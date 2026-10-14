import { floorAt, project } from './camera';
import { CELL, type Dir, LEGS, OPPOSITE, SCENE_H, SCENE_W } from './constants';
import { nameOf } from './edit';
import { ADULT, bodyFrame, drawFigure, placeOf, poseOf } from './figures';
import { type Spot, step, type Waypoint } from './floor';
import { type PlaySpot, TABLE_TOP } from './layout';
import { COBALT, HAIR, INK, LIME, METAL, PAPER, SAGE, SCREEN_ON, SHIRT, SKIN, STEEL, TANGERINE, TROUSERS } from './palette';

const HEART = '#e8556d';
import { FLOOR_KINDS } from './pieces';
import { placeRect, wallPoint } from './place';
import type { Pen } from './raster';
import { onWall } from './room';
import { pieceAt, type Scene, type Walker } from './scene';
import { type Hold, type Use, usesOf } from './uses';
import { WALL_KINDS } from './walls';

// You: the person at the screen, in the room. You run no session: you go where
// you are sent and stand there. Like everyone standing, you hold the cell of floor
// you stand on, so nobody is put down on top of you; walking, as everyone does,
// you pass through people.

export interface Look {
  shirt: string;
  skin: string;
  hair: string;
}

// what a look can be made of: what the workers are dressed from
export const LOOK_CHOICES: { readonly [K in keyof Look]: readonly string[] } = { shirt: SHIRT, skin: SKIN, hair: HAIR };
export const FIRST_LOOK: Look = { shirt: SHIRT[1], skin: SKIN[1], hair: HAIR[0] };

// What you can do with a piece of the room, and the menu of it a click opens.
export type Act = 'sit' | 'lie' | 'nap' | 'play';
export interface Action {
  id: Act | 'walk' | 'pet' | `use:${string}`; // a use is one of the piece's own (`uses.ts`)
  label: string;
  taken: boolean; // someone is in every place it could be done
}
export interface Menu {
  piece: number; // -1 for the cat
  name: string;
  sx: number; // where it was clicked, in the picture
  sy: number;
  actions: Action[];
}
const LABELS: Record<Act | 'walk', string> = { sit: 'Sit', lie: 'Lie down', nap: 'Nap', play: 'Play', walk: 'Walk here' };
// what your name tag says you are doing
const DOING: Record<Act, string> = { sit: 'sitting', lie: 'asleep', nap: 'napping', play: 'playing' };

// What you are doing, or on your way to do: where, facing which way, at what
// height, and the seats and play spots of the room it holds while you do it.
export interface Doing {
  act: Act | 'use' | 'talk' | 'pet';
  x: number;
  y: number;
  dir: Dir;
  z: number;
  seats: number[];
  play: number[];
  game?: PlaySpot['kind'];
  use?: Use; // one of the piece's own uses
  with?: string; // the session of the worker you are talking to
  top?: number; // how high the table in front of the seat is, for a laptop
  started?: number; // the frame you got there and set to it
}

// the seats and play spots the workers have, which are not yours to take
export interface Held {
  seats: ReadonlySet<number>;
  play: ReadonlySet<number>;
}

export interface You extends Walker {
  at: Waypoint;
  // the cell you hold while you stand, or are walking to stand; none while you sit
  spot: Spot | null;
  doing: Doing | null;
  holding: Hold | null; // what you took away with you: a coffee, a file
  away: number; // out of the door until this frame, or 0
  look: Look;
  tag: HTMLElement;
}

const AWAY = 25; // frames out of the door when you step out (four or five seconds)
const PETTED = 30; // frames the cat stays put to be petted

const SPEED = 4; // a brisk walk, as workers hurrying back to their desks

// Just inside the door, a few steps into the room: where you stand when the office
// opens, and when the room changes from under you.
function byTheDoor(scene: Scene): Spot | null {
  const { door } = scene.layout;
  const { w, d } = scene.room.size;
  const far = Math.hypot(w / 2 - door.x, d / 2 - door.y) || 1;
  const tx = door.x + ((w / 2 - door.x) / far) * CELL * 3;
  const ty = door.y + ((d / 2 - door.y) / far) * CELL * 3;
  return scene.floor.findSpot(door.x, door.y, tx, ty);
}

export function makeYou(scene: Scene, look: Look = FIRST_LOOK): You {
  const tag = document.createElement('span');
  tag.className = 'tag you';
  tag.textContent = 'You';
  scene.tags.append(tag);
  const spot = byTheDoor(scene);
  return { at: spot ? { x: spot.x, y: spot.y } : { ...scene.layout.door }, path: [], facing: 'S', spot, doing: null, holding: null, away: 0, look, tag };
}

// what you hold, for the workers to pass over
export function yours(scene: Scene): { seats: number[]; play: number[] } {
  const doing = scene.you?.doing;
  return { seats: doing?.seats ?? [], play: doing?.play ?? [] };
}

// The places on a piece an act can be done, free ones only, nearest `near` first.
// Lying takes the whole of a sofa, so only one nobody else is on.
function placesFor(scene: Scene, piece: number, act: Act, held: Held, near: Waypoint): Doing[] {
  const { seats, play } = scene.layout;
  const mine = yours(scene);
  const free = (taken: ReadonlySet<number>, own: number[]) => (i: number) => !taken.has(i) || own.includes(i);
  const seatFree = free(held.seats, mine.seats);
  const playFree = free(held.play, mine.play);
  const spots = play.map((spot, i) => ({ spot, i })).filter(({ spot }) => spot.piece === piece);
  let found: Doing[] = [];
  if (act === 'sit') {
    found = [
      ...seats.flatMap((seat, i) => (seat.piece === piece && seatFree(i) ? [{ act, x: seat.x, y: seat.y, dir: seat.dir, z: seat.z, seats: [i], play: [], top: seat.top ?? TABLE_TOP }] : [])),
      ...spots.filter(({ spot, i }) => spot.z && playFree(i)).map(({ spot, i }) => ({ act, x: spot.x, y: spot.y, dir: spot.dir, z: spot.z!, seats: [], play: [i] })),
    ];
  } else if (act === 'nap') {
    found = spots.filter(({ spot, i }) => spot.kind === 'bean' && playFree(i)).map(({ spot, i }) => ({ act, x: spot.x, y: spot.y, dir: spot.dir, z: spot.z ?? 3, seats: [], play: [i] }));
  } else if (act === 'lie') {
    const sofa = spots.filter(({ spot }) => spot.kind === 'sofa');
    if (sofa.length && sofa.every(({ i }) => playFree(i))) {
      const x = sofa.reduce((sum, { spot }) => sum + spot.x, 0) / sofa.length;
      const y = sofa.reduce((sum, { spot }) => sum + spot.y, 0) / sofa.length;
      found = [{ act, x, y, dir: sofa[0].spot.dir, z: sofa[0].spot.z ?? 6, seats: [], play: sofa.map(({ i }) => i) }];
    }
  } else {
    found = spots
      .filter(({ spot, i }) => (spot.kind === 'arcade' || spot.kind === 'pong') && playFree(i))
      .map(({ spot, i }) => ({ act, x: spot.x, y: spot.y, dir: spot.dir, z: LEGS, seats: [], play: [i], game: spot.kind }));
  }
  return found.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
}

// what a piece is for at all, taken or not
function offers(scene: Scene, piece: number): Act[] {
  const { seats, play } = scene.layout;
  const kinds = new Set(play.filter((spot) => spot.piece === piece).map((spot) => spot.kind));
  const acts: Act[] = [];
  if (seats.some((seat) => seat.piece === piece) || kinds.has('sofa') || kinds.has('bean')) acts.push('sit');
  if (kinds.has('sofa')) acts.push('lie');
  if (kinds.has('bean')) acts.push('nap');
  if (kinds.has('arcade') || kinds.has('pong')) acts.push('play');
  return acts;
}

// the chairs of a piece that are free, nearest `near` first
const chairsFor = (scene: Scene, piece: number, held: Held, near: Waypoint) => placesFor(scene, piece, 'sit', held, near).filter((place) => place.seats.length);

// The menu of a piece: its name, what you could do with it (what its chairs, sofas
// and games are for, then its own uses), and walking up to it.
export function menuFor(scene: Scene, piece: number, held: Held, sx: number, sy: number): Menu | null {
  const it = scene.room.pieces[piece];
  if (!it) return null;
  const [x, y] = floorAt(scene.view, sx, sy);
  const actions: Action[] = offers(scene, piece).map((id) => ({ id, label: LABELS[id], taken: !placesFor(scene, piece, id, held, { x, y }).length }));
  for (const use of usesOf(it)) {
    const atChair = use.how === 'seat' || use.how === 'work';
    actions.push({ id: `use:${use.id}`, label: use.label, taken: atChair && !chairsFor(scene, piece, held, { x, y }).length });
  }
  actions.push({ id: 'walk', label: LABELS.walk, taken: false });
  return { piece, name: nameOf(it), sx, sy, actions };
}

// Where to stand to use a piece: a free cell of floor beside it (or on it, for a
// rug), as near it as can be and then as near you, that can be walked to; and the
// way to face it. Off the wall, for what hangs on one. With nothing free right by
// it (a sign over a sofa), a step or two further back. The cell is then taken.
function standBy(scene: Scene, piece: number): { spot: Spot; path: Waypoint[]; dir: Dir } | null {
  const { room } = scene;
  const it = room.pieces[piece];
  if (!scene.you || !it) return null;
  let rect: [number, number, number, number];
  let facing: Dir | null = null;
  if (onWall(it)) {
    const kind = WALL_KINDS[it.kind];
    if (!kind) return null;
    const [from, to] = kind.span(it);
    const [ax, ay] = wallPoint(room.size, it.wall, it.a + from, it.out ?? 0);
    const [bx, by] = wallPoint(room.size, it.wall, it.a + to, it.out ?? 0);
    rect = [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)];
    facing = it.wall; // you face the wall it hangs on
  } else {
    const kind = FLOOR_KINDS[it.kind];
    if (!kind) return null;
    const box = kind.box(it);
    const [x, y, w, d] = placeRect(box, it, [0, 0, ...box]);
    rect = [x, y, x + w, y + d];
  }
  return standNear(scene, rect, facing);
}

// The free cell to stand on by a stretch of floor, and the way to face it (or
// `facing`, where that is given), as `standBy`. The cell is then taken.
function standNear(scene: Scene, rect: [number, number, number, number], facing: Dir | null): { spot: Spot; path: Waypoint[]; dir: Dir } | null {
  const { floor, you } = scene;
  if (!you) return null;
  const centre = { x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 };
  const free: { cell: number; x: number; y: number; gap: number; score: number }[] = [];
  for (let r = 0; r < floor.rows; r++) {
    for (let c = 0; c < floor.cols; c++) {
      const cell = r * floor.cols + c;
      if (!floor.free(c, r) || floor.taken.has(cell)) continue;
      const [x, y] = [c * CELL + CELL / 2, r * CELL + CELL / 2];
      const gap = Math.hypot(Math.max(rect[0] - x, 0, x - rect[2]), Math.max(rect[1] - y, 0, y - rect[3]));
      free.push({ cell, x, y, gap, score: gap + Math.hypot(x - you.at.x, y - you.at.y) / 4 });
    }
  }
  for (const reach of [2, 4, 7]) {
    const near = free.filter((spot) => spot.gap <= CELL * reach).sort((a, b) => a.score - b.score);
    for (const spot of near.slice(0, 8)) {
      const path = floor.route(you.at.x, you.at.y, spot.x, spot.y);
      if (!path.length) continue;
      floor.taken.add(spot.cell);
      const [dx, dy] = [centre.x - spot.x, centre.y - spot.y];
      const dir = facing ?? (Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N');
      return { spot: { cell: spot.cell, x: spot.x, y: spot.y, score: spot.score }, path, dir };
    }
  }
  return null;
}

// The worker, or the cat, drawn at a point of the picture: the nearest of those whose
// box (round where they are drawn this frame, head to foot) the point is in.
export type Figure = { worker: string } | { cat: true };
export function figureAt(scene: Scene, sx: number, sy: number): Figure | null {
  let found: Figure | null = null;
  let nearest = -Infinity;
  const consider = (x: number, y: number, z0: number, z1: number, r: number, who: Figure) => {
    let [x0, y0, x1, y1, near] = [Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (const dx of [-r, r]) {
      for (const dy of [-r, r]) {
        for (const z of [z0, z1]) {
          const [px, py, n] = project(scene.view, x + dx, y + dy, z);
          [x0, y0, x1, y1, near] = [Math.min(x0, px), Math.min(y0, py), Math.max(x1, px), Math.max(y1, py), Math.max(near, n)];
        }
      }
    }
    if (sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1 && near > nearest) {
      nearest = near;
      found = who;
    }
  };
  for (const desk of scene.desks.values()) {
    if (!placeOf(desk) || desk.outside || desk.gone) continue;
    const pose = poseOf(desk);
    consider(pose.x, pose.y, pose.sitting ? pose.base - 3 : 0, pose.base + ADULT.tall + ADULT.face, 4, { worker: desk.data.id });
  }
  consider(scene.cat.at.x, scene.cat.at.y, 0, 7, 4, { cat: true });
  return found;
}

// what a session's worker is called, and where they are now
function workerOf(scene: Scene, id: string) {
  const desk = scene.desks.get(id);
  return desk && placeOf(desk) && !desk.outside && !desk.gone ? { name: desk.data.name, pose: poseOf(desk) } : null;
}

// Walks you up beside a worker, facing them, to talk. Says whether you set off.
export function talkTo(scene: Scene, id: string): boolean {
  const { you, floor } = scene;
  const worker = workerOf(scene, id);
  if (!you || scene.editing || !worker) return false;
  const { x, y } = worker.pose;
  floor.release(you.spot);
  const by = standNear(scene, [x, y, x, y], null);
  if (!by) {
    if (you.spot) floor.taken.add(you.spot.cell);
    return false;
  }
  leave(you);
  you.spot = by.spot;
  you.doing = { act: 'talk', x: by.spot.x, y: by.spot.y, dir: by.dir, z: LEGS, seats: [], play: [], with: id };
  you.path = by.path;
  if (scene.reduced) arrive(you);
  return true;
}

// the cat's own menu: petting it, or walking up to it
export function catMenu(sx: number, sy: number): Menu {
  return { piece: -1, name: 'The cat', sx, sy, actions: [{ id: 'pet', label: 'Pet the cat', taken: false }, { id: 'walk', label: LABELS.walk, taken: false }] };
}

// What you have in your hand once you go: what you got from what you were doing,
// or what you had before.
function leave(you: You) {
  const was = posed(you);
  if (was?.use?.keep && was.use.hold) you.holding = was.use.hold;
  you.away = 0;
}

// Doing something with your hands puts down what you were carrying.
const handsFull = (act: Action['id'], use?: Use) => act === 'play' || !!use?.hold || use?.how === 'reach' || use?.how === 'work';

// The menu of the piece under a point of the picture. None for open floor, nor
// for a piece with nothing to do but walk up to it (a rug, a plant): a click on
// that walks you there, as one on the floor does.
export function menuAt(scene: Scene, held: Held, sx: number, sy: number): Menu | null {
  if (!scene.you || scene.editing) return null;
  const piece = pieceAt(scene, sx, sy);
  const menu = piece < 0 ? null : menuFor(scene, piece, held, sx, sy);
  return menu && menu.actions.length > 1 ? menu : null;
}

// Does what was chosen from a menu: walks you to the nearest free place on the
// piece for it, where you then do it. Says whether you set off.
export function doAt(scene: Scene, held: Held, menu: Menu, act: Action['id']): boolean {
  const { you, floor } = scene;
  if (!you || scene.editing) return false;
  if (act === 'walk') return walkTo(scene, menu.sx, menu.sy);
  if (act === 'pet') {
    // down beside the cat, facing it
    const { x, y } = scene.cat.at;
    floor.release(you.spot);
    const by = standNear(scene, [x, y, x, y], null);
    if (!by) {
      if (you.spot) floor.taken.add(you.spot.cell);
      return false;
    }
    leave(you);
    you.spot = by.spot;
    you.doing = { act: 'pet', x: by.spot.x, y: by.spot.y, dir: by.dir, z: 2, seats: [], play: [] };
    you.path = by.path;
    if (scene.reduced) arrive(you);
    return true;
  }
  const [x, y] = floorAt(scene.view, menu.sx, menu.sy);
  const it = scene.room.pieces[menu.piece];
  const use = act.startsWith('use:') && it ? usesOf(it).find((u) => `use:${u.id}` === act) : undefined;
  if (act.startsWith('use:') && !use) return false;

  let place: Doing | null = null;
  let path: Waypoint[] = [];
  let spot: Spot | null = null;
  if (!use || use.how === 'seat' || use.how === 'work') {
    // in one of its chairs, or on its sofa, bean bag or game
    const found = use ? chairsFor(scene, menu.piece, held, { x, y })[0] : placesFor(scene, menu.piece, act as Act, held, { x, y })[0];
    if (found) place = use ? { ...found, act: 'use', use } : found;
    path = place ? floor.route(you.at.x, you.at.y, place.x, place.y) : [];
  } else if (use.how === 'out') {
    const { door } = scene.layout;
    place = { act: 'use', use, x: door.x, y: door.y, dir: you.facing, z: LEGS, seats: [], play: [] };
    path = floor.route(you.at.x, you.at.y, door.x, door.y);
  } else {
    floor.release(you.spot); // where you stand may be the place for it
    const by = standBy(scene, menu.piece);
    if (!by && you.spot) floor.taken.add(you.spot.cell);
    if (by) {
      spot = by.spot;
      path = by.path;
      const dir = use.how === 'lean' ? OPPOSITE[by.dir] : by.dir;
      const z = use.how === 'floor' ? 2 : use.how === 'lie' ? 0.5 : LEGS;
      place = { act: 'use', use, x: by.spot.x, y: by.spot.y, dir, z, seats: [], play: [] };
    }
  }
  if (!place || !path.length) return false;
  leave(you);
  if (handsFull(act, use)) you.holding = null;
  if (!spot) floor.release(you.spot); // seated, you hold the seat and not the floor
  you.spot = spot;
  you.doing = place;
  you.path = path;
  if (scene.reduced) arrive(you);
  return true;
}

// Walks you to the floor under a point of the picture: to the free cell nearest it
// that can be got to. Off the floor, or with no way there, you stay where you are,
// and it says so.
export function walkTo(scene: Scene, sx: number, sy: number): boolean {
  const { you, floor } = scene;
  if (!you || scene.editing) return false;
  const [x, y] = floorAt(scene.view, sx, sy);
  floor.release(you.spot); // where you stand is somewhere you can be sent
  const spot = floor.findSpot(x, y, x, y);
  const path = spot ? floor.route(you.at.x, you.at.y, spot.x, spot.y) : [];
  if (!spot || !path.length) {
    floor.release(spot);
    if (you.spot) floor.taken.add(you.spot.cell);
    return false;
  }
  you.spot = spot;
  leave(you);
  you.doing = null; // up, if you were sitting
  you.path = path;
  if (scene.reduced) arrive(you);
  return true;
}

function arrive(you: You) {
  const end = you.path[you.path.length - 1];
  if (end) you.at = { x: end.x, y: end.y };
  you.path = [];
}

// you are where you were going, doing it
const posed = (you: You): Doing | null => (you.path.length ? null : you.doing);

// One frame of your walk, and of whatever you then set to. While the room is
// edited you stand still.
export function moveYou(scene: Scene) {
  const { you } = scene;
  if (!you || scene.editing) return;
  if (you.away) {
    if (scene.frame >= you.away) comeBack(scene, you);
    return;
  }
  if (you.path.length) {
    if (scene.reduced) arrive(you);
    else step(you, SPEED);
  }
  const doing = posed(you);
  if (doing && doing.started === undefined) {
    doing.started = scene.frame;
    if (doing.use?.how === 'out') you.away = scene.frame + AWAY; // through the door
    if (doing.act === 'pet' && scene.cat.mood !== 'sleep') {
      // it comes to a stop, and stays a while to be petted
      Object.assign(scene.cat, { mood: 'sit', path: [], dashes: 0, sleepy: false, until: scene.frame + PETTED });
      const [dx, dy] = [you.at.x - scene.cat.at.x, you.at.y - scene.cat.at.y];
      scene.cat.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N';
    }
  }
  // the one you were talking to has got up and gone, or gone off somewhere: you let them go
  if (doing?.act === 'talk' && doing.with) {
    const worker = workerOf(scene, doing.with);
    if (!worker || Math.hypot(worker.pose.x - doing.x, worker.pose.y - doing.y) > CELL * 4) you.doing = null;
  }
}

// The view of a session has been closed, or another opened: the talk is over, and
// you stay where you are.
export function talkingTo(scene: Scene, id: string | null) {
  const { you } = scene;
  if (you?.doing?.act === 'talk' && you.doing.with !== id) you.doing = null;
}

// back in from outside, a few steps into the room
function comeBack(scene: Scene, you: You) {
  you.away = 0;
  you.doing = null;
  const spot = byTheDoor(scene);
  you.spot = spot;
  if (spot) you.at = { x: spot.x, y: spot.y };
}

// After the room has changed: up from whatever you were doing (its seats are
// numbered afresh), and on the floor nearest where you were, or by the door when
// there is none near. The floor is a new one, so the cell is taken again.
export function resettleYou(scene: Scene) {
  const { you, floor } = scene;
  if (!you) return;
  you.path = [];
  you.doing = null;
  you.away = 0;
  const spot = floor.findSpot(you.at.x, you.at.y, you.at.x, you.at.y) ?? byTheDoor(scene);
  you.spot = spot;
  if (spot) you.at = { x: spot.x, y: spot.y };
}

// Lying on your back along a sofa, its length to your side: legs, body, head.
function drawLying(p: Pen, doing: Doing, look: Look) {
  const b = bodyFrame(p, doing.x, doing.y, doing.dir);
  const z = doing.z;
  b.box(-1.5, 1.5, -11, -9, z, 3, PAPER); // shoes, toes up
  b.box(-1.5, 1.5, -9, -1, z, 2.5, TROUSERS);
  b.box(-2.5, 2.5, -1, 6, z, 3.5, look.shirt);
  b.box(2.5, 3.5, 0, 5, z + 0.5, 2, look.shirt); // arms along the sides
  b.box(-3.5, -2.5, 0, 5, z + 0.5, 2, look.shirt);
  b.box(-3, 3, 6, 11, z, 5.5, look.skin);
  b.box(-3, 3, 11, 12.5, z, 5.5, look.hair);
  b.box(-3, 3, 9.5, 11, z + 5.5, 0.6, look.hair); // the fringe, on top
  b.box(-2, -1, 7.5, 8.5, z + 5.5, 0.2, INK); // eyes shut
  b.box(1, 2, 7.5, 8.5, z + 5.5, 0.2, INK);
}

// Something in your hand: at your side, or up at your mouth for a sip now and then;
// a phone at your ear, a magazine open in front of you, a watering can held out.
function drawHeld(p: Pen, x: number, y: number, dir: Dir, base: number, hold: Hold, f: number) {
  const b = bodyFrame(p, x, y, dir);
  const top = base + ADULT.tall;
  if (hold === 'phone') return b.box(0, 1.2, 3, 3.8, top + 1.5, 2.2, INK);
  if (hold === 'magazine') {
    b.box(2.5, 5, -2.5, 2.5, base + 3.5, 0.5, COBALT);
    return b.box(2.7, 4.8, -2.3, 2.3, base + 4, 0.2, PAPER);
  }
  if (hold === 'watering') {
    b.box(3, 6, 2, 4, base + 1.5, 2.5, SAGE);
    return b.box(6, 8, 2.6, 3.4, base + 3, 0.8, SAGE); // the spout
  }
  const sip = (hold === 'cup' || hold === 'water' || hold === 'can') && f % 12 < 3;
  const [f0, l0, z0] = sip ? [2, -0.75, top + 1] : [1.5, 3.2, base + 1.5];
  const colour = { cup: PAPER, water: PAPER, can: TANGERINE, snack: LIME, file: PAPER }[hold];
  const h = hold === 'can' ? 2.2 : hold === 'file' ? 3 : hold === 'snack' ? 1.6 : 2;
  b.box(f0, f0 + 1.5, l0, l0 + 1.5, z0, h, colour);
  if (hold === 'cup') b.box(f0, f0 + 1.5, l0, l0 + 1.5, z0 + 0.8, 0.5, TANGERINE); // its sleeve
  if (hold === 'water') b.box(f0 + 0.2, f0 + 1.3, l0 + 0.2, l0 + 1.3, z0 + h - 0.1, 0.1, '#9fd0ff');
}

// a laptop of your own, open on the table in front of you
function drawLaptop(p: Pen, doing: Doing) {
  const b = bodyFrame(p, doing.x, doing.y, doing.dir);
  const top = doing.top ?? TABLE_TOP;
  b.box(5, 10, -3, 3, top, 0.6, METAL);
  b.box(9.4, 10, -3, 3, top + 0.6, 4, STEEL);
  b.box(9.3, 9.4, -2.6, 2.6, top + 1, 3.2, SCREEN_ON);
}

export function drawYou(scene: Scene) {
  const { you, reduced } = scene;
  if (!you || scene.editing || you.away) return; // out of the way of the furniture, as the name tags are
  const walking = you.path.length > 0;
  const f = reduced ? 0 : scene.frame;
  const doing = posed(you);
  if (doing?.act === 'lie' || doing?.use?.how === 'lie') return drawLying(scene.pen, doing, you.look);
  if (doing) {
    const how = doing.use?.how;
    const playing = doing.act === 'play';
    const petting = doing.act === 'pet';
    const talking = doing.act === 'talk';
    const sitting = doing.act === 'sit' || doing.act === 'nap' || petting || how === 'seat' || how === 'work' || how === 'floor';
    const reaching = how === 'reach' && f - (doing.started ?? f) < 10; // hands on it a while, then done
    drawFigure(scene.pen, doing.x, doing.y, {
      size: ADULT,
      dir: doing.dir,
      base: doing.z,
      stance: sitting ? 'sit' : 'stand',
      stride: f,
      legs: TROUSERS,
      shoes: PAPER,
      shirt: you.look.shirt,
      skin: you.look.skin,
      hair: you.look.hair,
      style: 1,
      arms: playing || reaching || petting ? 'reach' : how === 'work' ? 'desk' : talking && f % 8 < 3 ? 'wave' : 'down',
      tap: playing || reaching || petting || how === 'work' ? f % 2 : talking ? 0 : -1,
      shut: doing.act === 'nap' || (!reduced && f % 29 === 0),
    });
    if (doing.game === 'pong') bodyFrame(scene.pen, doing.x, doing.y, doing.dir).box(4, 5, 3, 5, LEGS + 5 + (f % 2), 2.5, TANGERINE); // paddle
    if (how === 'work') drawLaptop(scene.pen, doing);
    const hold = doing.use?.hold ?? (playing || petting || how === 'work' || how === 'reach' ? null : you.holding);
    if (hold && !reaching) drawHeld(scene.pen, doing.x, doing.y, doing.dir, doing.z, hold, f);
    return;
  }
  if (you.holding) drawHeld(scene.pen, you.at.x, you.at.y, you.facing, LEGS + (walking && f % 2 ? 0.5 : 0), you.holding, walking ? 3 : f);
  drawFigure(scene.pen, you.at.x, you.at.y, {
    size: ADULT,
    dir: you.facing,
    base: LEGS + (walking && f % 2 ? 0.5 : 0),
    stance: walking ? 'walk' : 'stand',
    stride: f,
    legs: TROUSERS,
    shoes: PAPER,
    shirt: you.look.shirt,
    skin: you.look.skin,
    hair: you.look.hair,
    style: 1,
    arms: 'down',
    tap: walking ? f % 2 : -1,
    shut: !reduced && f % 29 === 0,
  });
}

// how high the top of your head is, and where
function headOf(you: You): [x: number, y: number, z: number] {
  const doing = posed(you);
  // lying, your head is along the sofa to your side (`drawLying`), not over the middle
  if (doing?.act === 'lie' || doing?.use?.how === 'lie') return doing.dir === 'N' || doing.dir === 'S' ? [doing.x + 9, doing.y, doing.z + 6] : [doing.x, doing.y + 9, doing.z + 6];
  if (doing) return [doing.x, doing.y, doing.z + ADULT.tall + ADULT.face];
  return [you.at.x, you.at.y, LEGS + ADULT.tall + ADULT.face];
}

// what your name tag says: you, and what you are doing
export function tagText(you: You, now = new Date(), names?: (id: string) => string | undefined): string {
  const doing = posed(you);
  if (!doing || you.away) return 'You';
  if (doing.use?.id === 'time') return `You · it's ${now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (doing.act === 'talk') return `You · talking${names ? ` to ${names(doing.with ?? '') ?? 'someone'}` : ''}`;
  if (doing.act === 'pet') return 'You · petting the cat';
  return `You · ${doing.use ? doing.use.doing : DOING[doing.act as Act]}`;
}

// your name tag, over your head, saying what you are doing
export function moveYouTag(scene: Scene) {
  const { you } = scene;
  if (!you) return;
  const text = tagText(you, new Date(), (id) => scene.desks.get(id)?.data.name);
  if (you.tag.textContent !== text) you.tag.textContent = text;
  you.tag.hidden = !!you.away;
  const [x, y, z] = headOf(you);
  const [sx, sy] = project(scene.view, x, y, z + 8);
  you.tag.style.left = `${(sx / SCENE_W) * 100}%`;
  you.tag.style.top = `${(sy / SCENE_H) * 100}%`;
}

// Over your head, drawn over everything: the "z" of sleep while you nap or lie down,
// a speech bubble while you talk, a heart over the cat while you pet it.
export function drawYouMarks(scene: Scene) {
  const { you } = scene;
  const doing = you && !scene.editing && !you.away ? posed(you) : null;
  if (!doing) return;
  const fill = (sx: number, sy: number) => (dx: number, dy: number, w: number, h: number, color: string) => {
    scene.ctx.fillStyle = color;
    scene.ctx.fillRect(Math.round(sx) + dx, Math.round(sy) + dy, w, h);
  };
  const f = scene.reduced ? 0 : scene.frame;
  if (doing.act === 'talk') {
    const [x, y, z] = headOf(you!);
    const dot = fill(...(project(scene.view, x, y, z + 1).slice(0, 2) as [number, number]));
    dot(10, -10, 15, 9, INK);
    dot(11, -9, 13, 7, PAPER);
    dot(13, -1, 3, 3, INK); // its tail
    for (let i = 0; i < 3; i++) if ((f >> 1) % 4 > i) dot(13 + i * 4, -6, 2, 2, INK);
    return;
  }
  if (doing.act === 'pet') {
    const { cat } = scene;
    const dot = fill(...(project(scene.view, cat.at.x, cat.at.y, 9 + (f % 6) / 2).slice(0, 2) as [number, number]));
    dot(-3, -3, 2, 2, HEART);
    dot(1, -3, 2, 2, HEART);
    dot(-4, -2, 7, 2, HEART);
    dot(-3, 0, 5, 1, HEART);
    dot(-2, 1, 3, 1, HEART);
    dot(-1, 2, 1, 1, HEART);
    return;
  }
  if (doing.act !== 'nap' && doing.act !== 'lie') return;
  const [x, y, z] = headOf(you!);
  const [sx, sy] = project(scene.view, x, y, z - 1);
  const drift = Math.floor(f / 3) % 3;
  const dot = (dx: number, dy: number, w: number, h: number, color: string) => {
    scene.ctx.fillStyle = color;
    scene.ctx.fillRect(Math.round(sx) + dx, Math.round(sy) + dy, w, h);
  };
  const [dx, dy] = [12 + drift * 2, -6 - drift * 3];
  dot(dx - 1, dy - 1, 6, 6, PAPER);
  dot(dx, dy, 4, 1, INK);
  dot(dx + 2, dy + 1, 1, 1, INK);
  dot(dx + 1, dy + 2, 1, 1, INK);
  dot(dx, dy + 3, 4, 1, INK);
}
