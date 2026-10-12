import { CELL, type Dir } from './constants';
import type { Finish } from './finish';
import { FLOOR_KINDS } from './pieces';
import { placeRect, type Rect, wallLength } from './place';
import { type FloorPiece, onWall, type Piece, type Room, type WallPiece } from './room';
import { problemsOf } from './valid';
import { WALL_KINDS } from './walls';

// Every change to a room is a plain function from one room to the next, so they
// can be tried without a canvas, and undoing one is going back to the room before.

export const snap = (v: number) => Math.round(v / CELL) * CELL; // onto the walking grid
export const STEP = CELL / 2; // what hangs on a wall moves along it in steps half as long
export const snapAlong = (a: number) => Math.round(a / STEP) * STEP;
// The next line of a grid on from `v`, forwards or backwards; `v` itself for no
// way at all. A piece that is off the grid goes onto it with its first step.
export const stepOn = (v: number, way: number, grid: number) => (way > 0 ? Math.floor(v / grid) * grid + grid : way < 0 ? Math.ceil(v / grid) * grid - grid : v);
export const WALLS: readonly Dir[] = ['N', 'E', 'S', 'W']; // round the room

// What can be added to a room, as the palette lists it. There is only ever the one door.
export const PALETTE: readonly { kind: string; name: string; wall: boolean }[] = [
  ...Object.entries(FLOOR_KINDS).map(([kind, { name }]) => ({ kind, name, wall: false })),
  ...Object.entries(WALL_KINDS).flatMap(([kind, { name, door }]) => (door ? [] : [{ kind, name, wall: true }])),
];

// The piece that has this number, if it is of a kind there is.
export function pieceOf(room: Room, index: number | null): Piece | null {
  const piece = index === null ? undefined : room.pieces[index];
  return piece && (onWall(piece) ? WALL_KINDS[piece.kind] : FLOOR_KINDS[piece.kind]) ? piece : null;
}
export const nameOf = (piece: Piece) => (onWall(piece) ? WALL_KINDS[piece.kind] : FLOOR_KINDS[piece.kind]).name;

// the floor a piece takes up where it stands
export function reach(piece: FloorPiece): Rect {
  const box = FLOOR_KINDS[piece.kind].box(piece);
  return placeRect(box, piece, [0, 0, ...box]);
}

const swap = (room: Room, index: number, piece: Piece): Room => ({ ...room, pieces: room.pieces.map((old, i) => (i === index ? piece : old)) });

// A piece on the floor, put down somewhere else.
export function movePiece(room: Room, index: number, x: number, y: number): Room {
  const piece = pieceOf(room, index);
  return piece && !onWall(piece) ? swap(room, index, { ...piece, x, y }) : room;
}

// As near to `a` along a wall as a piece can hang without sticking out past either end of it.
export function alongWall(room: Room, piece: WallPiece, wall: Dir, a: number): number {
  const [from, to] = WALL_KINDS[piece.kind].span(piece);
  return Math.max(-from, Math.min(wallLength(room.size, wall) - to, a));
}

// A piece on a wall, hung somewhere else along it or on another wall.
export function slidePiece(room: Room, index: number, wall: Dir, a: number): Room {
  const piece = pieceOf(room, index);
  return piece && onWall(piece) ? swap(room, index, { ...piece, wall, a }) : room;
}

export const GROW = CELL * 2; // how far a wall goes out or comes in at a time

// The room made wider or deeper, or less so: its east and south walls move, and
// everything keeps its distance from the north-west corner. What hangs on a wall
// that has got shorter slides back onto it, and the cat's home keeps its distance
// from a wall that has moved. What is left standing outside is the caller's to mind.
export function resizeRoom(room: Room, w: number, d: number): Room {
  const sized: Room = { ...room, size: { w, d } };
  const kept = (v: number, was: number, now: number) => (v > was / 2 ? v + now - was : v);
  return {
    ...sized,
    pieces: room.pieces.map((piece) => (onWall(piece) && WALL_KINDS[piece.kind] ? { ...piece, a: alongWall(sized, piece, piece.wall, piece.a) } : piece)),
    cat: room.cat.map(({ x, y }) => ({ x: kept(x, room.size.w, w), y: kept(y, room.size.d, d) })),
  };
}

// A quarter turn: for a piece on the floor, about its own middle, and one that is
// not square is put back on the grid; for a piece on a wall, round to the next wall.
export function turnPiece(room: Room, index: number): Room {
  const piece = pieceOf(room, index);
  if (!piece) return room;
  if (onWall(piece)) {
    const wall = WALLS[(WALLS.indexOf(piece.wall) + 1) & 3];
    return swap(room, index, { ...piece, wall, a: alongWall(room, piece, wall, piece.a) });
  }
  const [x, y, w, d] = reach(piece);
  const turn = ((piece.turn + 1) & 3) as FloorPiece['turn'];
  if (w === d) return swap(room, index, { ...piece, turn });
  return swap(room, index, { ...piece, turn, x: snap(x + w / 2 - d / 2), y: snap(y + d / 2 - w / 2) });
}

// The colour a piece has, if its kind has one of its own to choose; null if not.
export function tintOf(piece: Piece): string | null {
  const kind = onWall(piece) ? WALL_KINDS[piece.kind] : FLOOR_KINDS[piece.kind];
  return kind?.tint ? (piece.tint ?? kind.tint) : null;
}

// A piece in another colour; null puts it back in the colour it comes in.
export function paintPiece(room: Room, index: number, hex: string | null): Room {
  const piece = pieceOf(room, index);
  if (!piece || tintOf(piece) === null) return room;
  const { tint: _was, ...bare } = piece;
  return swap(room, index, hex === null ? bare : { ...bare, tint: hex });
}

// The room finished differently: what `change` names is set, and what it names as
// null goes back to how it comes. A room with nothing left to say has no finish.
export function finishRoom(room: Room, change: { [K in keyof Finish]?: string | null }): Room {
  const finish: Finish = { ...room.finish };
  for (const key of Object.keys(change) as (keyof Finish)[]) {
    const hex = change[key];
    if (hex) finish[key] = hex;
    else delete finish[key];
  }
  const { finish: _was, ...bare } = room;
  return Object.keys(finish).length ? { ...bare, finish } : bare;
}

export const removePiece = (room: Room, index: number): Room => ({ ...room, pieces: room.pieces.filter((_, i) => i !== index) });

// the first of the rooms made by trying a piece in each of these places that is a sound one
function firstSound(room: Room, tries: Piece[]): Room | null {
  for (const piece of tries) {
    const next = { ...room, pieces: [...room.pieces, piece] };
    if (!problemsOf(next).length) return next;
  }
  return null;
}

// The room with one more piece standing in it, on the clear floor nearest to
// (x, y) where it fits; null when there is nowhere it does. The new piece is the last.
function stand(room: Room, piece: FloorPiece, x: number, y: number): Room | null {
  const [, , w, d] = reach(piece);
  const spots: [x: number, y: number][] = [];
  for (let sy = 0; sy + d <= room.size.d; sy += CELL) for (let sx = 0; sx + w <= room.size.w; sx += CELL) spots.push([sx, sy]);
  const off = ([sx, sy]: [number, number]) => (sx - x) ** 2 + (sy - y) ** 2;
  return firstSound(room, spots.sort((a, b) => off(a) - off(b)).map(([sx, sy]) => ({ ...piece, x: sx, y: sy })));
}

// The same for a piece on a wall: on the first of these walls that has room, as
// near to `a` along it as it fits, or to the middle of the wall when no `a` is given.
function hang(room: Room, piece: WallPiece, walls: readonly Dir[], a?: number): Room | null {
  const [from, to] = WALL_KINDS[piece.kind].span(piece);
  for (const wall of walls) {
    const long = wallLength(room.size, wall);
    const near = a ?? (long - from - to) / 2;
    const spots: number[] = [];
    for (let at = Math.ceil(-from / STEP) * STEP; at + to <= long; at += STEP) spots.push(at);
    const next = firstSound(room, spots.sort((p, q) => Math.abs(p - near) - Math.abs(q - near)).map((at) => ({ ...piece, wall, a: at })));
    if (next) return next;
  }
  return null;
}

// One more piece of a kind: on the floor as near the middle of the room as it
// fits, or on the first of `walls` that has room for it.
export function addPiece(room: Room, kind: string, walls: readonly Dir[] = WALLS): Room | null {
  if (WALL_KINDS[kind]) return hang(room, { kind, wall: walls[0], a: 0 }, walls);
  if (!FLOOR_KINDS[kind]) return null;
  const piece: FloorPiece = { kind, x: 0, y: 0, turn: 0 };
  const [, , w, d] = reach(piece);
  return stand(room, piece, (room.size.w - w) / 2, (room.size.d - d) / 2);
}

// A copy of a piece, as near to it as it fits: on its own wall first, for one that hangs.
export function duplicatePiece(room: Room, index: number): Room | null {
  const piece = pieceOf(room, index);
  if (!piece) return null;
  if (onWall(piece)) return hang(room, { ...piece }, [piece.wall, ...WALLS.filter((wall) => wall !== piece.wall)], piece.a);
  return stand(room, { ...piece }, piece.x, piece.y);
}

// The rooms there have been, for undo and redo.
export interface History {
  past: readonly Room[];
  now: Room;
  future: readonly Room[];
}
const DEPTH = 100; // how far back undo goes

export const begin = (room: Room): History => ({ past: [], now: room, future: [] });
export const commit = (history: History, room: Room): History => ({ past: [...history.past, history.now].slice(-DEPTH), now: room, future: [] });
export function undo(history: History): History {
  const { past, now, future } = history;
  return past.length ? { past: past.slice(0, -1), now: past[past.length - 1], future: [now, ...future] } : history;
}
export function redo(history: History): History {
  const { past, now, future } = history;
  return future.length ? { past: [...past, now], now: future[0], future: future.slice(1) } : history;
}
