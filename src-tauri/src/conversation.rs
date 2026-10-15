// The conversation of one session started elsewhere, Claude Code's, Codex's or
// Antigravity's (`agy`), for the side panel: read from its transcript only while the panel is open on it, and kept
// nowhere. The page asks for the end of it first, then for what has been added
// since, every second, and for what came before when it is scrolled up to.

use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

use crate::collectors;
use crate::collectors::{agy, codex};

// how much of the file is read at a time, back from where the page has got to
const WINDOW: u64 = 512 * 1024;
// what is read forward at a time; a file that grew by more is caught up in steps
const MOST_AFTER: u64 = 8 * 1024 * 1024;
// the longest a prompt or a reply is shown, and a tool's note
const LONGEST_TEXT: usize = 8000;
const LONGEST_NOTE: usize = 120;

// One thing said or done, in the order it happened. A turn of the assistant's is
// several: what it wrote, and each tool it called.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Entry {
    pub id: String,
    pub from_user: bool,
    pub text: Option<String>,
    pub tool: Option<Tool>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Tool {
    pub name: String,
    // what it was for: the command, the file, the search
    pub note: Option<String>,
}

// The entries in the bytes of the file from `start` to `end`. Both are line starts
// (or the file's end), so the page asks on from one or back from the other.
#[derive(Debug, PartialEq, Serialize)]
pub struct Page {
    pub entries: Vec<Entry>,
    pub start: u64,
    pub end: u64,
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

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let len = text[start..].find(close)?;
    Some(text[start..start + len].trim())
}

// What a person typed. A slash command is stored wrapped in tags, and is shown as
// typed; what Claude Code adds of its own in tags is not something anyone said.
fn prompt(text: &str) -> Option<String> {
    if let Some(name) = between(text, "<command-name>", "</command-name>") {
        let args = between(text, "<command-args>", "</command-args>").unwrap_or("");
        return Some(format!("{name} {args}").trim().to_owned());
    }
    let text = text.trim();
    (!text.is_empty() && !text.starts_with("<local-command") && !text.starts_with("<command-")).then(|| clip(text, LONGEST_TEXT))
}

fn note(name: &str, input: &Value) -> Option<String> {
    let field = |key: &str| input.get(key).and_then(Value::as_str).filter(|value| !value.is_empty());
    let found = match name {
        "Bash" => field("description").or_else(|| field("command")),
        "Read" | "Write" | "Edit" | "MultiEdit" | "NotebookEdit" => field("file_path").or_else(|| field("notebook_path")),
        "Grep" | "Glob" => field("pattern"),
        "Task" | "Agent" => field("description"),
        "WebFetch" => field("url"),
        "WebSearch" => field("query"),
        "Skill" => field("skill"),
        _ => None,
    };
    found.map(one_line)
}

// How a tool writes its sessions down.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Format {
    Claude,
    Codex,
    // a SQLite file of steps, not lines (`collectors/agy.rs`): its places are step numbers
    Agy,
}

// The entries in one line of a Claude Code transcript: none for most, which are tool
// results, the model's thinking, notes Claude Code keeps for itself, and subagents' work.
pub fn entries(record: &Value) -> Vec<Entry> {
    let from_user = match record.get("type").and_then(Value::as_str) {
        Some("user") => true,
        Some("assistant") => false,
        _ => return Vec::new(),
    };
    let flag = |key: &str| record.get(key).and_then(Value::as_bool).unwrap_or(false);
    if flag("isMeta") || flag("isSidechain") {
        return Vec::new();
    }
    let id = record.get("uuid").and_then(Value::as_str).unwrap_or_default();
    let said = |text: String| Entry {
        id: String::new(),
        from_user,
        text: Some(text),
        tool: None,
    };
    let content = record.get("message").and_then(|message| message.get("content"));
    let mut found: Vec<Entry> = match content {
        Some(Value::String(text)) if from_user => prompt(text).map(said).into_iter().collect(),
        Some(Value::String(text)) => (!text.trim().is_empty()).then(|| said(clip(text.trim(), LONGEST_TEXT))).into_iter().collect(),
        Some(Value::Array(blocks)) => blocks
            .iter()
            .filter_map(|block| match block.get("type").and_then(Value::as_str)? {
                "text" => {
                    let text = block.get("text")?.as_str()?;
                    if from_user {
                        prompt(text).map(said)
                    } else {
                        (!text.trim().is_empty()).then(|| said(clip(text.trim(), LONGEST_TEXT)))
                    }
                }
                "tool_use" if !from_user => {
                    let name = block.get("name")?.as_str()?.to_owned();
                    let note = block.get("input").and_then(|input| note(&name, input));
                    Some(Entry {
                        id: String::new(),
                        from_user,
                        text: None,
                        tool: Some(Tool { name, note }),
                    })
                }
                _ => None,
            })
            .collect(),
        _ => Vec::new(),
    };
    for (n, entry) in found.iter_mut().enumerate() {
        entry.id = format!("{id}#{n}");
    }
    found
}

// The entries in one line of a Codex session file, which starts `at` bytes into it.
// What was typed and written back are its `message` records, which every version
// of Codex writes (its `user_message` and `agent_message` events say the same again
// in older files, and are gone from newer ones); each command and patch is a call.
// Not shown: what they printed, the reasoning, and what Codex sends along of its
// own: the `developer` instructions, and the blocks of a turn that open with a tag
// (`<environment_context>`, `<turn_aborted>`) or are the project's AGENTS.md.
pub fn codex_entries(record: &Value, at: u64) -> Vec<Entry> {
    let Some(payload) = record.get("payload") else {
        return Vec::new();
    };
    if record.get("type").and_then(Value::as_str) != Some("response_item") {
        return Vec::new();
    }
    let field = |key: &str| payload.get(key).and_then(Value::as_str);
    let mut found: Vec<Entry> = match field("type") {
        Some("message") => {
            let from_user = match field("role") {
                Some("user") => true,
                Some("assistant") => false,
                _ => return Vec::new(),
            };
            let blocks = payload.get("content").and_then(Value::as_array).map_or(&[][..], Vec::as_slice);
            blocks
                .iter()
                .filter(|block| matches!(block.get("type").and_then(Value::as_str), Some("input_text" | "output_text")))
                .filter_map(|block| block.get("text")?.as_str())
                .map(str::trim)
                .filter(|text| !text.is_empty())
                .filter(|text| !from_user || !(text.starts_with('<') || text.starts_with("# AGENTS.md")))
                .map(|text| Entry {
                    id: String::new(),
                    from_user,
                    text: Some(clip(text, LONGEST_TEXT)),
                    tool: None,
                })
                .collect()
        }
        Some("function_call") => field("name")
            .map(|name| {
                let args: Value = field("arguments").and_then(|args| serde_json::from_str(args).ok()).unwrap_or(Value::Null);
                let note = match args.get("cmd").or_else(|| args.get("command")) {
                    Some(Value::String(cmd)) => Some(one_line(cmd)),
                    Some(Value::Array(parts)) => Some(one_line(&parts.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" "))),
                    _ => None,
                };
                Entry {
                    id: String::new(),
                    from_user: false,
                    text: None,
                    tool: Some(Tool { name: name.to_owned(), note }),
                }
            })
            .into_iter()
            .collect(),
        // a script newer Codex runs its tools from is named for the tool it calls
        Some("custom_tool_call") => codex::tool_of(payload)
            .map(|name| {
                // a patch names its files on lines of its own
                let note = field("input").and_then(|input| {
                    input.lines().find_map(|line| ["*** Update File: ", "*** Add File: ", "*** Delete File: "].iter().find_map(|mark| line.strip_prefix(mark)))
                });
                Entry {
                    id: String::new(),
                    from_user: false,
                    text: None,
                    tool: Some(Tool { name: name.to_owned(), note: note.map(one_line) }),
                }
            })
            .into_iter()
            .collect(),
        _ => Vec::new(),
    };
    for (n, entry) in found.iter_mut().enumerate() {
        entry.id = format!("{at}#{n}");
    }
    found
}

// the entries in whole lines of `bytes`, which start at a line start, `base` bytes
// into the file
fn parse(bytes: &[u8], base: u64, format: Format) -> Vec<Entry> {
    let text = String::from_utf8_lossy(bytes);
    let mut at = base;
    let mut found = Vec::new();
    for line in text.split('\n') {
        if let Ok(record) = serde_json::from_str::<Value>(line) {
            match format {
                Format::Claude => found.extend(entries(&record)),
                Format::Codex => found.extend(codex_entries(&record, at)),
                Format::Agy => {}
            }
        }
        at += line.len() as u64 + 1;
    }
    found
}

fn read_range(file: &mut File, from: u64, len: u64) -> io::Result<Vec<u8>> {
    file.seek(SeekFrom::Start(from))?;
    let mut bytes = Vec::new();
    file.take(len).read_to_end(&mut bytes)?;
    Ok(bytes)
}

// What comes before `before` (the file's end when it is none), a window at a time.
// The line cut through at the window's start is left for the next window back. A
// line still being written at the file's end is left until it has been finished.
pub fn read_before(transcript: &Path, format: Format, before: Option<u64>, window: u64) -> io::Result<Page> {
    let mut file = File::open(transcript)?;
    let size = file.metadata()?.len();
    let before = before.unwrap_or(size).min(size);
    let from = before.saturating_sub(window);
    let bytes = read_range(&mut file, from, before - from)?;
    // the window's end: past its last whole line
    let Some(last) = bytes.iter().rposition(|&b| b == b'\n') else {
        return Ok(Page {
            entries: Vec::new(),
            start: from,
            end: before,
        });
    };
    let whole = &bytes[..=last];
    let skip = if from == 0 {
        0
    } else {
        whole.iter().position(|&b| b == b'\n').map_or(whole.len(), |at| at + 1)
    };
    if skip == whole.len() && from > 0 {
        // All of it is one line longer than the window, begun before it: there is
        // nothing whole to show, and the next window back goes on from here. The
        // long line itself (a tool's output, mostly) is passed over.
        return Ok(Page {
            entries: Vec::new(),
            start: from,
            end: from + last as u64 + 1,
        });
    }
    Ok(Page {
        entries: parse(&whole[skip..], from + skip as u64, format),
        start: from + skip as u64,
        end: from + last as u64 + 1,
    })
}

// What has been added since `from`, in whole lines.
pub fn read_after(transcript: &Path, format: Format, from: u64, most: u64) -> io::Result<Page> {
    let mut file = File::open(transcript)?;
    let size = file.metadata()?.len();
    // a file that got shorter was started again: from its start, then
    let from = if from > size { 0 } else { from };
    let len = (size - from).min(most);
    let bytes = read_range(&mut file, from, len)?;
    let end = match bytes.iter().rposition(|&b| b == b'\n') {
        Some(last) => last + 1,
        // one line longer than a step, and still going: stepped over, so as to get on
        None if len == most && len < size - from => bytes.len(),
        None => 0,
    };
    Ok(Page {
        entries: parse(&bytes[..end], from, format),
        start: from,
        end: from + end as u64,
    })
}

// a session's id, before it goes into a path
fn sound_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 100 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

// A Codex session is known by its process (`codex-<pid>`), and its file is found
// again from that; a Claude Code session by its own id.
fn transcript(session_id: &str, cwd: &str) -> Result<(std::path::PathBuf, Format), String> {
    if !sound_id(session_id) {
        return Err(format!("{session_id} is not a session id"));
    }
    let pid = |prefix: &str| session_id.strip_prefix(prefix).and_then(|pid| pid.parse::<u32>().ok());
    let found = if let Some(pid) = pid("codex-") {
        codex::rollout_for(pid).map(|file| (file, Format::Codex))
    } else if let Some(pid) = pid("agy-") {
        agy::conversation_for(pid).map(|file| (file, Format::Agy))
    } else {
        collectors::transcript(session_id, cwd).map(|file| (file, Format::Claude))
    };
    found.ok_or_else(|| "its conversation could not be found".to_owned())
}

#[tauri::command]
pub async fn conversation_before(session_id: String, cwd: String, before: Option<u64>) -> Result<Page, String> {
    let (file, format) = transcript(&session_id, &cwd)?;
    if format == Format::Agy {
        return agy::read_before(&file, before).map_err(|err| err.to_string());
    }
    read_before(&file, format, before, WINDOW).map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn conversation_after(session_id: String, cwd: String, from: u64) -> Result<Page, String> {
    let (file, format) = transcript(&session_id, &cwd)?;
    if format == Format::Agy {
        return agy::read_after(&file, from).map_err(|err| err.to_string());
    }
    read_after(&file, format, from, MOST_AFTER).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::env;
    use std::fs;
    use std::io::Write;
    use std::path::PathBuf;

    fn user(uuid: &str, content: Value) -> Value {
        json!({ "type": "user", "uuid": uuid, "message": { "role": "user", "content": content } })
    }

    fn assistant(uuid: &str, blocks: Value) -> Value {
        json!({ "type": "assistant", "uuid": uuid, "message": { "role": "assistant", "content": blocks } })
    }

    fn said(id: &str, from_user: bool, text: &str) -> Entry {
        Entry {
            id: id.into(),
            from_user,
            text: Some(text.into()),
            tool: None,
        }
    }

    fn did(id: &str, name: &str, note: Option<&str>) -> Entry {
        Entry {
            id: id.into(),
            from_user: false,
            text: None,
            tool: Some(Tool {
                name: name.into(),
                note: note.map(str::to_owned),
            }),
        }
    }

    #[test]
    fn shows_what_was_typed_and_what_was_written_and_done() {
        assert_eq!(entries(&user("u1", json!("fix the door"))), vec![said("u1#0", true, "fix the door")]);
        let turn = assistant(
            "a1",
            json!([
                { "type": "thinking", "thinking": "hmm" },
                { "type": "text", "text": "Looking at it.\n" },
                { "type": "tool_use", "name": "Bash", "input": { "command": "git status", "description": "Show working tree status" } },
                { "type": "tool_use", "name": "Edit", "input": { "file_path": "/repo/src/sim.ts", "old_string": "a", "new_string": "b" } },
                { "type": "tool_use", "name": "TodoWrite", "input": { "todos": [] } },
            ]),
        );
        assert_eq!(
            entries(&turn),
            vec![
                said("a1#0", false, "Looking at it."),
                did("a1#1", "Bash", Some("Show working tree status")),
                did("a1#2", "Edit", Some("/repo/src/sim.ts")),
                did("a1#3", "TodoWrite", None),
            ]
        );
    }

    #[test]
    fn shows_a_slash_command_as_it_was_typed() {
        let command = "<command-message>sdd</command-message>\n<command-name>/sdd</command-name>\n<command-args>status</command-args>";
        assert_eq!(entries(&user("u1", json!(command))), vec![said("u1#0", true, "/sdd status")]);
        let bare = "<command-name>/clear</command-name>\n<command-message>clear</command-message>\n<command-args></command-args>";
        assert_eq!(entries(&user("u2", json!(bare))), vec![said("u2#0", true, "/clear")]);
    }

    #[test]
    fn leaves_out_what_nobody_said() {
        let result = user("u1", json!([{ "type": "tool_result", "tool_use_id": "t1", "content": "secret output" }]));
        assert!(entries(&result).is_empty());
        let mut meta = user("u2", json!([{ "type": "text", "text": "Caveat: the messages below…" }]));
        meta["isMeta"] = json!(true);
        assert!(entries(&meta).is_empty());
        assert!(entries(&user("u3", json!("<local-command-stdout>done</local-command-stdout>"))).is_empty());
        let mut sidechain = assistant("a1", json!([{ "type": "text", "text": "a subagent's work" }]));
        sidechain["isSidechain"] = json!(true);
        assert!(entries(&sidechain).is_empty());
        assert!(entries(&json!({ "type": "summary", "summary": "x" })).is_empty());
        assert!(entries(&assistant("a2", json!([{ "type": "text", "text": "  \n" }]))).is_empty());
    }

    #[test]
    fn cuts_what_is_too_long_to_show() {
        let long = "x".repeat(LONGEST_TEXT + 50);
        let text = entries(&user("u1", json!(long)))[0].text.clone().unwrap();
        assert_eq!(text.chars().count(), LONGEST_TEXT + 1);
        assert!(text.ends_with('…'));
        let command = format!("{}\nand more", "y".repeat(500));
        let tool = assistant("a1", json!([{ "type": "tool_use", "name": "Bash", "input": { "command": command } }]));
        let note = entries(&tool)[0].tool.clone().unwrap().note.unwrap();
        assert_eq!(note.chars().count(), LONGEST_NOTE + 1, "one line, cut");
    }

    struct Transcript(PathBuf);

    impl Transcript {
        fn new(name: &str, records: &[Value]) -> Self {
            let file = env::temp_dir().join(format!("agent-office-talk-{name}-{}.jsonl", std::process::id()));
            let mut text = String::new();
            for record in records {
                text.push_str(&record.to_string());
                text.push('\n');
            }
            fs::write(&file, text).unwrap();
            Self(file)
        }

        fn add(&self, text: &str) {
            fs::OpenOptions::new().append(true).open(&self.0).unwrap().write_all(text.as_bytes()).unwrap();
        }

        fn size(&self) -> u64 {
            fs::metadata(&self.0).unwrap().len()
        }
    }

    impl Drop for Transcript {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }

    fn texts(page: &Page) -> Vec<String> {
        page.entries.iter().filter_map(|entry| entry.text.clone()).collect()
    }

    #[test]
    fn reads_back_a_window_at_a_time_and_misses_nothing_between_them() {
        let records: Vec<Value> = (0..40).map(|n| user(&format!("u{n}"), json!(format!("prompt {n}")))).collect();
        let file = Transcript::new("windows", &records);
        let mut seen = Vec::new();
        let mut page = read_before(&file.0, Format::Claude, None, 700).unwrap();
        assert_eq!(page.end, file.size());
        assert!(page.start > 0 && !page.entries.is_empty());
        loop {
            let mut older = texts(&page);
            older.extend(seen);
            seen = older;
            if page.start == 0 {
                break;
            }
            page = read_before(&file.0, Format::Claude, Some(page.start), 700).unwrap();
        }
        assert_eq!(seen, (0..40).map(|n| format!("prompt {n}")).collect::<Vec<_>>());
    }

    #[test]
    fn gets_past_a_line_longer_than_a_window() {
        let long = user("u1", json!([{ "type": "tool_result", "content": "x".repeat(3000) }]));
        let records = [user("u0", json!("before")), long, user("u2", json!("after"))];
        let file = Transcript::new("long", &records);
        let mut page = read_before(&file.0, Format::Claude, None, 700).unwrap();
        let mut seen = texts(&page);
        for step in 0.. {
            assert!(step < 20, "never got to the start");
            if page.start == 0 {
                break;
            }
            let back = read_before(&file.0, Format::Claude, Some(page.start), 700).unwrap();
            assert!(back.start < page.start, "always gets further back");
            let mut older = texts(&back);
            older.extend(seen);
            seen = older;
            page = back;
        }
        assert_eq!(seen, vec!["before", "after"]);
    }

    #[test]
    fn follows_the_file_as_it_grows_and_waits_for_a_line_to_be_finished() {
        let file = Transcript::new("grows", &[user("u0", json!("first"))]);
        let first = read_before(&file.0, Format::Claude, None, WINDOW).unwrap();
        assert_eq!(texts(&first), vec!["first"]);

        let next = assistant("a1", json!([{ "type": "text", "text": "second" }])).to_string();
        let (half, rest) = next.split_at(next.len() / 2);
        file.add(half);
        let page = read_after(&file.0, Format::Claude, first.end, MOST_AFTER).unwrap();
        assert!(page.entries.is_empty(), "half a line is not read");
        assert_eq!(page.end, first.end);
        assert_eq!(read_before(&file.0, Format::Claude, None, WINDOW).unwrap().end, first.end, "nor from the end");

        file.add(rest);
        file.add("\n");
        let page = read_after(&file.0, Format::Claude, first.end, MOST_AFTER).unwrap();
        assert_eq!(texts(&page), vec!["second"]);
        assert_eq!(page.end, file.size());
        assert!(read_after(&file.0, Format::Claude, page.end, MOST_AFTER).unwrap().entries.is_empty());
    }

    #[test]
    fn catches_up_on_a_lot_in_steps_and_starts_again_on_a_shorter_file() {
        let records: Vec<Value> = (0..20).map(|n| user(&format!("u{n}"), json!(format!("p{n}")))).collect();
        let file = Transcript::new("steps", &records);
        let mut from = 0;
        let mut seen = Vec::new();
        while from < file.size() {
            let page = read_after(&file.0, Format::Claude, from, 300).unwrap();
            assert!(page.end > from, "always gets on");
            seen.extend(texts(&page));
            from = page.end;
        }
        assert_eq!(seen.len(), 20);
        assert_eq!(read_after(&file.0, Format::Claude, file.size() + 99, MOST_AFTER).unwrap().start, 0);
    }

    fn message(role: &str, blocks: Value) -> Value {
        json!({ "type": "response_item", "payload": { "type": "message", "role": role, "content": blocks } })
    }

    #[test]
    fn shows_what_was_typed_to_codex_and_what_it_wrote_and_ran() {
        let typed = message("user", json!([{ "type": "input_text", "text": "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>" }, { "type": "input_text", "text": "fix the door\n" }]));
        assert_eq!(codex_entries(&typed, 7), vec![said("7#0", true, "fix the door")]);
        let wrote = message("assistant", json!([{ "type": "output_text", "text": "Done." }]));
        assert_eq!(codex_entries(&wrote, 9), vec![said("9#0", false, "Done.")]);
        let call = json!({ "type": "response_item", "payload": { "type": "function_call", "name": "exec_command", "arguments": "{\"cmd\":\"git status\",\"workdir\":\"/repo\"}" } });
        assert_eq!(codex_entries(&call, 3), vec![did("3#0", "exec_command", Some("git status"))]);
        let listed = json!({ "type": "response_item", "payload": { "type": "function_call", "name": "shell", "arguments": "{\"command\":[\"bash\",\"-lc\",\"ls\"]}" } });
        assert_eq!(codex_entries(&listed, 4)[0].tool.clone().unwrap().note.as_deref(), Some("bash -lc ls"));
        let patch = json!({ "type": "response_item", "payload": { "type": "custom_tool_call", "name": "apply_patch", "input": "*** Begin Patch\n*** Update File: src/sim.ts\n@@\n-a\n+b\n*** End Patch" } });
        assert_eq!(codex_entries(&patch, 5), vec![did("5#0", "apply_patch", Some("src/sim.ts"))]);
    }

    #[test]
    fn leaves_out_what_codex_keeps_for_itself() {
        assert!(codex_entries(&message("developer", json!([{ "type": "input_text", "text": "You are Codex." }])), 0).is_empty());
        let added = message("user", json!([{ "type": "input_text", "text": "# AGENTS.md instructions for /repo" }, { "type": "input_text", "text": "<turn_aborted>" }, { "type": "input_image", "image_url": "data:" }]));
        assert!(codex_entries(&added, 0).is_empty());
        let item = |kind: &str| json!({ "type": "response_item", "payload": { "type": kind } });
        assert!(codex_entries(&item("reasoning"), 0).is_empty());
        assert!(codex_entries(&item("function_call_output"), 0).is_empty());
        assert!(codex_entries(&json!({ "type": "session_meta", "payload": { "cwd": "/repo" } }), 0).is_empty());
        // older files say each prompt and reply again as events: read once, from the messages
        let event = |kind: &str| json!({ "type": "event_msg", "payload": { "type": kind, "message": "again" } });
        assert!(codex_entries(&event("user_message"), 0).is_empty());
        assert!(codex_entries(&event("agent_message"), 0).is_empty());
    }

    #[test]
    fn knows_each_codex_entry_by_where_its_line_starts() {
        let lines = [message("user", json!([{ "type": "input_text", "text": "one" }])), message("assistant", json!([{ "type": "output_text", "text": "two" }]))];
        let file = Transcript::new("codex-ids", &lines);
        let page = read_before(&file.0, Format::Codex, None, WINDOW).unwrap();
        let second = lines[0].to_string().len() + 1;
        assert_eq!(page.entries.iter().map(|e| e.id.clone()).collect::<Vec<_>>(), vec!["0#0".to_owned(), format!("{second}#0")]);
        let later = read_after(&file.0, Format::Codex, second as u64, MOST_AFTER).unwrap();
        assert_eq!(later.entries[0].id, format!("{second}#0"), "the same from either way");
    }

    #[test]
    fn takes_only_a_session_id_into_a_path() {
        assert!(sound_id("11111111-1111-4111-8111-111111111111"));
        assert!(!sound_id("../../etc/passwd"));
        assert!(!sound_id("a/b"));
        assert!(!sound_id(""));
        assert!(transcript("../x", "/").is_err());
    }
}
