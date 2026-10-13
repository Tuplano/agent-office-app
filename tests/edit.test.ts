// Edit mode: the changes to a room as plain functions, finding what is under the
// pointer, and the editor that ties them to the pointer, the keys and the people.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, floorAt, HOME, project, wallAt } from '../src/engine/camera';
import { CELL } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import {
  addPiece, begin, commit, duplicatePiece, finishRoom, movePiece, paintPiece, PALETTE, reach, redo, removePiece, resizeRoom, slidePiece, tintOf,
  turnPiece, undo,
} from '../src/engine/edit';
import { makeEditor } from '../src/engine/editor';
import { placeOf } from '../src/engine/figures';
import { lookOf, PLAIN, randomFinish, randomTint } from '../src/engine/finish';
import { layoutOf } from '../src/engine/layout';
import { buildOffice } from '../src/engine/office';
import { COBALT, FLOOR_A, FLOOR_B, GREIGE, hsl, IVORY, IVORY_SHADE, LIME, OAK, OAK_DARK, OAK_LIGHT, PURPLE, TANGERINE } from '../src/engine/palette';
import { DEFAULT_ROOM, type FloorPiece, type Piece, type Room, RoomSchema, type WallPiece } from '../src/engine/room';
import { READY_ROOMS } from '../src/engine/rooms';
import { makeScene, pieceAt } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { loadRoom, readRoom, saveRoom, writeRoom } from '../src/engine/store';
import { problemsOf } from '../src/engine/valid';
import { fakeCanvas, fakeElement, motionPreference, session } from './stand-ins';

const DOOR: Piece = { kind: 'door', wall: 'N', a: 40 };
const room = (pieces: Piece[], side = 140): Room => ({ size: { w: side, d: side }, pieces, cat: [] });
const numbered = (given: Room, kind: string, nth = 0) => given.pieces.flatMap((piece, i) => (piece.kind === kind ? [i] : []))[nth];
const SOFA = numbered(DEFAULT_ROOM, 'sofa');
const BEAN = numbered(DEFAULT_ROOM, 'bean-bag');
const floor = (given: Room, index: number) => given.pieces[index] as FloorPiece;

describe('a change to the room', () => {
  it('moves a piece, and leaves the room it came from as it was', () => {
    const moved = movePiece(DEFAULT_ROOM, BEAN, 80, 96);
    expect(floor(moved, BEAN)).toMatchObject({ kind: 'bean-bag', x: 80, y: 96, tint: floor(DEFAULT_ROOM, BEAN).tint });
    expect(floor(DEFAULT_ROOM, BEAN)).toMatchObject({ x: 38, y: 94 });
    expect(moved.pieces).toHaveLength(DEFAULT_ROOM.pieces.length);
    expect(movePiece(DEFAULT_ROOM, numbered(DEFAULT_ROOM, 'window'), 5, 5)).toBe(DEFAULT_ROOM); // not something that stands on the floor
  });

  it('slides what hangs on a wall along it, round to the next wall, and onto any other', () => {
    const MURAL = numbered(DEFAULT_ROOM, 'mural');
    const slid = slidePiece(DEFAULT_ROOM, MURAL, 'W', 12);
    expect(slid.pieces[MURAL]).toMatchObject({ kind: 'mural', wall: 'W', a: 12 });
    expect(problemsOf(slid)).toEqual([]);
    expect(slidePiece(DEFAULT_ROOM, SOFA, 'N', 4)).toBe(DEFAULT_ROOM); // not something that hangs
    // round the room: N, E, S, W; kept as far along, or as far as the wall goes
    const hung = room([DOOR, { kind: 'mural', wall: 'N', a: 104 }], 140);
    const walls = [1, 2, 3, 4].map((turns) => {
      let turned = hung;
      for (let i = 0; i < turns; i++) turned = turnPiece(turned, 1);
      return (turned.pieces[1] as WallPiece).wall;
    });
    expect(walls).toEqual(['E', 'S', 'W', 'N']);
    const narrow: Room = { size: { w: 140, d: 100 }, pieces: hung.pieces, cat: [] };
    expect(turnPiece(narrow, 1).pieces[1]).toMatchObject({ wall: 'E', a: 66 }); // 34 long, on a wall of 100
  });

  it('turns a piece about its own middle', () => {
    // the sofa is 11 by 28: on its side it is 28 by 11, about the same middle, back on the grid
    const once = turnPiece(room([DOOR, { kind: 'sofa', x: 40, y: 40, turn: 0 }]), 1);
    expect(floor(once, 1)).toMatchObject({ turn: 1, x: 32, y: 48 });
    expect(reach(floor(once, 1))).toEqual([32, 48, 28, 11]);
    let turned = once;
    for (let i = 0; i < 3; i++) turned = turnPiece(turned, 1);
    expect(floor(turned, 1).turn).toBe(0);
    // a square one stays exactly where it is, on the grid or off it
    const tree = turnPiece(room([DOOR, { kind: 'tree', x: 5, y: 87, turn: 3 }]), 1);
    expect(floor(tree, 1)).toMatchObject({ turn: 0, x: 5, y: 87 });
  });

  it('takes a piece away', () => {
    const without = removePiece(DEFAULT_ROOM, SOFA);
    expect(without.pieces).toHaveLength(DEFAULT_ROOM.pieces.length - 1);
    expect(without.pieces.some((piece) => piece.kind === 'sofa')).toBe(false);
    expect(layoutOf(without).play).toHaveLength(5);
  });

  it('adds a piece on the clear floor nearest the middle, and makes a sound room of it', () => {
    const bare = room([DOOR]);
    for (const { kind, wall } of PALETTE) {
      const added = addPiece(bare, kind);
      expect(added, kind).not.toBeNull();
      expect(problemsOf(added!), kind).toEqual([]);
      const piece = added!.pieces[added!.pieces.length - 1];
      expect('wall' in piece, kind).toBe(wall);
      if ('wall' in piece) continue;
      expect(piece).toMatchObject({ kind, turn: 0 });
      expect([piece.x % CELL, piece.y % CELL]).toEqual([0, 0]);
    }
    expect(PALETTE.some(({ kind }) => kind === 'door')).toBe(false); // a room has the one
    const first = addPiece(bare, 'planter')!;
    expect(floor(first, 1)).toMatchObject({ x: 64, y: 64 }); // 14 across: as near the middle of 140 as the grid has
    expect(addPiece(DEFAULT_ROOM, 'hat-stand')).toBeNull();
    // the default room has no floor left for a third long table, but it has for a table for two
    expect(addPiece(DEFAULT_ROOM, 'table')).toBeNull();
    expect(problemsOf(addPiece(DEFAULT_ROOM, 'small-table')!)).toEqual([]);
  });

  it('hangs a new piece in the middle of the first wall with room for it', () => {
    const bare = room([DOOR]);
    expect(addPiece(bare, 'clock')!.pieces[1]).toMatchObject({ kind: 'clock', wall: 'N', a: 60 }); // 20 long, on a wall of 140
    expect(addPiece(bare, 'clock', ['S', 'W'])!.pieces[1]).toMatchObject({ wall: 'S', a: 60 });
    // with the middle taken it goes beside it; with the wall full, on the next
    const beside = addPiece(addPiece(bare, 'mural')!, 'clock')!;
    expect(problemsOf(beside)).toEqual([]);
    expect(beside.pieces[2]).toMatchObject({ wall: 'N' });
    let full = bare;
    for (let i = 0; i < 3; i++) full = addPiece(full, 'mural', ['N'])!; // 34 long each, beside a door: three to a wall
    expect(problemsOf(full)).toEqual([]);
    expect(addPiece(full, 'mural', ['N'])).toBeNull();
    expect(addPiece(full, 'mural', ['N', 'E'])!.pieces[4]).toMatchObject({ wall: 'E' });
    expect(addPiece(bare, 'door')).toBeNull();
  });

  it('adds nothing when there is nowhere for it', () => {
    const planters: Piece[] = [0, 28, 56, 82].flatMap((x) => [10, 38, 66].map((y): Piece => ({ kind: 'planter', x, y, turn: 0 })));
    const full = room([DOOR, ...planters], 96);
    expect(problemsOf(full)).toEqual([]);
    expect(addPiece(full, 'table')).toBeNull();
    expect(addPiece(full, 'grass')).not.toBeNull();
  });

  it('copies a piece to the nearest place the copy fits', () => {
    const copied = duplicatePiece(DEFAULT_ROOM, BEAN)!;
    const [from, copy] = [floor(copied, BEAN), floor(copied, copied.pieces.length - 1)];
    expect(copy).toMatchObject({ kind: 'bean-bag', tint: from.tint, turn: from.turn });
    expect(Math.abs(copy.x - from.x) + Math.abs(copy.y - from.y)).toBeLessThanOrEqual(12);
    expect(problemsOf(copied)).toEqual([]);
    expect(duplicatePiece(DEFAULT_ROOM, numbered(DEFAULT_ROOM, 'door'))).toBeNull(); // a room has one door
    // what hangs is copied onto its own wall when there is room, and the next when there is not
    const clock = duplicatePiece(room([DOOR, { kind: 'clock', wall: 'S', a: 30 }]), 1)!;
    expect(clock.pieces[2]).toMatchObject({ kind: 'clock', wall: 'S', a: 10 }); // right beside it
    const banners = numbered(DEFAULT_ROOM, 'banner');
    const banner = duplicatePiece(DEFAULT_ROOM, banners)!;
    expect(banner.pieces[banner.pieces.length - 1]).toMatchObject({ kind: 'banner', tint: DEFAULT_ROOM.pieces[banners].tint, size: [10, 22] });
    expect(problemsOf(banner)).toEqual([]);
  });

  it('makes the room wider or deeper by moving its east and south walls', () => {
    const grown = resizeRoom(DEFAULT_ROOM, 148, 156);
    expect(grown.size).toEqual({ w: 148, d: 156 });
    expect(problemsOf(grown)).toEqual([]);
    expect(grown.pieces).toEqual(DEFAULT_ROOM.pieces); // everything keeps its distance from the north-west corner
    expect(grown.cat).toEqual([{ x: 120.5, y: 148.5 }]); // but the cat's home stays by the south wall
    expect(DEFAULT_ROOM.size).toEqual({ w: 140, d: 140 });

    // what hangs on a wall that has got shorter slides back onto it; what stands outside is left there to be found
    const hung = room([DOOR, { kind: 'clock', wall: 'E', a: 116 }, { kind: 'mural', wall: 'N', a: 100 }, { kind: 'tree', x: 130, y: 60, turn: 0 }]);
    const shrunk = resizeRoom(hung, 120, 124);
    expect(shrunk.pieces[1]).toMatchObject({ wall: 'E', a: 104 });
    expect(shrunk.pieces[2]).toMatchObject({ wall: 'N', a: 86 });
    expect(shrunk.pieces[3]).toMatchObject({ x: 130, y: 60 });
    expect(problemsOf(shrunk)).toEqual([{ piece: 3, why: 'It is partly outside the room.' }]);
    expect(problemsOf(resizeRoom(removePiece(hung, 3), 120, 124))).toEqual([]);
  });

  it('keeps the places the cat sleeps with the furniture they are by', () => {
    const naps = (given: Room) => layoutOf(given).cat.slice(1);
    const lamp: Piece = { kind: 'floor-lamp', x: 40, y: 40, turn: 0 };
    const bare = room([DOOR]);
    expect(naps(bare)).toEqual([{ x: 52.5, y: 10 }]); // on the floor by the door
    expect(naps(room([DOOR, lamp]))).toContainEqual({ x: 47, y: 44 }); // in the lamp's light
    expect(naps(movePiece(room([DOOR, lamp]), 1, 80, 100))).toContainEqual({ x: 87, y: 104 });
    expect(naps(removePiece(room([DOOR, lamp]), 1))).toEqual(naps(bare));
    // under a window, whichever wall it is on
    const windowed = room([DOOR, { kind: 'window', wall: 'N', a: 100 }]);
    expect(naps(windowed)).toContainEqual({ x: 102, y: 6 });
    expect(naps(turnPiece(windowed, 1))).toContainEqual({ x: 134, y: 102 });
    // and not where something stands
    expect(naps(room([DOOR, lamp, { kind: 'planter', x: 44, y: 42, turn: 0 }]))).not.toContainEqual({ x: 47, y: 44 });
    expect(layoutOf(bare).cat[0]).toEqual({ x: 70, y: 70 }); // no home of its own: the middle of the floor
  });

  it('paints a piece that has a colour of its own, and puts it back as it comes', () => {
    expect(tintOf(DEFAULT_ROOM.pieces[SOFA])).toBe(PURPLE);
    expect(tintOf(DEFAULT_ROOM.pieces[BEAN])).toBe(LIME); // the one it was given
    expect(tintOf(DEFAULT_ROOM.pieces[numbered(DEFAULT_ROOM, 'door')])).toBe(TANGERINE);
    expect(tintOf(DEFAULT_ROOM.pieces[numbered(DEFAULT_ROOM, 'window')])).toBeNull(); // nothing of its own to choose
    expect(tintOf(DEFAULT_ROOM.pieces[numbered(DEFAULT_ROOM, 'arcade')])).toBeNull();

    const painted = paintPiece(DEFAULT_ROOM, SOFA, COBALT);
    expect(painted.pieces[SOFA]).toMatchObject({ kind: 'sofa', x: 2, y: 94, tint: COBALT });
    expect(DEFAULT_ROOM.pieces[SOFA].tint).toBeUndefined();
    expect(problemsOf(painted)).toEqual([]);
    expect(paintPiece(painted, SOFA, null)).toEqual(DEFAULT_ROOM);
    expect('tint' in paintPiece(painted, SOFA, null).pieces[SOFA]).toBe(false);
    expect(paintPiece(DEFAULT_ROOM, numbered(DEFAULT_ROOM, 'window'), COBALT)).toBe(DEFAULT_ROOM);
  });

  it('finishes the room in other colours, a part at a time, and back', () => {
    const blue = finishRoom(DEFAULT_ROOM, { walls: '#d9e4ee' });
    expect(blue.finish).toEqual({ walls: '#d9e4ee' });
    const more = finishRoom(blue, { floor: '#8f6f4e', stripe: '#846546', wood: '#8a6a4a' });
    expect(more.finish).toEqual({ walls: '#d9e4ee', floor: '#8f6f4e', stripe: '#846546', wood: '#8a6a4a' });
    expect(RoomSchema.parse(more)).toEqual(more);
    expect(finishRoom(more, { walls: null }).finish).toEqual({ floor: '#8f6f4e', stripe: '#846546', wood: '#8a6a4a' });
    const bare = finishRoom(more, { walls: null, floor: null, stripe: null, wood: null });
    expect('finish' in bare).toBe(false); // nothing left to say
    expect(bare).toEqual(DEFAULT_ROOM);
    expect(DEFAULT_ROOM.finish).toBeUndefined();
    expect(RoomSchema.safeParse({ ...DEFAULT_ROOM, finish: { walls: 'blue' } }).success).toBe(false);
  });

  it('has a room that says nothing in the colours the app has always had', () => {
    expect(lookOf(undefined)).toEqual({ walls: IVORY, shade: IVORY_SHADE, floor: FLOOR_A, stripe: FLOOR_B, trim: GREIGE, wood: { mid: OAK, light: OAK_LIGHT, dark: OAK_DARK } });
    // what a finish does not say is worked out from what it does
    const dark = lookOf({ walls: '#5b6170', floor: '#5e6168', wood: '#3d3a38' });
    expect(dark).toMatchObject({ walls: '#5b6170', floor: '#5e6168', trim: GREIGE });
    for (const hex of [dark.shade, dark.stripe, dark.wood.light, dark.wood.dark]) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(new Set([dark.wood.mid, dark.wood.light, dark.wood.dark]).size).toBe(3);
  });

  it('takes any colour at all, for a piece and for the room', () => {
    const odd = finishRoom(paintPiece(DEFAULT_ROOM, SOFA, '#12ab9f'), { walls: '#fedcba', floor: '#010203' });
    expect(RoomSchema.parse(odd)).toEqual(odd);
    expect(problemsOf(odd)).toEqual([]);
    expect(lookOf(odd.finish)).toMatchObject({ walls: '#fedcba', floor: '#010203' });
    expect(hsl(0, 100, 50)).toBe('#ff0000');
    expect(hsl(120, 100, 25)).toBe('#008000');
    expect(hsl(240, 100, 50)).toBe('#0000ff');
    expect(hsl(77, 0, 100)).toBe('#ffffff');
    expect(hsl(200, 50, 0)).toBe('#000000');
  });

  it('picks a whole finish at random, always one a room can have, and never the same twice running', () => {
    let seed = 11;
    const random = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const seen = new Set<string>();
    let darkRooms = 0;
    for (let i = 0; i < 200; i++) {
      const finish = randomFinish(random);
      expect(Object.keys(finish).sort()).toEqual(['floor', 'stripe', 'trim', 'walls', 'wood']);
      expect(RoomSchema.safeParse({ ...DEFAULT_ROOM, finish }).success, JSON.stringify(finish)).toBe(true);
      expect(finish.stripe).not.toBe(finish.floor); // the stripes show
      seen.add(JSON.stringify(finish));
      if (parseInt(finish.walls!.slice(1, 3), 16) < 128) darkRooms++;
      expect(randomTint(random)).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(seen.size).toBe(200);
    expect(darkRooms).toBeGreaterThan(10); // now and then a dark one
    expect(darkRooms).toBeLessThan(80);
    // scripted, it is the same every time
    expect(randomFinish(() => 0.5)).toEqual(randomFinish(() => 0.5));
    expect(Object.values(PLAIN)).toEqual([null, null, null, null, null]);
  });

  it('can be undone and done again, until another change is made', () => {
    const [a, b, c] = [DEFAULT_ROOM, removePiece(DEFAULT_ROOM, SOFA), room([DOOR])];
    let history = commit(commit(begin(a), b), c);
    expect(undo(begin(a))).toMatchObject({ now: a, past: [], future: [] });
    history = undo(history);
    expect(history).toMatchObject({ now: b, past: [a], future: [c] });
    history = undo(history);
    expect(history.now).toBe(a);
    expect(undo(history)).toBe(history); // nothing further back
    history = redo(redo(history));
    expect(history).toMatchObject({ now: c, past: [a, b], future: [] });
    expect(redo(history)).toBe(history);
    history = commit(undo(history), a);
    expect(history).toMatchObject({ now: a, past: [a, b], future: [] }); // c is forgotten
  });
});

describe('edit mode', () => {
  let kept: Record<string, string>;
  beforeEach(() => {
    kept = {};
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept[key] ?? null, setItem: (key: string, value: string) => void (kept[key] = value) });
    vi.stubGlobal('document', { createElement: () => ({ ...fakeElement(), hidden: false }) });
  });
  afterEach(() => vi.unstubAllGlobals());

  function office(camera: Camera = HOME, given?: Room) {
    const scene = makeScene(fakeCanvas() as unknown as HTMLCanvasElement, { append() {} } as unknown as HTMLElement, given);
    Object.assign(scene.camera, camera);
    scene.view = aim(scene.camera);
    const sim = makeSim(scene);
    let drawn = 0;
    const redraw = () => {
      buildOffice(scene);
      draw(scene);
      drawn++;
    };
    redraw();
    const editor = makeEditor(scene, sim, redraw);
    const seen: string[] = [];
    editor.subscribe(() => seen.push(editor.state().note));
    return {
      scene,
      sim,
      editor,
      seen,
      drawn: () => drawn,
      // where a point of the room is in the picture
      at: (x: number, y: number, z = 0) => project(scene.view, x, y, z).slice(0, 2) as [number, number],
      piece: (index: number) => scene.room.pieces[index] as FloorPiece,
      // takes hold of a piece by a point on it, and carries it across the floor by (dx, dy), and then on by more
      carry(x: number, y: number, z: number, dx: number, dy: number) {
        const [sx, sy] = project(scene.view, x, y, z);
        const held = editor.grab(sx, sy);
        const [fx, fy] = floorAt(scene.view, sx, sy);
        const on = (mx: number, my: number) => {
          const [tx, ty] = project(scene.view, fx + mx, fy + my, 0);
          editor.drag(tx, ty);
        };
        on(dx, dy);
        return { held, on };
      },
      tick(frames = 1) {
        for (let i = 0; i < frames; i++) {
          scene.frame++;
          sim.tick();
          draw(scene);
        }
      },
    };
  }

  it('finds the floor under a point of the picture, whichever way the room is turned', () => {
    for (const camera of [HOME, { ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 }, { ...HOME, yaw: -1.9, pitch: 0.9, panX: 40, panY: -25 }]) {
      const view = aim(camera);
      for (const [x, y] of [[0, 0], [70, 70], [12.5, 133]]) {
        const [sx, sy] = project(view, x, y, 0);
        const [fx, fy] = floorAt(view, sx, sy);
        expect(fx).toBeCloseTo(x);
        expect(fy).toBeCloseTo(y);
      }
    }
  });

  it('knows which piece is drawn where', () => {
    const o = office();
    expect(pieceAt(o.scene, ...o.at(7, 108, 12.5))).toBe(SOFA); // the top of its back
    expect(pieceAt(o.scene, ...o.at(42, 98, 5.5))).toBe(BEAN);
    expect(pieceAt(o.scene, ...o.at(39, 12, 8))).toBe(numbered(DEFAULT_ROOM, 'table')); // a chair is its table's
    expect(pieceAt(o.scene, ...o.at(30, 122, 0))).toBe(numbered(DEFAULT_ROOM, 'lounge-rug'));
    expect(pieceAt(o.scene, ...o.at(40, 0, 16))).toBe(numbered(DEFAULT_ROOM, 'window'));
    expect(pieceAt(o.scene, ...o.at(60, 84, 0))).toBe(-1); // bare floor
    expect(pieceAt(o.scene, -5, 10)).toBe(-1);
    expect(pieceAt(o.scene, 10, 9999)).toBe(-1);
  });

  it('does nothing until it is started, and puts everyone in place when it is', () => {
    const o = office();
    o.sim.apply([]);
    o.sim.apply([session('a'), session('b', { supervisor: { status: 'busy' }, agents: [{ id: 'b1' }] })]);
    o.tick(6); // on their way in from the door
    expect(o.editor.grab(...o.at(42, 98, 5.5))).toBe(false);
    expect(o.editor.key({ key: 'Delete', ctrlKey: false, metaKey: false, shiftKey: false })).toBe(false);
    o.editor.add('planter');
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ on: false, selected: null, canUndo: false });

    o.editor.start();
    expect(o.editor.state()).toMatchObject({ on: true, selected: null, canUndo: false, canRedo: false, canReset: false, note: '' });
    expect(o.editor.state().pieces).toHaveLength(DEFAULT_ROOM.pieces.length);
    expect(o.editor.state().pieces.filter((piece) => piece.wall)).toHaveLength(DEFAULT_ROOM.pieces.filter((piece) => 'wall' in piece).length);
    for (const desk of o.scene.desks.values()) expect(desk).toMatchObject({ at: null, outside: false, path: [] });
    const b = o.scene.desks.get('b')!;
    expect(b.boss!.at).not.toBeNull();
    // and while it is on, a new arrival is simply there, and one who goes is simply gone
    o.sim.apply([session('b'), session('c')]);
    expect([...o.scene.desks.keys()]).toEqual(['b', 'c']);
    expect(o.scene.desks.get('c')).toMatchObject({ at: null, outside: false });
    o.tick(20);
    expect(o.scene.doorOpen).toBe(0);
    expect(o.scene.cat).toMatchObject({ mood: 'sit', path: [] });
  });

  it('moves a piece dragged across the floor, onto the grid, and keeps the room', () => {
    const o = office();
    o.editor.start();
    expect(o.carry(42, 98, 5.5, 41, 1).held).toBe(true);
    expect(o.editor.state().selected).toBe(BEAN);
    expect(o.scene.preview).toMatchObject({ piece: BEAN, fits: true });
    expect(o.scene.preview!.room.pieces[BEAN]).toMatchObject({ x: 80, y: 96 });
    expect(o.piece(BEAN)).toMatchObject({ x: 38, y: 94 }); // not moved until it is let go
    expect(o.scene.layout.play.find((spot) => spot.piece === BEAN)).toMatchObject({ x: 42, y: 98 });

    o.editor.drop();
    expect(o.scene.preview).toBeNull();
    expect(o.piece(BEAN)).toMatchObject({ x: 80, y: 96 });
    expect(o.scene.layout.play.find((spot) => spot.piece === BEAN)).toMatchObject({ x: 84, y: 100 });
    expect(o.editor.state()).toMatchObject({ selected: BEAN, canUndo: true, canReset: true, note: '' });
    expect(JSON.parse(kept['agent-office-room']).room).toEqual(o.scene.room);
    expect(pieceAt(o.scene, ...o.at(84, 100, 5.5))).toBe(BEAN); // and it is drawn there
  });

  it('shows a piece held where it cannot go, and puts it back when it is let go there', () => {
    const o = office();
    o.editor.start();
    const before = Uint32Array.from(o.scene.office.rgb);
    const hand = o.carry(42, 98, 5.5, -33, 3); // onto the sofa
    expect(o.scene.preview).toMatchObject({ fits: false });
    expect(o.scene.office.rgb).not.toEqual(before);
    const redraws = o.drawn();
    hand.on(-33.5, 3.5); // still over the same cell: nothing to redraw
    expect(o.drawn()).toBe(redraws);
    hand.on(-37, 3);
    expect(o.drawn()).toBe(redraws + 1);

    o.editor.drop();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.scene.preview).toBeNull();
    expect(o.editor.state()).toMatchObject({ selected: BEAN, canUndo: false, note: 'It does not fit there.' });
    expect(o.scene.office.rgb).toEqual(before);
    expect(kept['agent-office-room']).toBeUndefined();

    o.carry(42, 98, 5.5, 200, 0); // and out through the wall
    expect(o.scene.preview).toMatchObject({ fits: false });
    expect(() => draw(o.scene)).not.toThrow();
    o.editor.drop();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
  });

  it('picks a piece out with a click and lets go of it with a click on nothing', () => {
    const o = office();
    o.editor.start();
    expect(o.editor.grab(...o.at(42, 98, 5.5))).toBe(true);
    o.editor.drop(); // no drag in between
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ selected: BEAN, canUndo: false, note: '' });
    expect(o.editor.grab(...o.at(60, 84, 0))).toBe(false); // bare floor: the drag is the camera's
    expect(o.editor.grab(...o.at(134, 0, 12))).toBe(false); // bare wall
    expect(o.editor.state().selected).toBe(BEAN);
    o.editor.tap();
    expect(o.editor.state().selected).toBeNull();
    o.editor.select(SOFA);
    expect(o.editor.state().selected).toBe(SOFA);
    o.editor.select(999);
    expect(o.editor.state().selected).toBeNull();
  });

  it('finds the point of a wall under a point of the picture', () => {
    const { size } = DEFAULT_ROOM;
    for (const camera of [HOME, { ...HOME, yaw: 2.4, pitch: 0.3, zoom: 1.7 }, { ...HOME, yaw: -1.9, pitch: 0.9, panX: 40, panY: -25 }]) {
      const view = aim(camera);
      const on: [wall: 'N' | 'E' | 'S' | 'W', x: number, y: number][] = [['N', 33, 0], ['W', 0, 120], ['E', 140, 7.5], ['S', 99, 140]];
      for (const [wall, x, y] of on) {
        const [a, z] = wallAt(view, size, wall, ...(project(view, x, y, 17).slice(0, 2) as [number, number]));
        expect(a, wall).toBeCloseTo(wall === 'N' || wall === 'S' ? x : y);
        expect(z, wall).toBeCloseTo(17);
      }
    }
  });

  it('slides a window along its wall, and takes it round the corner onto the next', () => {
    const o = office();
    const WINDOW = numbered(DEFAULT_ROOM, 'window', 1); // on the north wall, from 56
    const hung = () => o.scene.room.pieces[WINDOW] as WallPiece;
    const on = (wall: 'N' | 'W', a: number, z = 16) => (wall === 'N' ? o.at(a, 0, z) : o.at(0, a, z));
    o.editor.start();
    expect(o.editor.grab(...on('N', 66))).toBe(true);
    expect(o.editor.state()).toMatchObject({ selected: WINDOW });
    expect(o.editor.state().pieces[WINDOW]).toMatchObject({ name: 'Window', wall: true });

    o.editor.drag(...on('N', 62.6)); // over the other window: it does not fit there
    expect(o.scene.preview).toMatchObject({ fits: false });
    expect(o.scene.preview!.room.pieces[WINDOW]).toMatchObject({ wall: 'N', a: 52 });
    o.editor.drag(...on('N', 500)); // past the end of the wall it stops at the end
    expect(o.scene.preview!.room.pieces[WINDOW]).toMatchObject({ wall: 'N', a: 115 });
    expect(hung()).toMatchObject({ wall: 'N', a: 56 }); // not moved until it is let go

    o.editor.drag(...on('W', 52)); // onto the west wall, between the mural and the shelf of cups
    expect(o.scene.preview!.room.pieces[WINDOW]).toMatchObject({ wall: 'W', a: 42 });
    expect(o.scene.preview).toMatchObject({ fits: false }); // where it is over both
    o.editor.drop();
    expect(hung()).toMatchObject({ wall: 'N', a: 56 });
    expect(o.editor.state().note).toBe('It does not fit there.');

    // the mood board has more room on the north wall
    const BOARD = numbered(DEFAULT_ROOM, 'mood-board');
    o.editor.grab(...on('N', 100));
    o.editor.drag(...on('N', 109.2));
    expect(o.scene.preview).toMatchObject({ piece: BOARD, fits: true });
    o.editor.drop();
    expect(o.scene.room.pieces[BOARD]).toMatchObject({ wall: 'N', a: 100 });
    expect(o.editor.state()).toMatchObject({ selected: BOARD, canUndo: true, note: '' });
    expect(o.scene.layout.hangouts).toContainEqual({ x: 113, y: 8, dir: 'N' }); // and the place to stand and look at it went with it
    expect(pieceAt(o.scene, ...on('N', 102, 23))).toBe(BOARD);
  });

  it('moves where everyone comes in when the door is moved', () => {
    const o = office(HOME, room([DOOR, { kind: 'table', x: 40, y: 50, turn: 0 }]));
    o.sim.apply([session('a')]);
    o.editor.start();
    o.editor.select(0);
    const key = (name: string) => o.editor.key({ key: name, ctrlKey: false, metaKey: false, shiftKey: false });
    // from the starting view the north wall runs up to the right: the arrow moves it that way along it
    key('ArrowRight');
    expect(o.scene.room.pieces[0]).toMatchObject({ wall: 'N', a: 42 });
    expect(o.scene.layout.door).toEqual({ x: 46.5, y: 2 });
    key('ArrowLeft');
    key('ArrowLeft');
    expect(o.scene.room.pieces[0]).toMatchObject({ a: 38 });
    expect(key('ArrowUp')).toBe(true); // nothing for a piece on a wall to do, but not the camera's either
    expect(o.scene.room.pieces[0]).toMatchObject({ a: 38 });

    // it cannot be deleted or copied, and it goes round to the next wall
    key('Delete');
    expect(o.scene.room.pieces[0]).toMatchObject({ kind: 'door' });
    expect(o.editor.state().note).toBe('A room needs a door.');
    o.editor.duplicate();
    expect(o.editor.state().note).toBe('There is no room for another door.');
    key('r');
    expect(o.scene.room.pieces[0]).toMatchObject({ wall: 'E', a: 38 });
    expect(o.scene.layout.door).toEqual({ x: 138, y: 42.5 });

    o.editor.done();
    o.sim.apply([session('a'), session('b')]);
    for (let i = 0; i < 4; i++) o.tick();
    const b = o.scene.desks.get('b')!;
    expect(Math.abs(b.at!.x - 138) + Math.abs(b.at!.y - 42.5)).toBeLessThan(20); // in by the east wall
  });

  it('steps a piece that is off the grid onto it, and stops at what is in the way', () => {
    const o = office();
    const THE_DOOR = numbered(DEFAULT_ROOM, 'door'); // at 81.5, between a window that ends at 81 and the mood board from 91
    o.editor.start();
    o.editor.select(THE_DOOR);
    o.editor.nudge(1, 0);
    expect(o.scene.room.pieces[THE_DOOR]).toMatchObject({ a: 82 });
    o.editor.nudge(1, 0);
    expect(o.scene.room.pieces[THE_DOOR]).toMatchObject({ a: 82 });
    expect(o.editor.state().note).toBe('It does not fit there.');
    o.editor.nudge(-1, 0);
    expect(o.scene.room.pieces[THE_DOOR]).toMatchObject({ a: 82 });
    o.editor.turn(); // and on the east wall a bush stands just inside where it would be
    expect(o.scene.room.pieces[THE_DOOR]).toMatchObject({ wall: 'N' });
    expect(o.editor.state().note).toBe('It does not fit on the next wall.');

    o.editor.select(BEAN); // at 38, 94
    o.editor.nudge(1, 0);
    expect(o.piece(BEAN)).toMatchObject({ x: 40, y: 94 });
    o.editor.nudge(0, -1);
    expect(o.piece(BEAN)).toMatchObject({ x: 40, y: 92 });
    o.editor.nudge(-1, 0);
    expect(o.piece(BEAN)).toMatchObject({ x: 36, y: 92 });
  });

  it('adds what hangs to a wall that can be seen, and deletes and copies it like anything else', () => {
    const o = office(); // from the starting view the north and west walls stand
    o.editor.start();
    o.editor.add('banner');
    const index = DEFAULT_ROOM.pieces.length;
    expect(o.scene.room.pieces[index]).toMatchObject({ kind: 'banner', wall: 'N' });
    expect(o.editor.state()).toMatchObject({ selected: index, note: '' });
    o.editor.duplicate();
    expect(o.scene.room.pieces[index + 1]).toMatchObject({ kind: 'banner' });
    o.editor.remove();
    o.editor.select(index);
    o.editor.remove();
    expect(o.scene.room.pieces).toHaveLength(DEFAULT_ROOM.pieces.length);
    for (let i = 0; i < 30 && !o.editor.state().note; i++) o.editor.add('mural');
    expect(o.editor.state().note).toBe('There is no room for another mural.');
    expect(problemsOf(o.scene.room)).toEqual([]);
    expect(() => draw(o.scene)).not.toThrow();
  });

  it('takes the keys for the piece picked out', () => {
    const o = office();
    const key = (name: string, with_: { ctrlKey?: boolean; shiftKey?: boolean } = {}) => o.editor.key({ key: name, ctrlKey: false, metaKey: false, shiftKey: false, ...with_ });
    o.editor.start();
    expect(key('ArrowRight')).toBe(false); // nothing picked: the arrows turn the room
    const added = addPiece(DEFAULT_ROOM, 'planter')!;
    o.editor.add('planter');
    const index = added.pieces.length - 1;
    const { x, y } = o.piece(index);
    expect(o.editor.state().selected).toBe(index);

    // from the starting view, across the picture is the floor's x and down it is its y
    expect(key('ArrowRight')).toBe(true);
    expect(o.piece(index)).toMatchObject({ x: x + CELL, y });
    key('ArrowDown');
    expect(o.piece(index)).toMatchObject({ x: x + CELL, y: y + CELL });
    key('ArrowLeft');
    key('ArrowUp');
    key('ArrowUp');
    expect(o.piece(index)).toMatchObject({ x, y: y - CELL });
    key('ArrowLeft'); // into the planter that was there already
    expect(o.piece(index)).toMatchObject({ x, y: y - CELL });
    expect(o.editor.state().note).toBe('It does not fit there.');

    expect(key('r')).toBe(true);
    expect(o.piece(index).turn).toBe(1);
    expect(key('R')).toBe(true);
    expect(o.piece(index).turn).toBe(2);
    expect(key('x')).toBe(false);

    expect(key('z', { ctrlKey: true })).toBe(true);
    expect(o.piece(index).turn).toBe(1);
    expect(key('z', { ctrlKey: true, shiftKey: true })).toBe(true);
    expect(o.piece(index).turn).toBe(2);
    expect(key('s', { ctrlKey: true })).toBe(false);

    o.editor.select(index);
    expect(key('Escape')).toBe(true);
    expect(o.editor.state().selected).toBeNull();
    o.editor.select(index);
    expect(key('Delete')).toBe(true);
    expect(o.scene.room.pieces).toHaveLength(DEFAULT_ROOM.pieces.length);
    expect(o.editor.state().selected).toBeNull();
  });

  it('moves a piece the way the arrow points however the room is turned', () => {
    const o = office({ ...HOME, yaw: Math.PI }); // seen from the other side
    o.editor.start();
    o.editor.select(BEAN);
    const [sx] = o.at(38, 94);
    o.editor.nudge(1, 0);
    expect(o.at(o.piece(BEAN).x, o.piece(BEAN).y)[0]).toBeGreaterThan(sx);
    expect(o.piece(BEAN).x).toBeLessThan(38);
  });

  it('finds a chair for someone the moment a table is added, and a place for those whose table goes', () => {
    const o = office();
    const staff = Array.from({ length: 12 }, (_, i) => session(`s${i}`));
    o.sim.apply(staff);
    expect([...o.scene.desks.values()].filter((desk) => desk.seat < 0)).toHaveLength(2);
    o.editor.start();
    o.editor.add('small-table');
    expect(o.editor.state()).toMatchObject({ selected: DEFAULT_ROOM.pieces.length, note: '' });
    expect([...o.scene.desks.values()].map((desk) => desk.seat).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);

    o.editor.select(numbered(DEFAULT_ROOM, 'table'));
    o.editor.remove();
    o.editor.select(numbered(o.scene.room, 'table'));
    o.editor.remove();
    expect(o.scene.layout.seats).toHaveLength(4); // the two stools and the new table
    const desks = [...o.scene.desks.values()];
    expect(desks.filter((desk) => desk.seat >= 0)).toHaveLength(4);
    expect(desks.every((desk) => placeOf(desk))).toBe(true); // the rest in the lounge, then on the floor
    o.tick(10);
  });

  it('says so when there is no room, and when a piece will not turn', () => {
    const o = office();
    o.editor.start();
    o.editor.select(SOFA);
    o.editor.turn(); // lying along the wall it would be on the low table
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state().note).toBe('It does not fit turned that way here.');
    o.editor.select(BEAN); // anything done clears what was said
    expect(o.editor.state().note).toBe('');
    for (let i = 0; i < 40 && !o.editor.state().note; i++) o.editor.add('games-floor');
    expect(o.editor.state().note).toBe('There is no room for another games floor.');
    expect(problemsOf(o.scene.room)).toEqual([]);
  });

  it('has nothing to reset in a default room that was saved and read back', () => {
    saveRoom(DEFAULT_ROOM);
    const read = loadRoom();
    expect(read).not.toBe(DEFAULT_ROOM);
    const o = office(HOME, read);
    o.editor.start();
    expect(o.editor.state().canReset).toBe(false);
    o.editor.add('planter');
    expect(o.editor.state().canReset).toBe(true);
  });

  it('makes the room bigger, and smaller as far as what is in it allows', () => {
    const o = office();
    o.sim.apply(Array.from({ length: 3 }, (_, i) => session(`s${i}`)));
    o.editor.start();
    expect(o.editor.state().size).toEqual({ w: 140, d: 140 });
    o.editor.resize(1, 0);
    o.editor.resize(0, 1);
    o.editor.resize(0, 1);
    expect(o.editor.state()).toMatchObject({ size: { w: 148, d: 156 }, canUndo: true, canReset: true, note: '' });
    expect([o.scene.floor.cols, o.scene.floor.rows]).toEqual([37, 39]);
    expect(o.scene.view).toMatchObject({ midX: 74, midY: 78 });
    expect(JSON.parse(kept['agent-office-room']).room.size).toEqual({ w: 148, d: 156 });
    expect(() => draw(o.scene)).not.toThrow();
    expect([...o.scene.desks.values()].map((desk) => desk.seat)).toEqual([0, 1, 2]);

    // back in, as far as the tree in the corner
    o.editor.resize(-1, -2);
    expect(o.editor.state().size).toEqual({ w: 140, d: 140 });
    o.editor.resize(-1, 0);
    expect(o.editor.state()).toMatchObject({ size: { w: 140, d: 140 } });
    expect(o.editor.state().note).toMatch(/^The [a-z -]+ is in the way\.$/);
    o.editor.select(numbered(DEFAULT_ROOM, 'tree', 2)); // picking something clears what was said
    expect(o.editor.state().note).toBe('');
    o.editor.done();
    o.editor.resize(1, 1);
    expect(o.scene.room.size).toEqual({ w: 140, d: 140 });
  });

  it('keeps the room within the sizes there are', () => {
    const o = office(HOME, room([DOOR], 96));
    o.editor.start();
    o.editor.resize(-1, 0);
    expect(o.editor.state()).toMatchObject({ size: { w: 96, d: 96 }, note: 'A room is from 96 to 196 across and deep, in steps of 4.' });
    for (let i = 0; i < 20; i++) o.editor.resize(1, 1);
    expect(o.editor.state().size).toEqual({ w: 192, d: 192 });
  });

  it('paints the piece picked out, and the room, and themes it', () => {
    const o = office();
    o.editor.start();
    const before = Uint32Array.from(o.scene.office.rgb);
    expect(o.editor.state()).toMatchObject({ finish: {} });
    expect(o.editor.state().pieces[SOFA]).toMatchObject({ name: 'Sofa', tint: PURPLE });
    expect(o.editor.state().pieces[numbered(DEFAULT_ROOM, 'window')]).toMatchObject({ tint: null });

    o.editor.paint(COBALT); // nothing picked out
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    o.editor.select(SOFA);
    o.editor.paint(COBALT);
    expect(o.scene.room.pieces[SOFA]).toMatchObject({ tint: COBALT });
    expect(o.editor.state()).toMatchObject({ selected: SOFA, canUndo: true, canReset: true });
    expect(o.editor.state().pieces[SOFA].tint).toBe(COBALT);
    const sofa = Uint32Array.from(o.scene.office.rgb);
    expect(sofa).not.toEqual(before);
    expect(JSON.parse(kept['agent-office-room']).room.pieces[SOFA].tint).toBe(COBALT);
    o.editor.paint(null);
    expect(o.scene.office.rgb).toEqual(before);
    expect(o.editor.state().canReset).toBe(false);
    o.editor.select(numbered(DEFAULT_ROOM, 'window'));
    o.editor.paint(COBALT); // a window has no colour of its own
    expect(o.editor.state().canReset).toBe(false);

    // a table's colour is its chairs', and the island's is its stools'
    o.editor.select(numbered(DEFAULT_ROOM, 'table'));
    o.editor.paint(TANGERINE);
    expect(o.scene.office.rgb).not.toEqual(before);
    o.editor.undo();
    expect(o.scene.office.rgb).toEqual(before);

    o.editor.refinish({ walls: '#d9e4ee' });
    o.editor.refinish({ floor: '#8f6f4e', stripe: '#846546' });
    expect(o.editor.state().finish).toEqual({ walls: '#d9e4ee', floor: '#8f6f4e', stripe: '#846546' });
    expect(o.scene.office.rgb).not.toEqual(before);
    o.editor.refinish({ walls: null, floor: null, stripe: null });
    expect(o.editor.state()).toMatchObject({ finish: {}, canReset: false });
    expect(o.scene.office.rgb).toEqual(before);

    // a whole finish at once, at random, and back as it comes in one go
    const random = randomFinish(() => 0.37);
    o.editor.refinish(random);
    expect(o.editor.state().finish).toEqual(random);
    expect(o.scene.office.rgb).not.toEqual(before);
    o.editor.refinish(PLAIN);
    expect(o.editor.state()).toMatchObject({ finish: {}, canReset: false });
    expect(o.scene.office.rgb).toEqual(before);
    // asking for what it already has is not a change to undo
    const steps = o.seen.length;
    o.editor.refinish(PLAIN);
    expect(o.seen.length).toBe(steps);
    o.editor.done();
    o.editor.refinish({ walls: '#d9e4ee' });
    expect(o.scene.room.finish).toBeUndefined();
  });

  it('makes two rooms with the same furniture look unmistakably different, by day and by lamp light', () => {
    for (const time of ['12:05:30', '22:30:00']) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(`2026-10-09T${time}`));
      const plain = office();
      const themed = office();
      vi.useRealTimers();
      themed.editor.start();
      themed.editor.refinish({ walls: '#5b6170', floor: '#5e6168', trim: '#252525', wood: '#3d3a38' });
      themed.editor.select(SOFA);
      themed.editor.paint(TANGERINE);
      themed.editor.done();
      expect(themed.scene.room.pieces.map((piece) => piece.kind)).toEqual(plain.scene.room.pieces.map((piece) => piece.kind));
      const [a, b] = [plain.scene.office.rgb, themed.scene.office.rgb];
      const drawn = a.filter((pixel) => pixel !== 0).length;
      const differing = a.filter((pixel, i) => pixel !== b[i]).length;
      expect(differing / drawn, time).toBeGreaterThan(0.6);
    }
  });

  it('starts from a ready-made room, says which one the room is, and can go back', () => {
    const o = office();
    const desks = READY_ROOMS.find((one) => one.id === 'desks')!.room;
    o.editor.startFrom('desks'); // not before edit mode is on
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    o.sim.apply(Array.from({ length: 12 }, (_, i) => session(`s${i}`)));
    o.editor.start();
    expect(o.editor.state().ready).toBe('default');
    o.editor.select(SOFA);

    o.editor.startFrom('desks');
    expect(o.scene.room).toBe(desks);
    expect(o.editor.state()).toMatchObject({ ready: 'desks', selected: null, canUndo: true, canReset: true, note: '' });
    expect(readRoom(kept['agent-office-room'])).toEqual(RoomSchema.parse(desks)); // kept for next time
    // everyone has a chair in it at once, where two went without
    expect([...o.scene.desks.values()].every((desk) => desk.seat >= 0)).toBe(true);
    const drawn = o.drawn();
    o.editor.startFrom('desks'); // there already
    o.editor.startFrom('no such room');
    expect(o.drawn()).toBe(drawn);
    expect(o.editor.state().canUndo).toBe(true);

    // a room that has been changed is no longer the ready-made one
    o.editor.add('planter');
    expect(o.editor.state().ready).toBeNull();
    o.editor.undo();
    expect(o.editor.state().ready).toBe('desks');
    o.editor.undo();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ ready: 'default', canReset: false });

    for (const { id, room } of READY_ROOMS) {
      o.editor.startFrom(id);
      expect(o.scene.room, id).toBe(room);
      expect(o.editor.state().ready, id).toBe(id);
      o.tick(3);
    }
    o.editor.reset(); // which is starting from the default
    expect(o.scene.room).toBe(DEFAULT_ROOM);
  });

  it('copies the room out, and takes one pasted in when it is a room the office can take', () => {
    const o = office();
    o.editor.start();
    o.editor.select(BEAN);
    o.editor.paint('#123456');
    o.editor.refinish({ walls: '#334455' });
    const made = o.scene.room;
    const copied = o.editor.copy();
    expect(readRoom(copied)).toEqual(RoomSchema.parse(made));
    expect(copied).toBe(kept['agent-office-room']); // written the way it is saved

    // into another office, which is then in that room
    const other = office();
    other.editor.paste(copied); // not before edit mode is on
    expect(other.scene.room).toBe(DEFAULT_ROOM);
    other.editor.start();
    other.editor.paste(`\n  ${copied}\n`);
    expect(other.scene.room).toEqual(RoomSchema.parse(made));
    expect(other.editor.state()).toMatchObject({ ready: null, canUndo: true, selected: null, note: '' });
    expect(other.scene.room.finish).toEqual({ walls: '#334455' });
    const drawn = other.drawn();
    other.editor.paste(copied); // the room there is already
    expect(other.drawn()).toBe(drawn);
    expect(other.editor.state().note).toBe('');
    other.editor.undo();
    expect(other.scene.room).toBe(DEFAULT_ROOM);
    other.editor.redo();

    // what is not a room, or not one the office can take, changes nothing and says why
    const was = other.scene.room;
    const crowded: Room = { ...DEFAULT_ROOM, pieces: [...DEFAULT_ROOM.pieces, { kind: 'planter', x: 4, y: 96, turn: 0 }] };
    const turned: [text: string, note: string][] = [
      ['', 'That is not a room.'],
      ['a sofa and two chairs', 'That is not a room.'],
      [JSON.stringify(DEFAULT_ROOM), 'That is not a room.'], // not as it is written out
      [JSON.stringify({ version: 2, room: DEFAULT_ROOM }), 'That is not a room.'],
      [writeRoom({ ...DEFAULT_ROOM, pieces: [] }), 'That room will not do. A room needs a door.'],
      [writeRoom(crowded), 'That room will not do. Planter: It stands where the sofa does.'],
      // text from anywhere: a piece that claims to be vast, one hung higher than the wall, one of no size
      [writeRoom(room([DOOR, { kind: 'bush', x: 0, y: 0, turn: 0, size: [1e9] }])), 'That room will not do. Bush: It is partly outside the room.'],
      [writeRoom(room([DOOR, { kind: 'banner', wall: 'W', a: 10, size: [10, 1e5] }])), 'That room will not do. Banner: It does not fit on its wall.'],
      [writeRoom(room([DOOR, { kind: 'bush', x: 60, y: 60, turn: 0, size: [-20] }])), 'That is not a room.'],
    ];
    for (const [text, note] of turned) {
      other.editor.paste(text);
      expect(other.editor.state().note, text.slice(0, 40)).toBe(note);
      expect(other.scene.room).toBe(was);
    }
    // a kind that is no kind, though every object has something by its name, is left out like any other
    other.editor.paste(writeRoom(room([DOOR, { kind: 'constructor', x: 0, y: 0, turn: 0 }, { kind: 'toString', wall: 'S', a: 8 }])));
    expect(other.editor.state()).toMatchObject({ note: '', pieces: [{ index: 0, name: 'Door' }] });
    // a ready-made room that was copied out somewhere is known for what it is
    other.editor.paste(writeRoom(READY_ROOMS[3].room));
    expect(other.editor.state()).toMatchObject({ ready: 'empty', note: '' });
  });

  it('can still undo what was done before Done, unless the room has been swapped since', () => {
    const o = office();
    o.editor.start();
    o.editor.startFrom('empty'); // by mistake, say
    o.editor.done();
    expect(readRoom(kept['agent-office-room'])!.pieces).toHaveLength(READY_ROOMS[3].room.pieces.length);
    o.editor.start();
    expect(o.editor.state()).toMatchObject({ ready: 'empty', canUndo: true });
    o.editor.undo();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ canUndo: false, canRedo: true });
    o.editor.done();

    // a room put in from outside the editor is a new beginning
    o.sim.setRoom(READY_ROOMS[1].room);
    o.editor.start();
    expect(o.editor.state()).toMatchObject({ ready: 'desks', canUndo: false, canRedo: false });
  });

  it('undoes, redoes, resets, and is done', () => {
    const o = office();
    o.sim.apply([]);
    o.editor.start();
    const told = o.seen.length;
    o.editor.select(BEAN);
    o.editor.remove();
    o.editor.select(SOFA);
    o.editor.duplicate();
    const two = o.scene.room;
    expect(two.pieces.filter((piece) => piece.kind === 'sofa')).toHaveLength(2);
    expect(o.editor.state().selected).toBe(two.pieces.length - 1);
    expect(o.seen.length).toBeGreaterThan(told);
    const state = o.editor.state();
    expect(o.editor.state()).toBe(state); // the same until something changes

    o.editor.undo();
    expect(o.scene.room.pieces.filter((piece) => piece.kind === 'sofa')).toHaveLength(1);
    expect(o.editor.state()).toMatchObject({ selected: null, canUndo: true, canRedo: true });
    o.editor.undo();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ canUndo: false, canRedo: true, canReset: false });
    o.editor.undo(); // nothing further back
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    o.editor.redo();
    o.editor.redo();
    expect(o.scene.room).toBe(two);
    expect(JSON.parse(kept['agent-office-room']).room).toEqual(two);

    o.editor.reset();
    expect(o.scene.room).toBe(DEFAULT_ROOM);
    expect(o.editor.state()).toMatchObject({ canUndo: true, canReset: false });
    o.editor.undo(); // even that
    expect(o.scene.room).toBe(two);

    o.editor.select(SOFA);
    o.editor.done();
    expect(o.editor.state()).toMatchObject({ on: false, selected: null });
    expect(o.scene).toMatchObject({ editing: false, selected: null, preview: null });
    expect(o.scene.room).toBe(two); // what was made stays
    // and people walk again
    o.sim.apply([session('a')]);
    expect(o.scene.desks.get('a')!.outside).toBe(true);
    o.editor.remove();
    expect(o.scene.room).toBe(two);
  });
});
