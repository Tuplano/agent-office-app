import { CELL, GRID } from './constants';
import { bodyFrame } from './figures';
import { type Floor, step, type Waypoint } from './floor';
import { CAT, INK } from './palette';
import type { Scene, Walker } from './scene';

// The office cat keeps its own hours. It sits and watches the room, wanders off to
// sit somewhere else, curls up for a sleep, and now and then tears around the place.
export interface Cat extends Walker {
  at: Waypoint;
  mood: 'sit' | 'sleep' | 'roam' | 'zoom';
  until: number; // the frame a sit or a sleep ends
  dashes: number; // runs still to come in a bout of zoomies
  sleepy: boolean; // on its way to a nap
}

export const CAT_HOME: Waypoint = { x: 112.5, y: 132.5 }; // beside the arcade, looking out at the room
// Where it likes to sleep: at home, in the light of the lounge lamp, under the north
// windows, by the planter, on the rug by the door.
export const CAT_NAPS: readonly Waypoint[] = [CAT_HOME, { x: 22, y: 90 }, { x: 58, y: 6 }, { x: 58, y: 78 }, { x: 94, y: 10 }];

// how long things last, in frames
const SIT: [number, number] = [30, 130];
const SLEEP: [number, number] = [260, 700];
const STRETCH: [number, number] = [20, 50]; // sitting up after a sleep

export function makeCat(): Cat {
  return { at: { ...CAT_HOME }, path: [], facing: 'S', mood: 'sit', until: 40, dashes: 0, sleepy: false };
}

type Random = () => number;
const between = (random: Random, [lo, hi]: [number, number]) => lo + Math.floor(random() * (hi - lo + 1));
const apart = (a: Waypoint, b: Waypoint) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

// The way to some clear bit of floor at least `far` from here; empty when none turns up.
function wayAnywhere(floor: Floor, from: Waypoint, far: number, random: Random): Waypoint[] {
  for (let tries = 0; tries < 12; tries++) {
    const c = Math.floor(random() * GRID);
    const r = Math.floor(random() * GRID);
    const to = { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
    if (!floor.free(c, r) || apart(from, to) < far) continue;
    const path = floor.route(from.x, from.y, to.x, to.y);
    if (path.length) return path;
  }
  return [];
}

// One frame of the cat's day. `random` is there so that a test can script it.
export function moveCat(scene: Scene, random: Random = Math.random) {
  const { cat, floor, frame } = scene;
  if (scene.reduced) return; // sits where it is
  const settle = (mood: 'sit' | 'sleep', frames: [number, number]) => {
    Object.assign(cat, { mood, path: [], dashes: 0, sleepy: false, until: frame + between(random, frames) });
  };

  if (cat.path.length) {
    step(cat, cat.mood === 'zoom' ? 4 : 2);
    if (cat.mood === 'zoom') step(cat, 4); // twice as fast as anybody walks
    if (cat.path.length) return;
    if (cat.mood === 'zoom' && cat.dashes > 0) {
      cat.dashes--;
      cat.path = wayAnywhere(floor, cat.at, 40, random);
      if (cat.path.length) return;
    }
    if (cat.sleepy) settle('sleep', SLEEP);
    else settle('sit', SIT);
    return;
  }
  if (cat.mood === 'roam' || cat.mood === 'zoom') return settle('sit', SIT); // nowhere to go after all
  if (frame < cat.until) return;
  if (cat.mood === 'sleep') return settle('sit', STRETCH);

  // sitting, and done with it
  const whim = random();
  if (whim < 0.14) {
    Object.assign(cat, { mood: 'zoom', dashes: between(random, [2, 4]), path: wayAnywhere(floor, cat.at, 40, random) });
  } else if (whim < 0.44) {
    const nap = CAT_NAPS[Math.floor(random() * CAT_NAPS.length)];
    if (apart(cat.at, nap) < 1) return settle('sleep', SLEEP);
    Object.assign(cat, { mood: 'roam', sleepy: true, path: floor.route(cat.at.x, cat.at.y, nap.x, nap.y) });
  } else if (whim < 0.9) {
    Object.assign(cat, { mood: 'roam', path: wayAnywhere(floor, cat.at, 16, random) });
  } else {
    settle('sit', SIT);
  }
}

export function drawCat(scene: Scene) {
  const { cat } = scene;
  const f = scene.reduced ? 1 : scene.frame;
  const b = bodyFrame(scene.pen, cat.at.x, cat.at.y, cat.facing);
  const eyes = (at: number, z0: number, z1: number) => {
    b.front(at, -1.5, -0.5, z0, z1, INK);
    b.front(at, 0.5, 1.5, z0, z1, INK);
  };

  if (cat.mood === 'sleep') {
    // curled up, head down on its paws, sides rising and falling
    b.box(-3, 3, -2.5, 2.5, 0, 2.5 + (Math.floor(f / 5) % 2) * 0.4, CAT);
    b.box(1, 4, -2, 2, 0, 3.2, CAT);
    b.box(2, 3.5, -2, -1, 3.2, 0.8, CAT);
    b.box(2, 3.5, 1, 2, 3.2, 0.8, CAT);
    b.box(-3, 1, 2.5, 3.5, 0, 1, CAT); // tail tucked round
    eyes(4, 1.6, 1.9);
  } else if (cat.path.length) {
    // on all fours; legs swap each frame, tail up at a walk and streaming out behind at a run
    const running = cat.mood === 'zoom';
    const lift = (n: number) => ((f + n) % 2 ? 0.7 : 0);
    b.box(1, 2, -1.5, -0.5, lift(0), 1.5, CAT);
    b.box(1, 2, 0.5, 1.5, lift(1), 1.5, CAT);
    b.box(-2.5, -1.5, -1.5, -0.5, lift(1), 1.5, CAT);
    b.box(-2.5, -1.5, 0.5, 1.5, lift(0), 1.5, CAT);
    b.box(-3, 2.5, -1.5, 1.5, 1.5, 3, CAT);
    b.box(2, 5, -2, 2, 3, 3, CAT);
    b.box(3, 4.5, -2, -1, 6, 1, CAT);
    b.box(3, 4.5, 1, 2, 6, 1, CAT);
    if (running) b.box(-6, -3, -0.5, 0.5, 3.5, 1, CAT);
    else b.box(-4, -3, -0.5, 0.5, 3, 3, CAT);
    eyes(5, 4.2, 5.2);
  } else {
    // sitting up: haunches, head, ears, a tail that flicks, eyes that blink
    b.box(-2.5, 2.5, -2.5, 2.5, 0, 3, CAT);
    b.box(-1.5, 3.5, -2.5, 2.5, 3, 3, CAT);
    b.box(0.5, 2.5, -2.5, -1.5, 6, 1, CAT);
    b.box(0.5, 2.5, 1.5, 2.5, 6, 1, CAT);
    if (f % 8 < 4) b.box(-0.5, 0.5, 2.5, 5.5, 0, 1, CAT);
    else b.box(-0.5, 0.5, 2.5, 3.5, 0, 3, CAT);
    if (f % 19 !== 0) eyes(3.5, 4, 5);
  }
}
