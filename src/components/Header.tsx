import { useEffect, useRef, useState } from "react";
import { useOfficeState } from "../data/useOfficeState";
import type { Editor, EditState } from "../engine";
import { summaryLine, windowTitle } from "../lib/describe";
import { useMusic } from "../lib/music";
import { type Theme, useTheme } from "../lib/theme";
import { setTitle } from "../lib/window";
import { EditIcon, MusicIcon, SettingsIcon } from "./icons";

interface Props {
  editor: Editor | null; // null until the office is there to be edited
  edit: EditState;
  // the room is to be edited: what it starts from is asked first
  onEdit(): void;
}

interface SettingsProps {
  theme: Theme;
  onTheme(): void; // swaps it for the other
  music: ReturnType<typeof useMusic>;
}

// What is set once and left: the theme, and the music and how loud it is.
function Settings({ theme, onTheme, music }: SettingsProps) {
  return (
    <div className="settings" id="settings" role="dialog" aria-label="Settings">
      <h2>Settings</h2>
      <div className="row">
        <span>Theme</span>
        <div className="tools">
          {(["light", "dark"] as const).map((one) => (
            <button key={one} type="button" aria-pressed={theme === one} onClick={theme === one ? undefined : onTheme}>
              {one === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <span>Music</span>
        <div className="tools">
          {[false, true].map((on) => (
            <button key={String(on)} type="button" aria-pressed={music.on === on} onClick={() => music.play(on)}>
              {on ? "On" : "Off"}
            </button>
          ))}
        </div>
      </div>
      <label className="row">
        <span>Volume</span>
        <input type="range" min={0} max={100} step={5} value={Math.round(music.volume * 100)} onChange={(event) => music.setVolume(Number(event.target.value) / 100)} />
      </label>
    </div>
  );
}

// What floats over the room, as over a game: the name and the count of sessions at
// one corner, and at the other the buttons for the music, for editing the room and
// for the settings.
export function Header({ editor, edit, onEdit }: Props) {
  const { state, status } = useOfficeState();
  const { theme, toggle } = useTheme();
  const music = useMusic();
  const [settings, setSettings] = useState(false);
  const menu = useRef<HTMLDivElement>(null);

  const summary =
    status === "connected"
      ? summaryLine(state.sessions)
      : status === "lost"
        ? "Can't reach the session watcher."
        : "Connecting…";
  // the counts ride in the window's title, to be seen while the window is not
  const title = status === "connected" ? windowTitle(state.sessions) : "Agent Office";
  useEffect(() => setTitle(title), [title]);

  // The settings shut on Escape and on a click anywhere else. Escape is kept from
  // the room behind, which has a use of its own for it.
  useEffect(() => {
    if (!settings) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setSettings(false);
    };
    const press = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node)) setSettings(false);
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("pointerdown", press, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("pointerdown", press, true);
    };
  }, [settings]);

  return (
    <header className="hud">
      <div className="plate">
        <h1>Agent Office</h1>
        <p role="status">{summary}</p>
      </div>
      <div className="dock">
        {edit.on && (
          <div className="tools" role="group" aria-label="Edit the room">
            <button type="button" disabled={!edit.canUndo} onClick={editor?.undo}>
              Undo
            </button>
            <button type="button" disabled={!edit.canRedo} onClick={editor?.redo}>
              Redo
            </button>
            <button type="button" disabled={!edit.canReset} onClick={editor?.reset}>
              Reset
            </button>
            <button type="button" className="primary" onClick={editor?.done}>
              Done
            </button>
          </div>
        )}
        <button type="button" className="icon" aria-label={music.on ? "Stop the music" : "Play music"} title={music.on ? "Stop the music" : "Play music"} aria-pressed={music.on} onClick={() => music.play(!music.on)}>
          <MusicIcon off={!music.on} />
        </button>
        {!edit.on && (
          <button type="button" className="icon" aria-label="Edit room" title="Edit room" disabled={!editor} onClick={onEdit}>
            <EditIcon />
          </button>
        )}
        <div className="menu" ref={menu}>
          <button type="button" className="icon" aria-label="Settings" title="Settings" aria-expanded={settings} aria-controls="settings" onClick={() => setSettings(!settings)}>
            <SettingsIcon />
          </button>
          {settings && <Settings theme={theme} onTheme={toggle} music={music} />}
        </div>
      </div>
    </header>
  );
}
