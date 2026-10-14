import type { Pointed } from "../lib/pointed";
import { useNow } from "../lib/useNow";
import type { Session } from "../shared/state";
import { SessionCard } from "./SessionCard";

interface Props {
  session: Session;
  home: string;
  hot: boolean; // its name tag in the office is being pointed at
  onPoint(pointed: Pointed | null): void;
  onBack(): void;
}

// One session, in the place of the list of them all.
export function SessionView({ session, home, hot, onPoint, onBack }: Props) {
  const now = useNow(5000);

  return (
    <div className="side view">
      {/* the keyboard goes where the card that was clicked has gone from */}
      <button type="button" className="back" onClick={onBack} autoFocus>
        ← All sessions
      </button>
      <SessionCard session={session} home={home} now={now} hot={hot} onPoint={onPoint} />
      <p className="empty">Answer this session in the terminal it runs in.</p>
    </div>
  );
}
