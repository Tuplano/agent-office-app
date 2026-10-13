// The room as data: what the default room works out to, which is what the engine
// had written out by hand before, and what other rooms do to the floor, the camera
// and the people.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, HOME, project } from '../src/engine/camera';
import { SCENE_W } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import { laptopOf, placeOf } from '../src/engine/figures';
import { createOffice } from '../src/engine/index';
import { layoutOf } from '../src/engine/layout';
import { DEFAULT_ROOM, type Piece, type Room, RoomSchema } from '../src/engine/room';
import { loadRoom, saveRoom } from '../src/engine/store';
import { problemsOf } from '../src/engine/valid';
import { fakeCanvas, fakeElement, motionPreference, officeIn, session, storage } from './stand-ins';

const room = (pieces: Piece[], rest: Partial<Room> = {}): Room => ({ size: { w: 140, d: 140 }, pieces, cat: [], ...rest });
const DOOR: Piece = { kind: 'door', wall: 'N', a: 81.5 };
describe('the default room', () => {
  const layout = layoutOf(DEFAULT_ROOM);

  it('is a room the schema takes', () => {
    expect(RoomSchema.parse(DEFAULT_ROOM)).toEqual(DEFAULT_ROOM);
  });

  it('gives out its chairs in the order it always has', () => {
    expect(layout.seats.map((s) => [s.x, s.y, s.dir, s.kind, s.z])).toEqual([
      [39, 12, 'S', 'bench', 7], [99, 39, 'E', 'bench', 7], [65, 12, 'S', 'bench', 7], [99, 65, 'E', 'bench', 7],
      [39, 36, 'N', 'bench', 7], [123, 39, 'W', 'bench', 7], [65, 36, 'N', 'bench', 7], [123, 65, 'W', 'bench', 7],
      [28, 58, 'W', 'stool', 9], [28, 72, 'W', 'stool', 9],
    ]);
  });

  it('numbers its games and its places to flop as it always has', () => {
    expect(layout.play.map((s) => [s.x, s.y, s.dir, s.kind, s.z])).toEqual([
      [72, 113, 'E', 'pong', undefined], [104, 113, 'W', 'pong', undefined], [124, 110, 'N', 'arcade', undefined],
      [9, 102, 'E', 'sofa', 6], [42, 98, 'W', 'bean', 5], [9, 114, 'E', 'sofa', 6], [42, 118, 'W', 'bean', 5],
    ]);
  });

  it('sends supervisors on the rounds it always has', () => {
    expect(layout.hangouts.map((s) => [s.x, s.y, s.dir])).toEqual([
      [11, 58, 'W'], [14, 28, 'W'], [104, 8, 'N'], [118, 18, 'E'], [56, 66, 'E'], [88, 128, 'N'], [132, 112, 'W'], [30, 88, 'S'],
    ]);
  });

  it('has its door, its spare floor and its cat where they were', () => {
    expect(layout.door).toEqual({ x: 86, y: 2 });
    expect(layout.spare).toEqual({ x: 60, y: 108, dir: 'S' });
    expect(layout.cat[0]).toEqual({ x: 112.5, y: 132.5 });
    // and it sleeps where it did, each place now the furniture's own: by the lamp, under a window, by the planter, by the door
    for (const nap of [{ x: 22, y: 90 }, { x: 58, y: 6 }, { x: 58, y: 78 }, { x: 94, y: 10 }]) expect(layout.cat).toContainEqual(nap);
    expect(layout.cat).toHaveLength(11); // home, under each of seven windows, and those three
  });

  it('blocks the floor under the furniture and the chairs, and none under the rugs', () => {
    expect(layout.footprints).toContainEqual([26, 17, 52, 14]); // a long table's top, not the room it keeps for its chairs
    expect(layout.footprints).toContainEqual([104, 26, 14, 52]); // and the one that is turned
    expect(layout.footprints).toContainEqual([17, 88, 1, 1]); // the floor lamp's pole, not its shade
    expect(layout.footprints).toContainEqual([35, 7, 8, 8]); // a chair
    expect(layout.footprints).toHaveLength(30);
  });
});

describe('a room', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { createElement: () => fakeElement() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is refused when it is not one', () => {
    const broken: unknown[] = [
      { ...DEFAULT_ROOM, size: { w: 0, d: 140 } },
      room([{ kind: 'sofa', x: 2, y: 94, turn: 4 } as unknown as Piece]),
      room([{ kind: 'window', wall: 'up', a: 3 } as unknown as Piece]),
      room([{ kind: 'bean-bag', x: 2, y: 2, turn: 0, tint: 'red' }]),
      // a piece's own measures: more than nothing, and no more than two of them
      room([{ kind: 'bush', x: 2, y: 2, turn: 0, size: [-20] }]),
      room([{ kind: 'bush', x: 2, y: 2, turn: 0, size: [0] }]),
      room([{ kind: 'banner', wall: 'N', a: 3, size: [10, 16, 4] }]),
      { size: { w: 140, d: 140 }, pieces: [] },
    ];
    for (const given of broken) expect(RoomSchema.safeParse(given).success, JSON.stringify(given)).toBe(false);
  });

  it('turns a piece with everything it offers', () => {
    const turned = (turn: 0 | 1 | 2 | 3) => layoutOf(room([{ kind: 'sofa', x: 40, y: 40, turn }]));
    // the sofa is 11 by 28 and its sitters look out over its long open side
    expect(turned(0).play.map((s) => [s.x, s.y, s.dir])).toEqual([[47, 48, 'E'], [47, 60, 'E']]);
    expect(turned(1).play.map((s) => [s.x, s.y, s.dir])).toEqual([[60, 47, 'S'], [48, 47, 'S']]);
    expect(turned(2).play.map((s) => [s.x, s.y, s.dir])).toEqual([[44, 60, 'W'], [44, 48, 'W']]);
    expect(turned(3).play.map((s) => [s.x, s.y, s.dir])).toEqual([[48, 44, 'N'], [60, 44, 'N']]);
    expect(turned(0).footprints).toEqual([[40, 40, 11, 28]]);
    expect(turned(1).footprints).toEqual([[40, 40, 28, 11]]);
  });

  it('leaves out a piece of a kind nobody knows', () => {
    const odd: Piece[] = [{ kind: 'hat-stand', x: 60, y: 60, turn: 0 }, { kind: 'aquarium', wall: 'W', a: 10 }];
    expect(layoutOf(room([DOOR, ...odd]))).toEqual(layoutOf(room([DOOR])));
    const { scene } = officeIn(room([DOOR, ...odd]));
    expect(() => draw(scene)).not.toThrow();
  });

  it('can be any size: the floor, the walks and the picture follow', () => {
    const size = { w: 100, d: 180 };
    const { scene, sim } = officeIn(room([{ ...DOOR, a: 40 }, { kind: 'table', x: 24, y: 80, turn: 0 }], { size }));
    expect([scene.floor.cols, scene.floor.rows]).toEqual([25, 45]);
    expect(scene.floor.blocked).toHaveLength(25 * 45);
    expect(scene.cat.at).toEqual({ x: 50, y: 86 }); // nowhere of its own, so the clear floor nearest the middle, which the table is on
    sim.apply([]);
    sim.apply([session('a')]);
    for (let frame = 0; frame < 80; frame++) {
      scene.frame++;
      sim.tick();
      draw(scene);
    }
    const a = scene.desks.get('a')!;
    expect(a).toMatchObject({ seat: 0, at: null, outside: false }); // came in by the door and sat down
    expect(placeOf(a)).toMatchObject({ x: 37, y: 85 });
    // from the starting view the whole floor is in the picture, as wide as the default room's
    const view = aim(HOME, size);
    const across = [[0, 0], [100, 0], [0, 180], [100, 180]].map(([x, y]) => project(view, x, y, 0)[0]);
    expect(Math.min(...across)).toBeCloseTo(10);
    expect(Math.max(...across)).toBeCloseTo(SCENE_W - 10);
  });

  it('with no desks sits its people in the lounge, then by the rug, and with nothing at all on the open floor', () => {
    const lounge: Piece[] = [DOOR, { kind: 'lounge-rug', x: 4, y: 90, turn: 0 }, { kind: 'bean-bag', x: 38, y: 94, turn: 0 }];
    const { scene, sim } = officeIn(room(lounge));
    sim.apply([session('a'), session('b')]);
    const [a, b] = [scene.desks.get('a')!, scene.desks.get('b')!];
    expect([a.seat, b.seat]).toEqual([-1, -1]);
    expect(a.spare).toMatchObject({ x: 42, y: 98, lounge: 0 }); // the bean bag
    expect(b.spare).toMatchObject({ lounge: -1, z: 3 }); // a cushion by the rug
    expect(() => draw(scene)).not.toThrow();

    // Nothing in the room but the door: everyone is still there, each on a cushion
    // on the floor with a laptop on their knees, the first of them in the middle.
    const bare = officeIn(room([DOOR]));
    const ids = Array.from({ length: 12 }, (_, i) => `s${i}`);
    bare.sim.apply(ids.map(session));
    const sat = ids.map((id) => bare.scene.desks.get(id)!);
    expect(placeOf(sat[0])).toMatchObject({ x: 70, y: 70, dir: 'S', z: 3, lounge: -1 });
    expect(sat.every((desk) => desk.seat < 0 && desk.spare?.lounge === -1 && laptopOf(desk) === 'lap')).toBe(true);
    // a few steps from each other, inside the walls, and out of the doorway
    for (const [i, one] of sat.entries()) {
      const at = placeOf(one)!;
      expect(at.x > 4 && at.y > 4 && at.x < 136 && at.y < 136, ids[i]).toBe(true);
      expect(Math.hypot(at.x - bare.scene.layout.door.x, at.y - bare.scene.layout.door.y), ids[i]).toBeGreaterThanOrEqual(16);
      for (const other of sat.slice(i + 1)) expect(Math.hypot(at.x - placeOf(other)!.x, at.y - placeOf(other)!.y), ids[i]).toBeGreaterThanOrEqual(16);
    }
    expect(() => draw(bare.scene)).not.toThrow();
    // while there is room they sit well apart; a crowd sits closer, and still nobody is left out
    const at = (desk: (typeof sat)[number]) => placeOf(desk)!;
    const nearest = (all: typeof sat) => Math.min(...all.flatMap((one, i) => all.slice(i + 1).map((other) => Math.hypot(at(one).x - at(other).x, at(one).y - at(other).y))));
    expect(nearest(sat)).toBe(28);
    const crowd = officeIn(room([DOOR]));
    crowd.sim.apply(Array.from({ length: 40 }, (_, i) => session(`c${i}`)));
    const crowded = [...crowd.scene.desks.values()];
    expect(crowded.every((desk) => placeOf(desk))).toBe(true);
    expect(nearest(crowded)).toBeGreaterThanOrEqual(16);
    expect(nearest(crowded)).toBeLessThan(28);
    // only a room with no floor left to sit on has a card and no figure
    const full = officeIn(room([DOOR]));
    full.scene.floor.blocked.fill(1);
    full.sim.apply([session('a')]);
    expect(placeOf(full.scene.desks.get('a')!)).toBeNull();
    expect(() => draw(full.scene)).not.toThrow();
  });
});

describe('a sound room', () => {
  const sofa = (x: number, y: number): Piece => ({ kind: 'sofa', x, y, turn: 0 });
  const rug = (x: number, y: number): Piece => ({ kind: 'lounge-rug', x, y, turn: 0 });
  const window = (wall: 'N' | 'E' | 'S' | 'W', a: number): Piece => ({ kind: 'window', wall, a });
  const about = (given: Room) => problemsOf(given).map(({ piece, why }) => `${piece}: ${why}`);

  it('is what the default room is', () => {
    expect(problemsOf(DEFAULT_ROOM)).toEqual([]);
  });

  it('may hold kinds nobody knows, rugs under things, and seats nobody can walk to', () => {
    expect(problemsOf(room([DOOR, { kind: 'hat-stand', x: 900, y: 900, turn: 0 }, { kind: 'aquarium', wall: 'N', a: 500 }]))).toEqual([]);
    expect(problemsOf(room([DOOR, rug(4, 90), sofa(2, 94), rug(60, 90)]))).toEqual([]);
    // a bean bag walled in by four planters
    const ring: Piece[] = [[40, 54], [54, 40], [68, 54], [54, 68]].map(([x, y]) => ({ kind: 'planter', x, y, turn: 0 }));
    expect(problemsOf(room([DOOR, ...ring, { kind: 'bean-bag', x: 57, y: 57, turn: 0 }]))).toEqual([]);
  });

  it('takes for kinds only the ones written down, not what every object has', () => {
    const odd: Piece[] = ['constructor', 'toString', '__proto__', 'hasOwnProperty'].flatMap((kind) => [{ kind, x: 0, y: 0, turn: 0 }, { kind, wall: 'N', a: 0 }]);
    expect(RoomSchema.safeParse(room([DOOR, ...odd])).success).toBe(true);
    expect(problemsOf(room([DOOR, ...odd]))).toEqual([]); // left out, like any kind nobody knows
    expect(layoutOf(room([DOOR, ...odd])).footprints).toEqual([]);
  });

  it('is found wanting at once, however big a piece in it claims to be', () => {
    const vast = room([DOOR, { kind: 'bush', x: 0, y: 0, turn: 0, size: [1e9] }]);
    const began = performance.now();
    expect(about(vast)).toEqual(['1: It is partly outside the room.', '0: Something stands in the doorway.']);
    expect(performance.now() - began).toBeLessThan(500);
    expect(about(room([DOOR, { kind: 'banner', wall: 'W', a: 10, size: [10, 22] }]))).toEqual([]);
    expect(about(room([DOOR, { kind: 'banner', wall: 'W', a: 10, size: [10, 100000] }]))).toEqual(['1: It does not fit on its wall.']); // higher than the wall
    expect(about(room([DOOR, { kind: 'banner', wall: 'W', a: 10, size: [] }]))).toEqual([]); // the size it comes in
  });

  it('is of a size the office can hold', () => {
    const sized = (w: number, d: number) => about(room([{ ...DOOR, a: 40 }], { size: { w, d } }));
    expect(sized(96, 196)).toEqual([]);
    for (const [w, d] of [[92, 140], [140, 200], [98, 140]]) expect(sized(w, d), `${w} by ${d}`).toEqual(['null: A room is from 96 to 196 across and deep, in steps of 4.']);
  });

  it('keeps everything inside the walls and off everything else', () => {
    expect(about(room([DOOR, sofa(130, 94)]))).toEqual(['1: It is partly outside the room.']);
    expect(about(room([DOOR, rug(100, 110)]))).toEqual(['1: It is partly outside the room.']);
    expect(about(room([DOOR, sofa(2, 94), { kind: 'bean-bag', x: 10, y: 100, turn: 0 }]))).toEqual(['2: It stands where the sofa does.']);
    expect(about(room([DOOR, rug(4, 90), rug(20, 100)]))).toEqual(['2: It lies over the lounge-rug.']);
    // turned, the sofa lies along x and reaches what it did not before
    expect(about(room([DOOR, { kind: 'tree', x: 60, y: 42, turn: 0 }, sofa(40, 40)]))).toEqual([]);
    expect(about(room([DOOR, { kind: 'tree', x: 60, y: 42, turn: 0 }, { ...sofa(40, 40), turn: 1 }]))).toEqual(['2: It stands where the tree does.']);
  });

  it('has room on its walls for what hangs on them', () => {
    expect(about(room([DOOR, window('E', 110)]))).toEqual([]);
    expect(about(room([DOOR, window('E', 120)]))).toEqual(['1: It does not fit on its wall.']);
    expect(about(room([DOOR, window('E', 0)]))).toEqual(['1: It does not fit on its wall.']); // its frame starts a little before it
    expect(about(room([DOOR, window('N', 10), window('W', 10), { kind: 'clock', wall: 'N', a: 30 }]))).toEqual(['3: It hangs over the window.']);
  });

  it('has one door, with the way in clear', () => {
    expect(about(room([sofa(2, 94)]))).toEqual(['null: A room needs a door.']);
    expect(about(room([DOOR, { kind: 'door', wall: 'S', a: 20 }]))).toEqual(['1: A room has one door.']);
    expect(about(room([DOOR, { kind: 'planter', x: 80, y: 0, turn: 0 }]))).toEqual(['0: Something stands in the doorway.']);
    expect(about(room([DOOR, { kind: 'planter', x: 80, y: 5, turn: 0 }]))).toEqual(['0: Something stands in the doorway.']); // a step inside it
    expect(about(room([DOOR, { kind: 'planter', x: 80, y: 10, turn: 0 }]))).toEqual([]);
  });
});

describe('the saved room', () => {
  let kept: Record<string, string>;
  const small = room([DOOR, { kind: 'table', x: 40, y: 50, turn: 0 }], { cat: [{ x: 10, y: 10 }] });
  beforeEach(() => {
    kept = {};
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept[key] ?? null, setItem: (key: string, value: string) => void (kept[key] = value) });
  });
  afterEach(() => vi.unstubAllGlobals());
  const keep = (value: unknown) => (kept['agent-office-room'] = typeof value === 'string' ? value : JSON.stringify(value));

  it('comes back as it was left', () => {
    expect(loadRoom()).toBe(DEFAULT_ROOM); // nothing saved yet
    saveRoom(small);
    expect(loadRoom()).toEqual(small);
    expect(JSON.parse(kept['agent-office-room']).version).toBe(1);
  });

  it('is dropped for the default room when it is not a sound room in the shape of today', () => {
    const dropped: unknown[] = [
      'not json {',
      { version: 2, room: small },
      { room: small },
      { version: 1, room: { ...small, pieces: [{ kind: 'sofa' }] } },
      { version: 1, room: room([]) }, // no door
      { version: 1 },
      null,
    ];
    for (const value of dropped) {
      keep(value);
      expect(loadRoom(), JSON.stringify(value)).toBe(DEFAULT_ROOM);
    }
  });

  it('comes back without the pieces that are of no kind now or no longer fit, and is not dropped for them', () => {
    const extra: Piece[] = [
      { kind: 'own-gone', x: 40, y: 50, turn: 0 }, // a model that was not kept, where the table stands
      { kind: 'planter', x: 44, y: 54, turn: 0 }, // on the table
      { kind: 'tree', x: 400, y: 10, turn: 0 }, // outside the walls
      { kind: 'mural', wall: 'N', a: 500 }, // off the end of its wall
    ];
    keep({ version: 1, room: { ...small, pieces: [...small.pieces, ...extra] } });
    expect(loadRoom()).toEqual(small);
    // what stands in the doorway cannot be told from the rest, so that room is still dropped
    const shut = room([DOOR, { kind: 'sofa', x: 76, y: 0, turn: 1 }]);
    expect(problemsOf(shut)).toEqual([{ piece: 0, why: 'Something stands in the doorway.' }]);
    keep({ version: 1, room: shut });
    expect(loadRoom()).toBe(DEFAULT_ROOM);
  });

  it('does without storage when there is none', () => {
    vi.stubGlobal('localStorage', {
      getItem() {
        throw new Error('off');
      },
      setItem() {
        throw new Error('off');
      },
    });
    expect(() => saveRoom(small)).not.toThrow();
    expect(loadRoom()).toBe(DEFAULT_ROOM);
  });
});

describe('the office', () => {
  let kept: Record<string, string>;
  const small = room([DOOR, { kind: 'table', x: 40, y: 50, turn: 0 }]);
  const open = () => {
    const tags: { hidden: boolean }[] = [];
    const office = createOffice(fakeCanvas() as unknown as HTMLCanvasElement, { append: (tag: { hidden: boolean }) => tags.push(tag) } as unknown as HTMLElement);
    return { office, tags };
  };
  beforeEach(() => {
    vi.useFakeTimers();
    kept = {};
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept[key] ?? null, setItem: (key: string, value: string) => void (kept[key] = value) });
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('document', { createElement: () => ({ ...fakeElement(), hidden: false }) });
    vi.stubGlobal('addEventListener', () => {});
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('takes a sound room, keeps it, and opens in it next time', () => {
    const first = open();
    first.office.apply({ sessions: ['a', 'b', 'c', 'd', 'e'].map(session) });
    expect(first.tags.map((tag) => tag.hidden)).toEqual([false, false, false, false, false]);

    expect(first.office.setRoom(small)).toEqual([]);
    expect(first.tags.map((tag) => tag.hidden)).toEqual([false, false, false, false, false]); // four chairs now, and the fifth sits on the floor
    expect(JSON.parse(kept['agent-office-room']).room).toEqual(small);
    vi.advanceTimersByTime(1000);
    first.office.destroy();

    const second = open();
    second.office.apply({ sessions: ['a', 'b', 'c', 'd', 'e'].map(session) });
    expect(second.tags.map((tag) => tag.hidden)).toEqual([false, false, false, false, false]);
    second.office.destroy();
  });

  it('turns down a room with something wrong with it, and changes nothing', () => {
    const { office, tags } = open();
    office.apply({ sessions: ['a', 'b', 'c', 'd', 'e'].map(session) });
    expect(office.setRoom(room([{ kind: 'table', x: 120, y: 50, turn: 0 }]))).toEqual([
      { piece: 0, why: 'It is partly outside the room.' },
      { piece: null, why: 'A room needs a door.' },
    ]);
    expect(tags.map((tag) => tag.hidden)).toEqual([false, false, false, false, false]);
    expect(kept['agent-office-room']).toBeUndefined();
    office.destroy();
  });
});
