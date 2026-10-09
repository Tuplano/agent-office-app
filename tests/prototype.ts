// Runs the prototype's page script, so the engine can be checked against it. The
// prototype keeps everything in script-level variables, so the script is run
// whole, in a page made of stand-ins, and hands back the ones we compare.
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import type { Scene } from '../src/engine/scene';

const PAGE = new URL('../../agent-office/public/index.html', import.meta.url);
export const prototypeMissing = !existsSync(PAGE);

// `painted` collects what is filled in over the picture: the marks above people's heads
export const fakeCanvas = (painted: string[] = []) => ({
  width: 0,
  height: 0,
  getContext: () => ({
    createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    fillStyle: '',
    fillRect(x: number, y: number, w: number, h: number) {
      painted.push(`${this.fillStyle} ${x} ${y} ${w} ${h}`);
    },
  }),
  addEventListener() {},
});
export const fakeElement = (painted?: string[]) => ({
  ...fakeCanvas(painted),
  classList: { add() {}, remove() {} },
  style: { setProperty() {} },
  dataset: {},
  append() {},
  remove() {},
  replaceChildren() {},
  textContent: '',
});
export const storage = { getItem: () => null, setItem() {} };
export const motionPreference = (reduced: boolean) => (query: string) => ({
  matches: reduced && query.includes('reduced-motion'),
  addEventListener() {},
});

export function loadPrototype({ reduced = false, painted = [] as string[] } = {}) {
  const html = readFileSync(PAGE, 'utf8');
  const script = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
  const page = {
    document: {
      getElementById: () => fakeElement(painted),
      createElement: () => fakeElement(),
      documentElement: { dataset: {} },
      body: {},
      title: '',
    },
    matchMedia: motionPreference(reduced),
    localStorage: storage,
    EventSource: class {},
    requestAnimationFrame() {},
    setInterval(run: () => void, ms: number) {
      if (ms === 180) page.out.tick = run; // the frame loop, stepped by hand
    },
    addEventListener() {},
    Date,
    out: {} as any,
  };
  runInNewContext(
    `${script}
    out.camera = camera; out.office = office; out.live = live; out.blocked = blocked; out.taken = taken;
    out.route = route; out.findSpot = findSpot;
    out.look = () => { stale = true; render(); };
    out.apply = apply; out.desks = desks; out.doorOpen = () => doorOpen; out.light = () => light;`,
    page,
  );
  return page.out;
}

// The engine keeps its own hours for dawn and dusk, so for a comparison it is given
// the prototype's light. Call this before the scene has drawn anything.
export function borrowLight(scene: Scene, old: { light(): unknown }) {
  scene.light.now = { ...JSON.parse(JSON.stringify(old.light())), lamps: true };
}

// The engine's office has grown apart from the prototype's on purpose: each window
// has its own view, the lamps throw more light, the cat is no longer part of the
// furniture. Marks the pixels where the two empty rooms differ, so that a comparison
// of what goes on in them can leave those out.
export function knownDifferences(scene: Scene, old: { office: { rgb: ArrayLike<number> } }): Uint8Array {
  return Uint8Array.from(scene.office.rgb, (pixel, i) => (pixel === old.office.rgb[i] ? 0 : 1));
}

// how many pixels differ, leaving out the ones marked in `skip`
export function differing(a: ArrayLike<number>, b: ArrayLike<number>, skip?: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !skip?.[i]) count++;
  return count;
}
