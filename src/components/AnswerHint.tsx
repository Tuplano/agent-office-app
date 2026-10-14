import { useState } from "react";
import { raiseSession } from "../data/host";
import type { Session } from "../shared/state";

interface Props {
  session: Session;
  canRaise: boolean; // there is a Rust side to ask: not in the demo
}

// Where a session started elsewhere is answered, and, where its window can be
// brought forward, the button that does it.
export function AnswerHint({ session, canRaise }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const { host } = session;
  if (!host) return <p className="readonly">Answer it in the terminal it runs in.</p>;
  if (!host.raise || !canRaise) return <p className="readonly">Answer it in {host.name}.</p>;
  const raise = () => {
    setFailed(null);
    raiseSession(session.pid, session.cwd).catch((err: unknown) => setFailed(String(err)));
  };
  return (
    <div className="answer">
      <button type="button" onClick={raise} title="Brings its window forward. The tab in it, if there are several, is yours to pick.">
        Reply in {host.name}
      </button>
      {failed && <span className="ended">{failed}</span>}
    </div>
  );
}
