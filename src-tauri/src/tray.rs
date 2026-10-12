// The tray icon: a menu (Show, Launch at login, Check for updates in release builds,
// Quit) and an orange dot on the icon while any session is waiting.

use std::error::Error;
use std::sync::{Mutex, PoisonError};

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};
use tauri_plugin_autostart::ManagerExt;

use crate::state::{Session, Status};

// the app's orange, as red, green, blue, alpha
const ORANGE: [u8; 4] = [0xff, 0x75, 0x48, 0xff];

pub struct Tray {
    icon: TrayIcon,
    plain: Image<'static>,
    marked: Image<'static>,
    // how many were waiting when the icon was last set
    waiting: Mutex<usize>,
}

impl Tray {
    pub fn create(
        app: &AppHandle,
        waiting: usize,
        update: Option<&MenuItem<Wry>>,
    ) -> Result<Self, Box<dyn Error>> {
        let base = app.default_window_icon().ok_or("the app has no icon")?;
        let (width, height) = (base.width(), base.height());
        let plain = Image::new_owned(base.rgba().to_vec(), width, height);
        let marked = Image::new_owned(with_dot(base.rgba(), width, height), width, height);

        let login = CheckMenuItem::with_id(
            app,
            "login",
            "Launch at login",
            true,
            app.autolaunch().is_enabled().unwrap_or(false),
            None::<&str>,
        )?;
        let menu = Menu::with_items(
            app,
            &[
                &MenuItem::with_id(app, "show", "Show", true, None::<&str>)?,
                &login,
            ],
        )?;
        if let Some(update) = update {
            menu.append(update)?;
        }
        menu.append(&MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?)?;

        let builder = TrayIconBuilder::with_id("main")
            .icon(if waiting > 0 {
                marked.clone()
            } else {
                plain.clone()
            })
            .tooltip(tooltip(waiting))
            .menu(&menu)
            .on_menu_event(move |app, event| match event.id().as_ref() {
                "show" => crate::show_main(app),
                "login" => toggle_login(app, &login),
                "update" => crate::update::on_click(app),
                "quit" => app.exit(0),
                _ => {}
            })
            // Windows and macOS report clicks on the icon, so a left click shows the
            // window and the menu stays on the right click. Linux reports none: there
            // the menu is the only way in, and Show is in it.
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    crate::show_main(tray.app_handle());
                }
            });
        #[cfg(not(target_os = "linux"))]
        let builder = builder.show_menu_on_left_click(false);

        Ok(Self {
            icon: builder.build(app)?,
            plain,
            marked,
            waiting: Mutex::new(waiting),
        })
    }

    // Brings the icon in line with how many are waiting. The picture changes only
    // when "anyone waiting" does; the tooltip (which Linux does not show) follows
    // the count.
    pub fn sync(&self, waiting: usize) {
        let mut shown = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
        if *shown == waiting {
            return;
        }
        let was_marked = *shown > 0;
        *shown = waiting;
        if was_marked != (waiting > 0) {
            let picture = if waiting > 0 {
                &self.marked
            } else {
                &self.plain
            };
            let _ = self.icon.set_icon(Some(picture.clone()));
        }
        let _ = self.icon.set_tooltip(Some(tooltip(waiting)));
    }
}

// Flips the setting, then shows what the system says it is now, so the tick never
// claims a change that did not happen.
fn toggle_login(app: &AppHandle, item: &CheckMenuItem<tauri::Wry>) {
    let autostart = app.autolaunch();
    let _ = if autostart.is_enabled().unwrap_or(false) {
        autostart.disable()
    } else {
        autostart.enable()
    };
    let _ = item.set_checked(autostart.is_enabled().unwrap_or(false));
}

pub fn waiting_count(sessions: &[Session]) -> usize {
    sessions
        .iter()
        .filter(|s| s.status == Status::Waiting)
        .count()
}

fn tooltip(waiting: usize) -> String {
    match waiting {
        0 => "Agent Office".into(),
        n => format!("Agent Office: {n} waiting"),
    }
}

// A copy of the picture with an orange dot in its bottom right corner. A buffer
// that is not width x height pixels of four bytes comes back as it was.
fn with_dot(rgba: &[u8], width: u32, height: u32) -> Vec<u8> {
    let mut out = rgba.to_vec();
    if out.len() as u64 != u64::from(width) * u64::from(height) * 4 {
        return out;
    }
    let radius = width.min(height) as f32 / 4.0;
    let (cx, cy) = (width as f32 - radius, height as f32 - radius);
    for y in 0..height {
        for x in 0..width {
            let (dx, dy) = (x as f32 + 0.5 - cx, y as f32 + 0.5 - cy);
            if dx * dx + dy * dy <= radius * radius {
                let at = (y as usize * width as usize + x as usize) * 4;
                out[at..at + 4].copy_from_slice(&ORANGE);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grey(width: u32, height: u32) -> Vec<u8> {
        [0x80, 0x80, 0x80, 0xff].repeat((width * height) as usize)
    }

    #[test]
    fn the_dot_keeps_the_size_and_paints_orange() {
        let (w, h) = (32, 32);
        let out = with_dot(&grey(w, h), w, h);
        assert_eq!(out.len(), grey(w, h).len());
        let last = out.len() - 4;
        assert_eq!(out[..4], [0x80, 0x80, 0x80, 0xff]);
        // the dot's centre is near the corner, but the corner pixel itself is outside it
        let centre = ((24 * w + 24) * 4) as usize;
        assert_eq!(out[centre..centre + 4], ORANGE);
        assert_eq!(out[last..], [0x80, 0x80, 0x80, 0xff]);
    }

    #[test]
    fn the_dot_changes_nothing_outside_its_area() {
        let (w, h) = (40u32, 24u32);
        let before = grey(w, h);
        let after = with_dot(&before, w, h);
        let radius = h / 4; // the shorter side over four
        let mut changed = 0;
        for y in 0..h {
            for x in 0..w {
                let at = ((y * w + x) * 4) as usize;
                if before[at..at + 4] != after[at..at + 4] {
                    changed += 1;
                    assert!(
                        x >= w - 2 * radius && y >= h - 2 * radius,
                        "({x}, {y}) is outside the dot"
                    );
                }
            }
        }
        assert!(changed > 0);
    }

    #[test]
    fn a_very_small_icon_does_not_panic() {
        for (w, h) in [(0, 0), (1, 1), (2, 2), (3, 1), (1, 5)] {
            assert_eq!(with_dot(&grey(w, h), w, h).len(), (w * h * 4) as usize);
        }
    }

    #[test]
    fn a_buffer_of_the_wrong_length_comes_back_unchanged() {
        assert_eq!(with_dot(&[1, 2, 3], 4, 4), [1, 2, 3]);
    }

    #[test]
    fn the_tooltip_says_how_many_are_waiting() {
        assert_eq!(tooltip(0), "Agent Office");
        assert_eq!(tooltip(2), "Agent Office: 2 waiting");
    }
}
