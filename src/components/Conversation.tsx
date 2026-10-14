import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { conversationAfter, conversationBefore, type Entry } from "../data/conversation";
import { turnsOf } from "../lib/turns";

const EVERY_MS = 1000; // how often what has been added is asked for

// What was shown, with what came since added on. An entry that was shown already
// (a step that `agy` wrote again as it ran) takes the place of the one before.
export function withLater(shown: readonly Entry[], later: readonly Entry[]): Entry[] {
  const at = new Map(shown.map((entry, i) => [entry.id, i]));
  const next = [...shown];
  for (const entry of later) {
    const i = at.get(entry.id);
    if (i === undefined) next.push(entry);
    else next[i] = entry;
  }
  return next;
}
const NEAR = 32; // how near an end of the box, in pixels, counts as at it

interface Props {
  sessionId: string;
  cwd: string;
  speaker: string; // what the tool's side is called: "Claude"
}

// The conversation of a session started elsewhere, read along as it is written.
// It stays at the bottom while it is scrolled to the bottom; scrolled up to the
// top, what came before is fetched. Every word is put on the page as text.
export function Conversation({ sessionId, cwd, speaker }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [found, setFound] = useState<boolean | null>(null); // null while it is first read
  const start = useRef(0); // where in the file what is shown begins, and ends
  const end = useRef(0);
  const fetching = useRef(false); // what came before is being fetched
  const pinned = useRef(true); // at the bottom, and staying there
  const before = useRef<number | null>(null); // the height before older entries went on top

  useEffect(() => {
    let live = true;
    let timer: number | undefined;
    const follow = () => {
      const from = end.current;
      conversationAfter(sessionId, cwd, from)
        .then((page) => {
          if (!live) return;
          end.current = page.end;
          // a file started again from nothing is read again from its start
          if (page.start !== from) setEntries(page.entries);
          else if (page.entries.length) setEntries((shown) => withLater(shown, page.entries));
        })
        .catch(() => {}) // tried again in a second
        .finally(() => {
          if (live) timer = window.setTimeout(follow, EVERY_MS);
        });
    };
    conversationBefore(sessionId, cwd, null).then(
      (page) => {
        if (!live) return;
        start.current = page.start;
        end.current = page.end;
        setEntries(page.entries);
        setFound(true);
        timer = window.setTimeout(follow, EVERY_MS);
      },
      () => live && setFound(false),
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [sessionId, cwd]);

  const fetchOlder = useCallback(() => {
    if (fetching.current || start.current === 0) return;
    fetching.current = true;
    conversationBefore(sessionId, cwd, start.current)
      .then((page) => {
        start.current = page.start;
        before.current = box.current?.scrollHeight ?? 0;
        setEntries((shown) => [...page.entries, ...shown]);
      })
      .catch(() => {})
      .finally(() => {
        fetching.current = false;
      });
  }, [sessionId, cwd]);

  // Where the box is scrolled to once entries are added: kept at the bottom, or,
  // for those put on top, kept on what was being read. With too little to scroll,
  // or still at the top, what came before is fetched too.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    if (before.current !== null) {
      el.scrollTop += el.scrollHeight - before.current;
      before.current = null;
    } else if (pinned.current) {
      el.scrollTop = el.scrollHeight;
    }
    if (el.scrollTop < NEAR) fetchOlder();
  }, [entries, fetchOlder]);

  const scrolled = () => {
    const el = box.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR;
    if (el.scrollTop < NEAR) fetchOlder();
  };

  return (
    <div className="talk" ref={box} onScroll={scrolled} role="log" aria-label="Conversation (read only)">
        {found === null && <p className="empty">Reading…</p>}
        {found === false && <p className="empty">Its conversation could not be found.</p>}
        {found && entries.length === 0 && <p className="empty">Nothing has been said yet.</p>}
        {turnsOf(entries).map((turn) => (
          <section key={turn.id} className={turn.fromUser ? "turn you" : "turn"}>
            <h3>{turn.fromUser ? "You" : speaker}</h3>
            {turn.entries.map((entry) =>
              entry.tool ? (
                <p key={entry.id} className="did">
                  → {entry.tool.name}
                  {entry.tool.note && ` · ${entry.tool.note}`}
                </p>
              ) : (
                <p key={entry.id} className="said">
                  {entry.text}
                </p>
              ),
            )}
          </section>
        ))}
    </div>
  );
}
