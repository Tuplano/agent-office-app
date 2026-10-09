import { getCurrentWindow } from '@tauri-apps/api/window';

// Names the window: in its title bar, and wherever else the system lists it.
export function setTitle(title: string) {
  document.title = title;
  try {
    getCurrentWindow().setTitle(title).catch(() => {});
  } catch {
    // not in a Tauri window: the page's title is all there is to set
  }
}
