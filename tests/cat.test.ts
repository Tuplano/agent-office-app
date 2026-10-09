import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAT_HOME, CAT_NAPS, moveCat } from '../src/engine/cat';
import { CELL } from '../src/engine/constants';
import { makeScene, type Scene } from '../src/engine/scene';

const fakeCanvas = () => ({
  getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }) }),
});
const office = (reduced = false): Scene => {
  vi.stubGlobal('matchMedia', () => ({ matches: reduced }));
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  return makeScene(fakeCanvas() as unknown as HTMLCanvasElement, {} as HTMLElement);
};
// the cat's choices, one after another; the last is repeated
const script = (...rolls: number[]) => () => (rolls.length > 1 ? rolls.shift()! : rolls[0]);
// numbers that look random but are the same on every run
const steady = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
const onClearFloor = (scene: Scene) => scene.floor.free(Math.floor(scene.cat.at.x / CELL), Math.floor(scene.cat.at.y / CELL));
// runs the frames until `done`, and says how many it took
function until(scene: Scene, random: () => number, done: () => boolean, limit = 3000) {
  for (let frames = 0; frames < limit; frames++) {
    if (done()) return frames;
    scene.frame++;
    moveCat(scene, random);
  }
  throw new Error(`still waiting after ${limit} frames`);
}

describe('the office cat', () => {
  let scene: Scene;
  beforeEach(() => {
    scene = office();
  });

  it('starts out sitting at home', () => {
    expect(scene.cat).toMatchObject({ at: CAT_HOME, mood: 'sit', path: [] });
    until(scene, script(0.5), () => scene.frame === 30);
    expect(scene.cat).toMatchObject({ at: CAT_HOME, mood: 'sit' });
  });

  it('wanders off to sit somewhere else', () => {
    const { cat } = scene;
    until(scene, script(0.6, 0.3), () => cat.mood === 'roam');
    expect(cat.path.length).toBeGreaterThan(0);
    until(scene, script(0.3), () => cat.mood === 'sit');
    expect(cat.at).not.toEqual(CAT_HOME);
    expect(onClearFloor(scene)).toBe(true);
  });

  it('goes to one of its spots for a sleep, and wakes up again', () => {
    const { cat } = scene;
    // the whim to nap, then the second spot on the list
    until(scene, script(0.3, 0.3), () => cat.sleepy);
    until(scene, script(0.5), () => cat.mood === 'sleep');
    expect(cat.at).toEqual(CAT_NAPS[1]);
    const slept = until(scene, script(0.5), () => cat.mood === 'sit');
    expect(slept).toBeGreaterThan(250);
    expect(cat.at).toEqual(CAT_NAPS[1]);
  });

  it('sleeps where it sits when that is the spot it picked', () => {
    until(scene, script(0.3, 0), () => scene.cat.mood === 'sleep');
    expect(scene.cat.at).toEqual(CAT_HOME);
  });

  it('gets the zoomies: several runs, faster than its walk', () => {
    const { cat } = scene;
    const paces: number[] = [];
    const pace = (random: () => number, mood: string) => {
      until(scene, random, () => cat.mood === mood);
      const from = { ...cat.at };
      scene.frame++;
      moveCat(scene, random);
      return Math.abs(cat.at.x - from.x) + Math.abs(cat.at.y - from.y);
    };
    paces.push(pace(steady(3), 'roam'));
    until(scene, steady(3), () => cat.mood === 'sit');
    // the whim to run and as many runs as it can have, then wherever the dice send it
    const first = [0.05, 0.99];
    const rest = steady(7);
    const random = () => first.shift() ?? rest();
    paces.push(pace(random, 'zoom'));
    expect(paces[1]).toBeGreaterThan(paces[0]);
    let runs = 1;
    let legs = cat.dashes;
    until(scene, random, () => {
      if (cat.dashes < legs) runs++;
      legs = cat.dashes;
      return cat.mood === 'sit';
    });
    expect(runs).toBeGreaterThan(2);
    expect(onClearFloor(scene)).toBe(true);
  });

  it('does all of it over a long day without ever ending up in the furniture', () => {
    const { cat } = scene;
    const random = steady(11);
    const moods = new Set<string>();
    for (let frame = 0; frame < 20000; frame++) {
      scene.frame++;
      moveCat(scene, random);
      moods.add(cat.mood);
      if (!onClearFloor(scene)) throw new Error(`in the furniture at ${cat.at.x}, ${cat.at.y} on frame ${frame}`);
    }
    expect([...moods].sort()).toEqual(['roam', 'sit', 'sleep', 'zoom']);
  });

  it('can reach every one of its sleeping spots', () => {
    for (const nap of CAT_NAPS) {
      expect(scene.floor.free(Math.floor(nap.x / CELL), Math.floor(nap.y / CELL)), `${nap.x}, ${nap.y}`).toBe(true);
      if (nap !== CAT_HOME) expect(scene.floor.route(CAT_HOME.x, CAT_HOME.y, nap.x, nap.y).length, `${nap.x}, ${nap.y}`).toBeGreaterThan(0);
    }
  });

  it('stays put when motion is reduced', () => {
    scene = office(true);
    until(scene, steady(5), () => scene.frame === 2000);
    expect(scene.cat).toMatchObject({ at: CAT_HOME, mood: 'sit', path: [] });
  });
});
