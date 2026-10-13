import { DEFAULT_ROOM, type Room, RoomSchema } from './room';
import { problemsOf } from './valid';

const STORE = 'agent-office-room';
// The shape a room is saved in. A room saved in another shape is dropped; when the
// shape next changes, this is where an older one gets brought up to date.
const VERSION = 1;

// A room written out: how it is saved, and how it is copied to be pasted in elsewhere.
export const writeRoom = (room: Room) => JSON.stringify({ version: VERSION, room });

// The room that was written out, or null for anything else. Whether it is a room
// the office can take is for whoever reads it to ask (valid.ts).
export function readRoom(text: string): Room | null {
  try {
    const written = JSON.parse(text);
    return written?.version === VERSION ? RoomSchema.parse(written.room) : null;
  } catch {
    return null; // not JSON, or not a room
  }
}

// The room as it was left, or the default one when nothing sound was saved.
export function loadRoom(): Room {
  try {
    const room = readRoom(localStorage.getItem(STORE) ?? '');
    if (room && !problemsOf(room).length) return room;
  } catch {
    // storage is off
  }
  return DEFAULT_ROOM;
}

export function saveRoom(room: Room) {
  try {
    localStorage.setItem(STORE, writeRoom(room));
  } catch {
    // storage is off; the room just resets next time
  }
}
