// How a transcript ends. Only the shape of its last turn is kept: who took it,
// why it stopped and what kinds of block it holds, never what was said.

use std::collections::HashMap;
use std::fs::{File, Metadata};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde_json::Value;

use super::CACHE_LIMIT;

const TAIL_BYTES: u64 = 64 * 1024;

#[derive(Clone, Debug, PartialEq)]
pub struct Turn {
    pub from_user: bool,
    pub stop: Option<String>,
    pub last_block: Option<String>,
    // the name of the last tool called in the turn
    pub last_tool: Option<String>,
    pub has_text: bool,
}

// The last turn, by the assistant or the user, in the end of the file.
pub fn last_turn(file: &Path) -> Option<Turn> {
    let mut file = File::open(file).ok()?;
    let size = file.metadata().ok()?.len();
    let len = size.min(TAIL_BYTES);
    file.seek(SeekFrom::Start(size - len)).ok()?;
    let mut tail = Vec::new();
    file.take(len).read_to_end(&mut tail).ok()?;

    let tail = String::from_utf8_lossy(&tail);
    let mut lines: Vec<&str> = tail.split('\n').filter(|line| !line.is_empty()).collect();
    if len < size && !lines.is_empty() {
        lines.remove(0); // first line is cut off mid-record
    }
    // a line that does not parse is a partial write, and is skipped
    lines
        .iter()
        .rev()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find_map(|record| turn(&record))
}

fn turn(record: &Value) -> Option<Turn> {
    let from_user = match record.get("type")?.as_str()? {
        "user" => true,
        "assistant" => false,
        _ => return None,
    };
    let message = record.get("message");
    let blocks = message
        .and_then(|m| m.get("content"))
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    let kind = |block: &Value| block.get("type").and_then(Value::as_str).map(str::to_owned);
    let is = |block: &&Value, wanted: &str| block.get("type").and_then(Value::as_str) == Some(wanted);
    Some(Turn {
        from_user,
        stop: message
            .and_then(|m| m.get("stop_reason"))
            .and_then(Value::as_str)
            .map(str::to_owned),
        last_block: blocks.last().and_then(kind),
        last_tool: blocks
            .iter()
            .rfind(|block| is(block, "tool_use"))
            .and_then(|tool| tool.get("name")?.as_str())
            .filter(|name| !name.is_empty())
            .map(str::to_owned),
        has_text: blocks.iter().any(|block| is(&block, "text")),
    })
}

// Last turns, kept per file until its modification time or size changes.
#[derive(Default)]
pub struct TurnCache {
    entries: HashMap<PathBuf, (Stamp, Option<Turn>)>,
}

type Stamp = (Option<SystemTime>, u64);

impl TurnCache {
    pub fn get(&mut self, file: &Path, meta: &Metadata) -> Option<Turn> {
        let stamp = (meta.modified().ok(), meta.len());
        if let Some((seen, turn)) = self.entries.get(file) {
            if *seen == stamp {
                return turn.clone();
            }
        }
        if self.entries.len() > CACHE_LIMIT {
            self.entries.clear();
        }
        let turn = last_turn(file);
        self.entries.insert(file.to_owned(), (stamp, turn.clone()));
        turn
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Write;

    use super::*;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/collectors/fixtures")
            .join(name)
    }

    #[test]
    fn reads_a_turn_that_ends_in_a_tool_call() {
        assert_eq!(
            last_turn(&fixture("tool-call.jsonl")),
            Some(Turn {
                from_user: false,
                stop: Some("tool_use".into()),
                last_block: Some("tool_use".into()),
                last_tool: Some("Bash".into()),
                has_text: true,
            })
        );
    }

    #[test]
    fn reads_a_finished_turn() {
        let turn = last_turn(&fixture("finished.jsonl")).unwrap();
        assert_eq!(turn.stop.as_deref(), Some("end_turn"));
        assert_eq!(turn.last_block.as_deref(), Some("text"));
        assert_eq!(turn.last_tool, None);
        assert!(turn.has_text);
    }

    #[test]
    fn a_user_turn_has_no_blocks_when_its_content_is_plain_text() {
        assert_eq!(
            last_turn(&fixture("user-last.jsonl")),
            Some(Turn {
                from_user: true,
                stop: None,
                last_block: None,
                last_tool: None,
                has_text: false,
            })
        );
    }

    #[test]
    fn skips_a_half_written_last_line_and_records_that_are_not_turns() {
        let turn = last_turn(&fixture("half-written.jsonl")).unwrap();
        assert_eq!(turn.last_block.as_deref(), Some("thinking"));
        assert!(!turn.from_user);
    }

    #[test]
    fn finds_nothing_in_a_missing_empty_or_turnless_file() {
        assert_eq!(last_turn(&fixture("does-not-exist.jsonl")), None);
        assert_eq!(last_turn(&fixture("empty.jsonl")), None);
        assert_eq!(last_turn(&fixture("no-turns.jsonl")), None);
    }

    #[test]
    fn reads_only_the_end_of_a_long_file_and_drops_the_line_it_cuts() {
        let file = std::env::temp_dir().join(format!("agent-office-tail-{}.jsonl", std::process::id()));
        let mut out = File::create(&file).unwrap();
        // one record far longer than the tail, so the tail starts inside it
        let long = "x".repeat(2 * TAIL_BYTES as usize);
        writeln!(out, r#"{{"type":"user","message":{{"content":"{long}"}}}}"#).unwrap();
        drop(out);
        assert_eq!(last_turn(&file), None);

        let mut out = fs::OpenOptions::new().append(true).open(&file).unwrap();
        writeln!(out, r#"{{"type":"assistant","message":{{"content":[{{"type":"text"}}]}}}}"#).unwrap();
        drop(out);
        let turn = last_turn(&file);
        fs::remove_file(&file).unwrap();
        assert_eq!(turn.unwrap().last_block.as_deref(), Some("text"));
    }

    #[test]
    fn the_cache_reads_a_file_again_only_when_it_changes() {
        let file = std::env::temp_dir().join(format!("agent-office-cache-{}.jsonl", std::process::id()));
        fs::write(&file, "{\"type\":\"user\"}\n").unwrap();
        let mut cache = TurnCache::default();
        let before = fs::metadata(&file).unwrap();
        assert!(cache.get(&file, &before).unwrap().from_user);

        fs::write(&file, "{\"type\":\"assistant\"}\n{\"type\":\"x\"}\n").unwrap();
        // the old stamp still answers from the cache; the new one reads the file
        assert!(cache.get(&file, &before).unwrap().from_user);
        let after = fs::metadata(&file).unwrap();
        let turn = cache.get(&file, &after);
        fs::remove_file(&file).unwrap();
        assert!(!turn.unwrap().from_user);
    }
}
