import type { Entry } from '../data/conversation';

// The entries put together as they are shown: one turn for each run of them by
// the same side, the person's or the tool's.
export interface Turn {
  id: string; // its first entry's
  fromUser: boolean;
  entries: Entry[];
}

export function turnsOf(entries: readonly Entry[]): Turn[] {
  const turns: Turn[] = [];
  for (const entry of entries) {
    const last = turns[turns.length - 1];
    if (last && last.fromUser === entry.fromUser) last.entries.push(entry);
    else turns.push({ id: entry.id, fromUser: entry.fromUser, entries: [entry] });
  }
  return turns;
}
