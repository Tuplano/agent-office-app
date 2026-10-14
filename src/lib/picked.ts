import type { Session } from '../shared/state';

// The session that was picked out, while it is still among those that are open. A
// session that has ended is nobody's to pick, and neither is one never clicked.
export function pickedOf(sessions: readonly Session[], id: string | null): Session | null {
  return (id !== null && sessions.find((session) => session.id === id)) || null;
}
