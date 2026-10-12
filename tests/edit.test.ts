// Edit mode: the changes to a room as plain functions, finding what is under the
// pointer, and the editor that ties them to the pointer, the keys and the people.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { aim, type Camera, floorAt, HOME, project, wallAt } from '../src/engine/camera';
import { CELL } from '../src/engine/constants';
import { draw } from '../src/engine/draw';
import { addPiece, begin, commit, duplicatePiece, movePiece, PALETTE, reach, redo, removePiece, slidePiece, turnPiece, undo } from '../src/engine/edit';
import { makeEditor } from '../src/engine/editor';
import { placeOf } from '../src/engine/figures';
import { layoutOf } from '../src/engine/layout';
import { buildOffice } from '../src/engine/office';
import { DEFAULT_ROOM, type FloorPiece, type Piece, type Room, type WallPiece } from '../src/engine/room';
import { makeScene, pieceAt, type SessionView } from '../src/engine/scene';
import { makeSim } from '../src/engine/sim';
import { loadRoom, saveRoom } from '../src/engine/store';
import { problemsOf } from '../src/engine/valid';
import { fakeCanvas, fakeElement, motionPreference } from './stand-ins';

const DOOR: Piece = { kind: 'door', wall: 'N', a: 40 };
const room = (pieces: Piece[], side = 140): Room => ({ size: { w: side, d: side }, pieces, cat: [] });
const numbered = (given: Room, kind: string, nth = 0) => given.pieces.flatMap((piece, i) => (piece.kind === kind ? [i] : []))[nth];
const SOFA = numbered(DEFAULT_ROOM, 'sofa');
const BEAN = numbered(DEFAULT_ROOM, 'bean-bag');
const floor = (given: Room, index: number) => given.pieces[index] as FloorPiece;
const session = (id: string, rest: Partial<SessionView> = {}): SessionView => ({ id, name: id, status: 'busy', statusSince: 0, background: false, supervisor: null, agents: [], ...rest });

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
