import { type Point, project, towardCamera, towardRight, type View } from './camera';
import { type Dir, SCENE_H, SCENE_W } from './constants';
import type { Light } from './light';

// Every box is drawn into a colour buffer and a depth buffer, pixel by pixel, so
// things hide each other correctly whatever order they are drawn in. The office
// is drawn once; each frame starts from a copy of it and adds whatever moves.
export interface PixelBuffer {
  rgb: Uint32Array;
  depth: Float64Array;
}

export function makeBuffer(): PixelBuffer {
  return { rgb: new Uint32Array(SCENE_W * SCENE_H), depth: new Float64Array(SCENE_W * SCENE_H) };
}

// Fills a flat four-cornered shape one pixel row at a time, so edges stay hard
// instead of antialiased. Each corner is [x, y, nearness]; nearness is worked out
// for every pixel and only the nearest thing drawn at a pixel is kept.
export function quad(buf: PixelBuffer, a: Point, b: Point, c: Point, d: Point, color: number, bias: number, sparse?: boolean) {
  const det = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
  if (Math.abs(det) < 0.5) return; // seen edge-on
  const perX = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / det;
  const perY = ((c[2] - a[2]) * (b[0] - a[0]) - (b[2] - a[2]) * (c[0] - a[0])) / det;
  const base = a[2] - perX * a[0] - perY * a[1] + bias;
  const xs = [a[0], b[0], c[0], d[0]];
  const ys = [a[1], b[1], c[1], d[1]];
  const top = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1], d[1])));
  const bottom = Math.min(SCENE_H, Math.ceil(Math.max(a[1], b[1], c[1], d[1])));
  for (let y = top; y < bottom; y++) {
    const mid = y + 0.5;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) & 3;
      if (ys[i] <= mid === ys[j] <= mid) continue;
      const x = xs[i] + ((mid - ys[i]) * (xs[j] - xs[i])) / (ys[j] - ys[i]);
      if (x < lo) lo = x;
      if (x > hi) hi = x;
    }
    const from = Math.max(0, Math.ceil(lo - 0.5));
    const to = Math.min(SCENE_W, Math.ceil(hi - 0.5));
    const rowNear = perY * mid + base;
    for (let x = from, k = y * SCENE_W + from; x < to; x++, k++) {
      if (sparse && (x + 3 * y) & 7) continue;
      const near = perX * (x + 0.5) + rowNear;
      if (near >= buf.depth[k]) {
        buf.depth[k] = near;
        buf.rgb[k] = color;
      }
    }
  }
}

// What a pen needs to know about the moment it is drawing in.
export interface Optics {
  view: View;
  light: Light;
  // Patches (a poster on a wall, an eye on a face) lie on the same plane as the
  // box they decorate, so each one is nudged a hair nearer than the last.
  layer: number;
}

export interface Pen {
  flat(x0: number, x1: number, y0: number, y1: number, z: number, hex: string): void;
  // a patch on the N, E, S or W side of something: a0..a1 runs along the side,
  // `at` is where the side stands; not drawn when that side faces away
  face(side: Dir, a0: number, a1: number, at: number, z0: number, z1: number, hex: string, lit?: boolean, sparse?: boolean): void;
  box(x: number, y: number, z: number, w: number, d: number, h: number, hex: string): void;
  south(x0: number, x1: number, y: number, z0: number, z1: number, hex: string, sparse?: boolean): void;
  north(x0: number, x1: number, y: number, z0: number, z1: number, hex: string, sparse?: boolean): void;
  east(x: number, y0: number, y1: number, z0: number, z1: number, hex: string, lit?: boolean, sparse?: boolean): void;
  west(x: number, y0: number, y1: number, z0: number, z1: number, hex: string, lit?: boolean, sparse?: boolean): void;
}

export function makePen(buf: PixelBuffer, optics: Optics): Pen {
  const at = (x: number, y: number, z: number) => project(optics.view, x, y, z);
  const tone = (hex: string, amount: number) => optics.light.tone(hex, amount);
  const facing = (side: Dir) => towardCamera(optics.view, side) > 0.001;
  const nudge = () => 0.02 + optics.layer++ * 1e-6;
  // sides turned to screen-right sit in shade
  const shade = (side: Dir) => (-0.17 * Math.round(Math.max(0, towardRight(optics.view, side)) * 8)) / 8;
  const upright = (x0: number, y0: number, x1: number, y1: number, z0: number, z1: number): [Point, Point, Point, Point] => [
    at(x0, y0, z1),
    at(x1, y1, z1),
    at(x1, y1, z0),
    at(x0, y0, z0),
  ];
  const pen: Pen = {
    flat(x0, x1, y0, y1, z, hex) {
      quad(buf, at(x0, y0, z), at(x1, y0, z), at(x1, y1, z), at(x0, y1, z), tone(hex, 0), nudge());
    },
    face(side, a0, a1, where, z0, z1, hex, lit, sparse) {
      if (!facing(side)) return;
      const corners = side === 'N' || side === 'S' ? upright(a0, where, a1, where, z0, z1) : upright(where, a0, where, a1, z0, z1);
      quad(buf, ...corners, tone(hex, lit ? 0 : shade(side)), nudge(), sparse);
    },
    box(x, y, z, w, d, h, hex) {
      const x1 = x + w;
      const y1 = y + d;
      const z1 = z + h;
      quad(buf, at(x, y, z1), at(x1, y, z1), at(x1, y1, z1), at(x, y1, z1), tone(hex, 0.2), 0);
      if (facing('S')) quad(buf, ...upright(x, y1, x1, y1, z, z1), tone(hex, shade('S')), 0);
      if (facing('N')) quad(buf, ...upright(x, y, x1, y, z, z1), tone(hex, shade('N')), 0);
      if (facing('E')) quad(buf, ...upright(x1, y, x1, y1, z, z1), tone(hex, shade('E')), 0);
      if (facing('W')) quad(buf, ...upright(x, y, x, y1, z, z1), tone(hex, shade('W')), 0);
    },
    south: (x0, x1, y, z0, z1, hex, sparse) => pen.face('S', x0, x1, y, z0, z1, hex, false, sparse),
    north: (x0, x1, y, z0, z1, hex, sparse) => pen.face('N', x0, x1, y, z0, z1, hex, false, sparse),
    east: (x, y0, y1, z0, z1, hex, lit, sparse) => pen.face('E', y0, y1, x, z0, z1, hex, lit, sparse),
    west: (x, y0, y1, z0, z1, hex, lit, sparse) => pen.face('W', y0, y1, x, z0, z1, hex, lit, sparse),
  };
  return pen;
}
