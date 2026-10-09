// Runs the same sessions through the prototype's page script and the engine, frame
// by frame, and checks that everybody is in the same place doing the same thing and
// that both draw the same picture. Skipped when ../agent-office is absent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, HOME } from '../src/engine/camera';
import { draw } from '../src/engine/draw';
import { buildOffice } from '../src/engine/office';
import { makeScene, type SessionView } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { borrowLight, differing, fakeCanvas, fakeElement, knownDifferences, loadPrototype, motionPreference, prototypeMissing, storage } from './prototype';

const START = new Date('2026-10-09T12:05:30').getTime();
const FRAME_MS = 180;

// a session as the Rust side sends it; the prototype's labels read the extra fields
const session = (id: string, rest: Partial<SessionView> = {}) => ({
  id,
  pid: 1,
  name: `repo-${id}`,
  cwd: `/home/sam/${id}`,
  background: false,
  status: 'busy' as const,
  waitingFor: null,
  activity: null,
  startedAt: START,
  statusSince: START,
  memMb: null,
  agents: [] as { id: string; type: string; desc: string }[],
  agentsSpawned: 0,
  supervisor: null,
  ...rest,
});
const agents = (...ids: string[]) => ids.map((id) => ({ id, type: 'agent', desc: '' }));
const busy = { status: 'busy' };
const idle = { status: 'idle' };

// Everything about the people that the two sides should agree on. Desks come from
// either side, so only what both keep is read.
function people(desks: Map<string, any>, taken: Set<number>, doorOpen: number) {
  return JSON.stringify({
    doorOpen,
    taken: [...taken].sort((a, b) => a - b),
    desks: [...desks].map(([id, d]) => ({
      id,
      seat: d.seat,
      tint: d.tint,
      play: d.play,
      outside: d.outside,
      at: d.at,
      path: d.path,
      facing: d.facing,
      tag: { hidden: d.tag.hidden, left: d.tag.style.left, top: d.tag.style.top, text: d.tag.textContent, status: d.tag.dataset.status },
      boss: d.boss && {
        at: d.boss.at,
        path: d.boss.path,
        facing: d.boss.facing,
        goal: d.boss.goal,
        turnTo: d.boss.turnTo,
        linger: d.boss.linger,
        trips: d.boss.trips,
        leaving: d.boss.leaving,
        home: d.boss.home && d.boss.home.cell,
      },
      helpers: [...d.helpers].map(([agent, h]: [string, any]) => ({
        agent,
        slot: h.slot,
        color: h.color,
        at: h.at,
        path: h.path,
        facing: h.facing,
        leaving: h.leaving,
        spot: h.spot && h.spot.cell,
      })),
    })),
  });
}

// The two offices side by side, fed and stepped together.
function pair(reduced: boolean) {
  vi.stubGlobal('matchMedia', motionPreference(reduced));
  const oldPainted: string[] = [];
  const newPainted: string[] = [];
  const old = loadPrototype({ reduced, painted: oldPainted });
  const scene = makeScene(fakeCanvas(newPainted) as unknown as HTMLCanvasElement, { append() {} } as unknown as HTMLElement);
  const sim = makeSim(scene);
  borrowLight(scene, old);
  let meant = new Uint8Array(0); // where the two empty rooms differ on purpose
  let frames = 0;
  // things the run should have shown at some point, so that agreeing is not agreeing on nothing
  const seen = { walking: false, playing: false, strolling: false, internLeaving: false, bossLeaving: false, doorOpen: false, noSeat: false };

  function compare(when: string) {
    expect(people(scene.desks, scene.floor.taken, scene.doorOpen), `people ${when}`).toBe(people(old.desks, old.taken, old.doorOpen()));
    expect(differing(scene.live.rgb, old.live.rgb, meant), `picture ${when}`).toBe(0);
    expect(newPainted, `marks ${when}`).toEqual(oldPainted);
    oldPainted.length = 0;
    newPainted.length = 0;
    for (const desk of scene.desks.values()) {
      if (desk.at && desk.path.length) seen.walking = true;
      if (desk.at && desk.play >= 0 && !desk.path.length) seen.playing = true;
      if (typeof desk.boss?.goal === 'number' && desk.boss.path.length) seen.strolling = true;
      if (desk.boss?.leaving) seen.bossLeaving = true;
      if ([...desk.helpers.values()].some((h) => h.leaving)) seen.internLeaving = true;
      if (desk.seat < 0) seen.noSeat = true;
    }
    if (scene.doorOpen) seen.doorOpen = true;
  }

  return {
    scene,
    seen,
    look(camera: Camera) {
      Object.assign(old.camera, camera);
      old.look();
      Object.assign(scene.camera, camera);
      scene.view = aim(scene.camera);
      buildOffice(scene);
      meant = knownDifferences(scene, old);
      sim.moveTags();
      draw(scene);
      compare(`after turning the view at frame ${frames}`);
    },
    apply(sessions: ReturnType<typeof session>[]) {
      old.apply({ home: '/home/sam', sessions });
      sim.apply(sessions);
      draw(scene);
      compare(`after the state given at frame ${frames}`);
    },
    run(count: number) {
      for (let i = 0; i < count; i++) {
        vi.setSystemTime(Date.now() + FRAME_MS);
        frames++;
        old.tick();
        scene.frame++;
        sim.tick();
        draw(scene);
        compare(`at frame ${frames}`);
      }
    },
  };
}

describe.skipIf(prototypeMissing)('the simulation against the prototype', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { createElement: () => fakeElement() });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('moves everybody the same way through a working day', () => {
    const office = pair(false);
    office.look(HOME);

    // four arrive: one working, one long idle, one waiting with staff, one headless
    office.apply([
      session('a'),
      session('b', { status: 'idle', statusSince: START - 60_000 }),
      session('c', { status: 'waiting', supervisor: busy, agents: agents('c1', 'c2') }),
      session('d', { background: true, supervisor: idle }),
    ]);
    office.run(70);

    // interns come and go, more than there is room for; supervisors start their rounds
    office.apply([
      session('a', { supervisor: idle, agents: agents('a1', 'a2', 'a3', 'a4', 'a5', 'a6') }),
      session('b', { status: 'idle', statusSince: START - 60_000 }),
      session('c', { status: 'waiting', supervisor: idle, agents: agents('c2') }),
      session('d', { background: true, supervisor: idle }),
    ]);
    office.run(120);

    // back to work from the games, an observer lost, a session ended, a new one in
    const later = (c: Partial<SessionView>, e: Partial<SessionView>) => [
      session('a', { supervisor: busy }),
      session('b'),
      session('c', { status: 'waiting', ...c }),
      session('e', { status: 'idle', statusSince: Date.now(), ...e }),
    ];
    const since = Date.now();
    office.apply(later({}, { statusSince: since }));
    office.run(60);

    // long enough for the lost supervisor to be given up on, and for the new one to get bored
    vi.setSystemTime(Date.now() + 100_000);
    office.apply(later({}, { statusSince: since }));
    office.run(5);
    // both change their minds part of the way there
    office.apply(later({ supervisor: busy }, { status: 'busy' }));
    office.run(60);

    office.look({ ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 });
    office.run(10);

    // more sessions than chairs, and more idlers than games
    const crowd = Array.from({ length: 9 }, (_, i) => session(`crowd-${i}`, { status: 'idle', statusSince: START }));
    office.apply([...later({ supervisor: busy }, { status: 'busy' }), ...crowd]);
    office.run(150);

    office.apply([]);
    office.run(10);
    expect(office.scene.desks.size).toBe(0);
    expect(office.scene.floor.taken.size).toBe(0);
    expect(office.seen).toEqual({ walking: true, playing: true, strolling: true, internLeaving: true, bossLeaving: true, doorOpen: true, noSeat: true });
  });

  it('puts everybody straight where they belong when motion is reduced', () => {
    const office = pair(true);
    office.look(HOME);
    office.apply([
      session('a', { supervisor: idle, agents: agents('a1', 'a2') }),
      session('b', { status: 'idle', statusSince: START - 60_000 }),
      session('c', { status: 'waiting', supervisor: busy }),
    ]);
    office.run(40);
    expect(office.seen.walking).toBe(false);
    expect(office.seen.playing).toBe(true);

    office.apply([session('a', { supervisor: busy, agents: agents('a2') }), session('b'), session('c', { status: 'waiting' })]);
    office.run(10);
    vi.setSystemTime(Date.now() + 100_000);
    office.apply([session('a', { supervisor: busy, agents: agents('a2') }), session('b'), session('c', { status: 'waiting' })]);
    office.run(10);
    expect(office.seen.walking).toBe(false);
  });
});
