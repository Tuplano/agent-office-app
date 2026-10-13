import { CELL, type Dir, SEAT_Z } from '../engine/constants';
import { LIMITS, type Model } from '../engine/models';
import { turnDir } from '../engine/place';

// A model as blocks: a grid of cubes half a unit across, which is one pixel at the
// home zoom. Whatever the file was, it comes to this, and from this the boxes that
// are kept are made.
export const CUBE = 0.5;

export interface Voxels {
  nx: number; // cubes across, deep and high
  ny: number;
  nz: number;
  // Each cube: 0 for nothing, 1 for the inside of something solid, which is never
  // seen, and from 2 up a colour, two more than its place in `colours`.
  cells: Uint8Array;
  colours: string[];
}
const INSIDE = 1;
const FIRST = 2;

// Why a model was not taken, in words for whoever brought it.
export class Refusal extends Error {}

export interface SeatMark {
  x: number; // in units, from the corner of the grid
  y: number;
  z: number;
  dir: Dir;
}

export const emptyVoxels = (nx: number, ny: number, nz: number, colours: string[]): Voxels => ({ nx, ny, nz, cells: new Uint8Array(nx * ny * nz), colours });
export const at = (v: Voxels, x: number, y: number, z: number) => (z * v.ny + y) * v.nx + x;
export const sizeOf = (v: Voxels): [w: number, d: number, h: number] => [v.nx * CUBE, v.ny * CUBE, v.nz * CUBE];

const hexOf = (rgb: number) => `#${rgb.toString(16).padStart(6, '0')}`;

// Colours cut down to a handful: the boxes of colour space that hold them are
// split across their widest side, at the middle of what they hold, until there are
// `most`; each box then stands for everything in it, as its average. Given how
// many times each colour turns up, as 0xrrggbb; gives back the handful, and which
// of them each colour became.
export function fewColours(counts: Map<number, number>, most: number): { colours: string[]; indexOf: Map<number, number> } {
  type Entry = [rgb: number, count: number];
  const channel = (rgb: number, c: number) => (rgb >> (16 - c * 8)) & 255;
  const spread = (bin: Entry[], c: number) => {
    let lo = 255;
    let hi = 0;
    for (const [rgb] of bin) {
      lo = Math.min(lo, channel(rgb, c));
      hi = Math.max(hi, channel(rgb, c));
    }
    return hi - lo;
  };
  const widest = (bin: Entry[]) => Math.max(spread(bin, 0), spread(bin, 1), spread(bin, 2));
  let bins: Entry[][] = [[...counts.entries()].sort((a, b) => a[0] - b[0])];
  while (bins.length < most) {
    const bin = bins.filter((one) => one.length > 1).sort((a, b) => widest(b) - widest(a))[0];
    if (!bin) break;
    const c = [0, 1, 2].sort((a, b) => spread(bin, b) - spread(bin, a))[0];
    bin.sort((a, b) => channel(a[0], c) - channel(b[0], c));
    const half = bin.reduce((sum, [, count]) => sum + count, 0) / 2;
    let cut = 0;
    for (let seen = 0; cut < bin.length - 1 && seen + bin[cut][1] <= half; cut++) seen += bin[cut][1];
    cut = Math.max(1, cut);
    bins = [...bins.filter((one) => one !== bin), bin.slice(0, cut), bin.slice(cut)];
  }
  const indexOf = new Map<number, number>();
  const colours = bins.map((bin, index) => {
    const total = bin.reduce((sum, [, count]) => sum + count, 0);
    const mean = [0, 1, 2].map((c) => Math.round(bin.reduce((sum, [rgb, count]) => sum + channel(rgb, c) * count, 0) / total));
    for (const [rgb] of bin) indexOf.set(rgb, index);
    return hexOf((mean[0] << 16) | (mean[1] << 8) | mean[2]);
  });
  return { colours, indexOf };
}

// A grid from what colour each cube is, for the cubes that are anything: the
// colours are cut down to a handful, and what is shut in on every side is marked
// as the inside of something solid.
export function voxelsOf(nx: number, ny: number, nz: number, filled: Map<number, number>): Voxels {
  const counts = new Map<number, number>();
  for (const rgb of filled.values()) counts.set(rgb, (counts.get(rgb) ?? 0) + 1);
  const { colours, indexOf } = fewColours(counts, LIMITS.colours);
  const v = emptyVoxels(nx, ny, nz, colours);
  for (const [cell, rgb] of filled) v.cells[cell] = FIRST + indexOf.get(rgb)!;
  return fillInside(v);
}

// Marks what cannot be reached from outside without going through a cube: the
// inside of a solid thing. It is never seen, so a box of any colour may run through it.
export function fillInside(v: Voxels): Voxels {
  const { nx, ny, nz, cells } = v;
  const reached = new Uint8Array(cells.length);
  const stack: number[] = [];
  const visit = (x: number, y: number, z: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return;
    const cell = at(v, x, y, z);
    if (cells[cell] >= FIRST || reached[cell]) return;
    reached[cell] = 1;
    stack.push(cell);
  };
  // in from every face of the grid
  for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) for (const z of [0, nz - 1]) visit(x, y, z);
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) for (const y of [0, ny - 1]) visit(x, y, z);
  for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) for (const x of [0, nx - 1]) visit(x, y, z);
  while (stack.length) {
    const cell = stack.pop()!;
    const x = cell % nx;
    const y = Math.floor(cell / nx) % ny;
    const z = Math.floor(cell / (nx * ny));
    visit(x + 1, y, z);
    visit(x - 1, y, z);
    visit(x, y + 1, z);
    visit(x, y - 1, z);
    visit(x, y, z + 1);
    visit(x, y, z - 1);
  }
  for (let cell = 0; cell < cells.length; cell++) if (cells[cell] < FIRST) cells[cell] = reached[cell] ? 0 : INSIDE;
  return v;
}

// The grid a quarter turn on, the way a piece turns in the room: what faced south faces west.
export function turned(v: Voxels, turns: number): Voxels {
  let now = v;
  for (let n = 0; n < (turns & 3); n++) {
    const next = emptyVoxels(now.ny, now.nx, now.nz, now.colours);
    for (let z = 0; z < now.nz; z++) {
      for (let y = 0; y < now.ny; y++) for (let x = 0; x < now.nx; x++) next.cells[at(next, now.ny - 1 - y, x, z)] = now.cells[at(now, x, y, z)];
    }
    now = next;
  }
  return now;
}

// A seat, turned with the grid it is on.
export function turnedMark(mark: SeatMark, [w, d]: readonly [number, number, number], turns: number): SeatMark {
  let { x, y, dir } = mark;
  let deep = d;
  let wide = w;
  for (let n = 0; n < (turns & 3); n++) {
    [x, y] = [deep - y, x];
    [wide, deep] = [deep, wide];
    dir = turnDir(dir, 1);
  }
  return { x, y, z: mark.z, dir };
}

// The grid at another size, each new cube taking after the old one its middle falls in.
export function resized(v: Voxels, by: number): Voxels {
  if (by === 1) return v;
  const [nx, ny, nz] = [v.nx, v.ny, v.nz].map((n) => Math.max(1, Math.round(n * by)));
  const next = emptyVoxels(nx, ny, nz, v.colours);
  const from = (i: number, n: number, old: number) => Math.min(old - 1, Math.floor(((i + 0.5) / n) * old));
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) next.cells[at(next, x, y, z)] = v.cells[at(v, from(x, nx, v.nx), from(y, ny, v.ny), from(z, nz, v.nz))];
  }
  // a cube that was shut in may no longer be, and one that was not may be
  for (let cell = 0; cell < next.cells.length; cell++) if (next.cells[cell] === INSIDE) next.cells[cell] = 0;
  return fillInside(next);
}

// The most a model's size may be multiplied by and still be within the limits.
export function fitting([w, d, h]: readonly [number, number, number]): number {
  return Math.min(LIMITS.floor / w, LIMITS.floor / d, LIMITS.high / h);
}

// How high someone sits at a point of a model: on top of whatever of it is there
// at about the height of a chair, or at the height of a chair if nothing is.
export function seatHeight(v: Voxels, x: number, y: number): number {
  const cx = Math.min(v.nx - 1, Math.max(0, Math.floor(x / CUBE)));
  const cy = Math.min(v.ny - 1, Math.max(0, Math.floor(y / CUBE)));
  for (let z = Math.min(v.nz, Math.round((SEAT_Z + 5) / CUBE)) - 1; z >= 0; z--) if (v.cells[at(v, cx, cy, z)]) return (z + 1) * CUBE;
  return SEAT_Z;
}

// Neighbours of one colour, merged into boxes: each cube not yet in a box starts
// one, which grows across, then deep, then up, for as long as everything it would
// take in is of its colour or is the unseen inside of the thing. Each is
// [x, y, z, wide, deep, high, colour], in cubes.
export function boxesOf(v: Voxels): number[][] {
  const { nx, ny, nz, cells } = v;
  const boxed = new Uint8Array(cells.length);
  const boxes: number[][] = [];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const c = cells[at(v, x, y, z)];
        if (c < FIRST || boxed[at(v, x, y, z)]) continue;
        const takes = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) => {
          for (let k = z0; k < z1; k++) {
            for (let j = y0; j < y1; j++) {
              for (let i = x0; i < x1; i++) {
                const cell = cells[at(v, i, j, k)];
                if (cell !== c && cell !== INSIDE) return false;
              }
            }
          }
          return true;
        };
        let [w, d, h] = [1, 1, 1];
        while (x + w < nx && takes(x + w, x + w + 1, y, y + 1, z, z + 1)) w++;
        while (y + d < ny && takes(x, x + w, y + d, y + d + 1, z, z + 1)) d++;
        while (z + h < nz && takes(x, x + w, y, y + d, z + h, z + h + 1)) h++;
        for (let k = z; k < z + h; k++) for (let j = y; j < y + d; j++) for (let i = x; i < x + w; i++) boxed[at(v, i, j, k)] = 1;
        boxes.push([x, y, z, w, d, h, c - FIRST]);
      }
    }
  }
  return boxes;
}

// a short name for a model, made of what it is, so that the same model is the same kind wherever it turns up
function idOf(parts: unknown): string {
  const text = JSON.stringify(parts);
  let [a, b] = [0x811c9dc5, 0x1b873593];
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b + text.charCodeAt(i), 0x85ebca6b) ^ (b >>> 13);
  }
  return `own-${(a >>> 0).toString(36)}${(b >>> 0).toString(36)}`;
}

// What the import form settles about a model.
export interface Choices {
  name: string;
  turn: number; // quarter turns, until its front faces south
  flat: boolean; // lies on the floor like a rug
  top: number | null; // how high its top is, if a laptop can stand on it
  seats: readonly SeatMark[]; // on the grid as it comes, before it is turned
}

// Where a grid stands once it is turned to face its front: in the middle of a box
// that is a whole number of cells each way, a whole number of cubes in from its corner.
export function boxOf(v: Voxels, turn: number): { box: [number, number]; ox: number; oy: number } {
  const [w, d] = turn & 1 ? [v.ny * CUBE, v.nx * CUBE] : [v.nx * CUBE, v.ny * CUBE];
  const box: [number, number] = [Math.ceil(w / CELL) * CELL, Math.ceil(d / CELL) * CELL];
  const snap = (n: number) => Math.floor(n / CUBE) * CUBE;
  return { box, ox: snap((box[0] - w) / 2), oy: snap((box[1] - d) / 2) };
}

// A point of that box, and a way to look from it, back on the grid as it came:
// what makeModel does to a seat, undone.
export function markAt(v: Voxels, turn: number, x: number, y: number, z: number, dir: Dir): SeatMark {
  const { ox, oy } = boxOf(v, turn);
  const [w, d, h] = sizeOf(v);
  return turnedMark({ x: x - ox, y: y - oy, z, dir }, turn & 1 ? [d, w, h] : [w, d, h], 4 - (turn & 3));
}

// The kind of piece a grid of cubes makes, as it is kept.
export function makeModel(v: Voxels, choices: Choices): Model {
  const faced = turned(v, choices.turn);
  const [w, d, high] = sizeOf(faced);
  if (w > LIMITS.floor || d > LIMITS.floor || high > LIMITS.high) throw new Refusal(`It is ${w} by ${d} and ${high} high, and the most is ${LIMITS.floor} by ${LIMITS.floor} and ${LIMITS.high} high. Make it smaller.`);
  const cubes = boxesOf(faced);
  if (!cubes.length) throw new Refusal('There is nothing in it to draw.');
  if (cubes.length > LIMITS.boxes) throw new Refusal(`It comes to ${cubes.length} boxes, and the most is ${LIMITS.boxes}. Make it smaller, or bring a simpler model.`);
  const { box, ox, oy } = boxOf(v, choices.turn);
  const boxes = cubes.map(([x, y, z, bw, bd, bh, c]) => [ox + x * CUBE, oy + y * CUBE, z * CUBE, bw * CUBE, bd * CUBE, bh * CUBE, c] as Model['boxes'][number]);
  const seats = choices.seats.slice(0, LIMITS.seats).map((mark) => {
    const seat = turnedMark(mark, sizeOf(v), choices.turn);
    const clamp = (n: number, most: number) => Math.max(0, Math.min(most, n));
    return { x: clamp(ox + seat.x, box[0]), y: clamp(oy + seat.y, box[1]), z: clamp(seat.z, high), dir: seat.dir };
  });
  const made = { box, high, colours: faced.colours, boxes, flat: choices.flat, ...(choices.top !== null && !choices.flat && { top: Math.min(choices.top, high) }), seats };
  return { id: idOf(made), name: choices.name.trim().slice(0, 40) || 'Piece', ...made };
}
