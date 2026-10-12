// Feeds the simulation sequences of sessions and checks what the people do about
// them. Every frame of every run is held to the same rules: after the first load
// nobody appears or vanishes anywhere but at the door, nobody jumps, and every spot
// and seat someone holds is held by one person only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BOSS_GRACE_MS, CELL } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import { laptopOf, placeOf, poseOf } from '../src/engine/figures';
import { layoutOf } from '../src/engine/layout';
import { buildOffice } from '../src/engine/office';
import { METAL } from '../src/engine/palette';
import { DEFAULT_ROOM, type Piece, type Room } from '../src/engine/room';
import { makeScene, type Desk, type SessionView } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { problemsOf } from '../src/engine/valid';
import { fakeCanvas, motionPreference, storage } from './stand-ins';

const START = new Date('2026-10-09T12:05:30').getTime();
const FRAME_MS = 180;
const WALKING_SPEED = 4;
const { door: DOOR, play: PLAY, seats: SEATS } = layoutOf(DEFAULT_ROOM);

const session = (id: string, rest: Partial<SessionView> = {}): SessionView => ({
  id,
  name: `repo-${id}`,
  status: 'busy',
  statusSince: START,
  background: false,
  supervisor: null,
  agents: [],
  ...rest,
});
const agents = (...ids: string[]) => ids.map((id) => ({ id }));
const idle = { status: 'idle' };
const busy = { status: 'busy' };
const longIdle = (id: string, rest: Partial<SessionView> = {}) => session(id, { status: 'idle', statusSince: START - 60_000, ...rest });

// a name tag that remembers what was done to it
function fakeTag() {
  const classes = new Set<string>();
  const tag = {
    className: '',
    dataset: {} as Record<string, string>,
    hidden: false,
    href: '',
    textContent: '',
    removed: false,
    style: { left: '', top: '', setProperty() {} },
    classList: {
      add: (name: string) => classes.add(name),
      remove: (name: string) => classes.delete(name),
      toggle: (name: string, on: boolean) => (on ? classes.add(name) : classes.delete(name)),
      contains: (name: string) => classes.has(name),
    },
    removeAttribute(name: string) {
      if (name === 'href') tag.href = '';
    },
    remove() {
      tag.removed = true;
    },
  };
  return tag;
}

const near = (p: { x: number; y: number }, to: { x: number; y: number }, within: number) => Math.abs(p.x - to.x) + Math.abs(p.y - to.y) <= within;

// every figure in the room, by who it is, and where it stands
function figures(desks: Map<string, Desk>) {
  const out = new Map<string, { x: number; y: number }>();
  for (const [id, desk] of desks) {
    if (placeOf(desk) && !desk.outside) out.set(id, poseOf(desk));
    if (desk.boss?.at) out.set(`${id} supervisor`, { ...desk.boss.at });
    for (const [agent, h] of desk.helpers) if (h.at) out.set(`${id} ${agent}`, { ...h.at });
  }
  return out;
}

// An office with its sim, stepped by hand.
function office(reduced = false, room?: Room) {
  vi.stubGlobal('matchMedia', motionPreference(reduced));
  const scene = makeScene(fakeCanvas() as unknown as HTMLCanvasElement, { append() {} } as unknown as HTMLElement, room);
  const sim = makeSim(scene);
  const { desks } = scene;
  let before = new Map<string, { x: number; y: number }>();
  let watching = false; // the first load has been given
  let doorOpened = false;

  // the rules every frame is held to
  function check(when: string) {
    const now = figures(desks);
    const { door } = scene.layout;
    if (watching) {
      for (const [who, at] of now) {
        const was = before.get(who);
        if (!was) expect(near(at, door, WALKING_SPEED), `${who} appeared away from the door ${when}`).toBe(true);
        else expect(near(at, was, WALKING_SPEED), `${who} jumped from ${was.x},${was.y} to ${at.x},${at.y} ${when}`).toBe(true);
      }
      for (const [who, at] of before) {
        if (!now.has(who)) expect(near(at, door, WALKING_SPEED), `${who} vanished at ${at.x},${at.y} ${when}`).toBe(true);
      }
    }
    before = now;

    // nobody is outside the walls, and nobody stands in the furniture
    const { w, d } = scene.room.size;
    for (const [who, at] of now) expect(at.x >= 0 && at.y >= 0 && at.x <= w && at.y <= d, `${who} is outside the walls at ${at.x},${at.y} ${when}`).toBe(true);
    for (const [id, desk] of desks) {
      for (const who of [desk.boss, ...desk.helpers.values()]) {
        if (!who?.at || who.path.length) continue;
        expect(scene.floor.free(Math.floor(who.at.x / CELL), Math.floor(who.at.y / CELL)), `someone of ${id} stands in the furniture at ${who.at.x},${who.at.y} ${when}`).toBe(true);
      }
    }

    // nobody has a chair, a game or a floor cell that someone else has
    const held: string[] = [];
    const cells: number[] = [];
    for (const desk of desks.values()) {
      if (desk.seat >= 0) held.push(`chair ${desk.seat}`);
      if (desk.play >= 0) held.push(`play ${desk.play}`);
      if (desk.spare && desk.spare.lounge >= 0) held.push(`play ${desk.spare.lounge}`);
      if (desk.spare?.spot) cells.push(desk.spare.spot.cell);
      if (desk.boss?.home) cells.push(desk.boss.home.cell);
      for (const h of desk.helpers.values()) if (h.spot) cells.push(h.spot.cell);
    }
    expect(new Set(held).size, `${held.join(', ')} ${when}`).toBe(held.length);
    // and every cell held is marked taken, and nothing else is
    expect([...scene.floor.taken].sort((a, b) => a - b), `floor ${when}`).toEqual([...cells].sort((a, b) => a - b));
    if (reduced) {
      for (const [id, desk] of desks) {
        const walking = [desk.path, desk.boss?.path ?? [], ...[...desk.helpers.values()].map((h) => h.path)].filter((path) => path.length);
        expect(walking, `${id} has somewhere to walk ${when}`).toEqual([]);
      }
    }
  }

  const office = {
    scene,
    desks,
    get doorOpened() {
      return doorOpened;
    },
    apply(sessions: SessionView[]) {
      sim.apply(sessions);
      draw(scene);
      check('after the state given');
      watching = !reduced; // the first load is the one time they appear in place

      if (scene.doorOpen) doorOpened = true;
    },
    run(count: number) {
      for (let i = 0; i < count; i++) {
        vi.setSystemTime(Date.now() + FRAME_MS);
        scene.frame++;
        sim.tick();
        draw(scene);
        check(`at frame ${scene.frame}`);
        if (scene.doorOpen) doorOpened = true;
      }
    },
    // swaps the room; like the first load, it is a time when people turn up in place
    setRoom(next: Room) {
      sim.setRoom(next);
      buildOffice(scene);
      draw(scene);
      watching = false;
      check('after the room changed');
      watching = !reduced;
    },
    // runs until something is so
    until(done: () => boolean, what: string, most = 500) {
      for (let i = 0; i < most && !done(); i++) office.run(1);
      expect(done(), `never ${what}`).toBe(true);
    },
    desk(id: string): Desk {
      return desks.get(id)!;
    },
    seated: (id: string) => !!desks.get(id) && !desks.get(id)!.outside && !desks.get(id)!.at && !desks.get(id)!.gone,
    // everybody ends, and runs out
    close() {
      office.apply([]);
      office.until(() => desks.size === 0, 'closed');
      expect(scene.floor.taken.size).toBe(0);
    },
  };
  return office;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { createElement: fakeTag });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('the first load', () => {
  it('puts everyone in place at once, with the door shut', () => {
    const o = office();
    const first = [session('a', { supervisor: busy, agents: agents('a1', 'a2') }), longIdle('b'), session('c', { background: true })];
    o.apply(first);

    for (const desk of o.desks.values()) {
      expect(desk.outside).toBe(false);
      expect((desk.tag as unknown as { hidden: boolean }).hidden).toBe(false);
      expect(desk.path).toEqual([]);
    }
    const a = o.desk('a');
    expect(a.at).toBeNull();
    expect(a.boss!.at).toEqual({ x: a.boss!.home!.x, y: a.boss!.home!.y });
    expect([...a.helpers.values()].map((h) => h.at)).toEqual([...a.helpers.values()].map((h) => ({ x: h.spot!.x, y: h.spot!.y })));
    const b = o.desk('b');
    expect(b.play).toBeGreaterThanOrEqual(0);
    expect(b.at).toEqual({ x: PLAY[b.play].x, y: PLAY[b.play].y });

    o.run(60);
    expect(o.doorOpened).toBe(false);
    expect(o.scene.doorOpen).toBe(0);
  });

  it('lets a later arrival in through the door', () => {
    const o = office();
    o.apply([session('a')]);
    o.apply([session('a'), session('d', { supervisor: idle, agents: agents('d1') })]);
    const d = o.desk('d');
    expect(d.outside).toBe(true);
    expect((d.tag as unknown as { hidden: boolean }).hidden).toBe(true);
    o.until(() => !d.outside, 'came in');
    expect(o.doorOpened).toBe(true);
    o.until(() => o.seated('d') && !!d.boss?.at && !d.boss.path.length && [...d.helpers.values()].every((h) => h.at && !h.path.length), 'sat down with their people');
    o.close();
  });
});

describe('a working day', () => {
  it('arrives, goes idle long enough to play, and comes back to work', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a')]);
    const a = o.desk('a');
    o.until(() => o.seated('a'), 'sat down');

    o.apply([session('a', { status: 'idle', statusSince: Date.now() - 31_000 })]);
    expect(a.play).toBeGreaterThanOrEqual(0);
    o.until(() => !!a.at && !a.path.length, 'reached the game');
    expect(a.at).toEqual({ x: PLAY[a.play].x, y: PLAY[a.play].y });
    o.run(20);

    o.apply([session('a', { statusSince: Date.now() })]);
    expect(a.play).toBe(-1);
    o.until(() => o.seated('a'), 'back at the chair');
    o.close();
  });

  it('keeps the same supervisor through a gap shorter than the grace period, and walks out the one gone longer', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { supervisor: idle })]);
    const a = o.desk('a');
    o.until(() => !!a.boss?.at && !a.boss.path.length, 'supervisor in');
    const boss = a.boss;

    o.apply([session('a')]); // the observer is gone
    vi.setSystemTime(Date.now() + BOSS_GRACE_MS / 2);
    o.apply([session('a', { supervisor: idle })]); // and another has taken over
    o.run(20);
    expect(a.boss).toBe(boss);
    expect(boss!.leaving).toBe(false);

    o.apply([session('a')]);
    vi.setSystemTime(Date.now() + BOSS_GRACE_MS + 1000);
    o.apply([session('a')]);
    expect(boss!.leaving).toBe(true);
    o.until(() => a.boss === null, 'supervisor out');
    expect(o.scene.floor.taken.size).toBe(0);
    o.close();
  });

  it('sends the supervisor back to the door and turns round one who is back in time', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { supervisor: idle })]);
    const a = o.desk('a');
    o.until(() => !!a.boss?.at && !a.boss.path.length, 'supervisor in');
    o.apply([session('a')]);
    vi.setSystemTime(Date.now() + BOSS_GRACE_MS + 1000);
    o.apply([session('a')]);
    o.run(3);
    const boss = a.boss!;
    expect(boss.leaving).toBe(true);
    o.apply([session('a', { supervisor: idle })]);
    expect(a.boss).toBe(boss);
    expect(boss.leaving).toBe(false);
    o.run(30);
    o.close();
  });

  it('has interns come and go', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { agents: agents('a1', 'a2', 'a3') })]);
    const a = o.desk('a');
    o.until(() => a.helpers.size === 3 && [...a.helpers.values()].every((h) => h.at && !h.path.length), 'interns in');

    o.apply([session('a', { agents: agents('a2', 'a3') })]);
    expect(a.helpers.get('a1')!.leaving).toBe(true);
    o.until(() => a.helpers.size === 2, 'intern out');

    // one more, and one that is called back on its way out
    o.apply([session('a', { agents: agents('a2') })]);
    o.run(2);
    const leaving = a.helpers.get('a3')!;
    expect(leaving.leaving).toBe(true);
    o.apply([session('a', { agents: agents('a2', 'a3', 'a4') })]);
    expect(a.helpers.get('a3')).toBe(leaving);
    expect(leaving.leaving).toBe(false);
    o.until(() => a.helpers.size === 3 && [...a.helpers.values()].every((h) => h.at && !h.path.length), 'interns settled');
    o.close();
  });

  it('has more idlers than games nap at their desks', () => {
    const o = office();
    o.apply([]);
    o.apply(Array.from({ length: 9 }, (_, i) => longIdle(`s${i}`)));
    o.run(300);
    const playing = [...o.desks.values()].filter((d) => d.play >= 0);
    expect(playing.length).toBe(PLAY.length);
    o.close();
  });
});

describe('a session that ends', () => {
  const ended = (o: ReturnType<typeof office>, id: string) => {
    const desk = o.desk(id);
    expect(desk.gone).toBe(true);
    expect(desk.tag.classList.contains('gone')).toBe(true);
    return desk;
  };

  it('walks out by the door when seated, with its supervisor and interns, and keeps its chair until then', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { supervisor: idle, agents: agents('a1', 'a2') }), session('b')]);
    o.until(() => o.seated('a') && o.seated('b') && !!o.desk('a').boss?.at && o.desk('a').helpers.size === 2, 'in');
    o.run(10);
    const chair = o.desk('a').seat;
    const tag = o.desk('a').tag as unknown as ReturnType<typeof fakeTag>;

    o.apply([session('b')]);
    const a = ended(o, 'a');
    expect(a.path.length).toBeGreaterThan(0);
    expect(tag.href).toBe('');
    expect(tag.hidden).toBe(false);
    expect(a.boss!.leaving).toBe(true);
    expect([...a.helpers.values()].every((h) => h.leaving)).toBe(true);

    // the chair is not given to a newcomer while they are on their way out
    o.apply([session('b'), session('c')]);
    expect(o.desk('c').seat).not.toBe(chair);
    o.until(() => !o.desks.has('a'), 'a gone');
    expect(tag.removed).toBe(true);
    expect(o.doorOpened).toBe(true);
    o.close();
  });

  it('gives up its game at once when it ends at a play spot', () => {
    const o = office();
    o.apply([]);
    o.apply([longIdle('a')]);
    const a = o.desk('a');
    o.until(() => a.play >= 0 && !!a.at && !a.path.length, 'at the game');
    o.apply([]);
    expect(a.gone).toBe(true);
    expect(a.play).toBe(-1);
    expect(a.path.length).toBeGreaterThan(0);
    o.close();
  });

  it('turns to the door from wherever it is when it ends mid-walk', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { agents: agents('a1') })]);
    const a = o.desk('a');
    o.until(() => !!a.at && a.path.length > 3 && !a.outside, 'walking');
    o.run(3);
    const where = { ...a.at! };
    o.apply([]);
    expect(a.at).toEqual(where);
    expect(a.path[a.path.length - 1]).toEqual({ x: DOOR.x, y: DOOR.y });
    o.close();
  });

  it('is simply dropped when it ends before its worker has come in', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a'), session('b', { supervisor: idle, agents: agents('b1', 'b2') })]);
    const b = o.desk('b');
    expect(b.outside).toBe(true);
    o.apply([session('a')]);
    expect(o.desks.has('b')).toBe(false);
    expect((b.tag as unknown as ReturnType<typeof fakeTag>).removed).toBe(true);
    expect(o.scene.floor.taken.size).toBe(0);
    o.run(60);
    o.close();
  });

  it('turns round and goes back to its place when the session comes back while walking out', () => {
    const o = office();
    o.apply([]);
    const back = () => session('a', { supervisor: idle, agents: agents('a1') });
    o.apply([back()]);
    const a = o.desk('a');
    const tag = a.tag as unknown as ReturnType<typeof fakeTag>;
    o.until(() => o.seated('a') && !!a.boss?.at && !a.boss.path.length && a.helpers.get('a1')!.at !== null && !a.helpers.get('a1')!.path.length, 'in');
    const boss = a.boss;
    const intern = a.helpers.get('a1');

    o.apply([]); // a session file caught half-written
    o.run(4);
    const where = { ...a.at! };
    o.apply([back()]);
    expect(o.desks.get('a')).toBe(a);
    expect(a.gone).toBe(false);
    expect(tag.classList.contains('gone')).toBe(false);
    expect(tag.href).toBe('#s-a');
    expect(a.at).toEqual(where);
    o.until(() => o.seated('a'), 'back in the chair');
    o.run(40);
    expect(a.boss).toBe(boss);
    expect(a.helpers.get('a1')).toBe(intern);
    expect(boss!.leaving).toBe(false);
    expect(intern!.leaving).toBe(false);
    expect(o.desks.size).toBe(1);
    o.close();
  });

  it('comes in again by the door when it comes back after its worker is out', () => {
    const o = office();
    o.apply([]);
    const back = () => session('a', { supervisor: idle, agents: agents('a1', 'a2', 'a3', 'a4', 'a5') });
    o.apply([session('x'), back()]); // in the second chair, from where the worker is first to the door
    const a = o.desk('a');
    o.until(() => o.seated('a') && a.helpers.size === 5 && [...a.helpers.values()].every((h) => h.at && !h.path.length), 'in');
    o.apply([session('x')]);
    o.until(() => a.outside, 'worker out');
    expect(o.desks.has('a')).toBe(true); // the supervisor or an intern is still walking out
    o.apply([session('x'), back()]);
    expect(a.gone).toBe(false);
    o.until(() => o.seated('a'), 'back in');
    o.close();
  });

  it('does not show a speech bubble, a sleeping z or a lit laptop for someone leaving', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a', { status: 'waiting' })]);
    o.until(() => o.seated('a'), 'in');
    const marks: string[] = [];
    const canvas = fakeCanvas(marks);
    o.scene.ctx = canvas.getContext() as unknown as CanvasRenderingContext2D;
    draw(o.scene);
    expect(marks.length).toBeGreaterThan(0); // a bubble while they work
    marks.length = 0;
    o.apply([]);
    draw(o.scene);
    expect(marks).toEqual([]);
    o.close();
  });
});

describe('more sessions than chairs', () => {
  const crowd = (count: number, rest: (i: number) => Partial<SessionView> = () => ({})) =>
    Array.from({ length: count }, (_, i) => session(`s${i}`, rest(i)));
  const settled = (o: ReturnType<typeof office>, ids: string[]) =>
    ids.every((id) => o.seated(id) && (o.desk(id).boss ? !o.desk(id).boss!.path.length : true));

  it('gives the extras a place to sit, and moves them to a chair when one frees', () => {
    const o = office();
    o.apply([]);
    const all = crowd(16, (i) => (i === 10 ? { supervisor: idle, agents: agents('i1') } : {}));
    o.apply(all);
    o.until(() => all.every((s) => o.seated(s.id)), 'all seated');

    const extra = [...o.desks.values()].filter((d) => d.seat < 0);
    expect(extra.map((d) => d.data.id)).toEqual(['s10', 's11', 's12', 's13', 's14', 's15']);
    const lounge = extra.filter((d) => d.spare!.lounge >= 0);
    expect(lounge.length).toBe(4);
    for (const d of lounge) expect(PLAY[d.spare!.lounge].z).toBeDefined();
    expect(extra.filter((d) => d.spare!.spot).length).toBe(2);
    for (const d of extra) {
      expect((d.tag as unknown as ReturnType<typeof fakeTag>).hidden).toBe(false);
      expect(placeOf(d)).not.toBeNull();
    }
    // their supervisor and intern gather round their place
    const s10 = o.desk('s10');
    expect(near(s10.boss!.at!, s10.spare!, 30)).toBe(true);

    // the oldest chair goes, and the one who has waited longest takes it
    o.apply(all.filter((s) => s.id !== 's0'));
    const chair = o.desk('s0').seat;
    expect(o.desk('s10').seat).toBe(-1); // it is still reserved
    o.until(() => !o.desks.has('s0'), 's0 out');
    const moved = o.desk('s10');
    expect(moved.seat).toBe(chair);
    expect(moved.spare).toBeNull();
    expect(o.desk('s11').seat).toBe(-1);
    o.until(() => settled(o, ['s10']) && [...moved.helpers.values()].every((h) => h.at && !h.path.length), 'moved to the chair');
    expect(near(moved.boss!.home!, SEATS[chair], 30)).toBe(true);
    expect(moved.boss!.at).toEqual({ x: moved.boss!.home!.x, y: moved.boss!.home!.y });
    o.close();
  });

  it('never double-books a lounge seat, even with idlers wanting to play', () => {
    const o = office();
    o.apply([]);
    const all = crowd(14, (i) => (i < 10 ? { status: 'idle' as const, statusSince: START - 60_000 } : {}));
    o.apply(all);
    o.run(400); // the booking check runs on every frame
    const lounge = [...o.desks.values()].filter((d) => d.spare && d.spare.lounge >= 0).map((d) => d.spare!.lounge);
    expect(lounge.length).toBe(4);
    for (const d of o.desks.values()) if (d.seat >= 0 && d.play >= 0) expect(PLAY[d.play].z).toBeUndefined();
    o.close();
  });

  it('lets those without a chair end, arrive and leave by the door like anyone', () => {
    const o = office();
    o.apply([]);
    o.apply(crowd(12));
    o.until(() => o.seated('s11'), 'in');
    const s11 = o.desk('s11');
    o.apply(crowd(11));
    expect(s11.gone).toBe(true);
    expect(s11.path.length).toBeGreaterThan(0);
    o.until(() => !o.desks.has('s11'), 'out');
    o.close();
  });

  it('falls back to a card and no figure when there is nowhere at all', () => {
    const o = office();
    o.apply([]);
    const all = crowd(400);
    o.apply(all);
    o.run(30);
    const nowhere = [...o.desks.values()].filter((d) => !placeOf(d));
    expect(nowhere.length).toBeGreaterThan(0);
    for (const d of nowhere) expect((d.tag as unknown as ReturnType<typeof fakeTag>).hidden).toBe(true);
    o.apply([]);
    o.until(() => o.desks.size === 0, 'closed', 1500);
    expect(o.scene.floor.taken.size).toBe(0);
  }, 30_000);
});

describe('laptops', () => {
  // how much of the picture is the top of a laptop: nothing else in these rooms is bare metal
  const metal = (o: ReturnType<typeof office>) => {
    const top = o.scene.light.tone(METAL, 0.2);
    return o.scene.live.rgb.filter((pixel) => pixel === top).length;
  };

  it('are brought in under the arm and set down on a desk that was bare', () => {
    const o = office();
    buildOffice(o.scene);
    o.apply([]);
    expect(metal(o)).toBe(0);

    o.apply([session('a')]);
    const a = o.desk('a');
    expect(laptopOf(a)).toBeNull(); // still outside
    o.until(() => !a.outside, 'came in');
    expect(laptopOf(a)).toBe('arm');
    o.run(3);
    expect(metal(o)).toBeGreaterThan(0);
    o.until(() => o.seated('a'), 'sat down');
    expect(laptopOf(a)).toBe('desk');
    expect(metal(o)).toBeGreaterThan(0);

    o.close();
    draw(o.scene);
    expect(metal(o)).toBe(0);
  });

  it('stay on the desk during a game and leave with their owner', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a')]);
    const a = o.desk('a');
    o.until(() => o.seated('a'), 'sat down');
    o.apply([longIdle('a')]);
    expect(laptopOf(a)).toBe('desk');
    o.until(() => !!a.at && !a.path.length, 'reached the game');
    expect(laptopOf(a)).toBe('desk');
    o.apply([session('a', { statusSince: Date.now() })]);
    expect(a.path.length).toBeGreaterThan(0);
    expect(laptopOf(a)).toBe('desk'); // walking back to it
    o.until(() => o.seated('a'), 'back at the chair');

    o.apply([]);
    expect(laptopOf(a)).toBe('arm');
    o.apply([session('a')]); // back before reaching the door: it goes back to the desk with them
    expect(laptopOf(a)).toBe('arm');
    o.until(() => o.seated('a'), 'sat down again');
    expect(laptopOf(a)).toBe('desk');
    o.apply([]);
    o.until(() => a.outside, 'out');
    expect(laptopOf(a)).toBeNull();
  });

  it('are already on the desks of those in place at the first load', () => {
    const o = office();
    o.apply([session('a'), longIdle('b')]);
    expect(o.desk('b').at).not.toBeNull(); // at a game
    expect([...o.desks.values()].map(laptopOf)).toEqual(['desk', 'desk']);
  });

  it('stay out of sight while their owner goes to play straight from the door', () => {
    const o = office();
    o.apply([]);
    o.apply([longIdle('a')]);
    const a = o.desk('a');
    o.until(() => a.play >= 0 && !!a.at && !a.path.length, 'at the game');
    expect(laptopOf(a)).toBeNull();
    o.apply([session('a', { statusSince: Date.now() })]);
    expect(laptopOf(a)).toBe('arm');
    o.until(() => o.seated('a'), 'sat down');
    expect(laptopOf(a)).toBe('desk');
    o.close();
  });

  it('are only for those at the long tables, and come along to a chair there when one frees', () => {
    const o = office();
    o.apply([]);
    const all = Array.from({ length: 11 }, (_, i) => session(`s${i}`));
    o.apply(all);
    o.until(() => all.every((s) => o.seated(s.id)), 'all seated');
    expect(all.map((s) => laptopOf(o.desk(s.id)))).toEqual([...Array(8).fill('desk'), null, null, null]); // two on bar stools, one in the lounge

    o.apply(all.slice(1));
    o.until(() => !o.desks.has('s0'), 's0 out');
    const moved = o.desk('s10');
    expect(SEATS[moved.seat].kind).toBe('bench');
    expect(laptopOf(moved)).toBe('arm');
    o.until(() => o.seated('s10'), 'moved to the chair');
    expect(laptopOf(moved)).toBe('desk');
    o.close();
  });
});

describe('reduced motion', () => {
  it('puts people straight where they belong and removes them at once', () => {
    const o = office(true);
    o.apply([]);
    const all = Array.from({ length: 12 }, (_, i) => session(`s${i}`, i === 10 ? { supervisor: busy, agents: agents('i1') } : i === 3 ? { status: 'idle', statusSince: START - 60_000 } : {}));
    o.apply(all);
    expect(o.desk('s11').seat).toBe(-1);
    expect(placeOf(o.desk('s11'))).not.toBeNull();
    expect(o.desk('s10').boss!.at).toEqual({ x: o.desk('s10').boss!.home!.x, y: o.desk('s10').boss!.home!.y });
    o.run(40);
    expect(o.desk('s3').play).toBeGreaterThanOrEqual(0);

    // back to work, a supervisor given up on, an intern done
    vi.setSystemTime(Date.now() + BOSS_GRACE_MS + 1000);
    o.apply(all.map((s) => (s.id === 's3' ? session('s3') : s.id === 's10' ? { ...s, supervisor: null, agents: [] } : s)));
    o.run(10);
    expect(o.desk('s10').boss).toBeNull();
    expect(o.desk('s10').helpers.size).toBe(0);

    // a chair frees: the one waiting takes it on the spot
    const chair = o.desk('s0').seat;
    o.apply(all.filter((s) => s.id !== 's0'));
    expect(o.desks.has('s0')).toBe(false);
    expect(o.desk('s10').seat).toBe(chair);
    expect(o.desk('s10').at).toBeNull();

    o.apply([]);
    expect(o.desks.size).toBe(0);
    expect(o.scene.floor.taken.size).toBe(0);
    o.run(5);
    expect(o.doorOpened).toBe(false);
  });
});

describe('a room that changes under people', () => {
  const door: Piece = { kind: 'door', wall: 'N', a: 81.5 };
  const table: Piece = { kind: 'table', x: 40, y: 50, turn: 0 };
  const rug: Piece = { kind: 'lounge-rug', x: 4, y: 90, turn: 0 };
  const sofa: Piece = { kind: 'sofa', x: 2, y: 94, turn: 0 };
  const beanBag: Piece = { kind: 'bean-bag', x: 38, y: 94, turn: 0 };
  const room = (...pieces: Piece[]): Room => ({ size: { w: 140, d: 140 }, pieces, cat: [] });
  const oneTable = room(door, table, rug, sofa);
  const still = (desk: Desk) => [desk.path, desk.boss?.path ?? [], ...[...desk.helpers.values()].map((h) => h.path)].every((path) => !path.length);

  it('hands out the chairs again in the order people arrived, and nobody walks', () => {
    const o = office();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    o.apply(ids.map((id) => session(id, id === 'a' ? { supervisor: busy, agents: agents('a1', 'a2') } : {})));
    o.run(5);

    o.setRoom(oneTable);
    expect(ids.map((id) => o.desk(id).seat)).toEqual([0, 1, 2, 3, -1, -1, -1]); // four chairs at the one table
    expect(['e', 'f'].map((id) => o.desk(id).spare!.lounge).sort()).toEqual([0, 1]); // the sofa
    expect(o.desk('g').spare).toMatchObject({ lounge: -1, z: 3 }); // a cushion by the rug
    for (const id of ids) {
      const desk = o.desk(id);
      expect(desk).toMatchObject({ at: null, outside: false, layout: o.scene.layout });
      expect(still(desk), `${id} is walking`).toBe(true);
      expect((desk.tag as unknown as { hidden: boolean }).hidden).toBe(false);
    }
    const a = o.desk('a');
    expect(a.boss!.at).toEqual({ x: a.boss!.home!.x, y: a.boss!.home!.y });
    expect([...a.helpers.values()].map((h) => h.at)).toEqual([...a.helpers.values()].map((h) => ({ x: h.spot!.x, y: h.spot!.y })));
    expect(near(a.boss!.home!, placeOf(a)!, 30)).toBe(true);
    o.run(30);
    expect(o.doorOpened).toBe(false);

    // and back: there is a chair for everyone again, in the same order
    o.setRoom(DEFAULT_ROOM);
    expect(ids.map((id) => o.desk(id).seat)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(ids.every((id) => o.desk(id).spare === null)).toBe(true);
    o.run(30);
    o.close();
  });

  it('takes a swap in the middle of a walk, a game and a goodbye', () => {
    const o = office();
    o.apply([]);
    o.apply([session('a'), longIdle('b'), session('c', { supervisor: idle, agents: agents('c1') })]);
    o.run(14);
    o.apply([session('a'), longIdle('b')]); // c is off home, with a supervisor and an intern behind
    o.run(3);
    expect(o.desk('c').gone).toBe(true);
    expect([...o.desks.values()].filter((desk) => !still(desk)).length).toBeGreaterThan(1);

    o.setRoom(oneTable);
    expect(o.desks.has('c')).toBe(false); // whoever was leaving has left
    expect([...o.desks.keys()]).toEqual(['a', 'b']);
    expect(o.desk('a')).toMatchObject({ seat: 0, at: null, path: [], outside: false });
    const b = o.desk('b');
    expect(b).toMatchObject({ seat: 1, path: [], outside: false });
    expect(b.at).toEqual({ x: o.scene.layout.play[b.play].x, y: o.scene.layout.play[b.play].y }); // already flopped on the sofa
    o.run(40);

    // called back to work, and on the way the room changes again
    o.apply([session('a'), session('b')]);
    o.run(2);
    expect(b.path.length).toBeGreaterThan(0);
    o.setRoom(DEFAULT_ROOM);
    expect(b).toMatchObject({ seat: 1, at: null, path: [], play: -1 });
    o.apply([session('a'), longIdle('b')]);
    o.run(3);
    expect(b.play).toBeGreaterThanOrEqual(0);
    expect(b.path.length).toBeGreaterThan(0); // off to a game
    o.setRoom(oneTable);
    expect(b.path).toEqual([]);
    expect(b.at).toEqual({ x: o.scene.layout.play[b.play].x, y: o.scene.layout.play[b.play].y });
    o.run(40);
    o.close();
  });

  it('makes do with a room with no desks, no lounge, or nothing in it', () => {
    const o = office();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const staff = ids.map((id) => session(id, id === 'e' ? { supervisor: busy, agents: agents('e1') } : {}));
    o.apply([]);
    o.apply(staff);
    o.until(() => ids.every(o.seated), 'all sat down');

    o.setRoom(room(door, rug, sofa, beanBag)); // no desks: three places to flop, then cushions
    expect(ids.map((id) => o.desk(id).seat)).toEqual([-1, -1, -1, -1, -1]);
    expect(ids.map((id) => o.desk(id).spare!.lounge >= 0)).toEqual([true, true, true, false, false]);
    expect(o.desk('e').boss!.at).not.toBeNull();
    o.run(20);

    o.setRoom(room(door, table)); // no lounge: four chairs, and nowhere at all for the fifth
    expect(ids.map((id) => o.desk(id).seat)).toEqual([0, 1, 2, 3, -1]);
    const e = o.desk('e');
    expect(placeOf(e)).toBeNull();
    expect((e.tag as unknown as { hidden: boolean }).hidden).toBe(true); // a card and no figure
    expect(e.boss!.at).toBeNull();
    o.run(20);

    o.setRoom(room(door)); // nothing
    expect(ids.every((id) => !placeOf(o.desk(id)))).toBe(true);
    expect(o.scene.floor.taken.size).toBe(0);
    o.apply([...staff, session('f')]); // someone still arrives, and someone still leaves
    o.run(20);
    o.apply(staff.slice(1));
    o.run(20);
    expect([...o.desks.keys()]).toEqual(['b', 'c', 'd', 'e']);
    expect(o.scene.doorOpen).toBe(0); // with nowhere to go, nobody came through the door

    o.setRoom(DEFAULT_ROOM); // and then a room again: the longest here sit first
    expect(['b', 'c', 'd', 'e'].map((id) => o.desk(id).seat)).toEqual([0, 1, 2, 3]);
    expect(e.boss!.at).not.toBeNull();
    expect([...e.helpers.values()].every((h) => h.at)).toBe(true);
    o.run(20);
    o.close();
  });

  it("brings later arrivals in by the new room's door", () => {
    const o = office();
    o.apply([session('a')]);
    const south = room({ kind: 'door', wall: 'S', a: 60 }, table);
    o.setRoom(south);
    expect(o.scene.layout.door).toEqual({ x: 64.5, y: 138 });
    o.apply([session('a'), session('b', { supervisor: busy })]);
    const b = o.desk('b');
    expect(b.outside).toBe(true);
    o.until(() => !b.outside, 'came in');
    expect(near(b.at!, o.scene.layout.door, WALKING_SPEED)).toBe(true);
    o.until(() => o.seated('b') && !!b.boss?.at && !b.boss.path.length, 'settled');
    expect(o.doorOpened).toBe(true);
    o.close();
  });

  it('starts in whatever room it is given, and stays put when motion is reduced', () => {
    const o = office(true, oneTable);
    o.apply([session('a'), longIdle('b', { supervisor: idle })]);
    expect(o.desk('a').seat).toBe(0);
    o.run(10);
    o.setRoom(DEFAULT_ROOM);
    o.run(10);
    o.setRoom(room(door));
    o.run(10);
    o.apply([]);
    expect(o.desks.size).toBe(0);
  });

  it('finds the cat at home when its floor is gone', () => {
    const o = office();
    o.scene.cat.at = { x: 50, y: 66 };
    Object.assign(o.scene.cat, { mood: 'roam', path: [{ x: 90, y: 90 }] });
    o.setRoom(room(door, rug)); // nothing where it stood: it sits down there
    expect(o.scene.cat).toMatchObject({ at: { x: 50, y: 66 }, mood: 'sit', path: [] });
    o.setRoom(oneTable); // a table where it stood
    expect(o.scene.cat.at).toEqual(o.scene.layout.cat[0]);
    const { x, y } = o.scene.cat.at;
    expect(o.scene.floor.free(Math.floor(x / CELL), Math.floor(y / CELL))).toBe(true);
  });
});

describe('a small room with its door on another wall', () => {
  const small: Room = {
    size: { w: 100, d: 100 },
    pieces: [
      { kind: 'door', wall: 'E', a: 40 },
      { kind: 'window', wall: 'N', a: 20 },
      { kind: 'clock', wall: 'W', a: 40 },
      { kind: 'small-table', x: 8, y: 8, turn: 0 },
      { kind: 'small-table', x: 44, y: 8, turn: 0 },
      { kind: 'planter', x: 80, y: 14, turn: 0 },
      { kind: 'floor-lamp', x: 20, y: 48, turn: 0 },
      { kind: 'lounge-rug', x: 4, y: 56, turn: 0 },
      { kind: 'sofa', x: 4, y: 60, turn: 0 },
      { kind: 'bean-bag', x: 36, y: 64, turn: 0 },
      { kind: 'ping-pong', x: 64, y: 70, turn: 0 },
    ],
    cat: [{ x: 50, y: 94 }],
  };

  it('is a sound room, with a way in from the east', () => {
    expect(problemsOf(small)).toEqual([]);
    const o = office(false, small);
    expect(o.scene.layout.door).toEqual({ x: 98, y: 44.5 });
    expect(o.scene.layout.seats).toHaveLength(4);
    expect(o.scene.layout.play.map((spot) => spot.kind)).toEqual(['pong', 'pong', 'sofa', 'bean', 'sofa']);
    expect(o.scene.layout.hangouts.length).toBeGreaterThanOrEqual(3);
    for (const seat of o.scene.layout.seats) expect(o.scene.floor.route(98, 44.5, seat.x, seat.y).length, `${seat.x}, ${seat.y}`).toBeGreaterThan(0);
  });

  it('sees people through a working day as well as the default room does', () => {
    const o = office(false, small);
    buildOffice(o.scene);
    o.apply([]);
    // six arrive for four chairs: one with a supervisor and interns, one long idle
    const staff = [
      session('a', { supervisor: busy, agents: agents('a1', 'a2') }),
      longIdle('b'),
      session('c', { status: 'waiting' }),
      session('d', { background: true, supervisor: idle }),
      session('e'),
      session('f'),
    ];
    o.apply(staff);
    expect([...o.desks.values()].every((desk) => desk.outside)).toBe(true);
    o.until(() => ['a', 'c', 'd', 'e', 'f'].every(o.seated), 'everyone sat down');
    expect(o.doorOpened).toBe(true);
    expect(['a', 'b', 'c', 'd'].map((id) => o.desk(id).seat)).toEqual([0, 1, 2, 3]);
    expect(['e', 'f'].map((id) => o.desk(id).spare!.lounge >= 0)).toEqual([true, true]); // the two without a chair are in the lounge
    o.until(() => o.desk('b').play >= 0 && !o.desk('b').path.length, 'b got to a game');
    o.until(() => !!o.desk('a').boss?.at && !o.desk('a').boss!.path.length && [...o.desk('a').helpers.values()].every((h) => h.at && !h.path.length), 'the staff settled');
    o.run(150); // long enough for the idle supervisor to stroll between hangouts

    // someone goes home, and once they are out the longest without a chair takes theirs; the idler is called back; the interns go
    o.apply([session('a', { supervisor: busy }), session('b'), ...staff.slice(3)]);
    o.until(() => !o.desks.has('c'), 'c went out by the door');
    expect(o.desk('e').seat).toBe(2);
    o.until(() => ['a', 'b', 'd', 'e', 'f'].every(o.seated) && o.desk('a').helpers.size === 0, 'settled again');
    o.close();
  });
});
