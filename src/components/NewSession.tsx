import { useEffect, useState } from "react";
import { chooseFolder, openTerminal, toolsFound } from "../data/terminals";
import { toolName } from "../lib/describe";
import { rememberFolder } from "../lib/folders";
import { shortPath } from "../lib/format";

interface Props {
  folders: string[]; // to choose from, the likeliest first
  home: string;
  onStarted(terminal: number): void;
}

// Starts a session in a terminal of the app's own: one of the tools that are
// installed, in a folder. Its worker walks in, and its view opens on the terminal.
export function NewSession({ folders, home, onStarted }: Props) {
  const [tools, setTools] = useState<string[] | null>(null); // null while they are looked for
  const [tool, setTool] = useState<string | null>(null);
  const [browsed, setBrowsed] = useState<string[]>([]);
  const [folder, setFolder] = useState<string | null>(folders[0] ?? null);
  const [starting, setStarting] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    toolsFound()
      .then((found) => {
        if (!live) return;
        setTools(found);
        setTool((chosen) => chosen ?? found[0] ?? null);
      })
      .catch(() => live && setTools([]));
    return () => {
      live = false;
    };
  }, []);

  const browse = () => {
    chooseFolder()
      .then((picked) => {
        if (!picked) return;
        setBrowsed((before) => [picked, ...before.filter((f) => f !== picked)]);
        setFolder(picked);
      })
      .catch((err: unknown) => setFailed(String(err)));
  };

  const start = () => {
    if (!tool || !folder) return;
    setStarting(true);
    setFailed(null);
    openTerminal(tool, folder).then(
      (terminal) => {
        rememberFolder(folder);
        onStarted(terminal);
      },
      (err: unknown) => {
        setFailed(String(err));
        setStarting(false);
      },
    );
  };

  const choices = [...new Set([...browsed, ...folders])];
  return (
    <div className="settings start" id="new-session" role="dialog" aria-label="New session">
      <h2>New session</h2>
      <div className="row">
        <span>Tool</span>
        {tools === null ? (
          <span className="dim">Looking…</span>
        ) : tools.length === 0 ? (
          <span className="dim">None of Claude Code, Codex, Gemini or Antigravity is installed.</span>
        ) : (
          <div className="tools">
            {tools.map((name) => (
              <button key={name} type="button" aria-pressed={tool === name} onClick={() => setTool(name)}>
                {toolName(name)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="row">
        <span>Folder</span>
        <div className="folder">
          {choices.length > 0 && (
            <select aria-label="Folder" value={folder ?? ""} onChange={(event) => setFolder(event.target.value)} title={folder ?? undefined}>
              {choices.map((choice) => (
                <option key={choice} value={choice}>
                  {shortPath(choice, home)}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={browse}>
            Browse…
          </button>
        </div>
      </div>
      <button type="button" className="primary" disabled={!tool || !folder || starting} onClick={start}>
        {starting ? "Starting…" : "Start"}
      </button>
      {failed && <p className="ended">{failed}</p>}
    </div>
  );
}
