// Codex sessions running in a terminal outside the app. Codex keeps no file per
// open session as Claude Code does: its processes are found, and each is matched
// to the file it writes the session to, `~/.codex/sessions/<y>/<m>/<d>/rollout-
// <time>-<id>.jsonl`. From the end of that file comes whether it is working. A
// subagent Codex spawns runs in the same process, in a file of its own that names
// the thread that spawned it: it is an intern of that session, never one itself.

use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};

use serde_json::Value;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::host::Hosts;
use crate::state::{Agent, Session, Status};

// how much of the end of a session file is read for its status
const TAIL_BYTES: u64 = 64 * 1024;
// how far a session file's start may be from its process's start and still be its
const STARTED_NEAR_MS: i64 = 30_000;
const MB: u64 = 1024 * 1024;
// a cache that grows past this is emptied
const CACHE_LIMIT: usize = 500;
// What Codex in VS Code writes as its `originator`. Its sessions run in VS Code's
// own server, which is not watched, so none of its files is a terminal's.
const IN_VS_CODE: &str = "codex_vscode";
// A command Codex has asked leave for is waiting on the person only once it has
// gone unanswered this long: one already allowed runs at once, and is no news.
const LEAVE_AFTER_MS: i64 = 5_000;

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

// What the first line of a session file says: whose it is, where it was started
// and when, by what, and, for a subagent's, the thread that spawned it and what it
// is called.
#[derive(Clone, Debug, PartialEq)]
pub struct Meta {
    pub id: String,
    pub cwd: String,
    pub started: Option<i64>,
    pub originator: Option<String>,
    pub subagent: bool,
    pub spawned_by: Option<String>,
    pub nickname: Option<String>,
    pub role: Option<String>,
}

pub fn meta(file: &Path) -> Option<Meta> {
    let mut first = String::new();
    File::open(file).ok()?.take(64 * 1024).read_to_string(&mut first).ok();
    let line = first.lines().next()?;
    let record: Value = serde_json::from_str(line).ok()?;
    if record.get("type")?.as_str()? != "session_meta" {
        return None;
    }
    let payload = record.get("payload")?;
    let started = payload.get("timestamp").and_then(Value::as_str).and_then(parse_time).or_else(|| time_of(&record));
    let subagent = payload.pointer("/source/subagent");
    let spawn = subagent.and_then(|s| s.get("thread_spawn"));
    let text = |value: Option<&Value>| value.and_then(Value::as_str).filter(|text| !text.is_empty()).map(str::to_owned);
    let named = |key: &str| text(spawn.and_then(|s| s.get(key))).or_else(|| text(payload.get(key)));
    Some(Meta {
        id: text(payload.get("id")).unwrap_or_default(),
        cwd: payload.get("cwd")?.as_str()?.to_owned(),
        started,
        originator: text(payload.get("originator")),
        subagent: subagent.is_some(),
        spawned_by: text(spawn.and_then(|s| s.get("parent_thread_id"))),
        nickname: named("agent_nickname"),
        role: named("agent_role"),
    })
}

// What each session file's first line says, kept: it is written once.
#[derive(Default)]
pub struct Metas(HashMap<PathBuf, Meta>);

impl Metas {
    fn get(&mut self, file: &Path) -> Option<&Meta> {
        if !self.0.contains_key(file) {
            // a first line not written yet is looked at again next time
            let meta = meta(file)?;
            if self.0.len() >= CACHE_LIMIT {
                self.0.clear();
            }
            self.0.insert(file.to_owned(), meta);
        }
        self.0.get(file)
    }

    fn is_subagent(&mut self, file: &Path) -> bool {
        self.get(file).is_some_and(|meta| meta.subagent)
    }
}

#[derive(Debug, PartialEq)]
pub struct Shape {
    pub status: Status,
    pub since: Option<i64>,
    pub waiting_for: Option<String>,
    pub activity: Option<String>,
}

// The tool a call is to. Newer Codex calls every tool from a script it hands to
// one called `exec` (`await tools.multi_agent_v1__spawn_agent({...})`): there it
// is the first tool the script calls.
pub fn tool_of(payload: &Value) -> Option<&str> {
    let name = payload.get("name")?.as_str()?;
    if name != "exec" {
        return Some(name);
    }
    let script = payload.get("input").and_then(Value::as_str).unwrap_or_default();
    let called = script.split("tools.").skip(1).find_map(|rest| {
        let end = rest.find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))?;
        (end > 0 && rest[end..].starts_with('(')).then(|| &rest[..end])
    });
    Some(called.unwrap_or("script"))
}

// What a call waits on the person for, if anything: an answer, when it asks them
// something, or their leave, for a command Codex wants run outside its sandbox.
#[derive(Clone, Copy, Debug, PartialEq)]
enum Ask {
    Answer,
    Leave,
}

fn ask_of(payload: &Value) -> Option<Ask> {
    let tool = tool_of(payload)?;
    if tool.rsplit("__").next() == Some("request_user_input") {
        return Some(Ask::Answer);
    }
    let said = payload.get("arguments").or_else(|| payload.get("input")).and_then(Value::as_str).unwrap_or_default();
    said.contains("require_escalated").then_some(Ask::Leave)
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
// until it is complete or stopped, and what it last did while working. Waiting,
// instead, while a call that asks the person something is unanswered (where its
// turn lets Codex ask: not with `approval_policy` "never"), as of `now`. `cut` says
// the records start partway through the file: a task that has gone on so long its
// start is cut off is working still.
pub fn shape<'a>(newest_first: impl Iterator<Item = &'a Value>, cut: bool, now: i64) -> Shape {
    let mut last_tool = None;
    let mut writing = false;
    let mut in_task = false;
    let mut answered: HashSet<&str> = HashSet::new();
    let mut asking: Option<(Ask, Option<i64>)> = None;
    let mut may_ask = None;
    let working = |last_tool: Option<&str>, writing: bool, asking: Option<(Ask, Option<i64>)>, may_ask: Option<bool>, since: Option<i64>| match asking {
        Some((ask, at)) if may_ask.unwrap_or(true) && (ask == Ask::Answer || at.is_some_and(|at| now - at >= LEAVE_AFTER_MS)) => Shape {
            status: Status::Waiting,
            since: at.or(since),
            waiting_for: Some(if ask == Ask::Answer { "an answer to its question" } else { "leave to run a command" }.into()),
            activity: None,
        },
        _ => Shape {
            status: Status::Busy,
            since,
            waiting_for: None,
            activity: last_tool.map(short).or_else(|| Some(if writing { "writing" } else { "thinking" }.into())),
        },
    };
    for record in newest_first {
        let payload = record.get("payload");
        let kind = payload.and_then(|p| p.get("type")).and_then(Value::as_str);
        let record_kind = record.get("type").and_then(Value::as_str);
        let call_id = payload.and_then(|p| p.get("call_id")).and_then(Value::as_str);
        match (record_kind, kind) {
            (Some("event_msg"), Some("task_started")) => return working(last_tool, writing, asking, may_ask, time_of(record)),
            (Some("event_msg"), Some("task_complete" | "turn_aborted")) => {
                return Shape {
                    status: Status::Idle,
                    since: time_of(record),
                    waiting_for: None,
                    activity: None,
                };
            }
            (Some("response_item"), Some("function_call_output" | "custom_tool_call_output")) => answered.extend(call_id),
            (Some("response_item"), Some("function_call" | "custom_tool_call")) => {
                let payload = payload.unwrap_or(&Value::Null);
                if asking.is_none() && call_id.is_some_and(|id| !answered.contains(id)) {
                    asking = ask_of(payload).map(|ask| (ask, time_of(record)));
                }
                if last_tool.is_none() && !writing {
                    last_tool = tool_of(payload);
                }
            }
            (Some("event_msg"), Some("agent_message")) if last_tool.is_none() => writing = true,
            (Some("turn_context"), _) if may_ask.is_none() => {
                may_ask = Some(payload.and_then(|p| p.get("approval_policy")).and_then(Value::as_str) != Some("never"));
            }
            _ => {}
        }
        in_task |= matches!(record_kind, Some("response_item" | "event_msg"));
    }
    if cut && in_task {
        return working(last_tool, writing, asking, may_ask, None);
    }
    Shape {
        status: Status::Idle,
        since: None,
        waiting_for: None,
        activity: None,
    }
}

fn shape_of(file: &Path, now: i64) -> Shape {
    let read = || -> Option<(String, bool)> {
        let mut file = File::open(file).ok()?;
        let size = file.metadata().ok()?.len();
        let len = size.min(TAIL_BYTES);
        file.seek(SeekFrom::Start(size - len)).ok()?;
        let mut tail = Vec::new();
        file.take(len).read_to_end(&mut tail).ok()?;
        Some((String::from_utf8_lossy(&tail).into_owned(), len < size))
    };
    let (tail, cut) = read().unwrap_or_default();
    let records: Vec<Value> = tail.lines().filter_map(|line| serde_json::from_str(line).ok()).collect();
    shape(records.iter().rev(), cut, now)
}

// The session file a Codex process has open, not counting its subagents'. Codex
// keeps it open while it writes to it, so on Linux this is exact, even with two
// sessions in one folder.
#[cfg(target_os = "linux")]
fn open_rollout(pid: u32, root: &Path, metas: &mut Metas) -> Option<PathBuf> {
    fs::read_dir(format!("/proc/{pid}/fd"))
        .ok()?
        .flatten()
        .filter_map(|fd| fs::read_link(fd.path()).ok())
        .filter(|file| is_rollout(file, root) && !metas.is_subagent(file))
        .max_by_key(|file| fs::metadata(file).and_then(|meta| meta.modified()).ok())
}

#[cfg(not(target_os = "linux"))]
fn open_rollout(_pid: u32, _root: &Path, _metas: &mut Metas) -> Option<PathBuf> {
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

// Where it cannot be seen which file a process has open (elsewhere than Linux, or
// Codex from 0.16x on, whose window leaves its files to a server shared by all of
// them, `codex app-server --managed-daemon`): the newest one started in its folder
// about when it was or since, that is no subagent's, not VS Code's, and that no
// other process has `taken`. Two sessions in one folder may be taken for each other
// here.
fn rollout_near(recent: &[PathBuf], metas: &mut Metas, cwd: &str, started: i64, taken: &[PathBuf]) -> Option<PathBuf> {
    recent
        .iter()
        .find(|file| {
            !taken.contains(file)
                && metas.get(file).is_some_and(|meta| {
                    !meta.subagent
                        && meta.originator.as_deref() != Some(IN_VS_CODE)
                        && meta.cwd == cwd
                        && meta.started.is_some_and(|when| (when - started).abs() < STARTED_NEAR_MS || when > started)
                })
        })
        .cloned()
}

// The file each Codex session was last shown from, for the side panel to show the
// conversation the card does.
static SHOWN: LazyLock<Mutex<HashMap<u32, PathBuf>>> = LazyLock::new(Mutex::default);

pub fn rollout_of(pid: u32, cwd: &str, started: i64, root: &Path) -> Option<PathBuf> {
    let mut metas = Metas::default();
    open_rollout(pid, root, &mut metas).or_else(|| rollout_near(&recent_rollouts(root), &mut metas, cwd, started, &[]))
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
    metas: Metas,
    // a process's file, kept while the file stays where it was found
    files: HashMap<u32, PathBuf>,
    // the status last shown for each, and since when, for a task whose start is
    // too far back to be read
    shown: HashMap<u32, (Status, i64)>,
}

impl Codex {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            system: System::new(),
            metas: Metas::default(),
            files: HashMap::new(),
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

    // Each process's file. The ones it can be seen to hold first; then the rest are
    // guessed, the process started last first, each from what is left.
    fn files_of(&mut self, found: &[Proc], recent: &[PathBuf]) -> HashMap<u32, PathBuf> {
        let mut files = HashMap::new();
        for proc in found {
            if let Some(file) = open_rollout(proc.pid, &self.root, &mut self.metas) {
                files.insert(proc.pid, file);
            }
        }
        let mut rest: Vec<&Proc> = found.iter().filter(|proc| !files.contains_key(&proc.pid)).collect();
        rest.sort_by_key(|proc| std::cmp::Reverse(proc.started));
        for proc in rest {
            let taken: Vec<PathBuf> = files.values().cloned().collect();
            let guessed = rollout_near(recent, &mut self.metas, &proc.cwd, proc.started, &taken);
            // `/new` starts another file in the same process, so the last one found
            // stands only until another is
            if let Some(file) = guessed.or_else(|| self.files.get(&proc.pid).filter(|f| f.exists()).cloned()) {
                files.insert(proc.pid, file);
            }
        }
        files
    }

    // The subagents the thread `id` spawned that are working still, oldest first,
    // and how many it has spawned.
    fn interns(&mut self, id: &str, recent: &[PathBuf], now: i64) -> (Vec<Agent>, usize) {
        let mut active = Vec::new();
        let mut spawned = 0;
        for file in recent {
            let Some(meta) = self.metas.get(file).filter(|meta| meta.spawned_by.as_deref() == Some(id)) else {
                continue;
            };
            spawned += 1;
            let meta = meta.clone();
            if shape_of(file, now).status == Status::Idle {
                continue;
            }
            active.push(Agent {
                id: meta.id,
                // Codex's role for a subagent given none in particular is "default"
                kind: meta.role.filter(|role| role != "default").unwrap_or_else(|| "agent".into()),
                desc: meta.nickname.unwrap_or_default(),
                started_at: meta.started.unwrap_or(0),
            });
        }
        active.sort_by_key(|agent| agent.started_at);
        (active, spawned)
    }

    // The Codex sessions running now, as of `now`. `name_of` names a folder.
    pub fn sessions(&mut self, now: i64, hosts: &mut Hosts, mut name_of: impl FnMut(&str) -> String) -> Vec<Session> {
        let found = self.processes();
        self.files.retain(|pid, _| found.iter().any(|p| p.pid == *pid));
        self.shown.retain(|pid, _| found.iter().any(|p| p.pid == *pid));
        let recent = recent_rollouts(&self.root);
        let mut files = self.files_of(&found, &recent);
        let mut sessions = Vec::new();
        for proc in found {
            let file = files.remove(&proc.pid);
            if let Some(file) = &file {
                self.files.insert(proc.pid, file.clone());
            }
            let meta = file.as_deref().and_then(|file| self.metas.get(file)).cloned();
            let shape = file.as_deref().map(|file| shape_of(file, now));
            let (agents, agents_spawned) = match &meta {
                Some(meta) if !meta.id.is_empty() => self.interns(&meta.id, &recent, now),
                _ => (Vec::new(), 0),
            };
            let cwd = meta.as_ref().map(|meta| meta.cwd.clone()).filter(|cwd| !cwd.is_empty()).unwrap_or_else(|| proc.cwd.clone());
            let status = shape.as_ref().map_or(Status::Idle, |s| s.status);
            let since = shape
                .as_ref()
                .and_then(|s| s.since)
                .or_else(|| self.shown.get(&proc.pid).filter(|(was, _)| *was == status).map(|(_, at)| *at))
                .unwrap_or(proc.started);
            self.shown.insert(proc.pid, (status, since));
            sessions.push(Session {
                id: format!("codex-{}", proc.pid),
                pid: proc.pid,
                name: name_of(&cwd),
                cwd,
                background: false,
                status,
                waiting_for: shape.as_ref().and_then(|s| s.waiting_for.clone()),
                activity: shape.as_ref().and_then(|s| s.activity.clone()),
                started_at: meta.and_then(|meta| meta.started).or(Some(proc.started)),
                status_since: Some(since),
                mem_mb: proc.mem_mb,
                agents,
                agents_spawned,
                supervisor: None,
                tool: "codex".into(),
                terminal: None,
                host: hosts.shown(proc.pid),
                parent: proc.parent,
            });
        }
        if let Ok(mut shown) = SHOWN.lock() {
            shown.clone_from(&self.files);
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
    if let Some(file) = SHOWN.lock().ok().and_then(|shown| shown.get(&pid).cloned()).filter(|file| file.exists()) {
        return Some(file);
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
            shape(running.iter().rev(), false, 0),
            Shape {
                status: Status::Busy,
                since: at("2026-07-14T05:00:00Z"),
                waiting_for: None,
                activity: Some("command".into())
            }
        );
        let thinking = [started.clone()];
        assert_eq!(shape(thinking.iter().rev(), false, 0).activity.as_deref(), Some("thinking"));
        let done = [started.clone(), call("apply_patch"), event("task_complete", "2026-07-14T05:01:00Z")];
        assert_eq!(
            shape(done.iter().rev(), false, 0),
            Shape {
                status: Status::Idle,
                since: at("2026-07-14T05:01:00Z"),
                waiting_for: None,
                activity: None
            }
        );
        let stopped = [started, event("turn_aborted", "2026-07-14T05:02:00Z")];
        assert_eq!(shape(stopped.iter().rev(), false, 0).status, Status::Idle);
        assert_eq!(shape([].iter(), false, 0).status, Status::Idle, "nothing asked yet");
    }

    fn asked(name: &str, call_id: &str, at: &str, args: &str) -> Value {
        json!({ "timestamp": at, "type": "response_item", "payload": { "type": "function_call", "name": name, "call_id": call_id, "arguments": args } })
    }

    fn answer(call_id: &str) -> Value {
        json!({ "timestamp": "2026-07-14T05:09:00Z", "type": "response_item", "payload": { "type": "function_call_output", "call_id": call_id, "output": "ok" } })
    }

    fn turn_context(policy: &str) -> Value {
        json!({ "timestamp": "2026-07-14T05:00:00Z", "type": "turn_context", "payload": { "approval_policy": policy } })
    }

    #[test]
    fn waits_on_the_person_while_it_asks_them_something() {
        let started = event("task_started", "2026-07-14T05:00:00Z");
        let at = parse_time("2026-07-14T05:01:00Z").unwrap();
        let question = asked("request_user_input", "q1", "2026-07-14T05:01:00Z", r#"{"questions":[]}"#);
        let asking = [started.clone(), turn_context("on-request"), question.clone()];
        assert_eq!(
            shape(asking.iter().rev(), false, at),
            Shape {
                status: Status::Waiting,
                since: Some(at),
                waiting_for: Some("an answer to its question".into()),
                activity: None
            }
        );
        let answered = [started.clone(), turn_context("on-request"), question, answer("q1")];
        assert_eq!(shape(answered.iter().rev(), false, at).status, Status::Busy);

        let escalated = asked("exec_command", "c1", "2026-07-14T05:01:00Z", r#"{"cmd":"npm i","sandbox_permissions":"require_escalated"}"#);
        let leave = [started.clone(), turn_context("on-request"), escalated.clone()];
        assert_eq!(shape(leave.iter().rev(), false, at + 1_000).status, Status::Busy, "allowed already, maybe: not yet news");
        let waited = shape(leave.iter().rev(), false, at + LEAVE_AFTER_MS);
        assert_eq!((waited.status, waited.waiting_for.as_deref()), (Status::Waiting, Some("leave to run a command")));
        let never = [started.clone(), turn_context("never"), escalated];
        assert_eq!(shape(never.iter().rev(), false, at + 60_000).status, Status::Busy, "nobody is asked");

        // newer Codex, calling the tool from a script
        let script = json!({ "timestamp": "2026-07-14T05:01:00Z", "type": "response_item", "payload": { "type": "custom_tool_call", "name": "exec", "call_id": "s1", "input": "const r = await tools.request_user_input({questions: []});" } });
        assert_eq!(shape([started, script].iter().rev(), false, at).status, Status::Waiting);
    }

    #[test]
    fn names_the_tool_a_script_calls() {
        let script = |input: &str| json!({ "type": "custom_tool_call", "name": "exec", "input": input });
        assert_eq!(tool_of(&script("const r = await tools.multi_agent_v1__spawn_agent({message:\"hi\"});")), Some("multi_agent_v1__spawn_agent"));
        assert_eq!(tool_of(&script("const m = ALL_TOOLS.filter(x => x);\ntext(m);")), Some("script"));
        assert_eq!(tool_of(&json!({ "type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch" })), Some("apply_patch"));
        assert_eq!(short("multi_agent_v1__spawn_agent"), "spawn_agent");
    }

    #[test]
    fn works_still_at_a_task_so_long_its_start_is_cut_off() {
        let midway = [call("exec_command"), event("token_count", "2026-07-14T05:09:00Z")];
        assert_eq!(
            shape(midway.iter().rev(), true, 0),
            Shape {
                status: Status::Busy,
                since: None,
                waiting_for: None,
                activity: Some("command".into())
            }
        );
        assert_eq!(shape(midway.iter().rev(), false, 0).status, Status::Idle, "the whole file, and no task in it");
        let ended = [call("exec_command"), event("task_complete", "2026-07-14T05:10:00Z")];
        assert_eq!(shape(ended.iter().rev(), true, 0).status, Status::Idle);
        assert_eq!(shape([].iter(), true, 0).status, Status::Idle, "nothing read");
    }

    fn rollout(root: &Path, day: &str, name: &str, cwd: &str, at: &str) -> PathBuf {
        let dir = root.join(day);
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join(format!("rollout-{name}.jsonl"));
        let meta = json!({ "timestamp": at, "type": "session_meta", "payload": { "id": name, "cwd": cwd, "timestamp": at } });
        fs::write(&file, format!("{meta}\n")).unwrap();
        file
    }

    fn subagent_rollout(root: &Path, day: &str, name: &str, parent: &str, at: &str) -> PathBuf {
        let file = rollout(root, day, name, "/repo", at);
        let source = json!({ "subagent": { "thread_spawn": { "parent_thread_id": parent, "depth": 1, "agent_nickname": "Mendel", "agent_role": "explorer" } } });
        let meta = json!({ "timestamp": at, "type": "session_meta", "payload": { "id": name, "cwd": "/repo", "timestamp": at, "source": source } });
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
        // written last, so the newest files in the folder: a subagent's, and one of
        // Codex in VS Code: never the session's
        subagent_rollout(&root, "2026/07/14", "sub", "mine", "2026-07-14T05:03:00Z");
        let in_vs_code = rollout(&root, "2026/07/14", "vscode", "/repo", "2026-07-14T05:04:00Z");
        let meta_line = json!({ "type": "session_meta", "payload": { "id": "vscode", "cwd": "/repo", "timestamp": "2026-07-14T05:04:00Z", "originator": IN_VS_CODE } });
        fs::write(&in_vs_code, format!("{meta_line}\n")).unwrap();
        let found = meta(&mine).unwrap();
        assert_eq!((found.id.as_str(), found.cwd.as_str(), found.started, found.subagent), ("mine", "/repo", Some(start + 2000), false));
        let (recent, mut metas) = (recent_rollouts(&root), Metas::default());
        assert_eq!(rollout_near(&recent, &mut metas, "/repo", start, &[]), Some(mine.clone()));
        assert_eq!(rollout_near(&recent, &mut metas, "/nowhere", start, &[]), None);
        assert_eq!(rollout_near(&recent, &mut metas, "/repo", start, &[mine]), None, "taken by another process");
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_subagent_s_file_names_the_thread_that_spawned_it() {
        let root = env::temp_dir().join(format!("agent-office-codex-sub-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let file = subagent_rollout(&root, "2026/07/14", "sub", "mine", "2026-07-14T05:03:00Z");
        let found = meta(&file).unwrap();
        assert!(found.subagent);
        assert_eq!(found.spawned_by.as_deref(), Some("mine"));
        assert_eq!((found.nickname.as_deref(), found.role.as_deref()), (Some("Mendel"), Some("explorer")));
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn a_session_s_working_subagents_are_its_interns() {
        let root = env::temp_dir().join(format!("agent-office-codex-interns-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        rollout(&root, "2026/07/14", "mine", "/repo", "2026-07-14T05:00:00Z");
        let working = subagent_rollout(&root, "2026/07/14", "working", "mine", "2026-07-14T05:01:00Z");
        let done = subagent_rollout(&root, "2026/07/14", "done", "mine", "2026-07-14T05:02:00Z");
        subagent_rollout(&root, "2026/07/14", "elses", "someone-else", "2026-07-14T05:01:00Z");
        let append = |file: &Path, records: &[Value]| {
            let lines: String = records.iter().map(|record| format!("{record}\n")).collect();
            fs::write(file, fs::read_to_string(file).unwrap() + &lines).unwrap();
        };
        append(&working, &[event("task_started", "2026-07-14T05:01:01Z"), call("exec_command")]);
        append(&done, &[event("task_started", "2026-07-14T05:02:01Z"), event("task_complete", "2026-07-14T05:02:30Z")]);
        let mut codex = Codex::new(root.clone());
        let (active, spawned) = codex.interns("mine", &recent_rollouts(&root), 0);
        assert_eq!(spawned, 2);
        assert_eq!(active.len(), 1);
        assert_eq!((active[0].id.as_str(), active[0].kind.as_str(), active[0].desc.as_str()), ("working", "explorer", "Mendel"));
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
            seen = open_rollout(holder.id(), &root, &mut Metas::default());
            if seen.is_some() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        holder.kill().unwrap();
        holder.wait().unwrap();
        assert_eq!(seen, Some(file));
        assert_eq!(open_rollout(std::process::id(), &root, &mut Metas::default()), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
