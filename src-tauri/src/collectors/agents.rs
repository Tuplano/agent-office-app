// A session's subagents: one transcript each under `<session>/subagents`.

use std::fs::{self, Metadata};
use std::path::Path;

use super::tail::{Turn, TurnCache};
use super::{clip, millis, read_json, text};
use crate::state::Agent;

// Subagents have no "done" marker, so whether one is still working is inferred
// from how its transcript ends and how long it has been silent. The limits drop
// agents that were killed mid-run.
const TOOL_MS: i64 = 10 * 60 * 1000; // waiting on a tool call
const THINK_MS: i64 = 3 * 60 * 1000; // waiting on the model
const TEXT_MS: i64 = 30 * 1000; // text with no stop reason: usually the final message
const FRESH_MS: i64 = 15 * 1000; // nothing readable: go by recent writes
const FINAL_STOPS: [&str; 4] = ["end_turn", "stop_sequence", "max_tokens", "refusal"];

// `age` is how long ago the transcript was last written, in milliseconds.
fn is_working(turn: Option<&Turn>, age: i64) -> bool {
    let Some(turn) = turn else {
        return age < FRESH_MS;
    };
    if turn.from_user {
        return age < THINK_MS;
    }
    if turn.stop.as_deref().is_some_and(|stop| FINAL_STOPS.contains(&stop)) {
        return false;
    }
    match turn.last_block.as_deref() {
        Some("tool_use") => age < TOOL_MS,
        Some("thinking") => age < THINK_MS,
        _ => age < TEXT_MS,
    }
}

// The subagents still working, oldest first, and how many were ever started.
pub fn read(project_dir: &Path, session_id: &str, now: i64, turns: &mut TurnCache) -> (Vec<Agent>, usize) {
    let dir = project_dir.join(session_id).join("subagents");
    let Ok(entries) = fs::read_dir(&dir) else {
        return (Vec::new(), 0);
    };
    let mut active = Vec::new();
    let mut spawned = 0;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(id) = name.to_str().and_then(|name| name.strip_suffix(".jsonl")) else {
            continue;
        };
        spawned += 1;
        let file = entry.path();
        let Ok(meta) = fs::metadata(&file) else {
            continue;
        };
        let Ok(written) = meta.modified() else {
            continue;
        };
        let age = now - millis(written);
        if age > TOOL_MS {
            continue;
        }
        if !is_working(turns.get(&file, &meta).as_ref(), age) {
            continue;
        }
        let label = read_json(&dir.join(format!("{id}.meta.json")));
        let labelled = |key| label.as_ref().and_then(|label| text(label, key));
        active.push(Agent {
            id: id.to_owned(),
            kind: clip(&labelled("agentType").unwrap_or_else(|| "agent".into()), 40),
            desc: clip(&labelled("description").unwrap_or_default(), 80),
            started_at: started(&meta),
        });
    }
    active.sort_by(|a, b| (a.started_at, &a.id).cmp(&(b.started_at, &b.id)));
    (active, spawned)
}

// when the file was made, or where that is not recorded, when it last changed
fn started(meta: &Metadata) -> i64 {
    if let Ok(made) = meta.created() {
        return millis(made);
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        meta.ctime() * 1000 + meta.ctime_nsec() / 1_000_000
    }
    #[cfg(not(unix))]
    {
        meta.modified().map_or(0, millis)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SECOND: i64 = 1000;
    const MINUTE: i64 = 60 * SECOND;

    fn turn(from_user: bool, stop: Option<&str>, last_block: Option<&str>) -> Turn {
        Turn {
            from_user,
            stop: stop.map(str::to_owned),
            last_block: last_block.map(str::to_owned),
            last_tool: None,
            has_text: false,
        }
    }

    #[test]
    fn with_nothing_readable_only_a_just_written_agent_is_working() {
        assert!(is_working(None, 14 * SECOND));
        assert!(!is_working(None, 15 * SECOND));
    }

    #[test]
    fn after_a_user_turn_the_agent_is_waiting_on_the_model() {
        let waiting = turn(true, None, Some("tool_result"));
        assert!(is_working(Some(&waiting), 3 * MINUTE - 1));
        assert!(!is_working(Some(&waiting), 3 * MINUTE));
    }

    #[test]
    fn a_final_stop_means_finished_however_fresh() {
        for stop in FINAL_STOPS {
            assert!(!is_working(Some(&turn(false, Some(stop), Some("text"))), 0));
            assert!(!is_working(Some(&turn(false, Some(stop), Some("tool_use"))), 0));
        }
    }

    #[test]
    fn a_tool_call_is_given_ten_minutes() {
        let calling = turn(false, Some("tool_use"), Some("tool_use"));
        assert!(is_working(Some(&calling), 10 * MINUTE - 1));
        assert!(!is_working(Some(&calling), 10 * MINUTE));
    }

    #[test]
    fn thinking_is_given_three_minutes() {
        let thinking = turn(false, None, Some("thinking"));
        assert!(is_working(Some(&thinking), 3 * MINUTE - 1));
        assert!(!is_working(Some(&thinking), 3 * MINUTE));
    }

    #[test]
    fn text_with_no_stop_reason_is_given_thirty_seconds() {
        for last_block in [Some("text"), None] {
            let writing = turn(false, None, last_block);
            assert!(is_working(Some(&writing), 30 * SECOND - 1));
            assert!(!is_working(Some(&writing), 30 * SECOND));
        }
    }
}
