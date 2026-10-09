import { useEffect } from "react";
import { useOfficeState } from "../data/useOfficeState";
import { summaryLine, windowTitle } from "../lib/describe";
import { useTheme } from "../lib/theme";
import { setTitle } from "../lib/window";

export function Header() {
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
      <button type="button" onClick={toggle}>
        {theme === "dark" ? "Light mode" : "Dark mode"}
      </button>
    </header>
  );
}
