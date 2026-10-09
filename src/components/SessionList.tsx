import { useOfficeState } from "../data/useOfficeState";
import type { Pointed } from "../lib/pointed";
import { useNow } from "../lib/useNow";
import { SessionCard } from "./SessionCard";

interface Props {
  pointed: Pointed | null;
  onPoint(pointed: Pointed | null): void;
}

export function SessionList({ pointed, onPoint }: Props) {
  const { state, status } = useOfficeState();
  const now = useNow(5000);
  const hot = pointed?.on === "tag" ? pointed.id : null;

  return (
    <div className="side">
      {status === "connected" && state.sessions.length === 0 && (
        <p className="empty">
          Nobody's in. Start a Claude Code session and someone takes a seat.
        </p>
      )}
      <section className="roster" aria-label="Claude Code sessions">
        {state.sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            home={state.home}
            now={now}
            hot={session.id === hot}
            onPoint={onPoint}
          />
        ))}
      </section>
    </div>
  );
}
