// Decides which sessions deserve a notification, and what it says. It only
// decides: the watch loop does the showing.

use std::collections::{HashMap, HashSet};

use crate::state::{Session, Status};

// a memory that grows past this is trimmed to the sessions in view
const CACHE_LIMIT: usize = 500;

pub struct Alert {
    pub title: String,
    pub body: String,
}

// The last status heard of each session. A session that drops out of view for a
// tick and comes back still waiting is not news.
pub struct Alerts {
    seen: HashMap<String, Status>,
}

impl Alerts {
    // Whoever is waiting at the start is already known, so is not announced.
    pub fn new(sessions: &[Session]) -> Self {
        let mut alerts = Self {
            seen: HashMap::new(),
        };
        alerts.remember(sessions);
        alerts
    }

    // The sessions that are waiting now and were not the last time they were seen.
    // One that appears already waiting counts: it is new to us.
    pub fn next(&mut self, sessions: &[Session]) -> Vec<Alert> {
        let alerts = sessions
            .iter()
            .filter(|s| {
                s.status == Status::Waiting && self.seen.get(&s.id) != Some(&Status::Waiting)
            })
            .map(alert_for)
            .collect();
        self.remember(sessions);
        alerts
    }

    fn remember(&mut self, sessions: &[Session]) {
        for s in sessions {
            self.seen.insert(s.id.clone(), s.status);
        }
        if self.seen.len() > CACHE_LIMIT {
            let in_view: HashSet<&str> = sessions.iter().map(|s| s.id.as_str()).collect();
            self.seen.retain(|id, _| in_view.contains(id.as_str()));
        }
    }
}

fn alert_for(session: &Session) -> Alert {
    let title = if session.name.is_empty() {
        "Claude Code"
    } else {
        &session.name
    };
    let body = match session.waiting_for.as_deref() {
        Some(text) if !text.is_empty() => text,
        _ => "Waiting for you",
    };
    Alert {
        title: title.into(),
        body: body.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn session(id: &str, status: Status) -> Session {
        Session {
            id: id.into(),
            pid: 1,
            name: format!("project-{id}"),
            cwd: String::new(),
            background: false,
            status,
            waiting_for: None,
            activity: None,
            started_at: None,
            status_since: None,
            mem_mb: None,
            agents: vec![],
            agents_spawned: 0,
            supervisor: None,
        }
    }

    fn titles(alerts: Vec<Alert>) -> Vec<String> {
        alerts.into_iter().map(|a| a.title).collect()
    }

    #[test]
    fn sessions_already_waiting_at_the_start_do_not_notify() {
        let start = [session("a", Status::Waiting)];
        let mut alerts = Alerts::new(&start);
        assert!(alerts.next(&start).is_empty());
    }

    #[test]
    fn a_change_to_waiting_notifies_once() {
        let mut alerts = Alerts::new(&[session("a", Status::Busy)]);
        let waiting = [session("a", Status::Waiting)];
        assert_eq!(titles(alerts.next(&waiting)), ["project-a"]);
        assert!(alerts.next(&waiting).is_empty());
        assert!(alerts.next(&waiting).is_empty());
    }

    #[test]
    fn waiting_busy_waiting_notifies_twice() {
        let mut alerts = Alerts::new(&[session("a", Status::Busy)]);
        assert_eq!(alerts.next(&[session("a", Status::Waiting)]).len(), 1);
        assert!(alerts.next(&[session("a", Status::Busy)]).is_empty());
        assert_eq!(alerts.next(&[session("a", Status::Waiting)]).len(), 1);
    }

    #[test]
    fn vanishing_for_a_tick_and_returning_still_waiting_does_not_repeat() {
        let mut alerts = Alerts::new(&[session("a", Status::Busy)]);
        assert_eq!(alerts.next(&[session("a", Status::Waiting)]).len(), 1);
        assert!(alerts.next(&[]).is_empty());
        assert!(alerts.next(&[session("a", Status::Waiting)]).is_empty());
    }

    #[test]
    fn a_session_that_arrives_already_waiting_notifies_once() {
        let mut alerts = Alerts::new(&[session("a", Status::Busy)]);
        let both = [session("a", Status::Busy), session("b", Status::Waiting)];
        assert_eq!(titles(alerts.next(&both)), ["project-b"]);
        assert!(alerts.next(&both).is_empty());
    }

    #[test]
    fn the_memory_stays_bounded_and_keeps_the_sessions_in_view() {
        let mut alerts = Alerts::new(&[]);
        for i in 0..CACHE_LIMIT + 50 {
            alerts.next(&[session(&format!("gone-{i}"), Status::Idle)]);
        }
        let waiting = [session("a", Status::Waiting)];
        assert_eq!(alerts.next(&waiting).len(), 1);
        assert!(alerts.seen.len() <= CACHE_LIMIT);
        assert!(alerts.next(&waiting).is_empty());
    }

    #[test]
    fn the_text_names_the_session_and_what_it_waits_for() {
        let mut s = session("a", Status::Waiting);
        s.waiting_for = Some("permission to run Bash".into());
        let alert = alert_for(&s);
        assert_eq!(alert.title, "project-a");
        assert_eq!(alert.body, "permission to run Bash");
    }

    #[test]
    fn the_text_falls_back_when_nothing_is_said() {
        let mut s = session("a", Status::Waiting);
        assert_eq!(alert_for(&s).body, "Waiting for you");
        s.waiting_for = Some(String::new());
        assert_eq!(alert_for(&s).body, "Waiting for you");
        s.name = String::new();
        assert_eq!(alert_for(&s).title, "Claude Code");
    }
}
