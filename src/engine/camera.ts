import { CENTRE_Y, type Dir, SCENE_W } from './constants';
import { DEFAULT_ROOM, type Size } from './room';

export interface Camera {
  yaw: number;
  pitch: number;
  zoom: number;
  panX: number;
  panY: number;
}

// The camera's sines and cosines, worked out once per redraw.
export interface View {
  cos: number;
  sin: number;
  up: number;
  level: number;
  zoom: number;
  cx: number;
  cy: number;
  // the middle of the floor, which the camera circles
  midX: number;
  midY: number;
}

export type Range = readonly [lo: number, hi: number];
export type Point = [x: number, y: number, near: number];

// The camera circles the room. At home it looks into the corner from the classic
// isometric angle, where one unit is exactly 2px across and 2px up.
export const HOME: Readonly<Camera> = { yaw: 0, pitch: Math.PI / 6, zoom: 1, panX: 0, panY: 0 };
export const PITCH: Range = [Math.PI / 18, (Math.PI * 17) / 36]; // from nearly level to nearly overhead
export const ZOOM: Range = [0.5, 4];
const BASE_ZOOM = 2 * Math.SQRT2; // pixels per unit across the screen at zoom 1
const LIFT = 2 / (BASE_ZOOM * Math.cos(HOME.pitch)); // heights are drawn a little short
const FIT = DEFAULT_ROOM.size.w + DEFAULT_ROOM.size.d; // a room of any size is as wide in the picture as this one

export const clamp = (n: number, [lo, hi]: Range) => Math.max(lo, Math.min(hi, n));

export function aim(camera: Camera, size: Size = DEFAULT_ROOM.size): View {
  const turn = Math.PI / 4 + camera.yaw;
  return {
    cos: Math.cos(turn),
    sin: Math.sin(turn),
    up: Math.sin(camera.pitch),
    level: Math.cos(camera.pitch),
    zoom: BASE_ZOOM * camera.zoom * (FIT / (size.w + size.d)),
    cx: SCENE_W / 2 + camera.panX,
    cy: CENTRE_Y + camera.panY,
    midX: size.w / 2,
    midY: size.d / 2,
  };
}

// A world point as [screen x, screen y, nearness to the camera].
export function project(view: View, x: number, y: number, z: number): Point {
  const dx = x - view.midX;
  const dy = y - view.midY;
  const across = dx * view.cos - dy * view.sin;
  const towards = dx * view.sin + dy * view.cos;
  const h = z * LIFT;
  return [view.cx + view.zoom * across, view.cy + view.zoom * (towards * view.up - h * view.level), towards * view.level + h * view.up];
}

// The point of the floor that is drawn at a point of the picture: project(), backwards, at z = 0.
export function floorAt(view: View, sx: number, sy: number): [x: number, y: number] {
  const across = (sx - view.cx) / view.zoom;
  const towards = (sy - view.cy) / (view.zoom * view.up);
  return [view.midX + across * view.cos + towards * view.sin, view.midY - across * view.sin + towards * view.cos];
}

// The point of a wall's inside that is drawn at a point of the picture, as how
// far along the wall it is and how high. Only for a wall that is not seen edge-on.
// `out` is for the side of a wall that stands that far out in the room.
export function wallAt(view: View, size: Size, wall: Dir, sx: number, sy: number, out = 0): [a: number, z: number] {
  const across = (sx - view.cx) / view.zoom;
  const alongX = wall === 'N' || wall === 'S'; // the wall runs along x, at a fixed y
  const dx = alongX ? 0 : wall === 'W' ? out - view.midX : size.w - out - view.midX;
  const dy = alongX ? (wall === 'N' ? out - view.midY : size.d - out - view.midY) : 0;
  const run = alongX ? (across + dy * view.sin) / view.cos : (dx * view.cos - across) / view.sin;
  const towards = alongX ? run * view.sin + dy * view.cos : dx * view.sin + run * view.cos;
  const h = (towards * view.up - (sy - view.cy) / view.zoom) / view.level;
  return [run + (alongX ? view.midX : view.midY), h / LIFT];
}

// how squarely a side (N, E, S or W) faces the camera, and how far it is turned to screen-right
export const towardCamera = (view: View, side: Dir) => (side === 'E' ? view.sin : side === 'W' ? -view.sin : side === 'S' ? view.cos : -view.cos);
export const towardRight = (view: View, side: Dir) => (side === 'E' ? view.cos : side === 'W' ? -view.cos : side === 'S' ? -view.sin : view.sin);

const STORE = 'agent-office-camera';

export function loadCamera(): Camera {
  const camera = { ...HOME };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null') || {};
    for (const key of Object.keys(HOME) as (keyof Camera)[]) if (Number.isFinite(saved[key])) camera[key] = saved[key];
  } catch {
    // nothing saved, or storage is off
  }
  return camera;
}

export function saveCamera(camera: Camera) {
  try {
    localStorage.setItem(STORE, JSON.stringify(camera));
  } catch {
    // storage is off; the view just resets next time
  }
}
