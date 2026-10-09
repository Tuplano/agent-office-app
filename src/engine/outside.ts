import type { Dir } from './constants';
import { hash } from './palette';

// A patch of a window pane: a0..a1 runs along it from 0 to PANE_W, z0..z1 is the
// height above the floor.
export type Patch = [a0: number, a1: number, z0: number, z1: number];

export const PANE_W = 24;
export const PANE_Z: [number, number] = [9, 23];

// What is seen out of one window. Every window looks out on its own stretch of sky
// and its own bit of town or country, and only some have the sun and moon in view.
export interface Outside {
  land: 'city' | 'hills';
  skyline: Patch[]; // buildings or hills along the bottom of the pane
  lights: Patch[]; // lit windows in the buildings, for after dark
  clouds: Patch[];
  stars: Patch[];
  sun: Patch | null; // where the low sun sits, when this window faces it
  moon: Patch | null;
}

// the town lies to the north and south, the hills to the east and west
const LAND: Record<Dir, Outside['land']> = { N: 'city', S: 'city', E: 'hills', W: 'hills' };
const half = (v: number) => Math.round(v * 2) / 2;

// a stream of numbers from 0 up to 1 that is the same every time for the same seed
function seeded(seed: number) {
  let s = seed || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function look(wall: Dir, a: number, heavens: boolean): Outside {
  const random = seeded(hash(`window ${wall} ${a}`));
  const pick = (lo: number, hi: number) => half(lo + random() * (hi - lo));
  const [floor, top] = PANE_Z;
  const view: Outside = { land: LAND[wall], skyline: [], lights: [], clouds: [], stars: [], sun: null, moon: null };

  if (view.land === 'city') {
    for (let x = pick(0, 1.5); x < PANE_W; ) {
      const wide = 2 + Math.floor(random() * 3);
      const tall = pick(1.5, 6.5);
      const end = Math.min(PANE_W, x + wide);
      view.skyline.push([x, end, floor, floor + tall]);
      for (let n = Math.floor(random() * 3); n > 0 && tall >= 2.5 && end - x >= 2; n--) {
        const la = x + 0.5 + Math.floor(random() * (end - x - 1));
        const lz = floor + 0.5 + half(random() * (tall - 1.5));
        view.lights.push([la, la + 0.5, lz, lz + 0.5]);
      }
      x = end + (random() < 0.3 ? 1 : 0);
    }
  } else {
    for (let n = 2 + Math.floor(random() * 2); n > 0; n--) {
      const mid = pick(2, PANE_W - 2);
      const reach = pick(4, 7.5);
      const tall = pick(2, 4.5);
      // three tiers, each narrower and higher than the one behind it
      for (let tier = 1; tier <= 3; tier++) {
        const r = half((reach * (4 - tier)) / 3);
        view.skyline.push([Math.max(0, mid - r), Math.min(PANE_W, mid + r), floor, floor + half((tall * tier) / 3)]);
      }
    }
  }

  for (let n = 2 + Math.floor(random() * 2); n > 0; n--) {
    const wide = pick(5, 8);
    const a0 = pick(0, PANE_W - wide);
    const z = pick(floor + 3.5, top - 2.5);
    view.clouds.push([a0, a0 + wide, z, z + 1], [a0 + 1.5, a0 + wide - 1.5, z + 1, z + 2]);
  }
  for (let n = 6 + Math.floor(random() * 4); n > 0; n--) {
    const a0 = pick(0.5, PANE_W - 1.5);
    const z = pick(floor + 2, top - 1);
    view.stars.push([a0, a0 + 1, z, z + 0.5]);
  }
  if (heavens) {
    const sun = pick(3, 16);
    const moon = pick(3, 18);
    view.sun = [sun, sun + 5, floor + 1.5, floor + 4.5];
    view.moon = [moon, moon + 3, top - 5, top - 3];
  }
  return view;
}

const views = new Map<string, Outside>();

// The view from the window that starts at `a` along a wall. `heavens` is whether
// the sun and moon pass this window.
export function outside(wall: Dir, a: number, heavens: boolean): Outside {
  const key = `${wall} ${a} ${heavens}`;
  let view = views.get(key);
  if (!view) views.set(key, (view = look(wall, a, heavens)));
  return view;
}
