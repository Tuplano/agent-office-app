// claude-mem runs one observer session beside each Claude session. Its database
// says which session an observer watches; that pair of ids is all that is read.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

use rusqlite::{Connection, OpenFlags};

use super::CACHE_LIMIT;

const RETRY_MS: i64 = 5000;

struct Link {
    parent: Option<String>,
    checked_at: i64,
}

pub struct Links {
    db: PathBuf,
    known: HashMap<String, Link>,
}

impl Links {
    pub fn new(db: PathBuf) -> Self {
        Self {
            db,
            known: HashMap::new(),
        }
    }

    // The session this observer watches. A link once found is kept; a miss is
    // looked up again after a few seconds.
    pub fn watched(&mut self, observer_id: &str, now: i64) -> Option<String> {
        if let Some(link) = self.known.get(observer_id) {
            if link.parent.is_some() || now - link.checked_at < RETRY_MS {
                return link.parent.clone();
            }
        }
        let parent = self.look_up(observer_id);
        if self.known.len() > CACHE_LIMIT {
            self.known.clear();
        }
        let link = Link {
            parent: parent.clone(),
            checked_at: now,
        };
        self.known.insert(observer_id.to_owned(), link);
        parent
    }

    // None covers no claude-mem, a database in use, and a schema this does not know.
    fn look_up(&self, observer_id: &str) -> Option<String> {
        let flags = OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX;
        let db = Connection::open_with_flags(&self.db, flags).ok()?;
        // rather miss this once than hold up everything else behind a lock
        db.busy_timeout(Duration::ZERO).ok()?;
        db.query_row(
            "SELECT content_session_id FROM sdk_sessions
             WHERE memory_session_id = ?1 ORDER BY id DESC LIMIT 1",
            [observer_id],
            |row| row.get::<_, Option<String>>(0),
        )
        .ok()
        .flatten()
    }
}
