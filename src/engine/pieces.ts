import { type Dir, SEAT_Z } from './constants';
import type { Look } from './finish';
import type { Light } from './light';
import {
  CHARCOAL, COBALT, DARK_GLASS, GREIGE, IVORY_SHADE, LEAF, LEAF_LIGHT, LIGHT_POOL, LIME,
  OAK_DARK, PAPER, PURPLE, SAGE, TANGERINE,
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
  play?: readonly PlayOffer[];
  hangout?: SpotOffer; // where a supervisor with nothing to note down stands by it
  spare?: SpotOffer; // open floor beside it, for someone with no chair and no lounge seat
  nap?: { x: number; y: number }; // where the cat curls up by it
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

const STOOL_Z = 9;
const beat = (scene: Scene) => (scene.reduced ? 1 : scene.frame);

export const FLOOR_KINDS: Record<string, FloorKind> = {
  // a long oak table for four: charcoal trestles, greenery down the middle, lamps overhead
  table: {
    name: 'Long table',
    tint: SAGE, // its chairs
    box: () => [52, 34],
    blocks: [[0, 10, 52, 14]],
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

  // the cafe's checkerboard floor
  'cafe-floor': {
    name: 'Cafe floor',
    tint: GREIGE,
    box: () => [36, 40],
    blocks: [],
    draw: (p, _env, piece) => checker(p, 36, 40, 5, piece.tint ?? GREIGE),
  },
  // the back counter, with the coffee machine
  counter: {
    name: 'Coffee counter',
    box: () => [6, 30],
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
    box: () => [50, 36],
    blocks: [],
    spare: { x: 56, y: 18, dir: 'S' },
    draw(p, _env, piece) {
      p.flat(0, 50, 0, 36, 0, '#f1e6d2');
      p.flat(0, 50, 0, 2, 0, GREIGE);
      p.flat(0, 50, 34, 36, 0, GREIGE);
      p.flat(44, 50, 2, 8, 0, piece.tint ?? LIME);
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
    box: () => [48, 28],
    blocks: [],
    draw(p, _env, piece) {
      p.flat(0, 48, 0, 28, 0, '#eef0e2');
      checker(p, 48, 28, 7, piece.tint ?? SAGE);
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
};
// A kind is looked up by a name that can come from anywhere, a pasted room for one:
// only the names above are kinds, and not what every object has, such as `constructor`.
Object.setPrototypeOf(FLOOR_KINDS, null);
