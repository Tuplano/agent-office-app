import { CELL, type Dir, SEAT_Z } from './constants';
import type { Look } from './finish';
import type { Light } from './light';
import {
  CHARCOAL, COBALT, DARK_GLASS, GREIGE, IVORY_SHADE, LEAF, LEAF_LIGHT, LIGHT_POOL, LIME,
  METAL, mix, OAK_DARK, PAPER, PURPLE, SAGE, STEEL, TANGERINE,
} from './palette';
import type { Box, Placed, Rect } from './place';
import type { Pen } from './raster';
import type { FloorPiece } from './room';
import type { Scene } from './scene';

// What a piece is drawn by: the hour's light, the colour of a lamp's bulb at this
// hour, and the wood the room's furniture is made of.
export interface Env {
  light: Light;
  bulb: string;
  wood: Look['wood'];
}

// The places a piece has for people, in its own coordinates.
export interface SeatOffer {
  x: number;
  y: number;
  dir: Dir; // the way the sitter looks
  kind: 'bench' | 'stool';
  z: number; // seat height
}
export interface PlayOffer {
  x: number;
  y: number;
  dir: Dir;
  kind: 'pong' | 'arcade' | 'sofa' | 'bean';
  z?: number; // seat height, for the spots where people sit
}
export interface SpotOffer {
  x: number;
  y: number;
  dir: Dir;
}
// Somewhere to sit on the piece itself, for a piece that is its own chair.
export interface SitOffer extends SpotOffer {
  z: number; // seat height
}

// One kind of thing that stands on the floor. It is described once, in its own
// coordinates and facing its own way; place.ts puts it where a piece of it stands.
export interface FloorKind {
  name: string; // what the palette calls it
  // the colour that is a piece of this kind's own to choose, as it comes: its cloth, its pot, its glass
  tint?: string;
  box(piece: FloorPiece): Box;
  draw(p: Placed, env: Env, piece: FloorPiece): void;
  // what of it is in the way of walkers: the whole box when not said, nothing for a rug
  blocks?: readonly Rect[];
  seats?: readonly SeatOffer[]; // their chairs are drawn by office.ts, and block the floor too
  // Where people sit on the piece itself. Whether one is a seat to work at or a
  // place to rest is for the room to say, by what stands in front of it (layout.ts).
  sits?: readonly SitOffer[];
  top?: number; // how high its top is, if it has one a laptop can stand on
  play?: readonly PlayOffer[];
  hangout?: SpotOffer; // where a supervisor with nothing to note down stands by it
  spare?: SpotOffer; // open floor beside it, for someone with no chair and no lounge seat
  nap?: { x: number; y: number }; // where the cat curls up by it
  build?: boolean; // a wall or a door to divide the room with, listed apart from the furniture
  long?: boolean; // it comes in lengths: `size` is how long a piece of it is, within LONG
  tall?: number; // how high a wall that stands in the room goes, for what is hung on it
  spread?: boolean; // it lies flat and comes in any size: `size` is how wide and how deep, within SPREAD
  cuts?: boolean; // put down on a wall that stands in the room, it takes its own length out of the wall
  // the light it throws on the floor, drawn last, over whatever lies there
  pool?(p: Placed, env: Env): void;
  // what moves on it, drawn every frame; `index` is the piece's place in the room
  live?(p: Placed, scene: Scene, index: number): void;
}

type Boxes = Pick<Pen, 'box'>;

// plants, in four shapes
export function sprig(p: Boxes, x: number, y: number, z: number, pot: string) {
  p.box(x, y, z, 2, 2, 1.5, pot);
  p.box(x - 0.5, y - 0.5, z + 1.5, 3, 3, 2.5, LEAF);
}
function bush(p: Boxes, s: number, pot: string) {
  p.box(0, 0, 0, s, s, s * 0.6, pot);
  p.box(-1, -1, s * 0.6, s + 2, s + 2, s * 0.8, LEAF);
  p.box(1, 1, s * 1.4, s - 2, s - 2, s * 0.35, LEAF_LIGHT);
  p.box(s + 1, 1, s * 0.6 + 1, 2, s - 2, 2, LEAF_LIGHT);
}
function tree(p: Boxes, pot: string) {
  p.box(0, 0, 0, 5, 5, 4, pot);
  p.box(2, 2, 4, 1, 1, 13, OAK_DARK);
  p.box(0, 0, 14, 5, 5, 4, LEAF);
  p.box(-2, 1, 11, 4, 3, 3, LEAF_LIGHT);
  p.box(3, -1, 17, 4, 4, 3, LEAF_LIGHT);
  p.box(1, 2, 20, 3, 3, 3, LEAF);
}
function blades(p: Boxes, pot: string) {
  p.box(0, 0, 0, 4, 4, 3, pot);
  p.box(0.5, 1, 3, 1, 1, 9, LEAF);
  p.box(2, 0.5, 3, 1, 1, 12, LEAF_LIGHT);
  p.box(2.5, 2.5, 3, 1, 1, 7, LEAF);
  p.box(1, 2.5, 3, 1, 1, 10, LEAF_LIGHT);
}

// A lamp hanging over (u, v), with the pool of warm light it throws on a table top
// when lit. The pool lies the same way whichever way the piece is turned.
function pendant(p: Placed, env: Env, u: number, v: number, hex: string, table: number) {
  const [x, y] = p.at(u, v);
  p.raw.box(x - 0.25, y - 0.25, 29, 0.5, 0.5, 9, CHARCOAL);
  p.raw.box(x - 2, y - 2, 26, 4, 4, 3, hex);
  p.raw.box(x - 1, y - 1, 25, 2, 2, 1, env.bulb);
  if (env.light.now.lamps) p.raw.flat(x - 5, x + 5, y - 4, y + 4, table, LIGHT_POOL);
}

function checker(p: Pen, w: number, d: number, size: number, hex: string) {
  for (let x = 0; x < w; x += size) {
    for (let y = 0; y < d; y += size) {
      if (((x + y) / size) & 1) p.flat(x, Math.min(x + size, w), y, Math.min(y + size, d), 0, hex);
    }
  }
}

// What lies flat on the floor is pulled out to any size by its corners.
export const SPREAD: readonly [least: number, most: number] = [CELL * 2, 300];
// how wide and deep a piece of such a kind is: its own measures, or the ones the kind comes in
const spreadOf = (piece: FloorPiece, w: number, d: number): Box => [piece.size?.[0] ?? w, piece.size?.[1] ?? d];

const STOOL_Z = 9;
const beat = (scene: Scene) => (scene.reduced ? 1 : scene.frame);

// The walls that stand in the room, to make rooms of it. Each is a cell thick, so
// that two of them meet squarely at a corner and block exactly the cells they stand on.
export const LONG: readonly [shortest: number, longest: number] = [CELL, 300]; // how long one may be: from a cell to right across the biggest room
const INNER_H = 26; // how high one stands: enough for anything that hangs on a wall
const PANE = '#a9d6e5';
const DOORWAY = 16; // a door in its frame: a post either side of a way through two cells wide
const lengthOf = (piece: FloorPiece) => piece.size?.[0] ?? 24;
// whether anyone, or the cat, is at a point of the floor or within `reach` of it
function someoneBy(scene: Scene, x: number, y: number, reach: number) {
  const by = (at: { x: number; y: number } | null | undefined) => !!at && Math.abs(at.x - x) <= reach && Math.abs(at.y - y) <= reach;
  if (by(scene.cat.at)) return true;
  for (const desk of scene.desks.values()) {
    if (by(desk.at) || by(desk.boss?.at)) return true;
    for (const helper of desk.helpers.values()) if (by(helper.at)) return true;
  }
  return false;
}

export const FLOOR_KINDS: Record<string, FloorKind> = {
  // a long oak table for four: charcoal trestles, greenery down the middle, lamps overhead
  table: {
    name: 'Long table',
    tint: SAGE, // its chairs
    box: () => [52, 34],
    blocks: [[0, 10, 52, 14]],
    top: 12,
    seats: [
      { x: 13, y: 5, dir: 'S', kind: 'bench', z: SEAT_Z },
      { x: 39, y: 5, dir: 'S', kind: 'bench', z: SEAT_Z },
      { x: 13, y: 29, dir: 'N', kind: 'bench', z: SEAT_Z },
      { x: 39, y: 29, dir: 'N', kind: 'bench', z: SEAT_Z },
    ],
    draw(p, env) {
      for (const t of [0.12, 0.88]) p.box(52 * t - 1, 12, 0, 2, 10, 10.5, CHARCOAL);
      p.box(0, 10, 10.5, 52, 14, 1.5, env.wood.light);
      for (const t of [0.25, 0.75]) pendant(p, env, 52 * t, 17, CHARCOAL, 12);
      sprig(p, 25, 16, 12, CHARCOAL);
      p.box(19, 16, 12, 2, 2, 2, IVORY_SHADE);
      p.box(31, 16, 12, 2, 2, 2.5, LIME);
    },
  },

  // half of one: a table for two, facing each other, under one lamp
  'small-table': {
    name: 'Table for two',
    tint: SAGE,
    box: () => [26, 34],
    blocks: [[0, 10, 26, 14]],
    top: 12,
    seats: [
      { x: 13, y: 5, dir: 'S', kind: 'bench', z: SEAT_Z },
      { x: 13, y: 29, dir: 'N', kind: 'bench', z: SEAT_Z },
    ],
    draw(p, env) {
      for (const t of [0.15, 0.85]) p.box(26 * t - 1, 12, 0, 2, 10, 10.5, CHARCOAL);
      p.box(0, 10, 10.5, 26, 14, 1.5, env.wood.light);
      pendant(p, env, 13, 17, CHARCOAL, 12);
      p.box(3, 16, 12, 2, 2, 2.5, LIME);
    },
  },

  // a desk for one, with drawers either side and a name plate: the boss's
  'boss-desk': {
    name: 'Desk for one',
    tint: CHARCOAL, // its chair
    box: () => [30, 22],
    blocks: [[0, 10, 30, 12]],
    top: 12,
    seats: [{ x: 15, y: 5, dir: 'S', kind: 'bench', z: SEAT_Z }],
    draw(p, env) {
      p.box(0, 10, 0, 7, 12, 10.5, env.wood.mid);
      p.box(23, 10, 0, 7, 12, 10.5, env.wood.mid);
      p.box(7, 20, 3, 16, 1, 7.5, env.wood.mid); // the panel across the front
      p.box(0, 10, 10.5, 30, 12, 1.5, env.wood.dark);
      for (const x of [1.5, 24.5]) for (const z of [3, 7]) p.north(x + 1, x + 3, 10, z, z + 0.8, CHARCOAL); // drawer pulls
      p.box(22, 19, 12, 6, 1, 1.5, '#d9a441'); // the name plate, facing whoever comes in
      sprig(p, 2, 17, 12, CHARCOAL);
      // a desk lamp
      p.box(26, 12, 12, 1, 1, 5, CHARCOAL);
      p.box(24, 11, 17, 4, 3, 1.5, env.bulb);
      if (env.light.now.lamps) p.flat(20, 29, 11, 18, 12, LIGHT_POOL);
    },
  },
  // a desk for one with screens on three sides, open behind the sitter
  cubicle: {
    name: 'Cubicle',
    tint: SAGE, // its screens, and its chair
    box: () => [32, 28],
    blocks: [[0, 0, 3, 28], [29, 0, 3, 28], [0, 25, 32, 3], [4, 14, 24, 11]],
    top: 12,
    seats: [{ x: 16, y: 9, dir: 'S', kind: 'bench', z: SEAT_Z }],
    draw(p, env, piece) {
      const hex = piece.tint ?? SAGE;
      const screens: Rect[] = [[0, 0, 3, 28], [29, 0, 3, 28], [3, 25, 26, 3]];
      for (const [x, y, w, d] of screens) {
        p.box(x, y, 0, w, d, 15, hex);
        p.box(x, y, 15, w, d, 0.6, CHARCOAL);
      }
      p.box(3, 14, 10.5, 26, 11, 1.5, env.wood.light);
      // what is pinned up inside, and a plant
      p.north(7, 11, 25, 12.5, 14.5, LIME);
      p.north(13, 17, 25, 12.3, 14.3, TANGERINE);
      p.north(19, 23, 25, 12.6, 14.6, PAPER);
      sprig(p, 24, 20, 12, CHARCOAL);
    },
  },
  // a table to meet round: five chairs down each side and one at either end
  'meeting-table': {
    name: 'Meeting table',
    tint: SAGE, // its chairs
    box: () => [104, 34],
    blocks: [[10, 10, 84, 14]],
    top: 12,
    seats: [
      ...[20, 36, 52, 68, 84].flatMap((x): SeatOffer[] => [
        { x, y: 5, dir: 'S', kind: 'bench', z: SEAT_Z },
        { x, y: 29, dir: 'N', kind: 'bench', z: SEAT_Z },
      ]),
      { x: 5, y: 17, dir: 'E', kind: 'bench', z: SEAT_Z },
      { x: 99, y: 17, dir: 'W', kind: 'bench', z: SEAT_Z },
    ],
    hangout: { x: 52, y: 40, dir: 'N' }, // standing by, listening in
    draw(p, env) {
      for (const x of [18, 51, 84]) p.box(x, 12, 0, 2, 10, 10.5, CHARCOAL);
      p.box(10, 10, 10.5, 84, 14, 1.5, env.wood.light);
      p.flat(14, 90, 16, 18, 12, env.wood.mid); // a runner down the middle
      for (const x of [26, 52, 78]) pendant(p, env, x, 17, CHARCOAL, 12);
      sprig(p, 51, 16, 12, CHARCOAL);
      p.box(36, 16, 12, 2, 2, 2.5, LIME);
      p.box(66, 16, 12, 2, 2, 2, IVORY_SHADE);
    },
  },

  // fitted carpet, with a paler line round its edge: `size` is how wide and how deep
  carpet: {
    name: 'Carpet',
    tint: '#34425e',
    spread: true,
    box: (piece) => spreadOf(piece, 40, 28),
    blocks: [],
    draw(p, _env, piece) {
      const [w, d] = spreadOf(piece, 40, 28);
      const hex = piece.tint ?? '#34425e';
      const line = mix(hex, PAPER, 0.3);
      p.flat(0, w, 0, d, 0, hex);
      p.flat(2, w - 2, 2, 3, 0, line);
      p.flat(2, w - 2, d - 3, d - 2, 0, line);
      p.flat(2, 3, 2, d - 2, 0, line);
      p.flat(w - 3, w - 2, 2, d - 2, 0, line);
    },
  },
  // a filing cabinet: three drawers, and something left on top
  cabinet: {
    name: 'Filing cabinet',
    tint: STEEL,
    box: () => [8, 6],
    draw(p, _env, piece) {
      const hex = piece.tint ?? STEEL;
      p.box(0, 0, 0, 8, 6, 14, hex);
      for (const z of [1, 5.3, 9.6]) {
        p.north(0.6, 7.4, 0, z, z + 3.6, mix(hex, PAPER, 0.25));
        p.north(3, 5, 0, z + 2.2, z + 2.8, CHARCOAL);
      }
      p.box(1, 1.5, 14, 4, 3, 1, PAPER); // a stack of paper
      p.box(5.5, 2, 14, 1.5, 1.5, 2, COBALT);
    },
  },
  // the water cooler, where people stop to talk
  'water-cooler': {
    name: 'Water cooler',
    box: () => [5, 5],
    hangout: { x: 2, y: -5, dir: 'S' },
    draw(p, env) {
      p.box(0, 0, 0, 5, 5, 11, METAL);
      p.north(1.5, 2.2, 0, 7, 8, COBALT);
      p.north(2.8, 3.5, 0, 7, 8, TANGERINE);
      env.light.glow(() => p.box(1, 1, 11, 3, 3, 6, PANE));
      p.box(1.5, 1.5, 17, 2, 2, 0.6, PANE);
    },
  },

  // a fridge for the pantry: two doors, and what people have stuck to it
  fridge: {
    name: 'Fridge',
    tint: METAL,
    box: () => [8, 8],
    draw(p, _env, piece) {
      const hex = piece.tint ?? METAL;
      p.box(0, 0, 0, 8, 8, 22, hex);
      p.south(0, 8, 8, 14.6, 15, CHARCOAL); // between the two doors
      p.south(6.2, 6.8, 8, 16, 20, CHARCOAL);
      p.south(6.2, 6.8, 8, 8, 13, CHARCOAL);
      p.south(1.5, 3.5, 8, 17, 19, LIME);
      p.south(2.5, 4.5, 8, 10, 11.5, TANGERINE);
    },
  },
  // a vending machine, lit from inside
  vending: {
    name: 'Vending machine',
    tint: COBALT,
    box: () => [10, 8],
    hangout: { x: 5, y: 14, dir: 'N' }, // choosing
    draw(p, env, piece) {
      const hex = piece.tint ?? COBALT;
      p.box(0, 0, 0, 10, 8, 22, hex);
      env.light.glow(() => {
        p.south(1, 7, 8, 7, 20.5, DARK_GLASS);
        const cans = [TANGERINE, LIME, PAPER, PURPLE];
        for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) p.south(1.6 + col * 1.8, 2.8 + col * 1.8, 8, 8 + row * 3.2, 10 + row * 3.2, cans[(row + col) % 4]);
        p.south(7.8, 9.2, 8, 13, 17, PAPER); // where the money goes
      });
      p.south(1, 7, 8, 2, 5, CHARCOAL); // and where the can comes out
    },
  },

  // the cafe's checkerboard floor
  'cafe-floor': {
    name: 'Cafe floor',
    tint: GREIGE,
    spread: true,
    box: (piece) => spreadOf(piece, 36, 40),
    blocks: [],
    draw: (p, _env, piece) => checker(p, ...spreadOf(piece, 36, 40), 5, piece.tint ?? GREIGE),
  },
  // the back counter, with the coffee machine
  counter: {
    name: 'Coffee counter',
    box: () => [6, 30],
    top: 11,
    hangout: { x: 10, y: 8, dir: 'W' }, // making a coffee
    draw(p, env) {
      p.box(0, 0, 0, 6, 30, 10, env.wood.mid);
      p.box(0, 0, 10, 6, 30, 1, GREIGE);
      p.box(1, 4, 11, 4, 5, 5, CHARCOAL);
      p.box(1.5, 11, 11, 1.5, 1.5, 2, PAPER);
      p.box(3.5, 12, 11, 1.5, 1.5, 2, PAPER);
      p.box(1.5, 14, 11, 1.5, 1.5, 2, LIME);
      sprig(p, 2, 24, 11, CHARCOAL);
    },
    live(p, scene) {
      // the coffee machine's light
      scene.light.glow(() => p.east(5, 5, 6, 13.5, 14.5, beat(scene) % 6 < 3 ? TANGERINE : '#7a3a26', true));
    },
  },
  // an island with two bar stools
  island: {
    name: 'Island with stools',
    tint: TANGERINE, // its stools
    box: () => [16, 28],
    blocks: [[0, 0, 8, 28]],
    top: 11,
    seats: [
      { x: 13, y: 7, dir: 'W', kind: 'stool', z: STOOL_Z },
      { x: 13, y: 21, dir: 'W', kind: 'stool', z: STOOL_Z },
    ],
    draw(p, env) {
      p.box(1, 1, 0, 6, 26, 10, env.wood.mid);
      p.box(0, 0, 10, 8, 28, 1, PAPER);
      pendant(p, env, 4, 7, LIME, 11);
      pendant(p, env, 4, 21, LIME, 11);
    },
  },

  planter: {
    name: 'Planter',
    box: () => [14, 14],
    hangout: { x: -6, y: 6, dir: 'E' }, // watering it
    nap: { x: -4, y: 18 },
    draw(p, env) {
      p.box(0, 0, 0, 14, 14, 5, env.wood.mid);
      p.flat(1, 13, 1, 13, 5, env.wood.dark);
      p.box(2, 2, 5, 5, 5, 7, LEAF);
      p.box(3, 3, 12, 3, 3, 3, LEAF_LIGHT);
      p.box(8, 6, 5, 4, 5, 5, LEAF_LIGHT);
      p.box(4, 9, 5, 1, 1, 10, LEAF);
      p.box(6, 10, 5, 1, 1, 13, LEAF_LIGHT);
      p.box(9, 2, 5, 3, 3, 3, LEAF);
    },
  },
  // a phone booth in coloured glass
  booth: {
    name: 'Phone booth',
    tint: COBALT, // its glass
    box: () => [12, 12],
    hangout: { x: -6, y: 16, dir: 'E' }, // waiting for it
    draw(p, env, piece) {
      const hex = piece.tint ?? COBALT;
      for (const [x, y] of [[0, 0], [11, 0], [0, 11], [11, 11]]) p.box(x, y, 0, 1, 1, 24, CHARCOAL);
      p.box(0, 0, 24, 12, 12, 1, hex);
      const glass: [Dir, number][] = [['W', 0], ['E', 12], ['N', 0], ['S', 12]];
      for (const [side, at] of glass) p.face(side, 0, 12, at, 0.5, 24, hex, true, true);
      p.box(7, 2, 0, 3, 3, 7, env.wood.mid);
      p.box(2, 7, 9, 8, 3, 1, env.wood.light);
    },
  },

  tree: {
    name: 'Tree',
    tint: CHARCOAL, // its pot
    box: () => [5, 5],
    draw: (p, _env, piece) => tree(p, piece.tint ?? CHARCOAL),
  },
  bush: {
    name: 'Bush',
    tint: IVORY_SHADE,
    box: (piece) => [piece.size?.[0] ?? 6, piece.size?.[0] ?? 6],
    draw: (p, _env, piece) => bush(p, piece.size?.[0] ?? 6, piece.tint ?? IVORY_SHADE),
  },
  grass: {
    name: 'Grass',
    tint: CHARCOAL,
    box: () => [4, 4],
    draw: (p, _env, piece) => blades(p, piece.tint ?? CHARCOAL),
  },

  'lounge-rug': {
    name: 'Lounge rug',
    tint: LIME, // the patch in its corner
    spread: true,
    box: (piece) => spreadOf(piece, 50, 36),
    blocks: [],
    spare: { x: 56, y: 18, dir: 'S' },
    draw(p, _env, piece) {
      const [w, d] = spreadOf(piece, 50, 36);
      p.flat(0, w, 0, d, 0, '#f1e6d2');
      p.flat(0, w, 0, 2, 0, GREIGE);
      p.flat(0, w, d - 2, d, 0, GREIGE);
      p.flat(w - 6, w, 2, Math.min(8, d - 2), 0, piece.tint ?? LIME);
    },
  },
  sofa: {
    name: 'Sofa',
    tint: PURPLE,
    box: () => [11, 28],
    play: [
      { x: 7, y: 8, dir: 'E', kind: 'sofa', z: 6 },
      { x: 7, y: 20, dir: 'E', kind: 'sofa', z: 6 },
    ],
    draw(p, _env, piece) {
      const hex = piece.tint ?? PURPLE;
      p.box(0, 0, 0, 3, 28, 12, hex);
      p.box(3, 0, 0, 8, 28, 6, hex);
      p.box(3, 0, 6, 8, 2, 3, hex);
      p.box(3, 26, 6, 8, 2, 3, hex);
      p.box(3, 12, 6, 2, 4, 4, hex === LIME ? PURPLE : LIME); // a cushion, which has to show
    },
  },
  'low-table': {
    name: 'Low table',
    box: () => [10, 12],
    draw(p, env) {
      p.box(0, 0, 0, 10, 12, 5, env.wood.mid);
      p.box(2, 3, 5, 4, 3, 0.5, COBALT);
      sprig(p, 6, 7, 5, CHARCOAL);
    },
  },
  'bean-bag': {
    name: 'Bean bag',
    tint: LIME,
    box: () => [8, 8],
    play: [{ x: 4, y: 4, dir: 'W', kind: 'bean', z: 5 }],
    draw(p, _env, piece) {
      const hex = piece.tint ?? LIME;
      p.box(0, 0, 0, 8, 8, 4, hex);
      p.box(1, 1, 4, 6, 6, 1.5, hex);
    },
  },
  'floor-lamp': {
    name: 'Floor lamp',
    box: () => [5, 5],
    blocks: [[2, 2, 1, 1]],
    hangout: { x: 15, y: 2, dir: 'S' }, // standing by it
    nap: { x: 7, y: 4 }, // in its light
    draw(p, env) {
      p.box(2, 2, 0, 1, 1, 20, CHARCOAL);
      p.box(0, 0, 20, 5, 5, 4, env.bulb);
    },
    pool(p, env) {
      if (env.light.now.lamps) p.flat(-5, 10, -4, 9, 0, LIGHT_POOL);
    },
  },

  // the games corner's sage checkerboard
  'games-floor': {
    name: 'Games floor',
    tint: SAGE,
    spread: true,
    box: (piece) => spreadOf(piece, 48, 28),
    blocks: [],
    draw(p, _env, piece) {
      const [w, d] = spreadOf(piece, 48, 28);
      p.flat(0, w, 0, d, 0, '#eef0e2');
      checker(p, w, d, 7, piece.tint ?? SAGE);
    },
  },
  'ping-pong': {
    name: 'Ping-pong table',
    tint: COBALT,
    box: () => [24, 14],
    play: [
      { x: -4, y: 7, dir: 'E', kind: 'pong' },
      { x: 28, y: 7, dir: 'W', kind: 'pong' },
    ],
    hangout: { x: 12, y: 22, dir: 'N' }, // watching the game
    draw(p, _env, piece) {
      for (const [x, y] of [[1, 1], [21, 1], [1, 11], [21, 11]]) p.box(x, y, 0, 2, 2, 7, CHARCOAL);
      p.box(0, 0, 7, 24, 14, 1, piece.tint ?? COBALT);
      p.flat(0, 24, 6.5, 7.5, 8, PAPER);
      p.box(11.5, -1, 8, 1, 16, 1.5, PAPER);
    },
    live(p, scene, index) {
      // the ball: a rally with two players, keepy-uppy with one, at rest with none
      const at = (slot: number) => scene.layout.play.findIndex((spot) => spot.piece === index && spot.slot === slot);
      const playing = (i: number) => [...scene.desks.values()].some((desk) => desk.play === i && desk.at && !desk.path.length);
      const [near, far] = [playing(at(0)), playing(at(1))];
      const f = beat(scene) % 8;
      const hop = [0, 2, 3, 2, 0, 2, 3, 2][f];
      if (near && far) p.box(2 + [0, 5, 10, 15, 20, 15, 10, 5][f], 6, 9 + hop, 1, 1, 1, PAPER);
      else if (near || far) p.box(near ? 2 : 21, 6, 9 + hop * 1.5, 1, 1, 1, PAPER);
      else p.box(6, 4, 8, 1, 1, 1, PAPER);
    },
  },
  arcade: {
    name: 'Arcade cabinet',
    box: () => [12, 10],
    play: [{ x: 6, y: 16, dir: 'N', kind: 'arcade' }],
    hangout: { x: 14, y: 18, dir: 'W' }, // over the player's shoulder
    draw(p, env) {
      p.box(0, 0, 0, 12, 10, 11, CHARCOAL);
      p.box(0, 0, 11, 12, 7, 11, CHARCOAL);
      p.south(2, 10, 7, 13, 19, DARK_GLASS);
      env.light.glow(() => p.south(1, 11, 7, 19.5, 21.5, LIME));
      p.flat(3, 5, 8, 9, 11, TANGERINE);
      p.flat(7, 9, 8, 9, 11, LIME);
      p.south(2, 10, 10, 3, 8, PURPLE);
    },
    live(p, scene) {
      const f = beat(scene);
      scene.light.glow(() => {
        p.south(3 + (f % 6), 5 + (f % 6), 7, 16.5, 17.5, LIME);
        p.south(5, 7, 7, 13.5, 14, TANGERINE);
        p.south(6, 7, 7, 14.5 + (f % 3) * 0.5, 15 + (f % 3) * 0.5, PAPER);
      });
    },
  },

  // a wall across the floor, with a dark cap along its top
  partition: {
    name: 'Wall',
    tint: IVORY_SHADE,
    build: true,
    long: true,
    tall: INNER_H,
    box: (piece) => [lengthOf(piece), CELL],
    draw(p, _env, piece) {
      const long = lengthOf(piece);
      p.box(0, 0, 0, long, CELL, INNER_H, piece.tint ?? IVORY_SHADE);
      p.box(0, 0, INNER_H, long, CELL, 1, CHARCOAL);
    },
  },
  // the same in glass, to see the room beyond through: a sill, a rail, a post every so often
  'glass-wall': {
    name: 'Glass wall',
    tint: PANE,
    build: true,
    long: true,
    tall: INNER_H,
    box: (piece) => [lengthOf(piece), CELL],
    draw(p, _env, piece) {
      const long = lengthOf(piece);
      const hex = piece.tint ?? PANE;
      p.box(0, 0, 0, long, CELL, 2, CHARCOAL);
      p.box(0, 0, INNER_H - 1, long, CELL, 1, CHARCOAL);
      for (let x = 0; x < long - 1; x += 12) p.box(x, 1, 2, 1, 2, INNER_H - 3, CHARCOAL);
      p.box(long - 1, 1, 2, 1, 2, INNER_H - 3, CHARCOAL);
      // seen from whichever side the camera is on
      p.face('S', 0, long, 2, 2, INNER_H - 1, hex, true, true);
      p.face('N', 0, long, 2, 2, INNER_H - 1, hex, true, true);
    },
  },
  // a wall to lean on and look over
  'half-wall': {
    name: 'Half wall',
    tint: IVORY_SHADE,
    build: true,
    long: true,
    tall: 12, // too low for anything to hang on
    box: (piece) => [lengthOf(piece), CELL],
    draw(p, env, piece) {
      const long = lengthOf(piece);
      p.box(0, 0, 0, long, CELL, 11, piece.tint ?? IVORY_SHADE);
      p.box(0, 0, 11, long, CELL, 1, env.wood.mid);
    },
  },
  // A door in a wall that stands in the room: the way into an office of one's own.
  // Only its posts are in the way; the leaf swings open for whoever comes by.
  'inner-door': {
    name: 'Office door',
    tint: TANGERINE,
    build: true,
    cuts: true,
    box: () => [DOORWAY, CELL],
    blocks: [[0, 0, CELL, CELL], [DOORWAY - CELL, 0, CELL, CELL]],
    draw(p) {
      p.box(0, 0, 0, 3, CELL, INNER_H, CHARCOAL);
      p.box(DOORWAY - 3, 0, 0, 3, CELL, INNER_H, CHARCOAL);
      p.box(3, 0, 21, DOORWAY - 6, CELL, INNER_H - 21, CHARCOAL);
    },
    live(p, scene, index) {
      const piece = (scene.preview ?? scene).room.pieces[index];
      const hex = piece?.tint ?? TANGERINE;
      const [x, y] = p.at(DOORWAY / 2, CELL / 2);
      if (!scene.editing && someoneBy(scene, x, y, 7)) {
        p.box(3, CELL, 0, 1, DOORWAY - 7, 20, hex); // swung back on its hinge
        return;
      }
      p.box(3, 1.5, 0, DOORWAY - 6, 1, 20, hex);
      p.box(DOORWAY - 5.5, 1, 9, 1, 2, 1, CHARCOAL);
    },
  },
};
// A kind is looked up by a name that can come from anywhere, a pasted room for one:
// only the names above are kinds, and not what every object has, such as `constructor`.
Object.setPrototypeOf(FLOOR_KINDS, null);
