// Updates, in release builds only: one quiet check shortly after start, and the tray
// item that shows what it found and installs it. Nothing is downloaded until the
// item is clicked.

use std::sync::{Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use tauri::menu::MenuItem;
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_updater::UpdaterExt;

const RELEASES: &str = "https://github.com/Tuplano/agent-office-app/releases";

// long enough that the check does not compete with the window opening
const FIRST_CHECK_AFTER: Duration = Duration::from_secs(20);

#[derive(Clone, Debug, PartialEq)]
enum Stage {
    // nothing newer is known
    Current,
    Checking,
    // a newer version is known, by its number alone
    Available(String),
    Installing,
}

#[derive(Debug, PartialEq)]
enum Click {
    Check,
    Install,
    // this install cannot update itself: say where to get the new version
    PointToReleases,
    Nothing,
}

// Windows and macOS replace themselves. On Linux only an AppImage can: a .deb
// belongs to the package manager.
fn can_update_itself(on_linux: bool, appimage: bool) -> bool {
    !on_linux || appimage
}

fn label(stage: &Stage, self_updating: bool) -> String {
    match stage {
        Stage::Current => "Check for updates".into(),
        Stage::Checking => "Checking for updates...".into(),
        Stage::Available(version) if self_updating => format!("Update to v{version}"),
        Stage::Available(version) => format!("v{version} is available"),
        Stage::Installing => "Updating...".into(),
    }
}

fn click(stage: &Stage, self_updating: bool) -> Click {
    match stage {
        Stage::Current => Click::Check,
        Stage::Available(_) if self_updating => Click::Install,
        Stage::Available(_) => Click::PointToReleases,
        Stage::Checking | Stage::Installing => Click::Nothing,
    }
}

// the item can be clicked unless work is under way
fn enabled(stage: &Stage) -> bool {
    !matches!(stage, Stage::Checking | Stage::Installing)
}

fn stage_after_check(found: Option<String>) -> Stage {
    found.map_or(Stage::Current, Stage::Available)
}

pub struct Updates {
    item: MenuItem<Wry>,
    stage: Mutex<Stage>,
    self_updating: bool,
}

impl Updates {
    // None in a debug build, which never updates.
    pub fn create(app: &AppHandle) -> Option<Self> {
        if cfg!(debug_assertions) {
            return None;
        }
        let stage = Stage::Current;
        let self_updating = self_updating(app);
        let item = MenuItem::with_id(
            app,
            "update",
            label(&stage, self_updating),
            enabled(&stage),
            None::<&str>,
        )
        .ok()?;
        Some(Self {
            item,
            stage: Mutex::new(stage),
            self_updating,
        })
    }

    pub fn item(&self) -> &MenuItem<Wry> {
        &self.item
    }

    // The quiet check after start.
    pub fn check_soon(app: &AppHandle) {
        let app = app.clone();
        thread::spawn(move || {
            thread::sleep(FIRST_CHECK_AFTER);
            tauri::async_runtime::block_on(check(&app, false));
        });
    }

    // Moves to a new stage and shows it on the item.
    fn set(&self, next: Stage) {
        let mut stage = self.stage.lock().unwrap_or_else(PoisonError::into_inner);
        *stage = next;
        let _ = self.item.set_text(label(&stage, self.self_updating));
        let _ = self.item.set_enabled(enabled(&stage));
    }

    fn current(&self) -> Stage {
        self.stage
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

fn self_updating(app: &AppHandle) -> bool {
    #[cfg(target_os = "linux")]
    return can_update_itself(true, app.env().appimage.is_some());
    #[cfg(not(target_os = "linux"))]
    {
        let _ = app;
        can_update_itself(false, false)
    }
}

pub fn on_click(app: &AppHandle) {
    let Some(updates) = app.try_state::<Updates>() else {
        return;
    };
    match click(&updates.current(), updates.self_updating) {
        Click::Check => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { check(&app, true).await });
        }
        Click::Install => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move { install(&app).await });
        }
        Click::PointToReleases => {
            notify(
                app,
                "A new version is available",
                &format!("This install cannot update itself. Download it from {RELEASES}"),
            );
        }
        Click::Nothing => {}
    }
}

fn notify(app: &AppHandle, title: &str, body: &str) {
    let _ = app.notification().builder().title(title).body(body).show();
}

fn with_updates(app: &AppHandle, then: impl FnOnce(&Updates)) {
    if let Some(updates) = app.try_state::<Updates>() {
        then(&updates);
    }
}

// Asks the release feed whether there is a newer version. A check the person asked
// for says how it went; the quiet one says nothing, even when it fails.
async fn check(app: &AppHandle, asked: bool) {
    let mut started = false;
    with_updates(app, |updates| {
        if updates.current() == Stage::Current {
            updates.set(Stage::Checking);
            started = true;
        }
    });
    if !started {
        return;
    }
    let found = match app.updater() {
        Ok(updater) => updater.check().await.map(|update| update.map(|u| u.version)),
        Err(err) => Err(err),
    };
    let failed = found.is_err();
    let found = found.ok().flatten();
    let newer = found.is_some();
    with_updates(app, |updates| updates.set(stage_after_check(found)));
    if asked {
        if failed {
            notify(app, "Agent Office", "Could not check for updates.");
        } else if !newer {
            notify(app, "Agent Office", "This is the latest version.");
        }
    }
}

// Downloads and installs the newer version, then restarts. The update is asked for
// again here, so what is installed is what the feed says now.
async fn install(app: &AppHandle) {
    with_updates(app, |updates| updates.set(Stage::Installing));
    let outcome = async {
        let update = app.updater()?.check().await?;
        match update {
            Some(update) => update.download_and_install(|_, _| {}, || {}).await.map(|()| true),
            None => Ok(false),
        }
    }
    .await;
    match outcome {
        Ok(true) => app.restart(),
        Ok(false) => with_updates(app, |updates| updates.set(Stage::Current)),
        Err(err) => {
            eprintln!("Agent Office: update failed: {err}");
            with_updates(app, |updates| updates.set(Stage::Current));
            notify(app, "Agent Office", "The update failed.");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn available() -> Stage {
        Stage::Available("0.2.0".into())
    }

    #[test]
    fn only_a_linux_install_outside_an_appimage_cannot_update_itself() {
        assert!(can_update_itself(true, true));
        assert!(!can_update_itself(true, false));
        assert!(can_update_itself(false, false));
        assert!(can_update_itself(false, true));
    }

    #[test]
    fn the_item_says_what_a_click_will_do() {
        assert_eq!(label(&Stage::Current, true), "Check for updates");
        assert_eq!(label(&Stage::Current, false), "Check for updates");
        assert_eq!(label(&available(), true), "Update to v0.2.0");
        assert_eq!(label(&available(), false), "v0.2.0 is available");
        assert_eq!(label(&Stage::Checking, true), "Checking for updates...");
        assert_eq!(label(&Stage::Installing, true), "Updating...");
    }

    #[test]
    fn a_click_checks_installs_or_points_to_the_releases() {
        assert_eq!(click(&Stage::Current, true), Click::Check);
        assert_eq!(click(&Stage::Current, false), Click::Check);
        assert_eq!(click(&available(), true), Click::Install);
        assert_eq!(click(&available(), false), Click::PointToReleases);
        assert_eq!(click(&Stage::Checking, true), Click::Nothing);
        assert_eq!(click(&Stage::Installing, false), Click::Nothing);
    }

    #[test]
    fn the_item_is_off_only_while_work_is_under_way() {
        assert!(enabled(&Stage::Current));
        assert!(enabled(&available()));
        assert!(!enabled(&Stage::Checking));
        assert!(!enabled(&Stage::Installing));
    }

    #[test]
    fn a_check_ends_with_the_version_it_found_or_with_nothing() {
        assert_eq!(stage_after_check(Some("0.2.0".into())), available());
        assert_eq!(stage_after_check(None), Stage::Current);
    }
}
