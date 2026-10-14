// The terminal coding tools the app can start. The page names one of these, and
// only these run: it never hands over a command line of its own.

use std::env;
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

pub struct Tool {
    pub name: &'static str,
    pub program: &'static str,
}

pub const TOOLS: &[Tool] = &[
    Tool {
        name: "claude",
        program: "claude",
    },
    Tool {
        name: "codex",
        program: "codex",
    },
    Tool {
        name: "gemini",
        program: "gemini",
    },
    // Google's Antigravity CLI, which runs Gemini
    Tool {
        name: "agy",
        program: "agy",
    },
];

pub fn find(name: &str) -> Option<&'static Tool> {
    TOOLS.iter().find(|tool| tool.name == name)
}

// Where programs are looked for. An app started from the desktop is not given the
// `PATH` a terminal has: what the shell's start-up files add (nvm, ~/.local/bin)
// is missing. So the person's own shell is asked, once, as a terminal would start
// it; and what the app was given is the fallback.
pub static PATH: LazyLock<Option<OsString>> = LazyLock::new(|| login_path().or_else(|| env::var_os("PATH")));

#[cfg(unix)]
fn login_path() -> Option<OsString> {
    use std::io::Read;
    use std::sync::mpsc;
    use std::thread;
    use std::time::Duration;

    use portable_pty::{native_pty_system, CommandBuilder, PtySize};

    // between marks, since start-up files may print things of their own
    const MARK: &str = "__agent_office_path__";
    let shell = env::var_os("SHELL").filter(|shell| !shell.is_empty())?;
    let script = if Path::new(&shell).ends_with("fish") {
        format!("printf '{MARK}%s{MARK}' (string join : $PATH)")
    } else {
        format!("printf '{MARK}%s{MARK}' \"$PATH\"")
    };
    // In a terminal of its own: an interactive shell takes over the terminal it is
    // started from, which would be the one `tauri dev` runs in.
    let pair = native_pty_system().openpty(PtySize::default()).ok()?;
    let mut command = CommandBuilder::new(&shell);
    command.args(["-l", "-i", "-c", &script]);
    let mut child = pair.slave.spawn_command(command).ok()?;
    drop(pair.slave);
    let mut reader = pair.master.try_clone_reader().ok()?;
    let (tell, told) = mpsc::channel();
    thread::spawn(move || {
        let mut out = Vec::new();
        let _ = reader.read_to_end(&mut out); // ends with an error on Linux, and that is the end
        let _ = tell.send(out);
    });
    // a start-up file that waits for something is given up on
    let out = told.recv_timeout(Duration::from_secs(5));
    let _ = child.kill();
    let _ = child.wait();
    between_marks(&String::from_utf8_lossy(&out.ok()?), MARK).map(OsString::from)
}

// Windows hands every program the whole `PATH`.
#[cfg(not(unix))]
fn login_path() -> Option<OsString> {
    None
}

fn between_marks<'a>(out: &'a str, mark: &str) -> Option<&'a str> {
    let start = out.find(mark)? + mark.len();
    let len = out[start..].find(mark)?;
    Some(&out[start..start + len]).filter(|path| !path.is_empty())
}

// The file `program` would run from on `path`, if it is there.
pub fn search(program: &str, path: &OsStr) -> Option<PathBuf> {
    env::split_paths(path).find_map(|dir| runnable(&dir.join(program)))
}

#[cfg(unix)]
fn runnable(file: &Path) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    let meta = file.metadata().ok()?;
    (meta.is_file() && meta.permissions().mode() & 0o111 != 0).then(|| file.to_path_buf())
}

#[cfg(not(unix))]
fn runnable(file: &Path) -> Option<PathBuf> {
    let exts = env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    exts.split(';')
        .map(|ext| file.with_extension(ext.trim_start_matches('.')))
        .find(|candidate| candidate.is_file())
}

// the tools that are installed, by name, in the order of the list
pub fn installed() -> Vec<&'static str> {
    let Some(path) = PATH.as_deref() else {
        return Vec::new();
    };
    TOOLS
        .iter()
        .filter(|tool| search(tool.program, path).is_some())
        .map(|tool| tool.name)
        .collect()
}

#[tauri::command]
pub async fn tools_found() -> Vec<&'static str> {
    // asking the shell can take a moment the first time; not on the window's thread
    tauri::async_runtime::spawn_blocking(installed).await.unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn knows_the_tools_by_name_and_nothing_else() {
        assert_eq!(find("codex").map(|tool| tool.program), Some("codex"));
        assert_eq!(find("agy").map(|tool| tool.program), Some("agy"));
        assert!(find("bash").is_none());
        assert!(find("claude --dangerously-skip-permissions").is_none());
        assert!(find("").is_none());
    }

    #[test]
    fn takes_the_path_from_between_the_marks_whatever_is_printed_around_it() {
        assert_eq!(between_marks("Welcome!\n@@/a:/b@@ bye", "@@"), Some("/a:/b"));
        assert_eq!(between_marks("@@@@", "@@"), None);
        assert_eq!(between_marks("@@/a", "@@"), None);
        assert_eq!(between_marks("nothing", "@@"), None);
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_program_that_can_run_on_the_path_and_not_one_that_cannot() {
        use std::os::unix::fs::PermissionsExt;
        let root = env::temp_dir().join(format!("agent-office-tools-{}", std::process::id()));
        let (empty, bin) = (root.join("empty"), root.join("bin"));
        fs::create_dir_all(&empty).unwrap();
        fs::create_dir_all(&bin).unwrap();
        fs::write(bin.join("codex"), "#!/bin/sh\n").unwrap();
        fs::set_permissions(bin.join("codex"), fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(bin.join("gemini"), "not a program").unwrap();
        let path = env::join_paths([&empty, &bin]).unwrap();

        assert_eq!(search("codex", &path), Some(bin.join("codex")));
        assert_eq!(search("gemini", &path), None);
        assert_eq!(search("claude", &path), None);
        fs::remove_dir_all(&root).unwrap();
    }
}
