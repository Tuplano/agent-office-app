// The program a session started elsewhere runs in: VS Code, a terminal, tmux. It
// is found by walking up from the session's process. On X11 its window can be
// brought forward, so that answering the session is one click away.

use std::collections::HashMap;
use std::path::Path;

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

use crate::state::Host;

// how far up from a session a host is looked for
const MOST_UP: usize = 32;
const CACHE_LIMIT: usize = 500;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Kind {
    pub name: &'static str,
    // it has windows of its own; tmux has only the terminal it is shown in
    window: bool,
}

const fn kind(name: &'static str, window: bool) -> Kind {
    Kind { name, window }
}

// What a process is called, lowercased and without ".exe", to the host it is. Linux
// cuts a process's name to 15 bytes, so a long one is listed as Linux has it too.
fn kind_of(process: &str) -> Option<Kind> {
    let name = process.to_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    Some(match name {
        "code" | "code-oss" => kind("VS Code", true),
        "code-insiders" | "code - insiders" => kind("VS Code Insiders", true),
        "codium" | "vscodium" => kind("VSCodium", true),
        "cursor" => kind("Cursor", true),
        "windsurf" => kind("Windsurf", true),
        "gnome-terminal-server" | "gnome-terminal-" => kind("GNOME Terminal", true),
        "kgx" | "gnome-console" => kind("Console", true),
        "ptyxis" | "ptyxis-agent" => kind("Ptyxis", true),
        "konsole" => kind("Konsole", true),
        "kitty" => kind("kitty", true),
        "alacritty" => kind("Alacritty", true),
        "wezterm-gui" | "wezterm" => kind("WezTerm", true),
        "ghostty" => kind("Ghostty", true),
        "xfce4-terminal" => kind("Xfce Terminal", true),
        "tilix" => kind("Tilix", true),
        "foot" => kind("foot", true),
        "xterm" => kind("XTerm", true),
        "terminal" => kind("Terminal", true),
        "iterm2" => kind("iTerm2", true),
        "windowsterminal" => kind("Windows Terminal", true),
        "tmux: server" | "tmux" => kind("tmux", false),
        _ => return None,
    })
}

// The host in a chain of processes going up from a session (its parent first),
// and the process that owns its windows: the highest of a run of the same kind,
// since VS Code runs a session's terminal in a process of its own under the one
// whose windows they are.
pub fn host_in(chain: &[(u32, String)]) -> Option<(Kind, u32)> {
    let first = chain.iter().position(|(_, name)| kind_of(name).is_some())?;
    let found = kind_of(&chain[first].1)?;
    let top = chain[first..]
        .iter()
        .take_while(|(_, name)| kind_of(name) == Some(found))
        .last()?;
    Some((found, top.0))
}

// Whether a window can be brought forward here: on X11, which lets one program ask
// for another's window to be shown. Wayland does not.
pub fn can_raise() -> bool {
    cfg!(target_os = "linux")
        && std::env::var_os("DISPLAY").is_some()
        && std::env::var("XDG_SESSION_TYPE").map_or(true, |kind| kind != "wayland")
}

// Hosts looked up by session pid, once each: a process does not change its parents.
pub struct Hosts {
    system: System,
    found: HashMap<u32, Option<(Kind, u32)>>,
}

impl Hosts {
    pub fn new() -> Self {
        Self {
            system: System::new(),
            found: HashMap::new(),
        }
    }

    fn chain(&mut self, pid: u32) -> Vec<(u32, String)> {
        let mut chain = Vec::new();
        let mut at = Pid::from_u32(pid);
        for _ in 0..MOST_UP {
            self.system
                .refresh_processes_specifics(ProcessesToUpdate::Some(&[at]), true, ProcessRefreshKind::nothing());
            let Some(parent) = self.system.process(at).and_then(|process| process.parent()) else {
                break;
            };
            self.system
                .refresh_processes_specifics(ProcessesToUpdate::Some(&[parent]), true, ProcessRefreshKind::nothing());
            let Some(process) = self.system.process(parent) else {
                break;
            };
            chain.push((parent.as_u32(), process.name().to_string_lossy().into_owned()));
            at = parent;
        }
        chain
    }

    pub fn of(&mut self, pid: u32) -> Option<(Kind, u32)> {
        if let Some(found) = self.found.get(&pid) {
            return *found;
        }
        if self.found.len() > CACHE_LIMIT {
            self.found.clear();
        }
        let found = host_in(&self.chain(pid));
        self.found.insert(pid, found);
        found
    }

    // as the page is told of it
    pub fn shown(&mut self, pid: u32) -> Option<Host> {
        self.of(pid).map(|(kind, _)| Host {
            name: kind.name.into(),
            raise: kind.window && can_raise(),
        })
    }
}

// Of the windows a host has, the one a session in `cwd` is likeliest to be in: the
// one whose title names the deepest of the folders `cwd` is in. VS Code puts its
// folder in the title, and a terminal its shell's folder.
pub fn choose(windows: &[(u32, String)], cwd: &str) -> Option<u32> {
    let folders: Vec<&str> = Path::new(cwd)
        .ancestors()
        .filter_map(|dir| dir.file_name()?.to_str())
        .collect();
    let score = |title: &str| folders.iter().position(|folder| title.contains(folder)).unwrap_or(usize::MAX);
    windows.iter().min_by_key(|(_, title)| score(title)).map(|(window, _)| *window)
}

// Brings forward the window the session at `pid` (working in `cwd`) is in.
#[tauri::command]
pub async fn session_raise(pid: u32, cwd: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (kind, owner) = Hosts::new().of(pid).ok_or("it runs in nothing the app knows")?;
        if !(kind.window && can_raise()) {
            return Err(format!("{} cannot be brought forward from here", kind.name));
        }
        raise(owner, &cwd)
    })
    .await
    .map_err(|err| err.to_string())?
}

#[cfg(target_os = "linux")]
fn raise(owner: u32, cwd: &str) -> Result<(), String> {
    x11::raise(owner, cwd).map_err(|err| err.to_string())
}

#[cfg(not(target_os = "linux"))]
fn raise(_owner: u32, _cwd: &str) -> Result<(), String> {
    Err("not on this system".into())
}

#[cfg(target_os = "linux")]
mod x11 {
    use std::error::Error;

    use x11rb::connection::Connection;
    use x11rb::protocol::xproto::{AtomEnum, ClientMessageEvent, ConnectionExt, EventMask};

    // Asks the window manager to show and focus a window of the program `owner`, as
    // a taskbar would (`_NET_ACTIVE_WINDOW`, from a pager).
    pub fn raise(owner: u32, cwd: &str) -> Result<(), Box<dyn Error>> {
        let (conn, screen) = x11rb::connect(None)?;
        let root = conn.setup().roots[screen].root;
        let atom = |name: &str| -> Result<u32, Box<dyn Error>> { Ok(conn.intern_atom(false, name.as_bytes())?.reply()?.atom) };
        let (list, pid, title, utf8, active) = (
            atom("_NET_CLIENT_LIST")?,
            atom("_NET_WM_PID")?,
            atom("_NET_WM_NAME")?,
            atom("UTF8_STRING")?,
            atom("_NET_ACTIVE_WINDOW")?,
        );
        let windows: Vec<u32> = conn
            .get_property(false, root, list, AtomEnum::WINDOW, 0, u32::MAX)?
            .reply()?
            .value32()
            .map(Iterator::collect)
            .unwrap_or_default();
        let mut its = Vec::new();
        for window in windows {
            let owned = conn.get_property(false, window, pid, AtomEnum::CARDINAL, 0, 1)?.reply()?;
            if owned.value32().and_then(|mut value| value.next()) == Some(owner) {
                let name = conn.get_property(false, window, title, utf8, 0, 1024)?.reply()?;
                its.push((window, String::from_utf8_lossy(&name.value).into_owned()));
            }
        }
        let window = super::choose(&its, cwd).ok_or("its window was not found")?;
        let ask = ClientMessageEvent::new(32, window, active, [2u32, 0, 0, 0, 0]);
        conn.send_event(false, root, EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY, ask)?;
        conn.flush()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chain(names: &[(u32, &str)]) -> Vec<(u32, String)> {
        names.iter().map(|(pid, name)| (*pid, (*name).to_owned())).collect()
    }

    #[test]
    fn finds_vs_code_as_the_process_that_owns_its_windows() {
        // as seen here: claude in VS Code's terminal
        let up = chain(&[(99405, "bash"), (65859, "code"), (65005, "code"), (9027, "gnome-shell"), (1956, "systemd")]);
        assert_eq!(host_in(&up), Some((kind("VS Code", true), 65005)));
    }

    #[test]
    fn knows_terminals_by_the_names_their_systems_give_them() {
        assert_eq!(host_in(&chain(&[(2, "bash"), (3, "gnome-terminal-")])), Some((kind("GNOME Terminal", true), 3)));
        assert_eq!(host_in(&chain(&[(2, "pwsh.exe"), (3, "WindowsTerminal.exe")])), Some((kind("Windows Terminal", true), 3)));
        assert_eq!(host_in(&chain(&[(2, "zsh"), (3, "kitty")])).map(|(kind, _)| kind.name), Some("kitty"));
    }

    #[test]
    fn stops_at_tmux_which_has_no_window_to_bring_forward() {
        let (found, _) = host_in(&chain(&[(2, "bash"), (3, "tmux: server"), (1, "systemd")])).unwrap();
        assert_eq!(found.name, "tmux");
        assert!(!found.window);
    }

    #[test]
    fn finds_nothing_for_a_session_with_no_host() {
        // claude-mem's observer, started by its worker
        assert_eq!(host_in(&chain(&[(76557, "bun"), (1956, "systemd")])), None);
        assert_eq!(host_in(&[]), None);
    }

    #[test]
    fn chooses_the_window_whose_title_names_the_deepest_folder() {
        let windows = [
            (1, "notes.md - notes - Visual Studio Code".to_owned()),
            (2, "App.tsx - agent-office-app - Visual Studio Code".to_owned()),
            (3, "Welcome - Visual Studio Code".to_owned()),
        ];
        assert_eq!(choose(&windows, "/home/sam/Portfolio/agent-office-app"), Some(2));
        assert_eq!(choose(&windows, "/home/sam/Portfolio/agent-office-app/src-tauri"), Some(2), "a folder inside it");
        assert_eq!(choose(&windows, "/srv/elsewhere"), Some(1), "the first, when no title says");
        assert_eq!(choose(&windows[2..], "/srv/elsewhere"), Some(3));
        assert_eq!(choose(&[], "/srv"), None);
    }

    #[test]
    fn looks_up_this_process_and_finds_its_parents() {
        let mut hosts = Hosts::new();
        assert!(!hosts.chain(std::process::id()).is_empty());
        let first = hosts.of(std::process::id());
        assert_eq!(hosts.of(std::process::id()), first, "kept");
    }
}
