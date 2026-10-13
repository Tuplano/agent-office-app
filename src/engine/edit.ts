import { CELL, type Dir } from './constants';
import { faceFor, facesOf } from './faces';
import type { Finish } from './finish';
import { modelOf } from './models';
import { FLOOR_KINDS, LONG } from './pieces';
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

// What can be added to a room, as the palette lists it: the kinds written in code.
// The models brought in are the editor's to add to these. There is only ever the one door.
// The walls and doors that divide a room are marked, to be listed apart from the furniture.
// The ones that come in lengths are not added but drawn, from one end to the other.
export const PALETTE: readonly { kind: string; name: string; wall: boolean; build: boolean; drawn: boolean }[] = [
  ...Object.entries(FLOOR_KINDS).flatMap(([kind, { name, build, long }]) => (modelOf(kind) ? [] : [{ kind, name, wall: false, build: !!build, drawn: !!long }])),
  ...Object.entries(WALL_KINDS).flatMap(([kind, { name, door }]) => (door ? [] : [{ kind, name, wall: true, build: false, drawn: false }])),
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
// On a wall that stands in the room, `side` is how far along that side of it runs.
export function alongWall(room: Room, piece: WallPiece, wall: Dir, a: number, side?: { from: number; to: number }): number {
  const [from, to] = WALL_KINDS[piece.kind].span(piece);
  return Math.max((side?.from ?? 0) - from, Math.min((side?.to ?? wallLength(room.size, wall)) - to, a));
}

// A piece on a wall, hung somewhere else along it or on another wall: one of the
// room's own, or with `out` the side of a wall that stands that far out in the room.
export function slidePiece(room: Room, index: number, wall: Dir, a: number, out = 0): Room {
  const piece = pieceOf(room, index);
  if (!piece || !onWall(piece)) return room;
  const { out: _was, ...bare } = piece;
  return swap(room, index, { ...bare, wall, a, ...(out > 0 && { out }) });
}

// The room without what hangs on a wall that is no longer behind it: a wall that
// stood in the room and has been taken away, cut or moved. The room as it was
// when everything still has its wall.
export function shed(room: Room): Room {
  const faces = facesOf(room);
  const pieces = room.pieces.filter((piece) => {
    const kind = onWall(piece) ? WALL_KINDS[piece.kind] : undefined;
    if (!onWall(piece) || !kind || !piece.out) return true;
    const [from, to] = kind.span(piece);
    return !!faceFor(faces, piece, piece.a + from, piece.a + to);
  });
  return pieces.length === room.pieces.length ? room : { ...room, pieces };
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
    pieces: room.pieces.map((piece) => {
      if (!onWall(piece) || !WALL_KINDS[piece.kind]) return piece;
      if (!piece.out) return { ...piece, a: alongWall(sized, piece, piece.wall, piece.a) };
      // on a wall that stands in the room, which stays where it is: so it is further from a wall that has moved
      const moved = piece.wall === 'E' ? w - room.size.w : piece.wall === 'S' ? d - room.size.d : 0;
      return { ...piece, out: piece.out + moved };
    }),
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
    const { out: _was, ...bare } = piece; // off a wall that stands in the room, onto one of the room's own
    return swap(room, index, { ...bare, wall, a: alongWall(room, piece, wall, piece.a) });
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

// How long a piece is, if its kind comes in lengths; null if not.
export function longOf(piece: Piece): number | null {
  const kind = onWall(piece) ? undefined : FLOOR_KINDS[piece.kind];
  return kind?.long && !onWall(piece) ? kind.box(piece)[0] : null;
}

// A piece that comes in lengths, a step of the grid longer or shorter: its low
// corner stays where it is. At either limit it is the room as it was.
export function stretchPiece(room: Room, index: number, way: number): Room {
  const piece = pieceOf(room, index);
  const long = piece && longOf(piece);
  if (!piece || onWall(piece) || long === null) return room;
  const next = Math.max(LONG[0], Math.min(LONG[1], long + Math.sign(way) * CELL));
  return next === long ? room : swap(room, index, { ...piece, size: [next] });
}

// A cell of the floor that a wall is drawn from. One that the last wall ended on
// is `joined`: the next wall begins beside it, and not on top of it.
export interface Corner {
  c: number;
  r: number;
  joined: boolean;
}

// The room with a wall of a kind drawn in a straight line from a corner to the
// cell (c, r), along whichever of the floor's two ways the cell is further off,
// and the corner the wall ends on, for the next to go on from. The new wall is the
// last piece. Null for a kind that is not drawn, or a wall of no length.
export function drawWall(room: Room, kind: string, from: Corner, c: number, r: number): { room: Room; end: Corner } | null {
  if (!FLOOR_KINDS[kind]?.long) return null;
  const flat = Math.abs(c - from.c) >= Math.abs(r - from.r);
  const to = flat ? c : r;
  let start = flat ? from.c : from.r;
  if (from.joined) {
    if (to === start) return null;
    start += Math.sign(to - start);
  }
  const low = Math.min(start, to) * CELL;
  const size = [Math.min(LONG[1], (Math.abs(to - start) + 1) * CELL)];
  const piece: FloorPiece = flat ? { kind, x: low, y: from.r * CELL, turn: 0, size } : { kind, x: from.c * CELL, y: low, turn: 1, size };
  return { room: { ...room, pieces: [...room.pieces, piece] }, end: flat ? { c: to, r: from.r, joined: true } : { c: from.c, r: to, joined: true } };
}

export const CUT = 'cut'; // what is "drawn" to take wall away: not a kind of piece

// The floor under a straight line of cells from a corner to the cell (c, r), which
// runs the way a drawn wall would: along whichever way the cell is further off.
export function lineOf(from: Corner, c: number, r: number): Rect {
  const flat = Math.abs(c - from.c) >= Math.abs(r - from.r);
  const [c0, c1] = flat ? [Math.min(from.c, c), Math.max(from.c, c)] : [from.c, from.c];
  const [r0, r1] = flat ? [from.r, from.r] : [Math.min(from.r, r), Math.max(from.r, r)];
  return [c0 * CELL, r0 * CELL, (c1 - c0 + 1) * CELL, (r1 - r0 + 1) * CELL];
}

// The room with the walls that stand in it cut away along a straight line from a
// corner to the cell (c, r), which runs the way a drawn wall would. A wall that
// the line passes through is left in two lengths, the second of them last; one
// that it covers is gone. The room as it was when there is no wall on the line.
export function cutWalls(room: Room, from: Corner, c: number, r: number): Room {
  const [gx, gy, gw, gd] = lineOf(from, c, r);
  const pieces: Piece[] = [];
  const more: Piece[] = [];
  let cut = false;
  for (const piece of room.pieces) {
    const [x, y, w, d] = !onWall(piece) && FLOOR_KINDS[piece.kind]?.long ? reach(piece) : [0, 0, 0, 0];
    if (onWall(piece) || !(x < gx + gw && gx < x + w && y < gy + gd && gy < y + d)) {
      pieces.push(piece);
      continue;
    }
    cut = true;
    const along = piece.turn % 2 === 0; // the wall runs along x
    const [start, end] = along ? [x, x + w] : [y, y + d];
    const [g0, g1] = along ? [gx, gx + gw] : [gy, gy + gd];
    const part = (a: number, b: number): FloorPiece => ({ ...piece, ...(along ? { x: a } : { y: a }), size: [b - a] });
    const parts = [...(start < g0 ? [part(start, g0)] : []), ...(end > g1 ? [part(g1, end)] : [])];
    pieces.push(...parts.slice(0, 1));
    more.push(...parts.slice(1));
  }
  return cut ? shed({ ...room, pieces: [...pieces, ...more] }) : room;
}

// A door put down on a wall that stands in the room: it is turned to lie along the
// wall and set in its line, and the wall gives up the length the door takes, in
// one piece or in two. Every piece keeps its number; a second length of wall goes
// last. Any other piece, or a door on no wall, leaves the room as it was.
export function doorInWall(room: Room, index: number): Room {
  const door = pieceOf(room, index);
  if (!door || onWall(door) || !FLOOR_KINDS[door.kind].cuts) return room;
  const [dx, dy, dw, dd] = reach(door);
  const [mx, my] = [dx + dw / 2, dy + dd / 2];
  const walls = (piece: Piece): piece is FloorPiece => !onWall(piece) && !!FLOOR_KINDS[piece.kind]?.long;
  const under = room.pieces.find((piece): piece is FloorPiece => {
    if (!walls(piece)) return false;
    const [x, y, w, d] = reach(piece);
    return mx >= x && mx <= x + w && my >= y && my <= y + d;
  });
  if (!under) return room;
  const flat = under.turn % 2 === 0; // the wall runs along x
  const long = Math.max(dw, dd);
  const set: FloorPiece = flat ? { ...door, turn: door.turn % 2 ? 0 : door.turn, x: snap(mx - long / 2), y: under.y } : { ...door, turn: door.turn % 2 ? door.turn : 1, x: under.x, y: snap(my - long / 2) };
  const [a0, a1] = flat ? [set.x, set.x + long] : [set.y, set.y + long];
  const pieces: Piece[] = [];
  const more: Piece[] = [];
  room.pieces.forEach((piece, i) => {
    if (i === index) return void pieces.push(set);
    const [x, y, w, d] = walls(piece) ? reach(piece) : [0, 0, 0, 0];
    const [from, to] = flat ? [x, x + w] : [y, y + d];
    const inLine = walls(piece) && (piece.turn % 2 === 0) === flat && (flat ? y === set.y : x === set.x) && from < a1 && a0 < to;
    if (!inLine || !walls(piece)) return void pieces.push(piece);
    const part = (start: number, end: number): FloorPiece => ({ ...piece, ...(flat ? { x: start } : { y: start }), size: [end - start] });
    const parts = [...(from < a0 ? [part(from, a0)] : []), ...(to > a1 ? [part(a1, to)] : [])];
    pieces.push(parts[0] ?? piece); // a wall with nothing left of it stays, and is in the way
    more.push(...parts.slice(1));
  });
  return { ...room, pieces: [...pieces, ...more] };
}

// what hung on a wall that is taken away goes with it
export const removePiece = (room: Room, index: number): Room => shed({ ...room, pieces: room.pieces.filter((_, i) => i !== index) });

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
  if (onWall(piece)) {
    const { out: _was, ...bare } = piece; // the copy goes on one of the room's own walls
    return hang(room, bare, [piece.wall, ...WALLS.filter((wall) => wall !== piece.wall)], piece.a);
  }
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
