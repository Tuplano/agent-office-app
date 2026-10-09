// Runs the prototype's page script beside the engine and checks that both draw
// the same pixels and plan the same walks. Skipped when ../agent-office is absent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, HOME } from '../src/engine/camera';
import { draw } from '../src/engine/draw';
import { makeScene } from '../src/engine/scene';
import { borrowLight, differing, fakeCanvas, lampPixels, loadPrototype, motionPreference, prototypeMissing, storage } from './prototype';

const VIEWS: Camera[] = [
  HOME,
  { ...HOME, yaw: 0.6 },
  { ...HOME, yaw: -1.9, pitch: 0.9 },
  { ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 },
  { ...HOME, yaw: Math.PI, zoom: 0.6, panX: 40, panY: -25 },
  { ...HOME, yaw: 4.1, pitch: 1.4, zoom: 3, panX: -120, panY: 60 },
];
// The engine has more stars at night than the prototype, so only hours when the
// prototype has the sun up are compared.
const HOURS = ['05:40:07', '06:40:00', '08:20:15', '12:05:30', '17:45:11', '18:40:02'];

describe.skipIf(prototypeMissing)('the engine against the prototype', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('localStorage', storage);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(HOURS)('draws the same empty office at %s', (time) => {
    vi.setSystemTime(new Date(`2026-10-09T${time}`));
    const old = loadPrototype();
    const scene = makeScene(fakeCanvas() as unknown as HTMLCanvasElement, {} as HTMLElement);
    borrowLight(scene, old);
    expect(scene.light.now.sun).not.toBe('night');
    for (const view of VIEWS) {
      Object.assign(old.camera, view);
      old.look();
      Object.assign(scene.camera, view);
      scene.view = aim(scene.camera);
      const lamps = lampPixels(scene);
      draw(scene);
      expect(differing(scene.office.rgb, old.office.rgb, lamps), 'office colours').toBe(0);
      expect(differing(scene.office.depth, old.office.depth, lamps), 'office depths').toBe(0);
      expect(differing(scene.live.rgb, old.live.rgb, lamps), 'frame colours').toBe(0);
      expect(differing(lamps, new Uint8Array(lamps.length)), 'pixels left out').toBeLessThan(6000);
      expect(scene.live.rgb.some((pixel) => pixel !== 0), 'something was drawn').toBe(true);
    }
  });

  it('blocks the same floor cells and plans the same walks', () => {
    const old = loadPrototype();
    old.look();
    const { floor } = makeScene(fakeCanvas() as unknown as HTMLCanvasElement, {} as HTMLElement);
    expect([...floor.blocked]).toEqual([...old.blocked]);
    expect(floor.blocked.filter(Boolean).length).toBeGreaterThan(100);

    let seed = 7;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 140;
    let walks = 0;
    for (let i = 0; i < 400; i++) {
      const [ax, ay, bx, by] = [random(), random(), random(), random()];
      const path = floor.route(ax, ay, bx, by);
      expect(path).toEqual(JSON.parse(JSON.stringify(old.route(ax, ay, bx, by))));
      if (path.length) walks++;
      expect(floor.findSpot(ax, ay, bx, by)).toEqual(JSON.parse(JSON.stringify(old.findSpot(ax, ay, bx, by))));
    }
    expect(walks).toBeGreaterThan(200);
    expect([...floor.taken].sort()).toEqual([...old.taken].sort());
  });
});
