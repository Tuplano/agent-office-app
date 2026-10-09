// Which sessions' processes are still running, and how much memory each holds.

use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

const MB: u64 = 1024 * 1024;

pub struct Processes {
    system: System,
}

impl Processes {
    pub fn new() -> Self {
        Self {
            system: System::new(),
        }
    }

    // Looks these processes up afresh; the ones that have ended are forgotten.
    pub fn refresh(&mut self, pids: impl Iterator<Item = u32>) {
        let mut pids: Vec<Pid> = pids.map(Pid::from_u32).collect();
        // sysinfo takes a pid listed twice for a process that has ended
        pids.sort_unstable();
        pids.dedup();
        self.system.refresh_processes_specifics(
            ProcessesToUpdate::Some(&pids),
            true,
            ProcessRefreshKind::nothing().with_memory(),
        );
    }

    pub fn is_running(&self, pid: u32) -> bool {
        self.system.process(Pid::from_u32(pid)).is_some()
    }

    pub fn memory_mb(&self, pid: u32) -> Option<u64> {
        let bytes = self.system.process(Pid::from_u32(pid))?.memory();
        (bytes > 0).then(|| (bytes + MB / 2) / MB)
    }
}
