// The state the window draws. Mirrors `src/shared/state.ts` field for field:
// change both together.

use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfficeState {
    pub home: String,
    pub sessions: Vec<Session>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Session {
    pub id: String,
    pub pid: u32,
    pub name: String,
    pub cwd: String,
    pub background: bool,
    pub status: Status,
    pub waiting_for: Option<String>,
    pub activity: Option<String>,
    pub started_at: Option<i64>,
    pub status_since: Option<i64>,
    pub mem_mb: Option<u64>,
    pub agents: Vec<Agent>,
    pub agents_spawned: usize,
    pub supervisor: Option<Supervisor>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Busy,
    Waiting,
    Idle,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agent {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub desc: String,
    pub started_at: i64,
}

// a supervisor is only ever busy or idle
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct Supervisor {
    pub status: Status,
}

#[cfg(test)]
mod tests {
    use super::*;

    // The same file is read by `tests/state-contract.test.ts`, so a field changed
    // on one side only fails one of the two.
    #[test]
    fn serializes_to_the_shared_fixture() {
        let state = OfficeState {
            home: "/home/sam".into(),
            sessions: vec![
                Session {
                    id: "11111111-1111-4111-8111-111111111111".into(),
                    pid: 4242,
                    name: "agent-office-app".into(),
                    cwd: "/home/sam/code/agent-office-app".into(),
                    background: false,
                    status: Status::Busy,
                    waiting_for: None,
                    activity: Some("Edit".into()),
                    started_at: Some(1_760_000_000_000),
                    status_since: Some(1_760_000_060_000),
                    mem_mb: Some(412),
                    agents: vec![Agent {
                        id: "agent-a1b2c3".into(),
                        kind: "Explore".into(),
                        desc: "Find the session readers".into(),
                        started_at: 1_760_000_030_000,
                    }],
                    agents_spawned: 3,
                    supervisor: Some(Supervisor { status: Status::Idle }),
                },
                Session {
                    id: "22222222-2222-4222-8222-222222222222".into(),
                    pid: 4343,
                    name: "notes".into(),
                    cwd: "/home/sam/notes".into(),
                    background: true,
                    status: Status::Waiting,
                    waiting_for: Some("permission to run Bash".into()),
                    activity: None,
                    started_at: None,
                    status_since: None,
                    mem_mb: None,
                    agents: vec![],
                    agents_spawned: 0,
                    supervisor: None,
                },
            ],
        };
        let fixture = include_str!("../../tests/fixtures/office-state.json");
        let expected: serde_json::Value = serde_json::from_str(fixture).unwrap();
        assert_eq!(serde_json::to_value(&state).unwrap(), expected);
    }
}
