// Sessions of Antigravity's `agy` (Gemini) running in a terminal outside the app.
// `agy` keeps each conversation in a SQLite file of its own,
// `~/.gemini/antigravity-cli/conversations/<id>.db`, one row a step, each step a
// protocol buffer. Its layout is not published: what is read here was learned
// from the files themselves (2026-10-14, `agy` 1.3.5), and an update may move it.
// Read wrong, a step shows nothing; it never shows something else. A subagent
// runs in the same process, in a conversation of its own that `invoke_subagent`
// tells the id of: it is an intern of the conversation that started it.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::conversation::{Entry, Page, Tool};
use crate::host::Hosts;
use crate::state::{Agent, Session, Status};

// the kinds of step, and how they stand
const TYPED: i64 = 14; // what the person typed
const MODEL: i64 = 15; // Gemini's turn: what it wrote, and the tools it calls
const TOOL_RAN: i64 = 132; // a tool, run
const DONE: i64 = 3;
const STOPPED: i64 = 6;
// A tool that ran and failed: Gemini is handed the error and carries on.
const ERRORED: i64 = 7;

// how many steps a page of the conversation holds, going back
const PAGE_STEPS: i64 = 200;
const LONGEST_TEXT: usize = 8000;
const LONGEST_NOTE: usize = 120;
const STARTED_NEAR_MS: i64 = 30_000;
const MB: u64 = 1024 * 1024;

// `agy`'s commands that are not a session
const NOT_SESSIONS: &[&str] = &[
    "agent", "agents", "changelog", "help", "install", "mcp", "mic-serve", "models", "plugin", "plugins", "remote-control", "update",
];

pub fn is_session(name: &str, cmd: &[String]) -> bool {
    let name = name.to_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name) == "agy" && !cmd.iter().skip(1).any(|arg| NOT_SESSIONS.contains(&arg.as_str()))
}

pub fn root() -> PathBuf {
    dirs::home_dir().unwrap_or_default().join(".gemini").join("antigravity-cli")
}

// A protocol buffer read without its schema: each field's number, and its value
// where that is a length of bytes (text, or a message in its own right).
mod pb {
    fn varint(bytes: &[u8], at: &mut usize) -> Option<u64> {
        let mut value = 0u64;
        for shift in (0..64).step_by(7) {
            let byte = *bytes.get(*at)?;
            *at += 1;
            value |= u64::from(byte & 0x7f) << shift;
            if byte < 0x80 {
                return Some(value);
            }
        }
        None
    }

    // the fields that hold bytes, in order; none for what is not a message
    pub fn fields(bytes: &[u8]) -> Vec<(u64, &[u8])> {
        let mut found = Vec::new();
        let mut at = 0;
        while at < bytes.len() {
            let Some(key) = varint(bytes, &mut at) else {
                return Vec::new();
            };
            match key & 7 {
                0 => {
                    if varint(bytes, &mut at).is_none() {
                        return Vec::new();
                    }
                }
                1 => at += 8,
                5 => at += 4,
                2 => {
                    let Some(len) = varint(bytes, &mut at).and_then(|len| usize::try_from(len).ok()) else {
                        return Vec::new();
                    };
                    let Some(value) = at.checked_add(len).and_then(|end| bytes.get(at..end)) else {
                        return Vec::new();
                    };
                    found.push((key >> 3, value));
                    at += len;
                }
                _ => return Vec::new(),
            }
        }
        found
    }

    pub fn all(bytes: &[u8], number: u64) -> Vec<&[u8]> {
        fields(bytes).into_iter().filter(|(n, _)| *n == number).map(|(_, value)| value).collect()
    }

    pub fn at<'a>(bytes: &'a [u8], path: &[u64]) -> Option<&'a [u8]> {
        path.iter().try_fold(bytes, |inside, number| all(inside, *number).into_iter().next())
    }

    pub fn text<'a>(bytes: &'a [u8], path: &[u64]) -> Option<&'a str> {
        std::str::from_utf8(at(bytes, path)?).ok().map(str::trim).filter(|text| !text.is_empty())
    }
}

fn clip(text: &str, most: usize) -> String {
    match text.char_indices().nth(most) {
        Some((cut, _)) => format!("{}…", text[..cut].trim_end()),
        None => text.to_owned(),
    }
}

fn one_line(text: &str) -> String {
    clip(text.lines().map(str::trim).find(|line| !line.is_empty()).unwrap_or(""), LONGEST_NOTE)
}

// a tool Gemini calls in its turn: its name, and what it is for, as `agy` says it
fn calls(model: &[u8]) -> Vec<Tool> {
    let Some(turn) = pb::at(model, &[20]) else {
        return Vec::new();
    };
    pb::all(turn, 7)
        .into_iter()
        .filter_map(|call| {
            let name = pb::text(call, &[2])?.to_owned();
            let args: Value = pb::text(call, &[3]).and_then(|args| serde_json::from_str(args).ok()).unwrap_or(Value::Null);
            let note = ["toolSummary", "CommandLine", "AbsolutePath", "TargetFile", "Query", "Pattern", "DirectoryPath"]
                .iter()
                .find_map(|key| args.get(key).and_then(Value::as_str).filter(|value| !value.is_empty()))
                .map(one_line);
            Some(Tool { name, note })
        })
        .collect()
}

// What a step shows: what was typed (field 19.2 of a typed step), what Gemini wrote
// (20.1 of its turn; 20.3, longer and beside its calls, is its thinking, and is not
// shown), and the tools it called (20.7). Tool runs, with what they printed, are not.
pub fn step_entries(idx: i64, kind: i64, payload: &[u8]) -> Vec<Entry> {
    let mut found = Vec::new();
    match kind {
        TYPED => {
            if let Some(text) = pb::text(payload, &[19, 2]).or_else(|| pb::text(payload, &[19, 3, 1])) {
                found.push((true, Some(clip(text, LONGEST_TEXT)), None));
            }
        }
        MODEL => {
            if let Some(text) = pb::text(payload, &[20, 1]) {
                found.push((false, Some(clip(text, LONGEST_TEXT)), None));
            }
            found.extend(calls(payload).into_iter().map(|tool| (false, None, Some(tool))));
        }
        _ => {}
    }
    found
        .into_iter()
        .enumerate()
        .map(|(n, (from_user, text, tool))| Entry {
            id: format!("{idx}#{n}"),
            from_user,
            text,
            tool,
        })
        .collect()
}

#[derive(Debug, PartialEq)]
pub struct Shape {
    pub status: Status,
    pub waiting_for: Option<String>,
    pub activity: Option<String>,
}

// How the session is, from its newest step: idle once Gemini has written its turn
// and called nothing more, or once a step was stopped or Gemini's own turn failed;
// waiting while it has asked a question; working at anything else, on the tool it
// last called, and thinking once a tool has failed.
pub fn shape(newest: Option<(i64, i64, &[u8])>) -> Shape {
    let idle = Shape {
        status: Status::Idle,
        waiting_for: None,
        activity: None,
    };
    let Some((kind, status, payload)) = newest else {
        return idle;
    };
    if kind == TOOL_RAN && status == ERRORED {
        return Shape {
            status: Status::Busy,
            waiting_for: None,
            activity: Some("thinking".into()),
        };
    }
    if status == STOPPED || status == ERRORED {
        return idle;
    }
    let called = if kind == MODEL || kind == TOOL_RAN {
        calls(payload).pop().map(|tool| tool.name).or_else(|| pb::text(payload, &[5, 4, 2]).map(str::to_owned))
    } else {
        None
    };
    match (kind, called.as_deref()) {
        (MODEL, None) if status == DONE => idle,
        (MODEL, Some("ask_question")) => Shape {
            status: Status::Waiting,
            waiting_for: Some("an answer to its question".into()),
            activity: None,
        },
        (_, Some(tool)) => Shape {
            status: Status::Busy,
            waiting_for: None,
            activity: Some(tool.to_owned()),
        },
        _ => Shape {
            status: Status::Busy,
            waiting_for: None,
            activity: Some(if kind == TYPED { "thinking" } else { "writing" }.into()),
        },
    }
}

fn open(db: &Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)?;
    // `agy` may be writing: wait for it a moment
    conn.busy_timeout(std::time::Duration::from_millis(250))?;
    Ok(conn)
}

fn shape_of(db: &Path) -> Shape {
    let newest = open(db).and_then(|conn| {
        conn.query_row("select step_type, status, step_payload from steps order by idx desc limit 1", [], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default()))
        })
    });
    match newest {
        Ok((kind, status, payload)) => shape(Some((kind, status, &payload))),
        Err(_) => shape(None),
    }
}

// A subagent a conversation started: its conversation, and what it was started as.
#[derive(Debug, PartialEq)]
pub struct Subagent {
    pub id: String,
    pub kind: String,
    pub desc: String,
}

// The conversation ids in what `invoke_subagent` returned, `"conversationId": "<id>"`,
// in order.
fn conversation_ids(bytes: &[u8]) -> Vec<String> {
    const KEY: &[u8] = b"\"conversationId\":";
    let mut ids: Vec<String> = Vec::new();
    let mut at = 0;
    while let Some(found) = bytes[at..].windows(KEY.len()).position(|window| window == KEY) {
        at += found + KEY.len();
        let rest = &bytes[at..];
        let start = rest.iter().position(|b| !b.is_ascii_whitespace() && *b != b'"').unwrap_or(rest.len());
        let len = rest[start..].iter().position(|b| !(b.is_ascii_alphanumeric() || *b == b'-')).unwrap_or(rest.len() - start);
        let id = String::from_utf8_lossy(&rest[start..start + len]).into_owned();
        if sound(&id) && !ids.contains(&id) {
            ids.push(id);
        }
    }
    ids
}

// The subagents conversation `db` has started, oldest first: each `invoke_subagent`
// is called with what each is to be (`Subagents`, with a `TypeName` and `Role`) and
// returns their conversations in the same order.
pub fn subagents(db: &Path) -> rusqlite::Result<Vec<Subagent>> {
    let conn = open(db)?;
    let mut query = conn.prepare("select step_payload from steps where step_type = ?1 and instr(step_payload, ?2) > 0 order by idx")?;
    let payloads: Vec<Vec<u8>> = query
        .query_map(rusqlite::params![TOOL_RAN, b"invoke_subagent".as_slice()], |row| row.get::<_, Option<Vec<u8>>>(0).map(Option::unwrap_or_default))?
        .collect::<rusqlite::Result<_>>()?;
    let mut found: Vec<Subagent> = Vec::new();
    for payload in payloads.iter().filter(|payload| pb::text(payload, &[5, 4, 2]) == Some("invoke_subagent")) {
        let args: Value = pb::text(payload, &[5, 4, 3]).and_then(|args| serde_json::from_str(args).ok()).unwrap_or(Value::Null);
        let asked = args.get("Subagents").and_then(Value::as_array).cloned().unwrap_or_default();
        for (n, id) in conversation_ids(payload).into_iter().enumerate() {
            if found.iter().any(|sub| sub.id == id) {
                continue;
            }
            let field = |key: &str| asked.get(n).and_then(|sub| sub.get(key)).and_then(Value::as_str).map(one_line).filter(|text| !text.is_empty());
            found.push(Subagent {
                id,
                kind: field("TypeName").unwrap_or_else(|| "subagent".into()),
                desc: field("Role").unwrap_or_default(),
            });
        }
    }
    Ok(found)
}

// The steps before `before` (all, the first time), a page at a time, as a page of
// the conversation; `start` and `end` are step numbers. A page that reaches the
// first step starts at 0, so nothing is asked for before it.
pub fn read_before(db: &Path, before: Option<u64>) -> rusqlite::Result<Page> {
    let conn = open(db)?;
    let before = before.map_or(i64::MAX, |before| before as i64);
    let mut query = conn.prepare("select idx, step_type, step_payload from steps where idx < ?1 order by idx desc limit ?2")?;
    let mut rows: Vec<(i64, i64, Vec<u8>)> = query
        .query_map([before, PAGE_STEPS], |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default())))?
        .collect::<rusqlite::Result<_>>()?;
    rows.reverse();
    let start = if (rows.len() as i64) < PAGE_STEPS { 0 } else { rows.first().map_or(0, |row| row.0) };
    let end = rows.last().map_or(0, |row| row.0 + 1);
    Ok(Page {
        entries: rows.iter().flat_map(|(idx, kind, payload)| step_entries(*idx, *kind, payload)).collect(),
        start: start as u64,
        end: end as u64,
    })
}

// The steps from `from` on, and the one before it again: a step is written more
// than once while it runs, and the page puts the later one in its place.
pub fn read_after(db: &Path, from: u64) -> rusqlite::Result<Page> {
    let conn = open(db)?;
    let mut query = conn.prepare("select idx, step_type, step_payload from steps where idx >= ?1 order by idx")?;
    let rows: Vec<(i64, i64, Vec<u8>)> = query
        .query_map([(from as i64 - 1).max(0)], |row| Ok((row.get(0)?, row.get(1)?, row.get::<_, Option<Vec<u8>>>(2)?.unwrap_or_default())))?
        .collect::<rusqlite::Result<_>>()?;
    let end = rows.last().map_or(from, |row| (row.0 + 1).max(from as i64) as u64);
    Ok(Page {
        entries: rows.iter().flat_map(|(idx, kind, payload)| step_entries(*idx, *kind, payload)).collect(),
        start: from,
        end,
    })
}

// the conversation file of an id, where there is one
fn conversation_file(root: &Path, id: &str) -> Option<PathBuf> {
    let db = root.join("conversations").join(format!("{id}.db"));
    (sound(id) && db.exists()).then_some(db)
}

// The conversation a process is in. `agy` holds `presence/<id>.lock` open for as
// long as it is in conversation `<id>`, so on Linux this is exact. It opens a
// conversation's own file only to write to it, and its subagents' too, which have
// no lock: so a file it holds is gone by only where it holds no lock.
#[cfg(target_os = "linux")]
fn open_conversation(pid: u32, root: &Path) -> Option<PathBuf> {
    let (presence, conversations) = (root.join("presence"), root.join("conversations"));
    let held: Vec<PathBuf> = fs::read_dir(format!("/proc/{pid}/fd")).ok()?.flatten().filter_map(|fd| fs::read_link(fd.path()).ok()).collect();
    let newest = |files: Vec<PathBuf>| files.into_iter().max_by_key(|file| fs::metadata(file).and_then(|meta| meta.modified()).ok());
    let in_dir = |dir: &Path, ext: &str| -> Vec<PathBuf> {
        held.iter().filter(|file| file.parent() == Some(dir) && file.extension().is_some_and(|e| e == ext)).cloned().collect()
    };
    let locked = in_dir(&presence, "lock").iter().filter_map(|lock| conversation_file(root, lock.file_stem()?.to_str()?)).collect();
    newest(locked).or_else(|| newest(in_dir(&conversations, "db")))
}

#[cfg(not(target_os = "linux"))]
fn open_conversation(_pid: u32, _root: &Path) -> Option<PathBuf> {
    None
}

// Elsewhere: the conversation whose presence lock was made as the process started
// (here, four seconds after). Two `agy` started within moments of each other may be
// taken for each other.
fn conversation_started(root: &Path, started: i64) -> Option<PathBuf> {
    fs::read_dir(root.join("presence"))
        .ok()?
        .flatten()
        .filter_map(|entry| {
            let made = modified_ms(&entry.path())?;
            let after = made - started;
            (-5_000..STARTED_NEAR_MS).contains(&after).then(|| (after.abs(), entry.path()))
        })
        .min_by_key(|(after, _)| *after)
        .and_then(|(_, lock)| conversation_file(root, lock.file_stem()?.to_str()?))
}

// Last, for the versions of `agy` that wrote the conversation into its history of
// prompts: the conversation of the newest prompt typed in its folder since it started.
fn conversation_near(root: &Path, cwd: &str, started: i64) -> Option<PathBuf> {
    let history = fs::read_to_string(root.join("history.jsonl")).ok()?;
    history.lines().rev().filter_map(|line| serde_json::from_str::<Value>(line).ok()).find_map(|record| {
        let at = record.get("timestamp")?.as_i64()?;
        if record.get("workspace")?.as_str()? != cwd || at < started - STARTED_NEAR_MS {
            return None;
        }
        conversation_file(root, record.get("conversationId")?.as_str()?)
    })
}

fn sound(id: &str) -> bool {
    !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

pub fn conversation_of(pid: u32, cwd: &str, started: i64, root: &Path) -> Option<PathBuf> {
    open_conversation(pid, root)
        .or_else(|| conversation_started(root, started))
        .or_else(|| conversation_near(root, cwd, started))
}

fn modified_ms(file: &Path) -> Option<i64> {
    let at = fs::metadata(file).ok()?.modified().ok()?;
    Some(at.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

struct Proc {
    pid: u32,
    parent: Option<u32>,
    cwd: String,
    started: i64,
    mem_mb: Option<u64>,
}

pub struct Agy {
    root: PathBuf,
    system: System,
    // the status last shown for each, and since when
    shown: HashMap<u32, (Status, i64)>,
}

fn created_ms(file: &Path) -> Option<i64> {
    let meta = fs::metadata(file).ok()?;
    let at = meta.created().or_else(|_| meta.modified()).ok()?;
    Some(at.duration_since(UNIX_EPOCH).ok()?.as_millis() as i64)
}

impl Agy {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            system: System::new(),
            shown: HashMap::new(),
        }
    }

    fn processes(&mut self) -> Vec<Proc> {
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing()
                .with_cmd(UpdateKind::OnlyIfNotSet)
                .with_cwd(UpdateKind::OnlyIfNotSet)
                .with_memory()
                .without_tasks(),
        );
        self.system
            .processes()
            .iter()
            .filter(|(_, process)| {
                let cmd: Vec<String> = process.cmd().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
                is_session(&process.name().to_string_lossy(), &cmd)
            })
            .map(|(pid, process)| Proc {
                pid: pid.as_u32(),
                parent: process.parent().map(Pid::as_u32),
                cwd: process.cwd().map(|cwd| cwd.to_string_lossy().into_owned()).unwrap_or_default(),
                started: process.start_time() as i64 * 1000,
                mem_mb: Some(process.memory()).filter(|&bytes| bytes > 0).map(|bytes| (bytes + MB / 2) / MB),
            })
            .collect()
    }

    // The subagents conversation `db` started that are working still, oldest first,
    // and how many it has started.
    fn interns(&self, db: &Path) -> (Vec<Agent>, usize) {
        let subagents = subagents(db).unwrap_or_default();
        let mut active: Vec<Agent> = subagents
            .iter()
            .filter_map(|sub| {
                let file = conversation_file(&self.root, &sub.id)?;
                (shape_of(&file).status != Status::Idle).then(|| Agent {
                    id: sub.id.clone(),
                    kind: sub.kind.clone(),
                    desc: sub.desc.clone(),
                    started_at: created_ms(&file).unwrap_or(0),
                })
            })
            .collect();
        active.sort_by_key(|agent| agent.started_at);
        (active, subagents.len())
    }

    // The `agy` sessions running now, as of `now`. `name_of` names a folder.
    pub fn sessions(&mut self, now: i64, hosts: &mut Hosts, mut name_of: impl FnMut(&str) -> String) -> Vec<Session> {
        let found = self.processes();
        self.shown.retain(|pid, _| found.iter().any(|p| p.pid == *pid));
        let mut sessions = Vec::new();
        for proc in found {
            let db = conversation_of(proc.pid, &proc.cwd, proc.started, &self.root);
            let shape = db.as_deref().map_or_else(|| shape(None), shape_of);
            let (agents, agents_spawned) = db.as_deref().map_or_else(|| (Vec::new(), 0), |db| self.interns(db));
            let since = {
                let shown = self.shown.entry(proc.pid).or_insert((shape.status, proc.started));
                if shown.0 != shape.status {
                    // when it changed, as near as can be told: the file's last write
                    *shown = (shape.status, db.as_deref().and_then(modified_ms).unwrap_or(now).min(now));
                }
                shown.1
            };
            sessions.push(Session {
                id: format!("agy-{}", proc.pid),
                pid: proc.pid,
                name: name_of(&proc.cwd),
                cwd: proc.cwd,
                background: false,
                status: shape.status,
                waiting_for: shape.waiting_for,
                activity: shape.activity,
                started_at: Some(proc.started),
                status_since: Some(since),
                mem_mb: proc.mem_mb,
                agents,
                agents_spawned,
                supervisor: None,
                tool: "agy".into(),
                terminal: None,
                host: hosts.shown(proc.pid),
                parent: proc.parent,
            });
        }
        sessions
    }
}

// The conversation of the `agy` session at `pid`, for the side panel. Only an
// `agy` session's process is looked at.
pub fn conversation_for(pid: u32) -> Option<PathBuf> {
    let mut system = System::new();
    let at = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[at]),
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always).with_cwd(UpdateKind::Always),
    );
    let process = system.process(at)?;
    let cmd: Vec<String> = process.cmd().iter().map(|arg| arg.to_string_lossy().into_owned()).collect();
    if !is_session(&process.name().to_string_lossy(), &cmd) {
        return None;
    }
    let cwd = process.cwd().map(|cwd| cwd.to_string_lossy().into_owned()).unwrap_or_default();
    conversation_of(pid, &cwd, process.start_time() as i64 * 1000, &root())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env;

    // a protocol buffer, written: each field a number and its bytes
    fn msg(fields: &[(u64, Vec<u8>)]) -> Vec<u8> {
        let mut out = Vec::new();
        let varint = |out: &mut Vec<u8>, mut value: u64| loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                break;
            }
            out.push(byte | 0x80);
        };
        for (number, bytes) in fields {
            varint(&mut out, number << 3 | 2);
            varint(&mut out, bytes.len() as u64);
            out.extend_from_slice(bytes);
        }
        out
    }

    fn s(text: &str) -> Vec<u8> {
        text.as_bytes().to_vec()
    }

    fn typed(text: &str) -> Vec<u8> {
        msg(&[(19, msg(&[(1, s("config")), (2, s(text))]))])
    }

    fn turn(text: Option<&str>, thinking: Option<&str>, calls: &[(&str, &str)]) -> Vec<u8> {
        let mut fields = Vec::new();
        if let Some(text) = text {
            fields.push((1, s(text)));
        }
        if let Some(thinking) = thinking {
            fields.push((3, s(thinking)));
        }
        for (name, args) in calls {
            fields.push((7, msg(&[(1, s("call_1")), (2, s(name)), (3, s(args))])));
        }
        msg(&[(5, msg(&[(12, s("meta"))])), (20, msg(&fields))])
    }

    #[test]
    fn shows_what_was_typed_written_and_called_and_not_the_thinking() {
        assert_eq!(
            step_entries(0, TYPED, &typed("fix the door")),
            vec![Entry {
                id: "0#0".into(),
                from_user: true,
                text: Some("fix the door".into()),
                tool: None
            }]
        );
        let model = turn(Some("Looking."), Some("I should look at the door"), &[("view_file", r#"{"AbsolutePath":"/repo/door.ts","toolSummary":"Viewing door.ts"}"#), ("run_command", r#"{"CommandLine":"npm test"}"#)]);
        let shown = step_entries(4, MODEL, &model);
        assert_eq!(shown.len(), 3);
        assert_eq!((shown[0].id.as_str(), shown[0].text.as_deref()), ("4#0", Some("Looking.")));
        assert_eq!(shown[1].tool, Some(Tool { name: "view_file".into(), note: Some("Viewing door.ts".into()) }));
        assert_eq!(shown[2].tool, Some(Tool { name: "run_command".into(), note: Some("npm test".into()) }));
        assert!(!shown.iter().any(|e| e.text.as_deref() == Some("I should look at the door")));
        assert!(step_entries(5, TOOL_RAN, &model).is_empty(), "a tool's run, and what it printed");
        assert!(step_entries(6, 101, &typed("x")).is_empty());
    }

    #[test]
    fn reads_nothing_from_what_is_not_a_step_it_knows() {
        assert!(step_entries(0, TYPED, b"\xff\xff\xff not protobuf").is_empty());
        assert!(step_entries(0, MODEL, &[]).is_empty());
        assert!(pb::fields(&[0x0a, 0x7f]).is_empty(), "a length past the end");
    }

    fn writing_turn() -> Vec<u8> {
        turn(Some("Half"), None, &[])
    }

    // `invoke_subagent`, run: what it was called with, and what it returned
    fn invoked(subagents: &str, returned: &str) -> Vec<u8> {
        let call = msg(&[(1, s("call_1")), (2, s("invoke_subagent")), (3, s(subagents))]);
        msg(&[(5, msg(&[(4, call)])), (140, msg(&[(2, msg(&[(1, s(returned))]))]))])
    }

    #[test]
    fn works_until_gemini_has_written_its_turn() {
        assert_eq!(shape(None).status, Status::Idle);
        let done = turn(Some("All done."), None, &[]);
        assert_eq!(shape(Some((MODEL, DONE, &done))).status, Status::Idle);
        let calling = turn(None, None, &[("run_command", "{}")]);
        assert_eq!(shape(Some((MODEL, DONE, &calling))), Shape { status: Status::Busy, waiting_for: None, activity: Some("run_command".into()) });
        assert_eq!(shape(Some((TYPED, DONE, &typed("go")))).activity.as_deref(), Some("thinking"));
        let asking = turn(None, None, &[("ask_question", "{}")]);
        assert_eq!(shape(Some((MODEL, DONE, &asking))).status, Status::Waiting);
        assert_eq!(shape(Some((TOOL_RAN, STOPPED, &calling))).status, Status::Idle, "stopped");
        assert_eq!(
            shape(Some((TOOL_RAN, ERRORED, &calling))),
            Shape { status: Status::Busy, waiting_for: None, activity: Some("thinking".into()) },
            "a tool failed, and Gemini carries on from its error"
        );
        assert_eq!(shape(Some((MODEL, ERRORED, &writing_turn()))).status, Status::Idle, "Gemini's own turn failed");
        let writing = turn(Some("Half"), None, &[]);
        assert_eq!(shape(Some((MODEL, 2, &writing))).activity.as_deref(), Some("writing"), "not done yet");
    }

    #[test]
    fn reads_the_subagents_a_conversation_started() {
        let root = env::temp_dir().join(format!("agent-office-agy-subs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let first = invoked(
            r#"{"Subagents":[{"TypeName":"research","Role":"Fixed asset researcher","Prompt":"Look"},{"TypeName":"sdd-developer","Role":"Builder"}]}"#,
            "Created the following subagents:\n{\n  \"conversationId\":  \"c-one\",\n  \"logAbsoluteUri\": \"file:///x\"\n}\n{\n  \"conversationId\": \"c-two\"\n}",
        );
        let viewed = msg(&[(5, msg(&[(4, msg(&[(2, s("view_file"))]))])), (140, s(r#"invoke_subagent "conversationId": "c-not""#))]);
        let db = conversation(&root.join("conversations"), "c-main", &[(TYPED, DONE, typed("go")), (TOOL_RAN, DONE, first), (TOOL_RAN, DONE, viewed)]);
        let found = subagents(&db).unwrap();
        assert_eq!(
            found,
            vec![
                Subagent { id: "c-one".into(), kind: "research".into(), desc: "Fixed asset researcher".into() },
                Subagent { id: "c-two".into(), kind: "sdd-developer".into(), desc: "Builder".into() },
            ],
            "and not from a file that only mentions it"
        );

        // one still working, one done: only the first is an intern
        conversation(&root.join("conversations"), "c-one", &[(TYPED, DONE, typed("look")), (MODEL, DONE, turn(None, None, &[("view_file", "{}")]))]);
        conversation(&root.join("conversations"), "c-two", &[(TYPED, DONE, typed("build")), (MODEL, DONE, turn(Some("Built."), None, &[]))]);
        let (interns, spawned) = Agy::new(root.clone()).interns(&db);
        assert_eq!(spawned, 2);
        assert_eq!(interns.len(), 1);
        assert_eq!((interns[0].id.as_str(), interns[0].kind.as_str(), interns[0].desc.as_str()), ("c-one", "research", "Fixed asset researcher"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn knows_a_session_from_its_other_commands() {
        let cmd = |args: &[&str]| args.iter().map(|arg| (*arg).to_owned()).collect::<Vec<_>>();
        assert!(is_session("agy", &cmd(&["agy"])));
        assert!(is_session("agy", &cmd(&["agy", "--continue"])));
        assert!(is_session("agy", &cmd(&["agy", "-p", "fix it"])));
        assert!(!is_session("agy", &cmd(&["agy", "update"])));
        assert!(!is_session("agy", &cmd(&["agy", "remote-control", "start"])));
        assert!(!is_session("gemini", &cmd(&["gemini"])));
    }

    fn conversation(dir: &Path, id: &str, steps: &[(i64, i64, Vec<u8>)]) -> PathBuf {
        fs::create_dir_all(dir).unwrap();
        let db = dir.join(format!("{id}.db"));
        let _ = fs::remove_file(&db);
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch("create table steps (idx INTEGER, step_type INTEGER, status INTEGER, step_payload BLOB)").unwrap();
        for (idx, (kind, status, payload)) in steps.iter().enumerate() {
            conn.execute("insert into steps values (?1, ?2, ?3, ?4)", rusqlite::params![idx as i64, kind, status, payload]).unwrap();
        }
        db
    }

    #[test]
    fn reads_a_conversation_back_a_page_at_a_time_and_on_as_it_grows() {
        let root = env::temp_dir().join(format!("agent-office-agy-{}", std::process::id()));
        let mut steps = Vec::new();
        for n in 0..250 {
            steps.push((TYPED, DONE, typed(&format!("prompt {n}"))));
        }
        let db = conversation(&root.join("conversations"), "c1", &steps);
        let last = read_before(&db, None).unwrap();
        assert_eq!((last.entries.len(), last.start, last.end), (200, 50, 250));
        let first = read_before(&db, Some(last.start)).unwrap();
        assert_eq!((first.entries.len(), first.start), (50, 0), "reached the first step");
        assert_eq!(first.entries[0].text.as_deref(), Some("prompt 0"));

        let conn = Connection::open(&db).unwrap();
        conn.execute("insert into steps values (250, ?1, 2, ?2)", rusqlite::params![MODEL, turn(Some("Half"), None, &[])]).unwrap();
        let after = read_after(&db, last.end).unwrap();
        assert_eq!(after.end, 251);
        assert_eq!(after.entries.last().unwrap().text.as_deref(), Some("Half"));
        assert_eq!(after.entries.first().unwrap().id, "249#0", "the step before again, in case it was written again");
        assert_eq!(shape_of(&db).activity.as_deref(), Some("writing"));
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_the_conversation_whose_presence_a_process_holds() {
        let root = env::temp_dir().join(format!("agent-office-agy-lock-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let db = conversation(&root.join("conversations"), "c-held", &[]);
        fs::create_dir_all(root.join("presence")).unwrap();
        let lock = root.join("presence/c-held.lock");
        fs::write(&lock, "").unwrap();
        // `tail -f` holds the lock open as `agy` does
        let mut holder = std::process::Command::new("tail").arg("-f").arg(&lock).stdout(std::process::Stdio::null()).spawn().unwrap();
        let mut seen = None;
        for _ in 0..50 {
            seen = open_conversation(holder.id(), &root);
            if seen.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        holder.kill().unwrap();
        holder.wait().unwrap();
        assert_eq!(seen, Some(db));
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn takes_the_conversation_it_holds_the_lock_of_over_a_subagent_s_it_writes() {
        let root = env::temp_dir().join(format!("agent-office-agy-sub-held-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let db = conversation(&root.join("conversations"), "c-main", &[]);
        fs::create_dir_all(root.join("presence")).unwrap();
        let lock = root.join("presence/c-main.lock");
        fs::write(&lock, "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        // written since, so the newest file it holds
        let sub = conversation(&root.join("conversations"), "c-sub", &[]);
        let mut holder = std::process::Command::new("tail").arg("-f").arg(&lock).arg(&sub).stdout(std::process::Stdio::null()).spawn().unwrap();
        let mut seen = None;
        for _ in 0..50 {
            seen = open_conversation(holder.id(), &root);
            if seen.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        holder.kill().unwrap();
        holder.wait().unwrap();
        assert_eq!(seen, Some(db));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_the_conversation_made_as_the_process_started() {
        let root = env::temp_dir().join(format!("agent-office-agy-start-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let db = conversation(&root.join("conversations"), "c-new", &[]);
        fs::create_dir_all(root.join("presence")).unwrap();
        fs::write(root.join("presence/c-new.lock"), "").unwrap();
        let made = modified_ms(&root.join("presence/c-new.lock")).unwrap();
        assert_eq!(conversation_started(&root, made - 4_000), Some(db), "four seconds after it started");
        assert_eq!(conversation_started(&root, made - 120_000), None, "long after: some other one's");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn finds_the_conversation_of_a_session_from_its_prompts() {
        let root = env::temp_dir().join(format!("agent-office-agy-near-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        conversation(&root.join("conversations"), "c-old", &[]);
        conversation(&root.join("conversations"), "c-mine", &[]);
        let line = |ws: &str, at: i64, id: Option<&str>| {
            let mut record = serde_json::json!({ "display": "x", "timestamp": at, "workspace": ws });
            if let Some(id) = id {
                record["conversationId"] = id.into();
            }
            record.to_string()
        };
        let history = [line("/repo", 1_000, Some("c-old")), line("/repo", 100_000, Some("c-mine")), line("/elsewhere", 100_500, Some("c-old")), line("/repo", 100_600, None)].join("\n");
        fs::write(root.join("history.jsonl"), history).unwrap();
        assert_eq!(conversation_near(&root, "/repo", 99_000), Some(root.join("conversations/c-mine.db")));
        assert_eq!(conversation_near(&root, "/repo", 500_000), None, "nothing typed since it started");
        assert_eq!(conversation_near(&root, "/nowhere", 0), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
