import { type Model, ModelSchema } from './models';
import { DEFAULT_ROOM, type Room, RoomSchema } from './room';
import { problemsOf } from './valid';

const STORE = 'agent-office-room';
// The shape a room is saved in. A room saved in another shape is dropped; when the
// shape next changes, this is where an older one gets brought up to date.
const VERSION = 1;

// A room written out: how it is saved, and how it is copied to be pasted in
// elsewhere. A room that is copied takes with it the models its pieces are of,
// since another office will not have them.
export const writeRoom = (room: Room, models: readonly Model[] = []) => JSON.stringify({ version: VERSION, room, ...(models.length > 0 && { models }) });

const MOST_MODELS = 40; // that come along with one room

// What was written out: the room, and the models that came with it, less any that
// are not sound. Null for anything that is not a room. Whether it is a room the
// office can take is for whoever reads it to ask (valid.ts).
export function readWritten(text: string): { room: Room; models: Model[] } | null {
  try {
    const written = JSON.parse(text);
    if (written?.version !== VERSION) return null;
    const room = RoomSchema.parse(written.room);
    const given: unknown[] = Array.isArray(written.models) ? written.models.slice(0, MOST_MODELS) : [];
    return { room, models: given.flatMap((one) => ModelSchema.safeParse(one).data ?? []) };
  } catch {
    return null; // not JSON, or not a room
  }
}
export const readRoom = (text: string): Room | null => readWritten(text)?.room ?? null;

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
