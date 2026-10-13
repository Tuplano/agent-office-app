// The ready-made rooms: each one a room the office can take, and each what its name says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import { reach } from '../src/engine/edit';
import { placeOf } from '../src/engine/figures';
import { makeFloor } from '../src/engine/floor';
import { layoutOf } from '../src/engine/layout';
import { FLOOR_KINDS } from '../src/engine/pieces';
import { drawRoom } from '../src/engine/preview';
import { DEFAULT_ROOM, onWall, type Room, RoomSchema } from '../src/engine/room';
import { READY_ROOMS } from '../src/engine/rooms';
import { readRoom, writeRoom } from '../src/engine/store';
import { problemsOf } from '../src/engine/valid';
import { fakeCanvas, fakeElement, motionPreference, officeIn, session, storage } from './stand-ins';

const ready = (id: string) => READY_ROOMS.find((one) => one.id === id)!.room;
const standing = (room: Room) => room.pieces.filter((piece) => !onWall(piece));

describe('the ready-made rooms', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('document', { createElement: () => ({ ...fakeElement(), hidden: false }) });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  // the people of an office in a room, with this many sent to work in it
  function staffOf(room: Room, people: number) {
    const { scene, sim } = officeIn(room);
    sim.apply(Array.from({ length: people }, (_, i) => session(`s${i}`)));
    expect(() => draw(scene)).not.toThrow();
    return [...scene.desks.values()];
  }

  it('are the default room and eight others, each with a name of its own', () => {
    expect(READY_ROOMS.map((one) => one.id)).toEqual(['default', 'desks', 'lounge', 'empty', 'loft', 'studio', 'glass', 'garden', 'corporate']);
    expect(ready('default')).toBe(DEFAULT_ROOM);
    expect(new Set(READY_ROOMS.map((one) => one.name)).size).toBe(9);
    expect(new Set(READY_ROOMS.map((one) => JSON.stringify(one.room))).size).toBe(9);
    // the later ones are other sizes, from the smallest a room can be up, each in colours of its own
    const themed = READY_ROOMS.slice(4);
    expect(themed.map(({ room }) => `${room.size.w} by ${room.size.d}`)).toEqual(['200 by 160', '96 by 96', '240 by 180', '160 by 120', '280 by 232']);
    expect(new Set(themed.map(({ room }) => JSON.stringify(room.finish))).size).toBe(5);
    for (const { id, room } of themed) {
      expect(Object.keys(room.finish ?? {}).sort(), id).toEqual(['floor', 'stripe', 'trim', 'walls', 'wood']);
      expect(layoutOf(room).seats.length, id).toBeGreaterThanOrEqual(2); // somewhere to work in each
    }
  });

  it('are all rooms the office can take, and come back whole when written out and read', () => {
    for (const { id, room } of READY_ROOMS) {
      expect(problemsOf(room), id).toEqual([]);
      expect(readRoom(writeRoom(room)), id).toEqual(RoomSchema.parse(room));
    }
  });

  it('are made as the editor would make them: of kinds there are, standing on the grid', () => {
    for (const { id, room } of READY_ROOMS.slice(1)) {
      for (const piece of standing(room)) {
        expect(FLOOR_KINDS[piece.kind], `${id}: ${piece.kind}`).toBeDefined();
        if (!onWall(piece)) expect([piece.x % CELL, piece.y % CELL], `${id}: ${piece.kind}`).toEqual([0, 0]);
      }
    }
  });

  it('let everyone walk in from the door to wherever they sit or play', () => {
    for (const { id, room } of READY_ROOMS) {
      const layout = layoutOf(room);
      const floor = makeFloor(room.size, layout.footprints);
      for (const spot of [...layout.seats, ...layout.play, ...layout.hangouts]) {
        expect(floor.route(layout.door.x, layout.door.y, spot.x, spot.y).length, `${id}: (${spot.x}, ${spot.y})`).toBeGreaterThan(0);
      }
    }
  });

  it('has nothing but desks in the room that is all desks: a chair for twenty-four', () => {
    const layout = layoutOf(ready('desks'));
    expect(layout.seats).toHaveLength(24);
    expect(layout.play).toEqual([]);
    expect(standing(ready('desks')).filter((piece) => piece.kind !== 'tree').every((piece) => piece.kind === 'table')).toBe(true);
    // the tables stand clear of each other, with a way between them
    const tables = standing(ready('desks')).filter((piece) => piece.kind === 'table').map((piece) => reach(piece as Parameters<typeof reach>[0]));
    for (const [x, y, w, d] of tables) {
      const gaps = tables.filter((other) => other[0] !== x || other[1] !== y).map(([ox, oy, ow, od]) => Math.max(ox - x - w, x - ox - ow, oy - y - d, y - oy - od));
      expect(Math.min(...gaps)).toBeGreaterThanOrEqual(CELL * 2);
    }
    const desks = staffOf(ready('desks'), 24);
    expect(desks.map((desk) => desk.seat).sort((a, b) => a - b)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('has far more places to flop than to work in the room that is mostly lounge', () => {
    const layout = layoutOf(ready('lounge'));
    const flop = layout.play.filter((spot) => spot.z);
    expect(layout.seats).toHaveLength(4); // the table for two, and the island's stools
    expect(flop).toHaveLength(12); // three sofas and six bean bags
    expect(layout.play.filter((spot) => !spot.z).map((spot) => spot.kind).sort()).toEqual(['arcade', 'pong', 'pong']);
    expect(layout.hangouts.length).toBeGreaterThanOrEqual(8);
    // ten at work: four at the table and the island, and the rest about the lounge, all somewhere to be seen
    const desks = staffOf(ready('lounge'), 10);
    expect(desks.filter((desk) => desk.seat >= 0)).toHaveLength(4);
    expect(desks.filter((desk) => desk.seat < 0 && desk.spare && desk.spare.lounge >= 0)).toHaveLength(6);
    expect(desks.every((desk) => placeOf(desk))).toBe(true);
  });

  it('are each shown, where they are chosen, with the people there are sitting in them', () => {
    // a canvas that keeps the picture put on it
    const shown = (room: Room, people: number) => {
      let pixels = new Uint32Array(0);
      const canvas = { ...fakeCanvas(), getContext: () => ({ ...fakeCanvas().getContext(), createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray((pixels = new Uint32Array(w * h)).buffer) }) }) };
      drawRoom(canvas as unknown as HTMLCanvasElement, room, Array.from({ length: people }, (_, i) => session(`s${i}`, i ? {} : { supervisor: { status: 'busy' }, agents: [{ id: 'i1' }] })));
      return pixels;
    };
    // the clocks on the walls are stopped: a second passing between two pictures would show in them
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 0, 5, 10, 30, 0));
    const differing = (a: Uint32Array, b: Uint32Array) => a.reduce((count, pixel, k) => count + (pixel === b[k] ? 0 : 1), 0);
    for (const { id, room } of READY_ROOMS) {
      const bare = shown(room, 0);
      expect(bare.some(Boolean), id).toBe(true); // the room itself
      expect(differing(shown(room, 0), bare), id).toBe(0);
      // five people, a supervisor and an intern are a good many pixels: in the empty room too
      expect(differing(shown(room, 5), bare), id).toBeGreaterThan(1500);
    }
  });

  it('has two offices behind glass in the room of glass offices, each with a way in and something in it', () => {
    const room = ready('glass');
    const layout = layoutOf(room);
    const floor = makeFloor(room.size, layout.footprints);
    expect(standing(room).filter((piece) => piece.kind === 'inner-door')).toHaveLength(2);
    // shut in but for their doors: with the doors walled up, nobody gets to the seats inside
    const inside = layout.seats.filter((seat) => seat.x > 164);
    expect(inside).toHaveLength(5); // the boss alone in one, four at the table in the other
    const shut: Room = { ...room, pieces: room.pieces.map((piece) => (piece.kind === 'inner-door' ? { ...piece, kind: 'glass-wall', size: [16] } : piece)) };
    const walled = layoutOf(shut);
    const closed = makeFloor(shut.size, walled.footprints);
    for (const seat of inside) {
      expect(floor.route(layout.door.x, layout.door.y, seat.x, seat.y).length).toBeGreaterThan(0);
      expect(closed.route(walled.door.x, walled.door.y, seat.x, seat.y)).toEqual([]);
    }
    // and the board in the southern one hangs on the wall that stands in the room
    expect(room.pieces.find((piece) => piece.kind === 'mood-board')).toMatchObject({ wall: 'N', out: 104 });
    expect(layout.hangouts).toContainEqual({ x: 193, y: 112, dir: 'N' });
  });

  it('has cubicles, a meeting room, an office for the boss, a pantry and a lounge in the corporate office', () => {
    const room = ready('corporate');
    const kinds = standing(room).map((piece) => piece.kind);
    // single cubicles, half of them turned round, so that the rows stand back to back
    const cubicles = standing(room).filter((piece) => piece.kind === 'cubicle');
    expect(cubicles.map((piece) => (onWall(piece) ? -1 : piece.turn)).sort().join('')).toBe('0000000022222222');
    expect(kinds.filter((kind) => kind === 'inner-door')).toHaveLength(2);
    for (const kind of ['meeting-table', 'boss-desk', 'counter', 'fridge', 'vending', 'island', 'lounge-rug']) expect(kinds.filter((one) => one === kind), kind).toHaveLength(1);
    // sixteen in the cubicles, twelve round the table, the boss, and four in the pantry: a chair for each
    const layout = layoutOf(room);
    expect(layout.seats).toHaveLength(33);
    const desks = staffOf(room, 33);
    expect(desks.map((desk) => desk.seat).sort((a, b) => a - b)).toEqual(Array.from({ length: 33 }, (_, i) => i));
    // and in the lounge two sofas and two bean bags to flop on, besides the boss's own sofa
    expect(layout.play.filter((spot) => spot.z && spot.y > 180)).toHaveLength(6);
  });

  it('has nothing on the floor of the empty room, and whoever comes sits down on it to work', () => {
    const empty = ready('empty');
    expect(standing(empty)).toEqual([]);
    expect(empty.pieces.map((piece) => piece.kind).sort().filter((kind, i, all) => kind !== all[i - 1])).toEqual(['door', 'window']);
    const layout = layoutOf(empty);
    expect([layout.seats, layout.play, layout.hangouts]).toEqual([[], [], []]);
    expect(layout.cat.length).toBeGreaterThan(0); // the cat still has its home
    const desks = staffOf(empty, 6);
    expect(desks.every((desk) => placeOf(desk)?.z === 3 && desk.spare?.lounge === -1)).toBe(true); // each on a cushion of their own
    expect(new Set(desks.map((desk) => `${placeOf(desk)!.x} ${placeOf(desk)!.y}`)).size).toBe(6);
  });
});
