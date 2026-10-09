mod collectors;
mod state;

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, State};

use collectors::Collector;
use state::OfficeState;

const TICK: Duration = Duration::from_secs(1);

// The state as last collected, kept for a window that has just opened.
struct Latest(Mutex<OfficeState>);

impl Latest {
    fn lock(&self) -> MutexGuard<'_, OfficeState> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[tauri::command]
fn get_state(latest: State<'_, Latest>) -> OfficeState {
    latest.lock().clone()
}

// Collects the state every tick and tells the window when it has changed.
fn watch(app: AppHandle, mut collector: Collector) {
    loop {
        thread::sleep(TICK);
        let next = collector.collect(collectors::now_ms());
        let latest = app.state::<Latest>();
        let mut current = latest.lock();
        if *current == next {
            continue;
        }
        *current = next;
        let _ = app.emit("state", &*current);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let mut collector = Collector::new();
            app.manage(Latest(Mutex::new(collector.collect(collectors::now_ms()))));
            let app = app.handle().clone();
            thread::spawn(move || watch(app, collector));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_state])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
