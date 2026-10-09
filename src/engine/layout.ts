import { type Dir, FACING, OPPOSITE, W } from './constants';

export type Rect = readonly [x: number, y: number, w: number, d: number];

export interface Seat {
  x: number;
  y: number;
  dir: Dir;
  kind: 'bench' | 'stool';
  z: number;
}

export interface PlaySpot {
  x: number;
  y: number;
  dir: Dir;
  kind: 'pong' | 'arcade' | 'sofa' | 'bean';
  z?: number; // seat height, for the spots where people sit
}

// Where people sit, as [x, y, facing, kind, seat height]. Facing is the way the
// sitter looks: S and E are towards the camera from the starting view, so those
// seats fill first; the bar stools take the overflow.
const seats: [number, number, Dir, Seat['kind'], number][] = [
  [39, 12, 'S', 'bench', 7], [99, 39, 'E', 'bench', 7], [65, 12, 'S', 'bench', 7], [99, 65, 'E', 'bench', 7],
  [39, 36, 'N', 'bench', 7], [123, 39, 'W', 'bench', 7], [65, 36, 'N', 'bench', 7], [123, 65, 'W', 'bench', 7],
  [28, 58, 'W', 'stool', 9], [28, 72, 'W', 'stool', 9],
];
export const SEATS: readonly Seat[] = seats.map(([x, y, dir, kind, z]) => ({ x, y, dir, kind, z }));

// Where idle people go to play, or to flop.
export const PLAY: readonly PlaySpot[] = [
  { x: 72, y: 113, dir: 'E', kind: 'pong' },
  { x: 104, y: 113, dir: 'W', kind: 'pong' },
  { x: 124, y: 110, dir: 'N', kind: 'arcade' },
  { x: 9, y: 102, dir: 'E', kind: 'sofa', z: 6 },
  { x: 42, y: 98, dir: 'W', kind: 'bean', z: 5 },
  { x: 9, y: 114, dir: 'E', kind: 'sofa', z: 6 },
  { x: 42, y: 118, dir: 'W', kind: 'bean', z: 5 },
];

// Places a supervisor drifts between while there is nothing to note down.
export const HANGOUTS: readonly { x: number; y: number; dir: Dir }[] = [
  { x: 11, y: 58, dir: 'W' }, // making a coffee
  { x: 14, y: 28, dir: 'W' }, // admiring the mural
  { x: 104, y: 8, dir: 'N' }, // at the mood board
  { x: 118, y: 18, dir: 'E' }, // waiting for the phone booth
  { x: 56, y: 66, dir: 'E' }, // watering the planter
  { x: 88, y: 128, dir: 'N' }, // watching the ping-pong
  { x: 132, y: 112, dir: 'W' }, // over the arcade player's shoulder
  { x: 30, y: 88, dir: 'S' }, // by the lounge lamp
];

export const DOOR = { x: 86, y: 2 }; // just inside the door everyone comes in by

// The wall clocks: the real time, in digits three cells wide and five tall. There
// is one on the west wall and one facing it on the east, so that one of them is
// in view whichever way the room is turned. `a` and `z` are the digits' low
// corner; seen from inside, the west wall reads from high y to low.
export interface Clock {
  wall: Dir;
  inside: Dir;
  at: number;
  a: number;
  z: number;
  flip: boolean;
}
export const CLOCKS: readonly Clock[] = [
  { wall: 'W', inside: 'E', at: 0, a: 78.5, z: 18, flip: true },
  { wall: 'E', inside: 'W', at: W, a: 61.5, z: 18, flip: false },
];

// A footprint given relative to a seat (f is forward from the sitter, l is sideways), as [x, y, w, d].
export function around(seat: Seat, f0: number, f1: number, l0: number, l1: number): Rect {
  const { x, y, dir } = seat;
  if (dir === 'S') return [x + l0, y + f0, l1 - l0, f1 - f0];
  if (dir === 'N') return [x + l0, y - f1, l1 - l0, f1 - f0];
  if (dir === 'E') return [x + f0, y + l0, f1 - f0, l1 - l0];
  return [x - f1, y + l0, f1 - f0, l1 - l0];
}

// One side of the laptop in front of a seat: the screen, which faces the sitter, or the lid's back.
export function laptopSide(seat: Seat, screen: boolean): { side: Dir; mid: number; at: number } {
  const [fx, fy] = FACING[seat.dir];
  const far = screen ? 10 : 11;
  const side = screen ? OPPOSITE[seat.dir] : seat.dir;
  return fx === 0 ? { side, mid: seat.x, at: seat.y + fy * far } : { side, mid: seat.y, at: seat.x + fx * far };
}

// What stands on the floor and is in the way of anyone walking. office.ts draws
// these things; this is only where they are. Move one and move the other.
export const FOOTPRINTS: readonly Rect[] = [
  // the two long tables
  [26, 17, 52, 14],
  [104, 26, 14, 52],
  // a chair with its back, or a bar stool
  ...SEATS.map((seat) => (seat.kind === 'stool' ? around(seat, -2.5, 2.5, -2.5, 2.5) : around(seat, -5, 3, -4, 4))),
  // cafe: the back counter, the island, the tree beside them
  [1, 50, 6, 30],
  [15, 51, 8, 28],
  [4, 86, 5, 5],
  // the planter in the middle of the room
  [62, 60, 14, 14],
  // the phone booth, the grass beside it, the tree in the corner by the door
  [124, 2, 12, 12],
  [118, 3, 4, 4],
  [4, 4, 5, 5],
  // lounge: the sofa, the low table, two bean bags, the floor lamp, a bush, some grass
  [2, 94, 11, 28],
  [22, 102, 10, 12],
  [38, 94, 8, 8],
  [38, 114, 8, 8],
  [17, 88, 1, 1],
  [4, 128, 6, 6],
  [50, 128, 4, 4],
  // games: the ping-pong table, the arcade cabinet, a tree, a bush
  [76, 106, 24, 14],
  [118, 94, 12, 10],
  [131, 130, 5, 5],
  [131, 82, 5, 5],
];
