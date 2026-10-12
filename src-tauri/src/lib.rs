mod alerts;
mod collectors;
mod state;
mod tray;
mod update;

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager, RunEvent, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use alerts::Alerts;
use collectors::Collector;
use state::OfficeState;
use tray::Tray;
use update::Updates;

const TICK: Duration = Duration::from_secs(1);

// Launch at login passes this, and the window then stays in the tray.
const HIDDEN_ARG: &str = "--hidden";

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

// What of the window is remembered between runs. Not whether it was visible: a
// normal launch always shows it.
fn remembered() -> StateFlags {
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

fn has_hidden_arg(args: impl IntoIterator<Item = String>) -> bool {
    args.into_iter().any(|arg| arg == HIDDEN_ARG)
}

fn show_main(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

// Collects the state every tick and tells the window when it has changed. It also
// raises notifications and marks the tray icon, so both work with the window hidden.
fn watch(app: AppHandle, mut collector: Collector, mut alerts: Alerts) {
    loop {
        thread::sleep(TICK);
        let next = collector.collect(collectors::now_ms());
        {
            let latest = app.state::<Latest>();
            let mut current = latest.lock();
            if *current == next {
                continue;
            }
            *current = next.clone();
            let _ = app.emit("state", &next);
        }
        for alert in alerts.next(&next.sessions) {
            let _ = app
                .notification()
                .builder()
                .title(alert.title)
                .body(alert.body)
                .show();
        }
        if let Some(tray) = app.try_state::<Tray>() {
            tray.sync(tray::waiting_count(&next.sessions));
        }
    }
}

// A closed window goes to the tray, but only if there is a tray to bring it back
// from; without one, closing quits as usual.
fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        if window.label() == "main" && app.try_state::<Tray>().is_some() {
            api.prevent_close();
            // saved now, so the size survives a process that is killed at logout
            let _ = app.save_window_state(remembered());
            let _ = window.hide();
        }
    }
}

// Clicking the Dock icon brings back a hidden window on macOS.
fn on_run_event(app: &AppHandle, event: RunEvent) {
    #[cfg(target_os = "macos")]
    if let RunEvent::Reopen { .. } = event {
        show_main(app);
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (app, event);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();
    // Release builds only, so that `tauri dev` is not handed over to an installed
    // copy that is already running. First, as the plugin's docs require.
    if !cfg!(debug_assertions) {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !has_hidden_arg(args) {
                show_main(app);
            }
        }));
    }
    builder
        .plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(remembered())
                .build(),
        )
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .args([HIDDEN_ARG])
                .build(),
        )
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(on_window_event)
        .setup(|app| {
            let mut collector = Collector::new();
            let first = collector.collect(collectors::now_ms());
            let alerts = Alerts::new(&first.sessions);
            let updates = Updates::create(app.handle());
            let waiting = tray::waiting_count(&first.sessions);
            match Tray::create(app.handle(), waiting, updates.as_ref().map(Updates::item)) {
                Ok(tray) => {
                    app.manage(tray);
                    // only with a tray, which is where the update item lives
                    if let Some(updates) = updates {
                        app.manage(updates);
                        Updates::check_soon(app.handle());
                    }
                }
                Err(err) => eprintln!("Agent Office: no tray icon: {err}"),
            }
            app.manage(Latest(Mutex::new(first)));
            // The window is created hidden (see tauri.conf.json), so it never flashes
            // at the wrong size. Without a tray it must always be shown.
            if app.try_state::<Tray>().is_none() || !has_hidden_arg(std::env::args()) {
                show_main(app.handle());
            }
            let app = app.handle().clone();
            thread::spawn(move || watch(app, collector, alerts));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_state])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(on_run_event);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_hidden_argument_keeps_the_window_hidden() {
        let args = |list: &[&str]| list.iter().map(|a| a.to_string()).collect::<Vec<_>>();
        assert!(has_hidden_arg(args(&["app", "--hidden"])));
        assert!(!has_hidden_arg(args(&["app"])));
        assert!(!has_hidden_arg(args(&["app", "--hide", "hidden"])));
    }
}
