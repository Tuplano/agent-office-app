import { aim, type Camera, loadCamera } from './camera';
import { type Cat, makeCat } from './cat';
import { type Dir, SCENE_H, SCENE_W } from './constants';
import { type Floor, makeFloor, type Spot, type Waypoint } from './floor';
import { FOOTPRINTS } from './layout';
import { makeLight } from './light';
import { makeBuffer, makePen, type Optics, type Pen, type PixelBuffer } from './raster';

// What the drawing needs to know about a session.
export interface SessionView {
  id: string;
  name: string; // what the name tag says
  status: 'busy' | 'waiting' | 'idle';
  statusSince: number | null;
  background: boolean; // headless sessions get a robot worker
  supervisor: { status: string } | null;
  agents: { id: string }[];
}

// anything that walks: where it is, the waypoints still to go, the way it looks
export interface Walker {
  at: Waypoint | null;
  path: Waypoint[];
  facing: Dir;
}

// a subagent
export interface Helper extends Walker {
  slot: number;
  seed: number;
  color: string;
  spot: Spot | null;
  leaving: boolean;
  enterAt: number;
}

// claude-mem's observer for a session
export interface Boss extends Walker {
  seed: number;
  home: Spot | null;
  goal: 'home' | 'door' | number; // a number is a hangout
  turnTo: Dir;
  linger: number;
  trips: number;
  leaving: boolean;
  enterAt: number;
}

// A session's place in the office: its worker and whoever stands around them.
export interface Desk extends Walker {
  data: SessionView;
  tag: HTMLAnchorElement;
  seed: number;
  tint: string;
  seat: number;
  play: number; // the play spot they hold, or -1
  outside: boolean; // not through the door yet
  enterAt: number;
  boss: Boss | null;
  bossSeen: number;
  helpers: Map<string, Helper>;
}

// Everything one office on the page owns.
export interface Scene extends Optics {
  canvas: HTMLCanvasElement;
  tags: HTMLElement;
  ctx: CanvasRenderingContext2D;
  image: ImageData;
  office: PixelBuffer; // the room and its furniture
  live: PixelBuffer; // the office plus whatever moves, as put on the canvas
  pen: Pen; // draws into `live`
  officeLayers: number;
  camera: Camera;
  floor: Floor;
  desks: Map<string, Desk>;
  cat: Cat;
  frame: number;
  doorOpen: number; // frames the door stays open for
  reduced: boolean; // the viewer asked for less motion
}

export function makeScene(canvas: HTMLCanvasElement, tags: HTMLElement): Scene {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This window cannot draw on a canvas.');
  const image = ctx.createImageData(SCENE_W, SCENE_H);
  const camera = loadCamera();
  const optics: Optics = { view: aim(camera), light: makeLight(), layer: 0 };
  const live = { rgb: new Uint32Array(image.data.buffer), depth: new Float64Array(SCENE_W * SCENE_H) };
  const scene: Scene = Object.assign(optics, {
    canvas,
    tags,
    ctx,
    image,
    office: makeBuffer(),
    live,
    pen: makePen(live, optics),
    officeLayers: 0,
    camera,
    floor: makeFloor(FOOTPRINTS),
    desks: new Map<string, Desk>(),
    cat: makeCat(),
    frame: 0,
    doorOpen: 0,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  });
  return scene;
}
