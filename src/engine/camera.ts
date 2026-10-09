import { CENTRE_Y, D, type Dir, SCENE_W, W } from './constants';

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

export const clamp = (n: number, [lo, hi]: Range) => Math.max(lo, Math.min(hi, n));

export function aim(camera: Camera): View {
  const turn = Math.PI / 4 + camera.yaw;
  return {
    cos: Math.cos(turn),
    sin: Math.sin(turn),
    up: Math.sin(camera.pitch),
    level: Math.cos(camera.pitch),
    zoom: BASE_ZOOM * camera.zoom,
    cx: SCENE_W / 2 + camera.panX,
    cy: CENTRE_Y + camera.panY,
  };
}

// A world point as [screen x, screen y, nearness to the camera].
export function project(view: View, x: number, y: number, z: number): Point {
  const dx = x - W / 2;
  const dy = y - D / 2;
  const across = dx * view.cos - dy * view.sin;
  const towards = dx * view.sin + dy * view.cos;
  const h = z * LIFT;
  return [view.cx + view.zoom * across, view.cy + view.zoom * (towards * view.up - h * view.level), towards * view.level + h * view.up];
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
