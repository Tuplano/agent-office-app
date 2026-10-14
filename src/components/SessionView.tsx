import { lazy, Suspense, useState } from "react";
import { closeTerminal } from "../data/terminals";
import { toolName } from "../lib/describe";
import type { Pointed } from "../lib/pointed";
import { useNow } from "../lib/useNow";
import type { Session } from "../shared/state";
import { Conversation } from "./Conversation";
import { SessionCard } from "./SessionCard";

// xterm is most of its weight, and only the app, never the demo, opens one
const TerminalPane = lazy(() => import("./TerminalPane").then((module) => ({ default: module.TerminalPane })));

interface Props {
  session: Session;
  home: string;
  hot: boolean; // its name tag in the office is being pointed at
  onPoint(pointed: Pointed | null): void;
  onBack(): void;
  // there is a Rust side to read a conversation from: not in the demo
  readable: boolean;
}

// One session, in the place of the list of them all.
// For a session started in the app, that is its terminal, and the way to end it.
// For a Claude Code session started elsewhere, its conversation, read along.
export function SessionView({ session, home, hot, onPoint, onBack, readable }: Props) {
  const now = useNow(5000);
  const { terminal } = session;
  const [ending, setEnding] = useState(false); // asked whether to, and not yet answered
  const [failed, setFailed] = useState<string | null>(null);
  const end = () => {
    if (terminal === null) return;
    closeTerminal(terminal).catch((err: unknown) => setFailed(String(err)));
  };

  return (
    <div className="side view">
      {/* the keyboard goes where the card that was clicked has gone from */}
      <button type="button" className="back" onClick={onBack} autoFocus>
        ← All sessions
      </button>
      <SessionCard session={session} home={home} now={now} hot={hot} onPoint={onPoint} />
      {terminal !== null ? (
        <>
          <Suspense fallback={<div className="term" />}>
            <TerminalPane id={terminal} />
          </Suspense>
          <div className="ending">
            {ending ? (
              <>
                <span>End it? This stops {toolName(session.tool)}.</span>
                <button type="button" className="primary" onClick={end}>
                  End it
                </button>
                <button type="button" onClick={() => setEnding(false)}>
                  Keep it
                </button>
              </>
            ) : (
              <button type="button" onClick={() => setEnding(true)}>
                End session
              </button>
            )}
          </div>
          {failed && <p className="ended">{failed}</p>}
        </>
      ) : readable && session.tool === "claude" ? (
        <Conversation sessionId={session.id} cwd={session.cwd} speaker="Claude" />
      ) : (
        <p className="empty">Answer this session in the terminal it runs in.</p>
      )}
    </div>
  );
}
