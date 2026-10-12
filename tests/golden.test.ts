// Pictures of the default room, recorded once and held to ever since: the empty
// office from every side at several hours, the same office full of people, and a
// morning of arrivals. They are kept as short digests, so a change shows up as a
// changed digest and nothing more; it is the parity tests that say what changed.
//
// Nothing here depends on the order the room numbers its games or its hangouts in:
// everyone is at work or on the way to it. Record again with `vitest -u` only when
// the default room is meant to look different.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, HOME } from '../src/engine/camera';
import { draw } from '../src/engine/draw';
import { buildOffice } from '../src/engine/office';
import { makeScene, type Scene, type SessionView } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { fakeCanvas, fakeElement, motionPreference, storage } from './stand-ins';

const VIEWS: Camera[] = [
  HOME,
  { ...HOME, yaw: 0.6 },
  { ...HOME, yaw: -1.9, pitch: 0.9 },
  { ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 },
  { ...HOME, yaw: Math.PI, zoom: 0.6, panX: 40, panY: -25 },
  { ...HOME, yaw: 4.1, pitch: 1.4, zoom: 3, panX: -120, panY: 60 },
];
// before dawn with the lamps on, midday, the orange afternoon, dusk under the lamps, night
const HOURS = ['06:00:00', '12:05:30', '16:30:00', '18:00:00', '22:30:00'];
const FRAME_MS = 180;

// a picture boiled down to eight characters
function digest(pixels: Uint32Array, from = 0x811c9dc5): string {
  let h = from;
  for (let i = 0; i < pixels.length; i++) {
    h ^= pixels[i];
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 15;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

const session = (id: string, rest: Partial<SessionView> = {}): SessionView => ({
  id,
  name: `repo-${id}`,
  status: 'busy',
  statusSince: Date.now(),
  background: false,
  supervisor: null,
  agents: [],
  ...rest,
});
const agents = (...ids: string[]) => ids.map((id) => ({ id }));
const busy = { status: 'busy' };
// ten of them: every chair and both bar stools, in every state there is to draw at a desk
const staff = (): SessionView[] => [
  session('a', { supervisor: busy, agents: agents('a1', 'a2', 'a3') }),
  session('b', { status: 'waiting' }),
  session('c', { status: 'idle' }), // asleep at the desk, not yet bored enough to play
  session('d', { background: true, supervisor: busy }),
  session('e', { background: true, status: 'waiting', agents: agents('e1') }),
  ...['f', 'g', 'h', 'i', 'j'].map((id) => session(id)),
];

function officeAt(time: string): Scene {
  vi.setSystemTime(new Date(`2026-10-09T${time}`));
  return makeScene(fakeCanvas() as unknown as HTMLCanvasElement, { append() {} } as unknown as HTMLElement);
}
function look(scene: Scene, camera: Camera) {
  Object.assign(scene.camera, camera);
  scene.view = aim(scene.camera);
  buildOffice(scene);
}

describe('the default room', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { createElement: () => fakeElement() });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each(HOURS)('is drawn as it always was when empty, at %s', (time) => {
    const scene = officeAt(time);
    const pictures = VIEWS.map((view) => {
      look(scene, view);
      draw(scene);
      return `${digest(scene.office.rgb)} ${digest(scene.live.rgb)}`;
    });
    expect(pictures).toMatchSnapshot();
  });

  it.each(['12:05:30', '18:00:00'])('is drawn as it always was with everyone in, at %s', (time) => {
    const scene = officeAt(time);
    const sim = makeSim(scene);
    sim.apply(staff());
    const pictures = VIEWS.map((view) => {
      look(scene, view);
      // a few frames, for the hands on the keys and the lights that blink
      return Array.from({ length: 4 }, () => {
        scene.frame++;
        sim.tick();
        draw(scene);
        return digest(scene.live.rgb);
      }).join(' ');
    });
    expect(pictures).toMatchSnapshot();
  });

  it('is drawn as it always was while everyone arrives', () => {
    const scene = officeAt('12:05:30');
    const sim = makeSim(scene);
    look(scene, HOME);
    sim.apply([]);
    sim.apply(staff());
    let walked = false;
    const pictures: string[] = [];
    for (let frame = 1; frame <= 120; frame++) {
      vi.setSystemTime(Date.now() + FRAME_MS);
      scene.frame++;
      sim.tick();
      draw(scene);
      if ([...scene.desks.values()].some((desk) => desk.at && desk.path.length)) walked = true;
      if (frame % 6 === 0) pictures.push(digest(scene.live.rgb));
    }
    expect(walked).toBe(true);
    expect([...scene.desks.values()].every((desk) => !desk.outside && !desk.at)).toBe(true); // all sat down by the end
    expect(pictures).toMatchSnapshot();
  });
});
