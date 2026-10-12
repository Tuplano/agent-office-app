import { isDemo } from "../data/choose-source";

export const DOWNLOAD_URL = "https://github.com/Tuplano/agent-office-app/releases";

// Owns up to the made-up sessions. Shown whenever the demo feed is the one in use.
export function DemoNotice() {
  if (!isDemo) return null;
  return (
    <aside className="demo">
      <p>
        This is a demo: these sessions are made up. The app shows the Claude Code
        sessions running on your own machine.
      </p>
      <a href={DOWNLOAD_URL} target="_blank" rel="noreferrer">
        Download the app
      </a>
    </aside>
  );
}
