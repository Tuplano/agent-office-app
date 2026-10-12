import { useEffect } from "react";
import { useOfficeState } from "../data/useOfficeState";
import type { Editor, EditState } from "../engine";
import { summaryLine, windowTitle } from "../lib/describe";
import { useTheme } from "../lib/theme";
import { setTitle } from "../lib/window";

interface Props {
  editor: Editor | null; // null until the office is there to be edited
  edit: EditState;
}

export function Header({ editor, edit }: Props) {
  const { state, status } = useOfficeState();
  const { theme, toggle } = useTheme();

  const summary =
    status === "connected"
      ? summaryLine(state.sessions)
      : status === "lost"
        ? "Can't reach the session watcher."
        : "Connecting…";
  // the counts ride in the window's title, to be seen while the window is not
  const title = status === "connected" ? windowTitle(state.sessions) : "Agent Office";
  useEffect(() => setTitle(title), [title]);

  return (
    <header className="bar">
      <h1>Agent Office</h1>
      <p role="status">{summary}</p>
      {edit.on ? (
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
      ) : (
        <button type="button" disabled={!editor} onClick={editor?.start}>
          Edit room
        </button>
      )}
      <button type="button" onClick={toggle}>
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
    </header>
  );
}
