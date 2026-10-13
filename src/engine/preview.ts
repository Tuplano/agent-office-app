import { aim, HOME, type View } from './camera';
import { CELL, SCENE_H, SCENE_W } from './constants';
import { draw } from './draw';
import { ADULT, drawFigure } from './figures';
import { makeLight } from './light';
import { kindOf, type Model } from './models';
import { buildOffice } from './office';
import { CHARCOAL, FLOOR_A, FLOOR_B, GREIGE, IVORY_SHADE, PAPER, PURPLE, TANGERINE, WARM_LIGHT } from './palette';
import { placedPen } from './place';
import { makeBuffer, makePen, type PixelBuffer } from './raster';
import type { Room } from './room';
import { makeScene, type SessionView } from './scene';
import { makeSim } from './sim';

// A model on its own, as it will look in the room: drawn by the same pen, in the
// light of the hour, on the patch of floor it will take up. The import form shows
// it so, and turns it about.

const PITCH = Math.PI / 6; // the angle the room is first seen from
const LIFT = 2 / (2 * Math.SQRT2 * Math.cos(PITCH)); // as camera.ts draws heights

// The view of a model from so far round it, fitted to the picture.
export function previewView(model: Model, yaw: number): View {
  const [w, d] = model.box;
  const zoom = Math.min(12, (SCENE_W * 0.82) / ((w + d + 8) * 0.75), (SCENE_H * 0.8) / ((w + d + 8) * 0.4 + (model.high + 14) * 0.95));
  const turn = Math.PI / 4 + yaw;
  return { cos: Math.cos(turn), sin: Math.sin(turn), up: Math.sin(PITCH), level: Math.cos(PITCH), zoom, cx: SCENE_W / 2, cy: SCENE_H * 0.5 + zoom * (model.high + 10) * 0.45, midX: w / 2, midY: d / 2 };
}

// The point of a model's box, at a height, that is drawn at a point of the picture.
export function previewPoint(view: View, sx: number, sy: number, z: number): [x: number, y: number] {
  const across = (sx - view.cx) / view.zoom;
  const towards = ((sy - view.cy) / view.zoom + z * LIFT * view.level) / view.up;
  return [view.midX + across * view.cos + towards * view.sin, view.midY - across * view.sin + towards * view.cos];
}

let buffer: PixelBuffer | null = null;

// Draws a model on a canvas the size of the scene: its floor, cell by cell, with a
// line along its front; the model; and someone sitting on each of its seats, the
// one picked out in purple. Gives back the view it was drawn from, for finding
// what a click on it was on.
export function drawPreview(canvas: HTMLCanvasElement, model: Model, yaw: number, picked: number | null): View {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const view = previewView(model, yaw);
  const ctx = canvas.getContext('2d');
  if (!ctx) return view;
  buffer ??= makeBuffer();
  buffer.rgb.fill(0);
  buffer.depth.fill(-1e9);
  const light = makeLight();
  const pen = makePen(buffer, { view, light, layer: 0 });
  const [w, d] = model.box;
  for (let y = 0; y < d; y += CELL) for (let x = 0; x < w; x += CELL) pen.flat(x, x + CELL, y, y + CELL, 0, ((x + y) / CELL) & 1 ? FLOOR_A : FLOOR_B);
  pen.flat(0, w, d, d + 1, 0, TANGERINE); // its front
  kindOf(model).draw(placedPen(pen, { kind: model.id, x: 0, y: 0, turn: 0 }, model.box), { light, bulb: WARM_LIGHT, wood: { light: PAPER, mid: PAPER, dark: PAPER } }, { kind: model.id, x: 0, y: 0, turn: 0 });
  model.seats.forEach((seat, index) => {
    drawFigure(pen, seat.x, seat.y, {
      size: ADULT,
      dir: seat.dir,
      base: seat.z,
      stance: 'sit',
      stride: 0,
      legs: GREIGE,
      shoes: CHARCOAL,
      shirt: index === picked ? PURPLE : IVORY_SHADE,
      skin: PAPER,
      hair: GREIGE,
      style: 0,
      arms: 'desk',
      tap: -1,
      shut: false,
    });
  });
  const image = ctx.createImageData(SCENE_W, SCENE_H);
  new Uint32Array(image.data.buffer).set(buffer.rgb);
  ctx.putImageData(image, 0, 0);
  return view;
}

// A whole room on a canvas of its own, as the office would draw it now: from the
// angle a room is first seen at, in the light of the hour, with the people there
// are sitting where they would sit in it, and their supervisors and interns by
// them. For choosing a room to start from before it is the room.
export function drawRoom(canvas: HTMLCanvasElement, room: Room, sessions: readonly SessionView[] = []) {
  const scene = makeScene(canvas, document.createElement('div'), room);
  Object.assign(scene.camera, HOME); // not wherever the office's own camera was left
  scene.view = aim(scene.camera, room.size);
  makeSim(scene).apply(sessions); // as on a first load: everyone is in place
  buildOffice(scene);
  draw(scene);
}
