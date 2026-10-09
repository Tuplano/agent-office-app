// The sessions Claude Code says are open: one `sessions/<pid>.json` each.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use super::tail::{Turn, TurnCache};
use super::{clip, read_json, text, CACHE_LIMIT};
use crate::state::Status;

// What a session file says, already checked and cut to size.
pub struct SessionFile {
    pub pid: u32,
    pub session_id: String,
    pub cwd: String,
    pub status: Status,
    pub waiting_for: Option<String>,
    pub background: bool,
    pub started_at: Option<i64>,
    pub status_since: Option<i64>,
}

pub fn read_files(dir: &Path) -> Vec<SessionFile> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|entry| is_session_file(&entry.file_name()))
        .filter_map(|entry| parse(&read_json(&entry.path())?))
        .collect()
}

fn is_session_file(name: &OsStr) -> bool {
    name.to_str()
        .and_then(|name| name.strip_suffix(".json"))
        .is_some_and(|pid| !pid.is_empty() && pid.bytes().all(|b| b.is_ascii_digit()))
}

fn parse(file: &Value) -> Option<SessionFile> {
    let pid = u32::try_from(file.get("pid")?.as_u64()?).ok()?;
    if pid == 0 {
        return None;
    }
    let status = match file.get("status").and_then(Value::as_str) {
        Some("busy") => Status::Busy,
        Some("waiting") => Status::Waiting,
        _ => Status::Idle,
    };
    let entrypoint = file.get("entrypoint").and_then(Value::as_str);
    Some(SessionFile {
        pid,
        session_id: text(file, "sessionId")?,
        cwd: text(file, "cwd")?,
        status,
        waiting_for: (status == Status::Waiting)
            .then(|| text(file, "waitingFor"))
            .flatten()
            .map(|what| clip(&what, 60)),
        background: entrypoint.is_some_and(|e| e.starts_with("sdk")),
        started_at: stamp(file, "startedAt"),
        status_since: stamp(file, "statusUpdatedAt").or_else(|| stamp(file, "updatedAt")),
    })
}

// a time in milliseconds that is there and not zero
fn stamp(file: &Value, key: &str) -> Option<i64> {
    let value = file.get(key)?;
    let ms = value.as_i64().or_else(|| value.as_f64().map(|ms| ms as i64))?;
    (ms != 0).then_some(ms)
}

// Where Claude Code keeps each session's transcripts.
pub struct Projects {
    root: PathBuf,
    found: HashMap<String, PathBuf>,
}

impl Projects {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            found: HashMap::new(),
        }
    }

    pub fn dir_for(&mut self, session_id: &str, cwd: &str) -> Option<PathBuf> {
        if let Some(dir) = self.found.get(session_id) {
            return Some(dir.clone());
        }
        let has = |dir: &Path| {
            dir.join(format!("{session_id}.jsonl")).exists() || dir.join(session_id).exists()
        };
        let guess = self.root.join(folder_name(cwd));
        let dir = if has(&guess) {
            guess
        } else {
            let dirs = fs::read_dir(&self.root).ok()?;
            dirs.flatten().map(|entry| entry.path()).find(|dir| has(dir))?
        };
        if self.found.len() > CACHE_LIMIT {
            self.found.clear();
        }
        self.found.insert(session_id.to_owned(), dir.clone());
        Some(dir)
    }
}

// Claude Code names a project's folder after its path, with a dash for everything
// that is not a letter or a digit. It counts in UTF-16 units, so this does too.
fn folder_name(cwd: &str) -> String {
    cwd.encode_utf16()
        .map(|unit| match u8::try_from(unit) {
            Ok(byte) if byte.is_ascii_alphanumeric() => byte as char,
            _ => '-',
        })
        .collect()
}

// A session is labelled with its repo: the nearest folder up from its cwd that
// holds a .git, or the cwd's own folder when it is not in a repo.
#[derive(Default)]
pub struct RepoNames(HashMap<String, String>);

impl RepoNames {
    pub fn name(&mut self, cwd: &str) -> String {
        if let Some(name) = self.0.get(cwd) {
            return name.clone();
        }
        let path = Path::new(cwd);
        let repo = path
            .ancestors()
            .find(|dir| dir.join(".git").exists())
            .unwrap_or(path);
        let name = match repo.file_name() {
            Some(name) => name.to_string_lossy().into_owned(),
            None => cwd.to_owned(),
        };
        if self.0.len() > CACHE_LIMIT {
            self.0.clear();
        }
        self.0.insert(cwd.to_owned(), name.clone());
        name
    }
}

pub fn current_activity(transcript: &Path, turns: &mut TurnCache) -> Option<String> {
    let meta = fs::metadata(transcript).ok()?;
    Some(activity(&turns.get(transcript, &meta)?))
}

fn activity(turn: &Turn) -> String {
    if turn.from_user {
        return "thinking".into();
    }
    match &turn.last_tool {
        Some(tool) => short_tool(tool).to_owned(),
        None if turn.has_text => "writing".into(),
        None => "thinking".into(),
    }
}

fn short_tool(name: &str) -> &str {
    if name.starts_with("mcp__") {
        name.rsplit("__").next().unwrap_or(name)
    } else {
        name
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn turn(from_user: bool, last_tool: Option<&str>, has_text: bool) -> Turn {
        Turn {
            from_user,
            stop: None,
            last_block: None,
            last_tool: last_tool.map(str::to_owned),
            has_text,
        }
    }

    #[test]
    fn activity_follows_the_last_turn() {
        assert_eq!(activity(&turn(true, Some("Bash"), true)), "thinking");
        assert_eq!(activity(&turn(false, Some("Bash"), true)), "Bash");
        assert_eq!(activity(&turn(false, Some("mcp__ide__getDiagnostics"), false)), "getDiagnostics");
        assert_eq!(activity(&turn(false, None, true)), "writing");
        assert_eq!(activity(&turn(false, None, false)), "thinking");
    }

    #[test]
    fn a_project_folder_is_named_after_its_path() {
        assert_eq!(folder_name("/home/sam/my_app.v2"), "-home-sam-my-app-v2");
        assert_eq!(folder_name("/home/sam/caf\u{e9}"), "-home-sam-caf-");
        // one character, two UTF-16 units
        assert_eq!(folder_name("/tmp/\u{1f600}"), "-tmp---");
    }

    #[test]
    fn only_pid_named_files_are_session_files() {
        assert!(is_session_file(OsStr::new("12345.json")));
        assert!(!is_session_file(OsStr::new(".json")));
        assert!(!is_session_file(OsStr::new("12a45.json")));
        assert!(!is_session_file(OsStr::new("12345.json.tmp")));
    }

    #[test]
    fn a_session_file_needs_a_pid_an_id_and_a_cwd() {
        let whole = json!({ "pid": 7, "sessionId": "abc", "cwd": "/work" });
        assert!(parse(&whole).is_some());
        for missing in ["pid", "sessionId", "cwd"] {
            let mut file = whole.clone();
            file.as_object_mut().unwrap().remove(missing);
            assert!(parse(&file).is_none(), "parsed without {missing}");
        }
        assert!(parse(&json!({ "pid": 0, "sessionId": "abc", "cwd": "/work" })).is_none());
        assert!(parse(&json!({ "pid": 7, "sessionId": "", "cwd": "/work" })).is_none());
    }

    #[test]
    fn a_session_file_is_read_leniently() {
        let file = parse(&json!({
            "pid": 7,
            "sessionId": "abc",
            "cwd": "/work",
            "status": "waiting",
            "waitingFor": "w".repeat(100),
            "entrypoint": "sdk-cli",
            "startedAt": 0,
            "updatedAt": 5000.0,
            "statusUpdatedAt": "yesterday",
            "somethingNew": { "nested": true },
        }))
        .unwrap();
        assert_eq!(file.status, Status::Waiting);
        assert_eq!(file.waiting_for.map(|what| what.len()), Some(60));
        assert!(file.background);
        assert_eq!(file.started_at, None);
        assert_eq!(file.status_since, Some(5000));
    }

    #[test]
    fn what_a_session_waits_for_is_kept_only_while_it_waits() {
        let file = parse(&json!({
            "pid": 7, "sessionId": "abc", "cwd": "/work", "status": "busy", "waitingFor": "a reply",
        }))
        .unwrap();
        assert_eq!(file.waiting_for, None);
    }
}
