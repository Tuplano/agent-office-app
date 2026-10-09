// Watches the Claude Code sessions on this machine through the files Claude Code
// keeps about them. Reads metadata only, never transcript text. With claude-mem
// installed, each session's observer is attached to it as its supervisor.

mod agents;
mod observers;
mod processes;
mod sessions;
mod tail;

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::state::{OfficeState, Session, Status, Supervisor};

// a cache that grows past this is emptied
const CACHE_LIMIT: usize = 500;

struct Paths {
    home: PathBuf,
    sessions: PathBuf,
    projects: PathBuf,
    mem_db: PathBuf,
    observer_cwd: PathBuf,
}

impl Paths {
    fn from_env() -> Self {
        let home = dirs::home_dir().unwrap_or_default();
        let claude = dir_from_env("CLAUDE_CONFIG_DIR", home.join(".claude"));
        let mem = dir_from_env("CLAUDE_MEM_DATA_DIR", home.join(".claude-mem"));
        Self::under(home, &claude, &mem)
    }

    fn under(home: PathBuf, claude: &Path, mem: &Path) -> Self {
        Self {
            home,
            sessions: claude.join("sessions"),
            projects: claude.join("projects"),
            mem_db: mem.join("claude-mem.db"),
            observer_cwd: mem.join("observer-sessions"),
        }
    }
}

fn dir_from_env(var: &str, default: PathBuf) -> PathBuf {
    match env::var_os(var) {
        Some(dir) if !dir.is_empty() => PathBuf::from(dir),
        _ => default,
    }
}

pub struct Collector {
    paths: Paths,
    processes: processes::Processes,
    projects: sessions::Projects,
    repos: sessions::RepoNames,
    turns: tail::TurnCache,
    links: observers::Links,
}

impl Collector {
    pub fn new() -> Self {
        Self::with(Paths::from_env())
    }

    fn with(paths: Paths) -> Self {
        Self {
            processes: processes::Processes::new(),
            projects: sessions::Projects::new(paths.projects.clone()),
            repos: sessions::RepoNames::default(),
            turns: tail::TurnCache::default(),
            links: observers::Links::new(paths.mem_db.clone()),
            paths,
        }
    }

    // The state as of `now`, in milliseconds since the epoch.
    pub fn collect(&mut self, now: i64) -> OfficeState {
        let files = sessions::read_files(&self.paths.sessions);
        self.processes.refresh(files.iter().map(|file| file.pid));

        let mut sessions = Vec::new();
        for file in files {
            if !self.processes.is_running(file.pid) {
                continue;
            }
            let project_dir = self.projects.dir_for(&file.session_id, &file.cwd);
            let (agents, agents_spawned) = match &project_dir {
                Some(dir) => agents::read(dir, &file.session_id, now, &mut self.turns),
                None => (Vec::new(), 0),
            };
            let activity = match (file.status, &project_dir) {
                (Status::Busy, Some(dir)) => {
                    let transcript = dir.join(format!("{}.jsonl", file.session_id));
                    sessions::current_activity(&transcript, &mut self.turns)
                }
                _ => None,
            };
            sessions.push(Session {
                name: clip(&self.repos.name(&file.cwd), 60),
                mem_mb: self.processes.memory_mb(file.pid),
                id: file.session_id,
                pid: file.pid,
                cwd: file.cwd,
                background: file.background,
                status: file.status,
                waiting_for: file.waiting_for,
                activity,
                started_at: file.started_at,
                status_since: file.status_since,
                agents,
                agents_spawned,
                supervisor: None,
            });
        }
        sessions.sort_by_key(|s| (s.started_at.unwrap_or(0), s.pid));

        OfficeState {
            home: self.paths.home.to_string_lossy().into_owned(),
            sessions: self.seat_observers(sessions, now),
        }
    }

    // An observer is never shown as a session: it becomes the supervisor of the one
    // it watches. claude-mem replaces observers now and then, and a new one is not
    // in its database for the first few seconds; until it is, it is left out.
    fn seat_observers(&mut self, sessions: Vec<Session>, now: i64) -> Vec<Session> {
        let observer_cwd = &self.paths.observer_cwd;
        let (observers, mut sessions): (Vec<_>, Vec<_>) = sessions
            .into_iter()
            .partition(|s| Path::new(&s.cwd) == observer_cwd);
        for observer in observers {
            let Some(parent) = self.links.watched(&observer.id, now) else {
                continue;
            };
            let Some(watched) = sessions.iter_mut().find(|s| s.id == parent) else {
                continue;
            };
            if watched.supervisor.is_some_and(|s| s.status == Status::Busy) {
                continue;
            }
            let status = if observer.status == Status::Busy {
                Status::Busy
            } else {
                Status::Idle
            };
            watched.supervisor = Some(Supervisor { status });
        }
        sessions
    }
}

pub fn now_ms() -> i64 {
    millis(SystemTime::now())
}

fn millis(time: SystemTime) -> i64 {
    time.duration_since(UNIX_EPOCH)
        .map_or(0, |since| since.as_millis() as i64)
}

fn read_json(file: &Path) -> Option<Value> {
    serde_json::from_slice(&fs::read(file).ok()?).ok()
}

// a string field that is there and not empty
fn text(record: &Value, key: &str) -> Option<String> {
    let value = record.get(key)?.as_str()?;
    (!value.is_empty()).then(|| value.to_owned())
}

fn clip(value: &str, max: usize) -> String {
    value.chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use std::process;

    use rusqlite::Connection;

    use super::*;

    const SESSION: &str = "11111111-1111-4111-8111-111111111111";
    const OBSERVER: &str = "22222222-2222-4222-8222-222222222222";
    // far above any pid a system hands out
    const DEAD_PID: u32 = 0x7fff_fff0;

    // a made-up home with a Claude folder and a claude-mem folder in it
    struct Home(PathBuf);

    impl Home {
        fn new(name: &str) -> Self {
            let root = env::temp_dir().join(format!("agent-office-{name}-{}", process::id()));
            let _ = fs::remove_dir_all(&root);
            fs::create_dir_all(root.join("claude/sessions")).unwrap();
            fs::create_dir_all(root.join("claude/projects")).unwrap();
            fs::create_dir_all(root.join("mem")).unwrap();
            Self(root)
        }

        fn collector(&self) -> Collector {
            Collector::with(Paths::under(
                self.0.clone(),
                &self.0.join("claude"),
                &self.0.join("mem"),
            ))
        }

        fn write(&self, file: &str, body: &str) {
            let file = self.0.join(file);
            fs::create_dir_all(file.parent().unwrap()).unwrap();
            fs::write(file, body).unwrap();
        }

        fn session(&self, file: &str, pid: u32, id: &str, cwd: &Path, rest: &str) {
            let cwd = cwd.to_string_lossy();
            self.write(
                &format!("claude/sessions/{file}.json"),
                &format!(r#"{{"pid":{pid},"sessionId":"{id}","cwd":"{cwd}"{rest}}}"#),
            );
        }

        fn link(&self, observer: &str, session: &str) {
            let db = Connection::open(self.0.join("mem/claude-mem.db")).unwrap();
            db.execute_batch(
                "CREATE TABLE IF NOT EXISTS sdk_sessions (
                    id INTEGER PRIMARY KEY, content_session_id TEXT, memory_session_id TEXT)",
            )
            .unwrap();
            db.execute(
                "INSERT INTO sdk_sessions (content_session_id, memory_session_id) VALUES (?1, ?2)",
                [session, observer],
            )
            .unwrap();
        }
    }

    impl Drop for Home {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn a_running_session_is_reported_with_what_it_is_doing() {
        let home = Home::new("running");
        let repo = home.0.join("code/my-repo");
        let cwd = repo.join("src");
        fs::create_dir_all(&cwd).unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();
        home.session(
            "100",
            process::id(),
            SESSION,
            &cwd,
            r#","status":"busy","startedAt":1000,"updatedAt":2000,"statusUpdatedAt":3000,"entrypoint":"cli","waitingFor":"nothing""#,
        );
        // the project folder is not where the cwd says, so it has to be searched for
        home.write(
            &format!("claude/projects/elsewhere/{SESSION}.jsonl"),
            concat!(
                r#"{"type":"user","message":{"content":"hello"}}"#,
                "\n",
                r#"{"type":"assistant","message":{"content":[{"type":"text","text":"x"},{"type":"tool_use","name":"mcp__files__read_page"}]}}"#,
                "\n",
            ),
        );
        let subagents = format!("claude/projects/elsewhere/{SESSION}/subagents");
        home.write(
            &format!("{subagents}/agent-working.jsonl"),
            r#"{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Read"}]}}"#,
        );
        home.write(
            &format!("{subagents}/agent-working.meta.json"),
            r#"{"agentType":"Explore","description":"Look around"}"#,
        );
        home.write(
            &format!("{subagents}/agent-done.jsonl"),
            r#"{"type":"assistant","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"x"}]}}"#,
        );

        let state = home.collector().collect(now_ms());

        assert_eq!(state.home, home.0.to_string_lossy());
        assert_eq!(state.sessions.len(), 1);
        let session = &state.sessions[0];
        assert_eq!(session.id, SESSION);
        assert_eq!(session.pid, process::id());
        assert_eq!(session.name, "my-repo");
        assert_eq!(session.status, Status::Busy);
        assert_eq!(session.waiting_for, None);
        assert_eq!(session.activity.as_deref(), Some("read_page"));
        assert_eq!(session.started_at, Some(1000));
        assert_eq!(session.status_since, Some(3000));
        assert!(!session.background);
        assert!(session.mem_mb.is_some_and(|mb| mb > 0));
        assert_eq!(session.agents_spawned, 2);
        assert_eq!(session.agents.len(), 1);
        assert_eq!(session.agents[0].id, "agent-working");
        assert_eq!(session.agents[0].kind, "Explore");
        assert_eq!(session.agents[0].desc, "Look around");
        assert_eq!(session.supervisor, None);
    }

    #[test]
    fn an_observer_becomes_the_supervisor_of_the_session_it_watches() {
        let home = Home::new("observer");
        let work = home.0.join("work");
        fs::create_dir_all(&work).unwrap();
        home.session("100", process::id(), SESSION, &work, r#","status":"waiting","waitingFor":"a reply""#);
        home.session(
            "200",
            process::id(),
            OBSERVER,
            &home.0.join("mem/observer-sessions"),
            r#","status":"busy","entrypoint":"sdk-cli""#,
        );
        let mut collector = home.collector();

        // not in claude-mem's database yet: the observer is left out altogether
        let state = collector.collect(1_000_000);
        assert_eq!(state.sessions.len(), 1);
        assert_eq!(state.sessions[0].supervisor, None);
        assert_eq!(state.sessions[0].waiting_for.as_deref(), Some("a reply"));

        home.link(OBSERVER, SESSION);
        // asked again too soon, so the miss still stands
        let state = collector.collect(1_000_000 + 1_000);
        assert_eq!(state.sessions[0].supervisor, None);

        let state = collector.collect(1_000_000 + 6_000);
        assert_eq!(state.sessions.len(), 1);
        assert_eq!(state.sessions[0].id, SESSION);
        assert_eq!(state.sessions[0].supervisor, Some(Supervisor { status: Status::Busy }));
    }

    #[test]
    fn broken_and_ended_sessions_are_dropped_one_by_one() {
        let home = Home::new("broken");
        let work = home.0.join("work");
        fs::create_dir_all(&work).unwrap();
        home.session("100", process::id(), SESSION, &work, r#","status":"sleeping","nobody":"knows""#);
        home.session("200", DEAD_PID, OBSERVER, &work, "");
        home.write("claude/sessions/300.json", r#"{"pid":300,"sessionId":"#);
        home.write("claude/sessions/400.json", r#"{"pid":"four hundred","cwd":7}"#);
        home.write("claude/sessions/notes.json", r#"{"pid":1,"sessionId":"x","cwd":"/"}"#);

        let state = home.collector().collect(now_ms());

        assert_eq!(state.sessions.len(), 1);
        assert_eq!(state.sessions[0].id, SESSION);
        assert_eq!(state.sessions[0].status, Status::Idle);
        assert_eq!(state.sessions[0].name, "work");
        assert_eq!(state.sessions[0].agents_spawned, 0);
    }

    #[test]
    fn nothing_to_read_is_an_empty_office() {
        let home = Home::new("empty");
        fs::remove_dir_all(home.0.join("claude")).unwrap();
        assert_eq!(home.collector().collect(now_ms()).sessions, vec![]);
    }
}
