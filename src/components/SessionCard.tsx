import type { CSSProperties } from "react";
import { sessionTint } from "../engine";
import { metaLine, staffLines, statusLine } from "../lib/describe";
import { shortPath } from "../lib/format";
import type { Pointed } from "../lib/pointed";
import type { Session } from "../shared/state";

interface Props {
  session: Session;
  home: string;
  now: number;
  hot: boolean; // its name tag in the office is being pointed at
  onPoint(pointed: Pointed | null): void;
}

export function SessionCard({ session, home, now, hot, onPoint }: Props) {
  return (
    <article
      className={hot ? "card hot" : "card"}
      // the name tag over the session's worker links here
      id={`s-${session.id}`}
      style={{ "--tint": sessionTint(session.id) } as CSSProperties}
      onMouseEnter={() => onPoint({ id: session.id, on: "card" })}
      onMouseLeave={() => onPoint(null)}
    >
      <h2>{session.name}</h2>
      <p className="where" title={session.cwd}>
        {shortPath(session.cwd, home)}
      </p>
      <p className="state" data-status={session.status}>
        {statusLine(session, now)}
      </p>
      <ul className="agents">
        {staffLines(session).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
      <p className="meta">{metaLine(session, now)}</p>
    </article>
  );
}
