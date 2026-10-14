import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project } from '../src/engine/camera';
import { CELL } from '../src/engine/constants';
import { ADULT, poseOf } from '../src/engine/figures';
import { DEFAULT_ROOM } from '../src/engine/room';
import type { Scene } from '../src/engine/scene';
import { catMenu, doAt, figureAt, type Held, makeYou, moveYou, talkingTo, talkTo, tagText } from '../src/engine/you';
import { fakeElement, motionPreference, officeIn, session, storage } from './stand-ins';

const none: Held = { seats: new Set(), play: new Set() };

function office() {
  const { scene, sim } = officeIn(DEFAULT_ROOM);
  scene.you = makeYou(scene);
  sim.apply([session('alpha'), session('beta')]); // the first load: everyone in place at once
  return { scene, sim, you: scene.you };
}

// the middle of a worker's body, in the picture
const overWorker = (scene: Scene, id: string): [number, number] => {
  const pose = poseOf(scene.desks.get(id)!);
  const [sx, sy] = project(scene.view, pose.x, pose.y, pose.base + ADULT.tall / 2);
  return [sx, sy];
};
const names = (scene: Scene) => (id: string) => scene.desks.get(id)?.data.name;

beforeEach(() => {
  vi.stubGlobal('matchMedia', motionPreference(true)); // there at once
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { createElement: () => fakeElement() });
});
afterEach(() => vi.unstubAllGlobals());

describe('a click on a worker', () => {
  it('finds the worker drawn there, over the desk they sit at', () => {
    const { scene } = office();
    expect(figureAt(scene, ...overWorker(scene, 'alpha'))).toEqual({ worker: 'alpha' });
    expect(figureAt(scene, ...overWorker(scene, 'beta'))).toEqual({ worker: 'beta' });
    expect(figureAt(scene, -100, -100)).toBeNull();
  });

  it('walks you up beside them, facing them, to talk', () => {
    const { scene, you } = office();
    expect(talkTo(scene, 'alpha')).toBe(true);
    moveYou(scene);
    const pose = poseOf(scene.desks.get('alpha')!);
    expect(you.doing).toMatchObject({ act: 'talk', with: 'alpha' });
    expect(Math.hypot(you.at.x - pose.x, you.at.y - pose.y)).toBeLessThanOrEqual(CELL * 3);
    expect(scene.floor.taken.has(you.spot!.cell)).toBe(true);
    const [dx, dy] = [pose.x - you.at.x, pose.y - you.at.y];
    expect(you.doing!.dir).toBe(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'E' : 'W') : dy > 0 ? 'S' : 'N');
    expect(tagText(you, new Date(), names(scene))).toBe('You · talking to alpha');
  });

  it('lets them go when their session ends, and you stay where you are', () => {
    const { scene, sim, you } = office();
    talkTo(scene, 'alpha');
    moveYou(scene);
    const at = { ...you.at };
    sim.apply([session('beta')]); // alpha has ended, and walks out
    moveYou(scene);
    expect(you.doing).toBeNull();
    expect(you.at).toEqual(at);
  });

  it('ends the talk when their view is closed, or another opened, but not while it is theirs', () => {
    const { scene, you } = office();
    talkTo(scene, 'alpha');
    moveYou(scene);
    talkingTo(scene, 'alpha');
    expect(you.doing?.act).toBe('talk');
    talkingTo(scene, null);
    expect(you.doing).toBeNull();
  });

  it('is no click at all while the room is being edited', () => {
    const { scene } = office();
    scene.editing = true;
    expect(talkTo(scene, 'alpha')).toBe(false);
  });
});

describe('the cat', () => {
  it('is found where it is drawn, and has a menu of its own', () => {
    const { scene } = office();
    const [sx, sy] = project(scene.view, scene.cat.at.x, scene.cat.at.y, 3);
    expect(figureAt(scene, sx, sy)).toEqual({ cat: true });
    expect(catMenu(sx, sy).actions.map((a) => a.label)).toEqual(['Pet the cat', 'Walk here']);
  });

  it('stops for you, turns to you and stays to be petted while it is awake', () => {
    const { scene, you } = office();
    scene.cat.mood = 'roam';
    scene.cat.path = [{ x: 1, y: 1 }];
    expect(doAt(scene, none, catMenu(0, 0), 'pet')).toBe(true);
    moveYou(scene);
    expect(you.doing?.act).toBe('pet');
    expect(scene.cat).toMatchObject({ mood: 'sit', path: [] });
    expect(scene.cat.until).toBeGreaterThan(scene.frame);
    expect(Math.hypot(you.at.x - scene.cat.at.x, you.at.y - scene.cat.at.y)).toBeLessThanOrEqual(CELL * 3);
    expect(tagText(you)).toBe('You · petting the cat');
  });

  it('sleeps on if it is asleep', () => {
    const { scene } = office();
    scene.cat.mood = 'sleep';
    doAt(scene, none, catMenu(0, 0), 'pet');
    moveYou(scene);
    expect(scene.cat.mood).toBe('sleep');
  });
});
