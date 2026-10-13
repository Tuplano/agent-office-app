import type { View } from './camera';
import { SCENE_H, SCENE_W } from './constants';
import { lookOf } from './finish';
import { layoutOf } from './layout';
import { lightAt, makeLight } from './light';
import { drawChair } from './office';
import { IVORY_SHADE } from './palette';
import { type Env, FLOOR_KINDS } from './pieces';
import { placedPen, wallPen } from './place';
import { makeBuffer, makePen, type PixelBuffer } from './raster';
import type { FloorPiece, WallPiece } from './room';
import { WALL_KINDS } from './walls';

// A small picture of each kind of piece, for the list to add from: drawn by the
// room's own pen, from the angle the room is first seen at, in the light of noon
// so that it is the same picture whatever the hour. What moves on a piece is left
// out. Each is drawn once and kept.
export const THUMB = { w: 96, h: 64 } as const;
const EDGE = 3; // kept clear all round
const MOST = 6; // a small thing is not blown up past this many pixels to the unit, across
const ROOM = { w: 196, d: 196 }; // a wall long enough for anything that hangs

const PITCH = Math.PI / 6;
let buffer: PixelBuffer | null = null;
const kept = new Map<string, Uint32Array | null>();

// Draws a piece of a kind, alone, about the middle of the scene's buffer, and
// says where in it the picture came out: left, top, right, bottom, or null for nothing.
function alone(kind: string, zoom: number): [x0: number, y0: number, x1: number, y1: number] | null {
  buffer ??= makeBuffer();
  buffer.rgb.fill(0);
  buffer.depth.fill(-1e9);
  const light = makeLight();
  light.now = lightAt(12);
  const env: Env = { light, bulb: IVORY_SHADE, wood: lookOf().wood };
  const turn = Math.PI / 4;
  const from = (midX: number, midY: number): View => ({ cos: Math.cos(turn), sin: Math.sin(turn), up: Math.sin(PITCH), level: Math.cos(PITCH), zoom, cx: SCENE_W / 2, cy: SCENE_H / 2, midX, midY });
  const hung = WALL_KINDS[kind];
  const stood = FLOOR_KINDS[kind];
  if (hung) {
    const piece: WallPiece = { kind, wall: 'N', a: 0 };
    const [a0, a1] = hung.span(piece);
    const view = from((a0 + a1) / 2, 0);
    hung.draw(wallPen(makePen(buffer, { view, light, layer: 0 }), view, ROOM, piece), env, piece);
  } else if (stood) {
    const piece: FloorPiece = { kind, x: 0, y: 0, turn: 0 };
    const box = stood.box(piece);
    const view = from(box[0] / 2, box[1] / 2);
    const pen = makePen(buffer, { view, light, layer: 0 });
    stood.draw(placedPen(pen, piece, box), env, piece);
    // with the chairs that come with it, as the room would draw them
    layoutOf({ size: ROOM, pieces: [piece], cat: [] }).seats.forEach((seat, n) => seat.kind !== 'own' && drawChair(pen, seat, n));
  } else return null;

  let [x0, y0, x1, y1] = [SCENE_W, SCENE_H, -1, -1];
  for (let y = 0, k = 0; y < SCENE_H; y++) {
    for (let x = 0; x < SCENE_W; x++, k++) {
      if (!buffer.rgb[k]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : [x0, y0, x1 + 1, y1 + 1];
}

// The picture of a kind, as its pixels, a row after another; null for a kind
// nobody knows, or one with nothing to see.
export function thumbOf(kind: string): Uint32Array | null {
  if (kept.has(kind)) return kept.get(kind)!;
  // first at a size at which anything fits, to see how big it comes out; then at the size that fills the picture
  const start = 2.5;
  const first = alone(kind, start);
  let pixels: Uint32Array | null = null;
  if (first) {
    const fill = Math.min((THUMB.w - EDGE * 2) / (first[2] - first[0]), (THUMB.h - EDGE * 2) / (first[3] - first[1]));
    const drawn = alone(kind, Math.min(MOST, start * fill)) ?? first;
    const left = Math.round((drawn[0] + drawn[2] - THUMB.w) / 2);
    const top = Math.round((drawn[1] + drawn[3] - THUMB.h) / 2);
    pixels = new Uint32Array(THUMB.w * THUMB.h);
    for (let y = 0; y < THUMB.h; y++) {
      for (let x = 0; x < THUMB.w; x++) {
        const [sx, sy] = [left + x, top + y];
        if (sx >= 0 && sy >= 0 && sx < SCENE_W && sy < SCENE_H) pixels[y * THUMB.w + x] = buffer!.rgb[sy * SCENE_W + sx];
      }
    }
  }
  kept.set(kind, pixels);
  return pixels;
}

// Puts the picture of a kind on a canvas of its own.
export function drawThumb(canvas: HTMLCanvasElement, kind: string) {
  canvas.width = THUMB.w;
  canvas.height = THUMB.h;
  const ctx = canvas.getContext('2d');
  const pixels = thumbOf(kind);
  if (!ctx || !pixels) return;
  const image = ctx.createImageData(THUMB.w, THUMB.h);
  new Uint32Array(image.data.buffer).set(pixels);
  ctx.putImageData(image, 0, 0);
}
