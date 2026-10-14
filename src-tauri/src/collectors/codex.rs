// Codex sessions running in a terminal outside the app. Codex keeps no file per
// open session as Claude Code does: its processes are found, and each is matched
// to the file it writes the session to, `~/.codex/sessions/<y>/<m>/<d>/rollout-
// <time>-<id>.jsonl`. From the end of that file comes whether it is working.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use serde_json::Value;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::host::Hosts;
use crate::state::{Session, Status};

// how much of the end of a session file is read for its status
const TAIL_BYTES: u64 = 64 * 1024;
// how far a session file's start may be from its process's start and still be its
const STARTED_NEAR_MS: i64 = 30_000;
const MB: u64 = 1024 * 1024;

// Codex's commands that are not a session someone works in: servers, for VS Code
// and others, and things done once and over.
const NOT_SESSIONS: &[&str] = &[
    "app-server", "mcp-server", "exec-server", "mcp", "login", "logout", "completion", "apply", "sandbox", "debug", "features",
    "update", "doctor", "cloud", "archive", "unarchive", "delete", "plugin", "help", "remote-control",
];

pub fn is_session(name: &str, cmd: &[String]) -> bool {
    let name = name.to_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name) == "codex" && !cmd.iter().skip(1).any(|arg| NOT_SESSIONS.contains(&arg.as_str()))
}

// A time Codex writes, "2026-07-14T05:18:54.123Z", in milliseconds since the epoch.
pub fn parse_time(text: &str) -> Option<i64> {
    let (date, time) = text.trim_end_matches('Z').split_once('T')?;
    let mut ymd = date.splitn(3, '-').map(|part| part.parse::<i64>().ok());
    let (y, m, d) = (ymd.next()??, ymd.next()??, ymd.next()??);
    let mut hms = time.splitn(3, ':');
    let (h, min) = (hms.next()?.parse::<i64>().ok()?, hms.next()?.parse::<i64>().ok()?);
    let secs: f64 = hms.next()?.parse().ok()?;
    if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
        return None;
    }
    // days from 1970-01-01 to the date, by Howard Hinnant's reckoning
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(((days * 86_400 + h * 3600 + min * 60) as f64 * 1000.0 + secs * 1000.0).round() as i64)
}

fn time_of(record: &Value) -> Option<i64> {
    parse_time(record.get("timestamp")?.as_str()?)
}

// What the first line of a session file says: where it was started, and when.
pub fn meta(file: &Path) -> Option<(String, Option<i64>)> {
    let mut first = String::new();
    File::open(file).ok()?.take(64 * 1024).read_to_string(&mut first).ok();
    let line = first.lines().next()?;
    let record: Value = serde_json::from_str(line).ok()?;
    if record.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let payload = record.get("payload")?;
    let started = payload.get("timestamp").and_then(Value::as_str).and_then(parse_time).or_else(|| time_of(&record));
    Some((payload.get("cwd")?.as_str()?.to_owned(), started))
}

#[derive(Debug, PartialEq)]
pub struct Shape {
    pub status: Status,
    pub since: Option<i64>,
    pub activity: Option<String>,
}

// what a tool is called on a card
fn short(tool: &str) -> String {
    match tool {
        "exec_command" | "shell" | "local_shell" | "write_stdin" => "command".into(),
        "apply_patch" => "patch".into(),
        "web_search" => "search".into(),
        other => other.rsplit("__").next().unwrap_or(other).into(),
    }
}

// How the session is, from its records, last first: working from a task's start
// until it is complete or stopped, and what it last did while working.
pub fn shape<'a>(newest_first: impl Iterator<Item = &'a Value>) -> Shape {
    let mut last_tool = None;
    let mut writing = false;
    for record in newest_first {
        let payload = record.get("payload");
        let kind = payload.and_then(|p| p.get("type")).and_then(Value::as_str);
        match (record.get("type").and_then(Value::as_str), kind) {
            (Some("event_msg"), Some("task_started")) => {
                let activity = last_tool.map(|tool: &str| short(tool)).or_else(|| Some(if writing { "writing" } else { "thinking" }.into()));
                return Shape {
                    status: Status::Busy,
                    since: time_of(record),
                    activity,
                };
            }
            (Some("event_msg"), Some("task_complete" | "turn_aborted")) => {
                return Shape {
                    status: Status::Idle,
                    since: time_of(record),
                    activity: None,
                };
            }
            (Some("response_item"), Some("function_call" | "custom_tool_call")) if last_tool.is_none() && !writing => {
                last_tool = payload.and_then(|p| p.get("name")).and_then(Value::as_str);
            }
            (Some("event_msg"), Some("agent_message")) if last_tool.is_none() => writing = true,
            _ => {}
        }
    }
    Shape {
        status: Status::Idle,
        since: None,
        activity: None,
    }
}

fn shape_of(file: &Path) -> Shape {
    let read = || -> Option<String> {
        let mut file = File::open(file).ok()?;
        let size = file.metadata().ok()?.len();
        let len = size.min(TAIL_BYTES);
        file.seek(SeekFrom::Start(size - len)).ok()?;
        let mut tail = Vec::new();
        file.take(len).read_to_end(&mut tail).ok()?;
        Some(String::from_utf8_lossy(&tail).into_owned())
    };
    let tail = read().unwrap_or_default();
    let records: Vec<Value> = tail.lines().filter_map(|line| serde_json::from_str(line).ok()).collect();
    shape(records.iter().rev())
}

// The session file a Codex process has open. Codex keeps it open while it writes
// to it, so on Linux this is exact, even with two sessions in one folder.
#[cfg(target_os = "linux")]
fn open_rollout(pid: u32, root: &Path) -> Option<PathBuf> {
    fs::read_dir(format!("/proc/{pid}/fd"))
        .ok()?
        .flatten()
        .filter_map(|fd| fs::read_link(fd.path()).ok())
        .filter(|file| is_rollout(file, root))
        .max_by_key(|file| fs::metadata(file).and_then(|meta| meta.modified()).ok())
}

#[cfg(not(target_os = "linux"))]
fn open_rollout(_pid: u32, _root: &Path) -> Option<PathBuf> {
    None
}

fn is_rollout(file: &Path, root: &Path) -> bool {
    file.starts_with(root)
        && file.extension().is_some_and(|ext| ext == "jsonl")
        && file.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.starts_with("rollout-"))
}

// the session files of the last two days there are any for, newest first
fn recent_rollouts(root: &Path) -> Vec<PathBuf> {
    let newest = |dir: &Path, n: usize| -> Vec<PathBuf> {
        let mut dirs: Vec<PathBuf> = fs::read_dir(dir).into_iter().flatten().flatten().map(|entry| entry.path()).filter(|path| path.is_dir()).collect();
        dirs.sort();
        dirs.into_iter().rev().take(n).collect()
    };
    let mut days = Vec::new();
    for year in newest(root, 2) {
        for month in newest(&year, 2) {
            days.extend(newest(&month, 2));
        }
    }
    days.sort();
    let mut files: Vec<PathBuf> = days
        .iter()
        .rev()
        .take(2)
        .flat_map(|day| fs::read_dir(day).into_iter().flatten().flatten().map(|entry| entry.path()))
        .filter(|file| is_rollout(file, root))
        .collect();
    files.sort_by_key(|file| std::cmp::Reverse(fs::metadata(file).and_then(|meta| meta.modified()).ok()));
    files
}

// Where it cannot be seen which file a process has open: the newest one started in
// its folder about when it was. Two sessions in one folder may be taken for each
// other here.
fn rollout_near(root: &Path, cwd: &str, started: i64) -> Option<PathBuf> {
    recent_rollouts(root).into_iter().find(|file| {
        meta(file).is_some_and(|(at, when)| at == cwd && when.is_some_and(|when| (when - started).abs() < STARTED_NEAR_MS || when > started))
    })
}

pub fn rollout_of(pid: u32, cwd: &str, started: i64, root: &Path) -> Option<PathBuf> {
    open_rollout(pid, root).or_else(|| rollout_near(root, cwd, started))
}

pub fn sessions_root() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_default();
    let codex = match std::env::var_os("CODEX_HOME") {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => home.join(".codex"),
    };
    codex.join("sessions")
}

struct Proc {
    pid: u32,
    parent: Option<u32>,
    cwd: String,
    started: i64,
    mem_mb: Option<u64>,
}

pub struct Codex {
    root: PathBuf,
    system: System,
    // a process's file, kept while the file stays where it was found
    files: HashMap<u32, PathBuf>,
}

impl Codex {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            system: System::new(),
            files: HashMap::new(),
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

    // The Codex sessions running now, as of `now`. `name_of` names a folder.
    pub fn sessions(&mut self, hosts: &mut Hosts, mut name_of: impl FnMut(&str) -> String) -> Vec<Session> {
        let found = self.processes();
        self.files.retain(|pid, _| found.iter().any(|p| p.pid == *pid));
        let mut sessions = Vec::new();
        for proc in found {
            // `/new` starts another file in the same process: looked for again each time
            let file = rollout_of(proc.pid, &proc.cwd, proc.started, &self.root).or_else(|| self.files.get(&proc.pid).filter(|f| f.exists()).cloned());
            if let Some(file) = &file {
                self.files.insert(proc.pid, file.clone());
            }
            let (cwd, started) = file.as_deref().and_then(meta).unwrap_or((proc.cwd.clone(), None));
            let shape = file.as_deref().map(shape_of);
            let cwd = if cwd.is_empty() { proc.cwd.clone() } else { cwd };
            sessions.push(Session {
                id: format!("codex-{}", proc.pid),
                pid: proc.pid,
                name: name_of(&cwd),
                cwd,
                background: false,
                status: shape.as_ref().map_or(Status::Idle, |s| s.status),
                waiting_for: None,
                activity: shape.as_ref().and_then(|s| s.activity.clone()),
                started_at: started.or(Some(proc.started)),
                status_since: shape.as_ref().and_then(|s| s.since).or(Some(proc.started)),
                mem_mb: proc.mem_mb,
                agents: Vec::new(),
                agents_spawned: 0,
                supervisor: None,
                tool: "codex".into(),
                terminal: None,
                host: hosts.shown(proc.pid),
                parent: proc.parent,
            });
        }
        sessions
    }
}

// The file of the Codex session at `pid`, for the conversation shown in the side
// panel. Only a Codex session's process is looked at.
pub fn rollout_for(pid: u32) -> Option<PathBuf> {
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
    rollout_of(pid, &cwd, process.start_time() as i64 * 1000, &sessions_root())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::env;

    fn cmd(args: &[&str]) -> Vec<String> {
        args.iter().map(|arg| (*arg).to_owned()).collect()
    }

    #[test]
    fn knows_a_session_from_a_server() {
        assert!(is_session("codex", &cmd(&["/usr/lib/codex/codex"])));
        assert!(is_session("codex", &cmd(&["codex", "resume", "--last"])));
        assert!(is_session("codex", &cmd(&["codex", "-m", "gpt-5", "fix the door"])));
        assert!(is_session("codex.exe", &cmd(&["codex.exe"])));
        // as running here: VS Code's extension, and the daemon
        assert!(!is_session("codex", &cmd(&["codex", "-c", "features.code_mode_host=true", "app-server", "--analytics-default-enabled"])));
        assert!(!is_session("codex", &cmd(&["codex", "app-server", "daemon", "pid-update-loop"])));
        assert!(!is_session("codex", &cmd(&["codex", "login"])));
        assert!(!is_session("node", &cmd(&["node", "/usr/bin/codex"])), "the wrapper; its child is the session");
    }

    #[test]
    fn reads_the_times_codex_writes() {
        assert_eq!(parse_time("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_time("2026-07-14T05:18:54.123Z"), Some(1_784_006_334_123));
        assert_eq!(parse_time("2000-02-29T12:00:00Z"), Some(951_825_600_000));
        assert_eq!(parse_time("not a time"), None);
        assert_eq!(parse_time("2026-13-01T00:00:00Z"), None);
    }

    fn event(kind: &str, at: &str) -> Value {
        json!({ "timestamp": at, "type": "event_msg", "payload": { "type": kind } })
    }

    fn call(name: &str) -> Value {
        json!({ "timestamp": "2026-07-14T05:00:05Z", "type": "response_item", "payload": { "type": "function_call", "name": name, "arguments": "{}" } })
    }

    #[test]
    fn works_from_a_task_s_start_to_its_end() {
        let at = |s: &str| parse_time(s);
        let started = event("task_started", "2026-07-14T05:00:00Z");
        let running = [started.clone(), call("exec_command")];
        assert_eq!(
            shape(running.iter().rev()),
            Shape {
                status: Status::Busy,
                since: at("2026-07-14T05:00:00Z"),
                activity: Some("command".into())
            }
        );
        let thinking = [started.clone()];
        assert_eq!(shape(thinking.iter().rev()).activity.as_deref(), Some("thinking"));
        let done = [started.clone(), call("apply_patch"), event("task_complete", "2026-07-14T05:01:00Z")];
        assert_eq!(
            shape(done.iter().rev()),
            Shape {
                status: Status::Idle,
                since: at("2026-07-14T05:01:00Z"),
                activity: None
            }
        );
        let stopped = [started, event("turn_aborted", "2026-07-14T05:02:00Z")];
        assert_eq!(shape(stopped.iter().rev()).status, Status::Idle);
        assert_eq!(shape([].iter()).status, Status::Idle, "nothing asked yet");
    }

    fn rollout(root: &Path, day: &str, name: &str, cwd: &str, at: &str) -> PathBuf {
        let dir = root.join(day);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("rollout-{name}.jsonl"));
        let meta = json!({ "timestamp": at, "type": "session_meta", "payload": { "id": name, "cwd": cwd, "timestamp": at } });
        fs::write(&file, format!("{meta}\n")).unwrap();
        file
    }

    #[test]
    fn finds_the_file_of_a_session_by_its_folder_and_start() {
        let root = env::temp_dir().join(format!("agent-office-codex-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let start = parse_time("2026-07-14T05:00:00Z").unwrap();
        rollout(&root, "2026/07/13", "old", "/repo", "2026-07-13T05:00:00Z");
        let mine = rollout(&root, "2026/07/14", "mine", "/repo", "2026-07-14T05:00:02Z");
        rollout(&root, "2026/07/14", "other", "/elsewhere", "2026-07-14T05:00:01Z");
        assert_eq!(meta(&mine), Some(("/repo".into(), Some(start + 2000))));
        assert_eq!(rollout_near(&root, "/repo", start), Some(mine));
        assert_eq!(rollout_near(&root, "/nowhere", start), None);
        fs::remove_dir_all(&root).unwrap();
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn finds_the_file_a_process_has_open() {
        let root = env::temp_dir().join(format!("agent-office-codex-open-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let file = rollout(&root, "2026/07/14", "open", "/repo", "2026-07-14T05:00:00Z");
        // `tail -f` holds a file open as Codex does
        let mut holder = std::process::Command::new("tail").arg("-f").arg(&file).stdout(std::process::Stdio::null()).spawn().unwrap();
        let mut seen = None;
        for _ in 0..50 {
            seen = open_rollout(holder.id(), &root);
            if seen.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        holder.kill().unwrap();
        holder.wait().unwrap();
        assert_eq!(seen, Some(file));
        assert_eq!(open_rollout(std::process::id(), &root), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
