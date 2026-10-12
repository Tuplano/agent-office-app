// The room as data: what the default room works out to, which is what the engine
// had written out by hand before, and what other rooms do to the floor, the camera
// and the people.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, HOME, project } from '../src/engine/camera';
import { SCENE_W } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import { placeOf } from '../src/engine/figures';
import { layoutOf } from '../src/engine/layout';
import { buildOffice } from '../src/engine/office';
import { DEFAULT_ROOM, type Piece, type Room, RoomSchema } from '../src/engine/room';
import { makeScene, type SessionView } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { fakeCanvas, fakeElement, motionPreference, storage } from './stand-ins';

const room = (pieces: Piece[], rest: Partial<Room> = {}): Room => ({ size: { w: 140, d: 140 }, pieces, cat: [], ...rest });
const DOOR: Piece = { kind: 'door', wall: 'N', a: 81.5 };
const session = (id: string): SessionView => ({ id, name: id, status: 'busy', statusSince: 0, background: false, supervisor: null, agents: [] });

function officeIn(given: Room) {
  const scene = makeScene(fakeCanvas() as unknown as HTMLCanvasElement, { append() {} } as unknown as HTMLElement, given);
  buildOffice(scene);
  return { scene, sim: makeSim(scene) };
}

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
    expect(layout.cat).toHaveLength(5);
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
    expect(scene.cat.at).toEqual({ x: 50, y: 90 }); // nowhere of its own, so the middle of the floor
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

  it('with no desks sits its people in the lounge, then on the floor, then nowhere', () => {
    const lounge: Piece[] = [DOOR, { kind: 'lounge-rug', x: 4, y: 90, turn: 0 }, { kind: 'bean-bag', x: 38, y: 94, turn: 0 }];
    const { scene, sim } = officeIn(room(lounge));
    sim.apply([session('a'), session('b')]);
    const [a, b] = [scene.desks.get('a')!, scene.desks.get('b')!];
    expect([a.seat, b.seat]).toEqual([-1, -1]);
    expect(a.spare).toMatchObject({ x: 42, y: 98, lounge: 0 }); // the bean bag
    expect(b.spare).toMatchObject({ lounge: -1, z: 3 }); // a cushion by the rug
    expect(() => draw(scene)).not.toThrow();

    const bare = officeIn(room([DOOR]));
    bare.sim.apply([session('a')]);
    expect(placeOf(bare.scene.desks.get('a')!)).toBeNull(); // a card and no figure
    expect(() => draw(bare.scene)).not.toThrow();
  });
});
