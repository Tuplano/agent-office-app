// Terminals the app owns: a program run in a pseudo-terminal, typed to and read
// from by the page. The last of what each one printed is kept here, so a view
// that is closed and opened again starts from what was there.

use std::collections::HashMap;
use std::ffi::OsStr;
use std::io::{ErrorKind, Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicI64, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::thread::{self, Thread};

use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::State;

use crate::collectors::now_ms;
use crate::state::{Session, Status};
use crate::tools;

// how much of what a terminal printed is kept for a view that opens later
const KEEP: usize = 256 * 1024;
// A tool that tells nothing about itself is busy while it prints, and for this
// long after; then it is idle.
const BUSY_MS: i64 = 2000;

// What a terminal tells whoever is watching it: what it printed, and that its
// program has ended, with the code it ended with when there is one.
pub enum Event<'a> {
    Output(&'a [u8]),
    Exit(Option<u32>),
}

pub type Sink = Box<dyn FnMut(Event<'_>) + Send>;

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

#[derive(Default)]
struct Seen {
    kept: Vec<u8>,
    // the one watching, and the number it was given, so that a view letting go
    // late cannot take the place of the one that came after it
    sink: Option<(u32, Sink)>,
    // set once the program has ended and everything it printed has been read
    ended: Option<Option<u32>>,
}

impl Seen {
    fn keep(&mut self, bytes: &[u8]) {
        self.kept.extend_from_slice(bytes);
        if self.kept.len() > KEEP {
            // from the start of a line where there is one, so the replay does not
            // begin in the middle of one
            let cut = self.kept.len() - KEEP;
            let line = self.kept[cut..].iter().position(|&b| b == b'\n').map_or(cut, |at| cut + at + 1);
            self.kept.drain(..line);
        }
    }
}

struct Term {
    tool: &'static str,
    cwd: String,
    pid: Option<u32>,
    started_at: i64,
    printed_at: AtomicI64,
    // the status last shown for it, and since when, for a tool that does not say
    shown: Mutex<(Status, i64)>,
    // taken away once the program has ended (see `open`)
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    seen: Mutex<Seen>,
}

impl Term {
    fn printed(&self, bytes: &[u8]) {
        self.printed_at.store(now_ms(), Ordering::Relaxed);
        let mut seen = lock(&self.seen);
        seen.keep(bytes);
        if let Some((_, sink)) = seen.sink.as_mut() {
            sink(Event::Output(bytes));
        }
    }

    fn ended(&self, code: Option<u32>) {
        let mut seen = lock(&self.seen);
        seen.ended = Some(code);
        if let Some((_, mut sink)) = seen.sink.take() {
            sink(Event::Exit(code));
        }
    }
}

#[derive(Default)]
pub struct Terminals {
    open: Arc<Mutex<HashMap<u32, Arc<Term>>>>,
    next: AtomicU32,
    // the thread that collects the state, woken when a terminal opens or ends so
    // that the office hears of it at once and not at the next tick
    wake: Arc<Mutex<Option<Thread>>>,
}

fn poke(wake: &Mutex<Option<Thread>>) {
    if let Some(thread) = lock(wake).as_ref() {
        thread.unpark();
    }
}

// What to start in a terminal, and what the session is shown as.
pub struct Launch<'a> {
    pub tool: &'static str,
    pub program: &'a OsStr,
    pub args: &'a [&'a str],
    pub cwd: &'a Path,
    // the `PATH` it runs with, where the app's own is not the one to use
    pub path: Option<&'a OsStr>,
}

#[derive(Clone, Copy)]
pub struct Size {
    pub cols: u16,
    pub rows: u16,
}

impl Size {
    pub const START: Size = Size { cols: 80, rows: 24 };

    fn pty(self) -> PtySize {
        PtySize {
            rows: self.rows.max(1),
            cols: self.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        }
    }
}

fn said(err: impl std::fmt::Display) -> String {
    err.to_string()
}

impl Terminals {
    fn get(&self, id: u32) -> Result<Arc<Term>, String> {
        lock(&self.open).get(&id).cloned().ok_or_else(|| format!("there is no terminal {id}"))
    }

    pub fn wake_with(&self, thread: Thread) {
        *lock(&self.wake) = Some(thread);
    }

    pub fn count(&self) -> usize {
        lock(&self.open).len()
    }

    // Starts a program in a terminal and gives the terminal's id. It is dropped once
    // the program has ended and the last of what it printed has been passed on.
    pub fn open(&self, launch: Launch<'_>, size: Size) -> Result<u32, String> {
        let Launch { tool, program, args, cwd, path } = launch;
        if !cwd.is_dir() {
            return Err(format!("{} is not a folder", cwd.display()));
        }
        let pair = native_pty_system().openpty(size.pty()).map_err(said)?;
        let mut command = CommandBuilder::new(program);
        command.args(args);
        command.cwd(cwd);
        command.env("TERM", "xterm-256color");
        command.env("COLORTERM", "truecolor");
        if let Some(path) = path {
            command.env("PATH", path);
        }
        let mut child = pair.slave.spawn_command(command).map_err(said)?;
        // the program holds the other end now; with this one still open here, its
        // ending would never be seen
        drop(pair.slave);
        let mut reader = pair.master.try_clone_reader().map_err(said)?;
        let writer = pair.master.take_writer().map_err(said)?;
        let now = now_ms();
        let term = Arc::new(Term {
            tool,
            cwd: cwd.to_string_lossy().into_owned(),
            pid: child.process_id(),
            started_at: now,
            printed_at: AtomicI64::new(now),
            shown: Mutex::new((Status::Busy, now)),
            killer: Mutex::new(child.clone_killer()),
            master: Mutex::new(Some(pair.master)),
            writer: Mutex::new(writer),
            seen: Mutex::new(Seen::default()),
        });
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        lock(&self.open).insert(id, term.clone());
        poke(&self.wake);

        // Waits for the program to end, then lets go of the terminal: on Windows
        // that is what ends the reading below.
        let held = term.clone();
        let waiter = thread::spawn(move || {
            let code = child.wait().ok().map(|status| status.exit_code());
            lock(&held.master).take();
            code
        });
        let open = self.open.clone();
        let wake = self.wake.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 8192];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => term.printed(&buf[..n]),
                    Err(err) if err.kind() == ErrorKind::Interrupted => continue,
                    Err(_) => break, // what Linux says once the program's end is closed
                }
            }
            let code = waiter.join().ok().flatten();
            lock(&open).remove(&id);
            poke(&wake);
            term.ended(code);
        });
        Ok(id)
    }

    // Puts the sessions running in the app's terminals in with the rest, as of
    // `now`. One whose tool keeps a session file (Claude Code) is already among
    // them, found by its pid: it takes the terminal's session id, so it is the same
    // session, with the same person, from the moment the terminal opened. Any
    // other is made from what the app knows of it. `name_of` names a folder.
    pub fn merge(&self, sessions: &mut Vec<Session>, now: i64, mut name_of: impl FnMut(&str) -> String) {
        let open = lock(&self.open);
        let mut ids: Vec<u32> = open.keys().copied().collect();
        ids.sort_unstable();
        for id in ids {
            let term = &open[&id];
            let key = format!("term-{id}");
            let found = term.pid.and_then(|pid| sessions.iter_mut().find(|s| s.pid == pid));
            if let Some(session) = found {
                session.id = key;
                session.tool = term.tool.into();
                session.terminal = Some(id);
                session.host = None; // it is in the app
                continue;
            }
            let status = if now - term.printed_at.load(Ordering::Relaxed) < BUSY_MS {
                Status::Busy
            } else {
                Status::Idle
            };
            let since = {
                let mut shown = lock(&term.shown);
                if shown.0 != status {
                    *shown = (status, now);
                }
                shown.1
            };
            sessions.push(Session {
                id: key,
                pid: term.pid.unwrap_or(0),
                name: name_of(&term.cwd),
                cwd: term.cwd.clone(),
                background: false,
                status,
                waiting_for: None,
                activity: None,
                started_at: Some(term.started_at),
                status_since: Some(since),
                mem_mb: None,
                agents: Vec::new(),
                agents_spawned: 0,
                supervisor: None,
                tool: term.tool.into(),
                terminal: Some(id),
                host: None,
            });
        }
        sessions.sort_by_key(|s| (s.started_at.unwrap_or(0), s.pid));
    }

    // Hands what was kept to `sink`, then all that follows, until the program ends
    // or `detach` is called with the number given back here.
    pub fn attach(&self, id: u32, mut sink: Sink) -> Result<u32, String> {
        let term = self.get(id)?;
        let mut seen = lock(&term.seen);
        if !seen.kept.is_empty() {
            sink(Event::Output(&seen.kept));
        }
        let watch = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        match seen.ended {
            // it ended between being found and being locked
            Some(code) => sink(Event::Exit(code)),
            None => seen.sink = Some((watch, sink)),
        }
        Ok(watch)
    }

    pub fn detach(&self, id: u32, watch: u32) {
        if let Ok(term) = self.get(id) {
            let mut seen = lock(&term.seen);
            if seen.sink.as_ref().is_some_and(|(given, _)| *given == watch) {
                seen.sink = None;
            }
        }
    }

    pub fn write(&self, id: u32, bytes: &[u8]) -> Result<(), String> {
        let term = self.get(id)?;
        let mut writer = lock(&term.writer);
        writer.write_all(bytes).and_then(|()| writer.flush()).map_err(said)
    }

    pub fn resize(&self, id: u32, size: Size) -> Result<(), String> {
        let term = self.get(id)?;
        let master = lock(&term.master);
        match master.as_ref() {
            Some(master) => master.resize(size.pty()).map_err(said),
            None => Ok(()), // it has ended; there is nothing left to fit
        }
    }

    // Ends the program. The terminal goes the way any ended one does.
    pub fn close(&self, id: u32) -> Result<(), String> {
        let term = self.get(id)?;
        let _ = lock(&term.killer).kill(); // it may have ended already
        Ok(())
    }
}

// What the page calls. Output goes down the channel as raw bytes, which the page
// gets as an ArrayBuffer; the end goes as `{ "exit": code }`.

#[tauri::command]
pub async fn terminal_open(terminals: State<'_, Terminals>, tool: String, cwd: String) -> Result<u32, String> {
    let tool = tools::find(&tool).ok_or_else(|| format!("{tool} is not a tool the app knows"))?;
    // asking the shell for its `PATH` takes a moment the first time
    let path = tauri::async_runtime::spawn_blocking(|| tools::PATH.clone()).await.map_err(said)?;
    let program = path
        .as_deref()
        .and_then(|path| tools::search(tool.program, path))
        .ok_or_else(|| format!("{} is not installed", tool.program))?;
    let launch = Launch {
        tool: tool.name,
        program: program.as_os_str(),
        args: &[],
        cwd: Path::new(&cwd),
        path: path.as_deref(),
    };
    terminals.open(launch, Size::START)
}

#[tauri::command]
pub fn terminal_attach(terminals: State<'_, Terminals>, id: u32, channel: Channel) -> Result<u32, String> {
    terminals.attach(
        id,
        Box::new(move |event| {
            let _ = match event {
                Event::Output(bytes) => channel.send(InvokeResponseBody::Raw(bytes.to_vec())),
                Event::Exit(code) => channel.send(InvokeResponseBody::Json(serde_json::json!({ "exit": code }).to_string())),
            };
        }),
    )
}

#[tauri::command]
pub fn terminal_detach(terminals: State<'_, Terminals>, id: u32, watch: u32) {
    terminals.detach(id, watch);
}

#[tauri::command]
pub fn terminal_write(terminals: State<'_, Terminals>, id: u32, data: String) -> Result<(), String> {
    terminals.write(id, data.as_bytes())
}

#[tauri::command]
pub fn terminal_resize(terminals: State<'_, Terminals>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
    terminals.resize(id, Size { cols, rows })
}

#[tauri::command]
pub fn terminal_close(terminals: State<'_, Terminals>, id: u32) -> Result<(), String> {
    terminals.close(id)
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::sync::mpsc::{self, Receiver};
    use std::time::{Duration, Instant};

    const WAIT: Duration = Duration::from_secs(5);

    // what a watcher has been told: everything printed, and the end when it comes
    struct Watched {
        printed: Arc<Mutex<Vec<u8>>>,
        exit: Receiver<Option<u32>>,
    }

    impl Watched {
        fn text(&self) -> String {
            String::from_utf8_lossy(&lock(&self.printed)).into_owned()
        }

        fn until_printed(&self, what: &str) {
            let start = Instant::now();
            while !self.text().contains(what) {
                assert!(start.elapsed() < WAIT, "never printed {what:?}, only {:?}", self.text());
                thread::sleep(Duration::from_millis(10));
            }
        }

        fn until_ended(&self) -> Option<u32> {
            self.exit.recv_timeout(WAIT).expect("never ended")
        }
    }

    fn watch(terminals: &Terminals, id: u32) -> (u32, Watched) {
        let printed = Arc::new(Mutex::new(Vec::new()));
        let (tell, exit) = mpsc::channel();
        let into = printed.clone();
        let given = terminals
            .attach(
                id,
                Box::new(move |event| match event {
                    Event::Output(bytes) => lock(&into).extend_from_slice(bytes),
                    Event::Exit(code) => {
                        let _ = tell.send(code);
                    }
                }),
            )
            .unwrap();
        (given, Watched { printed, exit })
    }

    fn launch<'a>(program: &'a str, args: &'a [&'a str], cwd: &'a str) -> Launch<'a> {
        Launch {
            tool: "sh",
            program: OsStr::new(program),
            args,
            cwd: Path::new(cwd),
            path: None,
        }
    }

    fn sh(terminals: &Terminals, script: &str) -> u32 {
        terminals.open(launch("sh", &["-c", script], "/"), Size::START).unwrap()
    }

    #[test]
    fn passes_on_what_the_program_prints_and_its_end() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "sleep 0.2; printf hello; exit 3");
        let (_, watched) = watch(&terminals, id);
        assert_eq!(watched.until_ended(), Some(3));
        assert!(watched.text().contains("hello"));
        assert!(terminals.get(id).is_err(), "an ended terminal is dropped");
    }

    #[test]
    fn hands_what_was_typed_to_the_program() {
        let terminals = Terminals::default();
        let id = terminals.open(launch("cat", &[], "/"), Size::START).unwrap();
        let (_, watched) = watch(&terminals, id);
        terminals.write(id, b"ping\n").unwrap();
        watched.until_printed("ping");
        terminals.close(id).unwrap();
        watched.until_ended();
    }

    #[test]
    fn starts_a_later_watcher_from_what_was_kept() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "printf first; sleep 0.4; printf second; sleep 5");
        let (given, early) = watch(&terminals, id);
        early.until_printed("first");
        terminals.detach(id, given);

        let (_, late) = watch(&terminals, id);
        assert!(late.text().starts_with("first"), "{:?}", late.text());
        late.until_printed("second");
        assert!(!early.text().contains("second"), "one let go is told no more");
        terminals.close(id).unwrap();
        late.until_ended();
    }

    #[test]
    fn a_late_letting_go_leaves_the_next_watcher_alone() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "sleep 0.3; printf after; sleep 5");
        let (first, _) = watch(&terminals, id);
        let (_, second) = watch(&terminals, id);
        terminals.detach(id, first);
        second.until_printed("after");
        terminals.close(id).unwrap();
        second.until_ended();
    }

    #[test]
    fn tells_a_watcher_that_comes_after_the_end_at_once() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "sleep 5");
        let term = terminals.get(id).unwrap();
        terminals.close(id).unwrap();
        let start = Instant::now();
        while lock(&term.seen).ended.is_none() {
            assert!(start.elapsed() < WAIT, "never ended");
            thread::sleep(Duration::from_millis(10));
        }
        // found before it was dropped, watched after it ended
        lock(&terminals.open).insert(id, term);
        let (_, watched) = watch(&terminals, id);
        assert!(watched.exit.try_recv().is_ok());
    }

    #[test]
    fn resizes_the_terminal_the_program_sees() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "sleep 0.3; stty size");
        terminals.resize(id, Size { cols: 100, rows: 30 }).unwrap();
        let (_, watched) = watch(&terminals, id);
        watched.until_printed("30 100");
        watched.until_ended();
    }

    #[test]
    fn keeps_only_the_last_of_a_lot_from_a_line_start() {
        let mut seen = Seen::default();
        for _ in 0..3 {
            seen.keep(&[b'a'; KEEP / 2]);
            seen.keep(b"\nline\n");
        }
        assert!(seen.kept.len() <= KEEP);
        assert!(seen.kept.starts_with(b"line\n"), "the cut falls after a line ends");
        assert!(seen.kept.ends_with(b"\nline\n"));
    }

    #[test]
    fn refuses_what_is_not_there() {
        let terminals = Terminals::default();
        assert!(terminals.write(99, b"x").is_err());
        assert!(terminals.resize(99, Size::START).is_err());
        assert!(terminals.close(99).is_err());
        assert!(terminals.attach(99, Box::new(|_| {})).is_err());
        terminals.detach(99, 1); // nothing to let go of, and no harm
        assert!(terminals.open(launch("sh", &[], "/no/such/folder"), Size::START).is_err());
        assert!(terminals.open(launch("no-such-program-here", &[], "/"), Size::START).is_err());
    }

    fn found(id: &str, pid: u32) -> Session {
        Session {
            id: id.into(),
            pid,
            name: "found".into(),
            cwd: "/".into(),
            background: false,
            status: Status::Waiting,
            waiting_for: Some("permission".into()),
            activity: None,
            started_at: Some(1),
            status_since: Some(1),
            mem_mb: Some(100),
            agents: Vec::new(),
            agents_spawned: 0,
            supervisor: None,
            tool: "claude".into(),
            terminal: None,
            host: None,
        }
    }

    #[test]
    fn makes_a_session_of_a_terminal_whose_tool_tells_nothing_busy_while_it_prints() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "printf hi; sleep 5");
        let (_, watched) = watch(&terminals, id);
        watched.until_printed("hi");
        let mut sessions = vec![found("other", 1)];
        let now = now_ms();
        terminals.merge(&mut sessions, now, |cwd| format!("named {cwd}"));
        let made = sessions.iter().find(|s| s.terminal == Some(id)).expect("a session for the terminal");
        assert_eq!((made.id.as_str(), made.tool.as_str(), made.name.as_str()), (format!("term-{id}").as_str(), "sh", "named /"));
        assert_eq!(made.status, Status::Busy);
        assert_eq!(sessions.len(), 2);

        // quiet for long enough, it is idle, since then
        let later = now + BUSY_MS + 1;
        let mut sessions = Vec::new();
        terminals.merge(&mut sessions, later, |_| String::new());
        assert_eq!((sessions[0].status, sessions[0].status_since), (Status::Idle, Some(later)));
        let mut sessions = Vec::new();
        terminals.merge(&mut sessions, later + 500, |_| String::new());
        assert_eq!(sessions[0].status_since, Some(later), "still idle since then");
        terminals.close(id).unwrap();
        watched.until_ended();
    }

    #[test]
    fn hands_its_id_to_the_session_a_tool_tells_of_itself() {
        let terminals = Terminals::default();
        let id = sh(&terminals, "sleep 5");
        let pid = lock(&terminals.open)[&id].pid.unwrap();
        let mut sessions = vec![found("11111111-real", pid), found("elsewhere", 1)];
        terminals.merge(&mut sessions, now_ms(), |_| String::new());
        assert_eq!(sessions.len(), 2, "no second session for the same program");
        let mine = sessions.iter().find(|s| s.pid == pid).unwrap();
        assert_eq!((mine.id.as_str(), mine.terminal), (format!("term-{id}").as_str(), Some(id)));
        assert_eq!(mine.status, Status::Waiting, "what the tool says of itself stays");
        assert_eq!(sessions.iter().find(|s| s.pid == 1).unwrap().terminal, None);
        terminals.close(id).unwrap();
    }

    #[test]
    fn wakes_the_collector_when_a_terminal_opens_and_when_it_ends() {
        let terminals = Terminals::default();
        let (tell, told) = mpsc::channel();
        let watcher = thread::spawn(move || {
            for _ in 0..2 {
                thread::park_timeout(WAIT);
                tell.send(()).unwrap();
            }
        });
        terminals.wake_with(watcher.thread().clone());
        let id = sh(&terminals, "sleep 0.2");
        told.recv_timeout(Duration::from_secs(1)).expect("woken by the opening");
        assert_eq!(terminals.count(), 1);
        told.recv_timeout(Duration::from_secs(2)).expect("woken by the end");
        assert!(terminals.get(id).is_err());
        assert_eq!(terminals.count(), 0);
    }
}
