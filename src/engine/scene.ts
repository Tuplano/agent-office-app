import { aim, type Camera, loadCamera } from './camera';
import { type Cat, makeCat } from './cat';
import { CELL, type Dir, SCENE_H, SCENE_W } from './constants';
import { type Floor, makeFloor, type Spot, type Waypoint } from './floor';
import { type Layout, layoutOf } from './layout';
import type { Rect } from './place';
import { makeLight } from './light';
import { makeBuffer, makePen, type Optics, type Pen, type PixelBuffer } from './raster';
import { DEFAULT_ROOM, type Room } from './room';
import { resettleYou, type You } from './you';

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

// Where a session with no chair sits: a lounge seat, or a cushion on the floor.
export interface Spare {
  x: number;
  y: number;
  dir: Dir;
  z: number; // seat height
  lounge: number; // the play spot it is, or -1
  spot: Spot | null; // the floor cell it holds
}

// A session's place in the office: its worker and whoever stands around them.
export interface Desk extends Walker {
  data: SessionView;
  layout: Layout; // the room they are in, which `seat` and `play` are numbers in
  tag: HTMLAnchorElement;
  seed: number;
  tint: string;
  seat: number; // their chair, or -1
  spare: Spare | null; // where they sit while they have no chair
  gone: boolean; // the session has ended and they are walking out
  play: number; // the play spot they hold, or -1
  outside: boolean; // not in the room: not through the door yet, or already out of it
  unpacked: boolean; // their laptop is out on the desk; until then, and on the way out, it is under their arm
  enterAt: number;
  boss: Boss | null;
  bossSeen: number;
  helpers: Map<string, Helper>;
}

// The room as it is shown while a piece is being dragged about: with the piece
// where it is held, and whether it would fit if it were let go there.
export interface Preview {
  room: Room;
  layout: Layout;
  piece: number;
  fits: boolean;
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
  room: Room;
  layout: Layout; // where everything in the room is, for the people in it
  floor: Floor;
  desks: Map<string, Desk>;
  cat: Cat;
  you: You | null; // the person at the screen, in the room: only in an office on the page (`createOffice`)
  frame: number;
  doorOpen: number; // frames the door stays open for
  reduced: boolean; // the viewer asked for less motion
  editing: boolean; // the room is being rearranged, and the people hold still
  selected: number | null; // the piece picked out for moving, turning or deleting
  preview: Preview | null;
  mark: Rect | null; // a stretch of floor picked out in red: where wall is about to be cut away
}

export function makeScene(canvas: HTMLCanvasElement, tags: HTMLElement, room: Room = DEFAULT_ROOM): Scene {
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('This window cannot draw on a canvas.');
  const image = ctx.createImageData(SCENE_W, SCENE_H);
  const camera = loadCamera();
  const layout = layoutOf(room);
  const optics: Optics = { view: aim(camera, room.size), light: makeLight(), layer: 0 };
  const live = { rgb: new Uint32Array(image.data.buffer), depth: new Float64Array(SCENE_W * SCENE_H) };
  const scene: Scene = Object.assign(optics, {
    canvas,
    tags,
    ctx,
    image,
    office: { ...makeBuffer(), owner: new Int16Array(SCENE_W * SCENE_H).fill(-1), who: -1 },
    live,
    pen: makePen(live, optics),
    officeLayers: 0,
    camera,
    room,
    layout,
    floor: makeFloor(room.size, layout.footprints),
    desks: new Map<string, Desk>(),
    cat: makeCat(layout.cat[0]),
    you: null as You | null,
    frame: 0,
    doorOpen: 0,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
    editing: false,
    selected: null as number | null,
    preview: null as Preview | null,
    mark: null as Rect | null,
  });
  return scene;
}

// Swaps the room for another: where everything is, the floor, the view of it. The
// picture has to be built again afterwards, and the people put where they now
// belong, which is the sim's to do.
export function furnish(scene: Scene, room: Room) {
  scene.room = room;
  scene.layout = layoutOf(room);
  scene.floor = makeFloor(room.size, scene.layout.footprints);
  scene.view = aim(scene.camera, room.size);
  scene.doorOpen = 0;
  // the cat sits down where it is, if that is still clear floor; otherwise it turns up at home
  const { cat } = scene;
  const clear = scene.floor.free(Math.floor(cat.at.x / CELL), Math.floor(cat.at.y / CELL));
  Object.assign(cat, { at: clear ? cat.at : { ...scene.layout.cat[0] }, path: [], mood: 'sit', dashes: 0, sleepy: false, until: scene.frame + 40 });
  // you too, first, so that nobody else is put where you stand
  resettleYou(scene);
}

// The piece of the room drawn at a point of the picture, by its number, or -1.
export function pieceAt(scene: Scene, sx: number, sy: number): number {
  const [x, y] = [Math.floor(sx), Math.floor(sy)];
  if (x < 0 || y < 0 || x >= SCENE_W || y >= SCENE_H) return -1;
  return scene.office.owner?.[y * SCENE_W + x] ?? -1;
}
