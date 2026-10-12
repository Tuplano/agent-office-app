import { DEFAULT_ROOM, type Room, RoomSchema } from './room';
import { problemsOf } from './valid';

const STORE = 'agent-office-room';
// The shape a room is saved in. A room saved in another shape is dropped; when the
// shape next changes, this is where an older one gets brought up to date.
const VERSION = 1;

// The room as it was left, or the default one when nothing sound was saved.
export function loadRoom(): Room {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (saved?.version === VERSION) {
      const room = RoomSchema.parse(saved.room);
      if (!problemsOf(room).length) return room;
    }
  } catch {
    // nothing saved, storage is off, or what was saved is not a room
  }
  return DEFAULT_ROOM;
}

export function saveRoom(room: Room) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ version: VERSION, room }));
  } catch {
    // storage is off; the room just resets next time
  }
}
