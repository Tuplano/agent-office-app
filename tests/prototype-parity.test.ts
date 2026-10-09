// Runs the prototype's page script beside the engine and checks that both draw
// the same pixels and plan the same walks. Skipped when ../agent-office is absent.
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, HOME } from '../src/engine/camera';
import { draw } from '../src/engine/draw';
import { buildOffice } from '../src/engine/office';
import { makeScene } from '../src/engine/scene';

const PAGE = new URL('../../agent-office/public/index.html', import.meta.url);

const fakeCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillRect() {},
  }),
  addEventListener() {},
});
const storage = { getItem: () => null, setItem() {} };
const noMotionPreference = () => ({ matches: false, addEventListener() {} });

// The prototype keeps everything in script-level variables, so the script is run
// whole, in a page made of stand-ins, and hands back the ones we compare.
function loadPrototype() {
  const html = readFileSync(PAGE, 'utf8');
  const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const element = () => ({ ...fakeCanvas(), classList: { add() {}, remove() {} }, style: {}, dataset: {}, append() {}, textContent: '' });
  const page = {
    document: { getElementById: element, documentElement: { dataset: {} }, body: {}, title: '' },
    matchMedia: noMotionPreference,
    localStorage: storage,
    EventSource: class {},
    requestAnimationFrame() {},
    setInterval() {},
    addEventListener() {},
    Date,
    out: {} as any,
  };
  runInNewContext(
    `${script}
    out.camera = camera; out.office = office; out.live = live; out.blocked = blocked; out.taken = taken;
    out.route = route; out.findSpot = findSpot;
    out.look = () => { stale = true; render(); };`,
    page,
  );
  return page.out;
}

const VIEWS: Camera[] = [
  HOME,
  { ...HOME, yaw: 0.6 },
  { ...HOME, yaw: -1.9, pitch: 0.9 },
  { ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 },
  { ...HOME, yaw: Math.PI, zoom: 0.6, panX: 40, panY: -25 },
  { ...HOME, yaw: 4.1, pitch: 1.4, zoom: 3, panX: -120, panY: 60 },
];
const HOURS = ['03:10:07', '06:40:00', '12:05:30', '17:45:11', '19:50:02', '23:59:59'];

describe.skipIf(!existsSync(PAGE))('the engine against the prototype', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', noMotionPreference);
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
    for (const view of VIEWS) {
      Object.assign(old.camera, view);
      old.look();
      Object.assign(scene.camera, view);
      scene.view = aim(scene.camera);
      buildOffice(scene);
      draw(scene);
      const differing = (a: ArrayLike<number>, b: ArrayLike<number>) => Array.prototype.filter.call(a, (v: number, i: number) => v !== b[i]).length;
      expect(differing(scene.office.rgb, old.office.rgb), 'office colours').toBe(0);
      expect(differing(scene.office.depth, old.office.depth), 'office depths').toBe(0);
      expect(differing(scene.live.rgb, old.live.rgb), 'frame colours').toBe(0);
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
