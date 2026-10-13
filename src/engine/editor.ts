import { floorAt, wallAt } from './camera';
import { CELL } from './constants';
import {
  addPiece, alongWall, begin, commit, type Corner, CUT, cutWalls, doorInWall, drawWall, duplicatePiece, finishRoom, GROW, type History, lineOf, longOf, movePiece, nameOf, paintPiece, PALETTE, pieceOf, redo,
  removePiece, resizeRoom, shed, slidePiece, snap, snapAlong, STEP, stepOn, stretchPiece, tintOf, turnPiece, undo, WALLS,
} from './edit';
import { type Face, facesOf, outerFace } from './faces';
import type { Finish } from './finish';
import { layoutOf } from './layout';
import { addModel, dropModel, listModels, type Model, modelOf, ModelSchema, modelsIn, saveModels } from './models';
import { FLOOR_KINDS } from './pieces';
import { standing, wallPoint } from './place';
import { onWall, type Room, RoomSchema, type WallPiece } from './room';
import { BLANK_ID, BLANK_ROOM, DEFAULT_ID, READY_ROOMS } from './rooms';
import { pieceAt, type Scene } from './scene';
import type { Sim } from './sim';
import { readWritten, saveRoom, writeRoom } from './store';
import { type Problem, problemsOf } from './valid';
import { WALL_KINDS } from './walls';

// What the page needs to know about the editing, to show its buttons.
export interface EditState {
  on: boolean;
  selected: number | null; // the piece picked out, by its number in the room
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean; // the room is not the one the app starts with
  ready: string | null; // the room to start from that this one is, if it is one of them just as it comes
  size: { w: number; d: number }; // how wide and how deep the room is
  finish: Finish; // the colours the room has that are not the ones it comes in
  // What there is to add to a room: the kinds written in code, then the models
  // that were brought in, each with how many of it the room has.
  palette: readonly { kind: string; name: string; wall: boolean; build?: boolean; drawn?: boolean; own: boolean; used: number }[];
  // what is in the room: whether each hangs on a wall, its colour if it has one of its own to choose,
  // and how long it is if it comes in lengths
  pieces: readonly { index: number; name: string; wall: boolean; tint: string | null; long?: number }[];
  drawing?: string | null; // the kind of wall being drawn across the floor, if one is, or CUT while wall is being cut away
  note: string; // why the last thing asked for was not done, or nothing
}

// What edit mode does with the pointer and the keys; input.ts asks it first.
export interface Hands {
  // takes hold of the piece at a point of the picture; false when there is none, or no editing
  grab(sx: number, sy: number): boolean;
  drag(sx: number, sy: number): void;
  drop(): void;
  // A click on nothing lets go of the piece picked out. While a wall is being
  // drawn, a click at a point of the picture is where it starts, and the next is
  // where it ends and the wall after it begins.
  tap(sx?: number, sy?: number): void;
  // the pointer passing over the picture with nothing held: a wall being drawn is shown as far as there
  hover(sx: number, sy: number): void;
  // A piece of a kind from the list to add from, carried over the picture before
  // it is put down: shown where it would go, on the floor under the point or on
  // the wall there, and in red where it would not fit.
  carry(kind: string, sx: number, sy: number): void;
  // put down there, if it fits; the room says why not otherwise
  put(kind: string, sx: number, sy: number): void;
  // carried off the picture again
  letGo(): void;
  // true when the key was edit mode's to deal with
  key(event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): boolean;
}

// Edit mode: rearranging the furniture and what hangs on the walls. Every change is tried as a whole new
// room and taken only when the room is still a sound one; then the office is
// rebuilt around it, the people are put where they now belong, and it is saved.
export interface Editor extends Hands {
  state(): EditState;
  // calls back whenever the state changes; returns what stops it
  subscribe(listener: () => void): () => void;
  start(): void;
  done(): void;
  select(index: number | null): void;
  add(kind: string): void;
  // A kind of wall is taken up, to be drawn across the floor from click to click,
  // or CUT, to take wall away the same way; the same again, or null, puts it down.
  build(kind: string | null): void;
  // these act on the piece picked out; a turn takes a piece on a wall round to the next wall
  turn(): void;
  remove(): void;
  duplicate(): void;
  // the piece picked out a step longer (1) or shorter (-1), if it is a wall that comes in lengths
  stretch(way: number): void;
  // one step of the grid across the picture (dx) or down it (dy)
  nudge(dx: number, dy: number): void;
  // makes the room a step wider (1) or narrower (-1), and the same for deeper or shallower
  resize(wider: number, deeper: number): void;
  // the piece picked out in another colour, or with null in the one it comes in
  paint(hex: string | null): void;
  // the room's own colours: each one named is set, or with null put back
  refinish(change: { [K in keyof Finish]?: string | null }): void;
  undo(): void;
  redo(): void;
  // back to the room the app starts with; can be undone
  reset(): void;
  // the room replaced by one of the ready-made ones, or by the bare one; can be undone
  startFrom(id: string): void;
  // the room written out, with the models its pieces are of, to be pasted in somewhere else
  copy(): string;
  // A model that was made in a 3D tool joins the palette, for good, and one of it
  // is put in the room if there is room.
  importModel(model: Model): void;
  renameModel(id: string, name: string): void;
  // the model is forgotten, and every piece of it leaves the room; undoing that brings both back
  deleteModel(id: string): void;
  // the room replaced by one that was written out; can be undone
  paste(text: string): void;
}

const NO_FIT = 'It does not fit there.';
const NO_FINISH: Finish = {};
const BUILT_IN = PALETTE.map((piece) => ({ ...piece, own: false, used: 0 }));
// Whether two rooms are the same room. One that has been saved and read back has
// its pieces' fields in the schema's order, so both are put in that order first.
// A room is never changed, only replaced, so each is written out the once.
const texts = new WeakMap<Room, string>();
function written(room: Room): string {
  let text = texts.get(room);
  if (text === undefined) texts.set(room, (text = JSON.stringify(RoomSchema.parse(room))));
  return text;
}
const STARTS = [...READY_ROOMS, { id: BLANK_ID, room: BLANK_ROOM }]; // the rooms there are to start from
const READY = new Map(STARTS.map(({ id, room }) => [id, room]));
const READY_IDS = new Map(STARTS.map(({ id, room }) => [written(room), id]));
const readyOf = (room: Room) => READY_IDS.get(written(room)) ?? null;

export function makeEditor(scene: Scene, sim: Sim, redraw: () => void): Editor {
  let history: History = begin(scene.room);
  // the piece in hand, and how far its corner is from the point it is held by
  let held: { index: number; dx: number; dy: number } | null = null;
  let note = '';
  // the kind of wall being drawn, and the corner the next length of it goes from
  let drawing: string | null = null;
  let corner: Corner | null = null;
  // The models deleted since the app was opened. The rooms from before still have
  // their pieces, so a step to one of those rooms brings its models back with it.
  const forgotten = new Map<string, Model>();
  const listeners = new Set<() => void>();

  const snapshot = (): EditState => {
    const ready = readyOf(scene.room);
    return {
      on: scene.editing,
      selected: scene.selected,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      canReset: ready !== DEFAULT_ID,
      ready,
      size: scene.room.size,
      finish: scene.room.finish ?? NO_FINISH,
      palette: [
        ...BUILT_IN,
        ...listModels().map(({ id, name }) => ({ kind: id, name, wall: false, own: true, used: scene.room.pieces.filter((piece) => piece.kind === id).length })),
      ],
      drawing,
      pieces: scene.room.pieces.flatMap((_, index) => {
        const piece = pieceOf(scene.room, index);
        return piece ? [{ index, name: nameOf(piece), wall: onWall(piece), tint: tintOf(piece), long: longOf(piece) ?? undefined }] : [];
      }),
      note,
    };
  };
  let state = snapshot();
  function changed(why = '') {
    note = why;
    state = snapshot();
    for (const listener of listeners) listener();
  }

  // the office, rebuilt around a room
  function show(room: Room, selected: number | null) {
    held = null;
    scene.preview = null;
    scene.selected = selected;
    sim.setRoom(room);
    redraw();
    changed();
  }
  // the same, for a room that is to be kept
  function keep(room: Room, selected: number | null) {
    saveRoom(room);
    show(room, selected);
  }
  // A room there was before, or after. Any model its pieces are of that was deleted
  // since is taken in again first: a room is never shown, or saved, with a piece of a
  // kind nobody knows, which would stand there unseen and in the way.
  function revisit(room: Room) {
    const kinds = new Set(room.pieces.map((piece) => piece.kind));
    const lost = [...kinds].flatMap((kind) => (modelOf(kind) ? [] : (forgotten.get(kind) ?? [])));
    lost.forEach(addModel);
    if (lost.length) saveModels();
    corner = null; // the wall it was the end of may not be there
    keep(room, null);
  }
  // takes a changed room if it is a sound one; says why not otherwise, in the
  // words given, or the ones made of what is wrong with it, or failing those its own
  function take(room: Room | null, selected: number | null, whyNot: string | ((wrong: Problem, room: Room) => string)): boolean {
    const wrong = room && problemsOf(room)[0];
    if (!room || wrong) {
      const said = typeof whyNot === 'string' ? whyNot : room && wrong ? whyNot(wrong, room) : '';
      changed(said || (wrong ? wrong.why : ''));
      return false;
    }
    history = commit(history, room);
    keep(room, selected);
    return true;
  }
  const picked = () => (scene.editing ? pieceOf(scene.room, scene.selected) : null);
  // The side of a wall that is seen at a point of the picture, and how far along
  // it the point is: one of the room's own walls, or of the walls that stand in the
  // room, whichever is nearest the camera there.
  function faceUnder(sx: number, sy: number): { face: Face; a: number } | undefined {
    const { room, view } = scene;
    let best: { face: Face; a: number } | undefined;
    let nearest = -Infinity;
    for (const face of [...WALLS.map((wall) => outerFace(room.size, wall)), ...facesOf(room)]) {
      if (!standing(view, face.wall)) continue;
      const [a, z] = wallAt(view, room.size, face.wall, sx, sy, face.out);
      if (a < face.from || a > face.to || z < 0 || z > face.top) continue;
      const [x, y] = wallPoint(room.size, face.wall, a, face.out);
      const near = (x - view.midX) * view.sin + (y - view.midY) * view.cos;
      if (near <= nearest) continue;
      nearest = near;
      best = { face, a };
    }
    return best;
  }
  // the side a piece hangs on now
  const faceOf = (piece: WallPiece): Face =>
    (piece.out && facesOf(scene.room).find((face) => face.wall === piece.wall && face.out === piece.out && face.from <= piece.a && piece.a <= face.to)) ||
    { ...outerFace(scene.room.size, piece.wall), out: piece.out ?? 0 };
  // A door that has been put down or moved takes its length out of a wall it is on,
  // and what hung on that length goes. The door may have another number after.
  function settle(room: Room, index: number): { room: Room; index: number } {
    const cut = doorInWall(room, index);
    if (cut === room) return { room, index };
    const tidy = shed(cut);
    return { room: tidy, index: tidy.pieces.indexOf(cut.pieces[index]) };
  }
  // The room with one more piece of a kind in it, its middle at a point of the
  // picture: on the floor there, or along the wall there. Null when the kind is
  // not one to add, or hangs and the point is on no wall.
  function withNew(kind: string, sx: number, sy: number): { room: Room; index: number } | null {
    const made = newIn(kind, sx, sy);
    return made && settle(made, made.pieces.length - 1);
  }
  function newIn(kind: string, sx: number, sy: number): Room | null {
    const { room, view } = scene;
    const hung = WALL_KINDS[kind];
    if (hung) {
      const under = hung.door ? undefined : faceUnder(sx, sy);
      if (!under) return null;
      const { face } = under;
      const blank: WallPiece = { kind, wall: face.wall, a: 0, ...(face.out > 0 && { out: face.out }) };
      const [from, to] = hung.span(blank);
      const a = alongWall(room, blank, face.wall, snapAlong(under.a - (from + to) / 2), face);
      return { ...room, pieces: [...room.pieces, { ...blank, a }] };
    }
    const stood = FLOOR_KINDS[kind];
    if (!stood) return null;
    const piece = { kind, x: 0, y: 0, turn: 0 as const };
    const [w, d] = stood.box(piece);
    const [fx, fy] = floorAt(view, sx, sy);
    return { ...room, pieces: [...room.pieces, { ...piece, x: snap(fx - w / 2), y: snap(fy - d / 2) }] };
  }
  // The room with the wall being drawn in it as far as a point of the picture: from
  // the corner there is, or a cell of it there where none has been clicked yet.
  function wallTo(sx: number, sy: number) {
    const { room } = scene;
    if (!drawing) return null;
    const [c, r] = cellAt(sx, sy);
    const from = corner ?? { c, r, joined: false };
    if (drawing !== CUT) return drawWall(room, drawing, from, c, r);
    // cutting: the room without the wall there is along the line, which may be none
    return { room: cutWalls(room, from, c, r), end: { c, r, joined: false }, line: lineOf(from, c, r) };
  }
  // The cell of the floor at a point of the picture. A wall that is being cut is
  // pointed at anywhere on it, however high up: then it is the cell of the wall
  // behind the point, and not the floor that would be seen through it.
  function cellAt(sx: number, sy: number): [c: number, r: number] {
    const { room, view } = scene;
    let [fx, fy] = floorAt(view, sx, sy);
    const under = drawing === CUT ? faceUnder(sx, sy) : undefined;
    // just behind the side of the wall that the point is on
    if (under && under.face.out > 0) [fx, fy] = wallPoint(room.size, under.face.wall, Math.min(under.a, under.face.to - 0.01), under.face.out - CELL / 2);
    const within = (v: number, side: number) => Math.max(0, Math.min(side / CELL - 1, Math.floor(v / CELL)));
    return [within(fx, room.size.w), within(fy, room.size.d)];
  }
  const howTo = () => (drawing === CUT ? 'Click on a wall where the cut starts, then where it ends. Esc stops.' : 'Click where the wall starts, then where it ends. Esc stops.');
  function stopDrawing() {
    drawing = null;
    corner = null;
    scene.mark = null;
  }
  const noRoom = (name: string) => `There is no room for another ${name.toLowerCase()}.`;
  // the walls that can be seen from where the camera stands, then the others
  const wallsInView = () => [...WALLS.filter((wall) => standing(scene.view, wall)), ...WALLS.filter((wall) => !standing(scene.view, wall))];

  const editor: Editor = {
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    start() {
      if (scene.editing) return;
      scene.editing = true;
      // what was done last time can still be undone, unless the room has been swapped since
      if (history.now !== scene.room) history = begin(scene.room);
      show(scene.room, null); // everyone is put in place, and there they stay
    },
    done() {
      if (!scene.editing) return;
      stopDrawing();
      Object.assign(scene, { editing: false, selected: null, preview: null });
      held = null;
      redraw();
      changed();
    },
    select(index) {
      if (!scene.editing) return;
      scene.selected = pieceOf(scene.room, index) ? index : null;
      redraw();
      changed();
    },

    build(kind) {
      if (!scene.editing) return;
      const next = kind && (kind === CUT || FLOOR_KINDS[kind]?.long) && kind !== drawing ? kind : null;
      stopDrawing();
      drawing = next;
      Object.assign(scene, { selected: null, preview: null });
      held = null;
      redraw();
      changed(next ? howTo() : '');
    },
    add(kind) {
      if (!scene.editing) return;
      stopDrawing();
      const room = addPiece(scene.room, kind, wallsInView());
      take(room, room && room.pieces.length - 1, noRoom((FLOOR_KINDS[kind] ?? WALL_KINDS[kind])?.name ?? 'piece'));
    },
    turn() {
      const piece = picked();
      if (piece) take(turnPiece(scene.room, scene.selected!), scene.selected, onWall(piece) ? 'It does not fit on the next wall.' : 'It does not fit turned that way here.');
    },
    remove() {
      if (picked()) take(removePiece(scene.room, scene.selected!), null, '');
    },
    duplicate() {
      const piece = picked();
      if (!piece) return;
      const room = duplicatePiece(scene.room, scene.selected!);
      take(room, room && room.pieces.length - 1, noRoom(nameOf(piece)));
    },
    stretch(way) {
      const room = picked() && stretchPiece(scene.room, scene.selected!, way);
      if (room && room !== scene.room) take(room, scene.selected, way > 0 ? 'There is no room to make it longer.' : NO_FIT);
    },
    nudge(dx, dy) {
      const piece = picked();
      if (!piece) return;
      const { cos, sin } = scene.view;
      if (onWall(piece)) {
        // along its wall, the way the arrow points across the picture
        const way = piece.wall === 'N' || piece.wall === 'S' ? Math.sign(cos) : -Math.sign(sin);
        if (dx) take(slidePiece(scene.room, scene.selected!, piece.wall, stepOn(piece.a, dx * way, STEP)), scene.selected, NO_FIT);
        return;
      }
      // the way across the picture and the way down it, as the floor's own x or y, whichever is nearer
      const flat = Math.abs(cos) >= Math.abs(sin);
      const x = flat ? dx * Math.sign(cos) : dy * Math.sign(sin);
      const y = flat ? dy * Math.sign(cos) : -dx * Math.sign(sin);
      const moved = settle(movePiece(scene.room, scene.selected!, stepOn(piece.x, x, CELL), stepOn(piece.y, y, CELL)), scene.selected!);
      take(moved.room, moved.index, NO_FIT);
    },

    resize(wider, deeper) {
      if (!scene.editing) return;
      const { w, d } = scene.room.size;
      // a wall cannot come in past what stands or hangs in its way
      take(resizeRoom(scene.room, w + wider * GROW, d + deeper * GROW), scene.selected, (wrong, room) => {
        const piece = pieceOf(room, wrong.piece);
        return piece ? `The ${nameOf(piece).toLowerCase()} is in the way.` : '';
      });
    },

    paint(hex) {
      const room = picked() && paintPiece(scene.room, scene.selected!, hex);
      if (room && room !== scene.room) take(room, scene.selected, '');
    },
    refinish(change) {
      if (!scene.editing) return;
      const room = finishRoom(scene.room, change);
      if (written(room) !== written(scene.room)) take(room, scene.selected, '');
    },

    undo() {
      if (!scene.editing || !history.past.length) return;
      history = undo(history);
      revisit(history.now);
    },
    redo() {
      if (!scene.editing || !history.future.length) return;
      history = redo(history);
      revisit(history.now);
    },
    reset() {
      editor.startFrom(DEFAULT_ID);
    },
    startFrom(id) {
      const room = READY.get(id);
      if (scene.editing && room && readyOf(scene.room) !== id) take(room, null, '');
    },
    copy: () => writeRoom(scene.room, modelsIn(scene.room)),
    paste(text) {
      if (!scene.editing) return;
      const pasted = readWritten(text);
      if (!pasted) return changed('That is not a room.');
      const { room } = pasted;
      if (written(room) === written(scene.room)) return changed(); // the room there is already
      // The models that came with it and are not here yet are taken in first, since
      // what a room has in it decides whether it will do; they go again if it will not.
      const fresh = pasted.models.filter((model) => !modelOf(model.id));
      fresh.forEach(addModel);
      const taken = take(room, null, (wrong) => {
        const piece = pieceOf(room, wrong.piece);
        return `That room will not do. ${piece ? `${nameOf(piece)}: ` : ''}${wrong.why}`;
      });
      if (!fresh.length) return;
      if (taken) return saveModels();
      for (const model of fresh) dropModel(model.id);
      changed(state.note); // the list to add from, without them again
    },

    importModel(given) {
      if (!scene.editing) return;
      const model = ModelSchema.safeParse(given);
      if (!model.success) return changed('That model cannot be kept.');
      addModel(model.data);
      saveModels();
      const room = addPiece(scene.room, model.data.id);
      take(room, room && room.pieces.length - 1, `${model.data.name} is in the list to add from. There is no room for one just now.`);
    },
    renameModel(id, name) {
      const model = modelOf(id);
      const named = model && ModelSchema.safeParse({ ...model, name });
      if (!scene.editing || !named) return;
      if (!named.success) return changed('A name is from 1 to 40 letters.');
      addModel(named.data);
      saveModels();
      redraw();
      changed();
    },
    deleteModel(id) {
      const model = modelOf(id);
      if (!scene.editing || !model) return;
      const room: Room = { ...scene.room, pieces: scene.room.pieces.filter((piece) => piece.kind !== id) };
      forgotten.set(id, model);
      dropModel(id);
      saveModels();
      if (room.pieces.length === scene.room.pieces.length) return changed();
      history = commit(history, room);
      keep(room, null);
    },

    grab(sx, sy) {
      if (!scene.editing || drawing) return false; // a wall is drawn with clicks, and a drag still turns the room
      const index = pieceAt(scene, sx, sy);
      const piece = pieceOf(scene.room, index);
      if (!piece) return false;
      if (onWall(piece)) {
        // held by the point of its wall that was under the pointer
        held = { index, dx: wallAt(scene.view, scene.room.size, piece.wall, sx, sy, piece.out)[0] - piece.a, dy: 0 };
      } else {
        // held by the point of the floor that was under the pointer, however high up the piece the click was
        const [x, y] = floorAt(scene.view, sx, sy);
        held = { index, dx: x - piece.x, dy: y - piece.y };
      }
      editor.select(index);
      return true;
    },
    drag(sx, sy) {
      if (!held) return;
      const { size } = scene.room;
      const shown = scene.preview ? scene.preview.room.pieces[scene.preview.piece] : scene.room.pieces[held.index];
      let room: Room;
      let index = held.index;
      if (onWall(shown)) {
        // along the wall it is on, or onto another once the pointer is over that one:
        // one of the room's own, or either side of a wall that stands in the room
        const face = faceUnder(sx, sy)?.face ?? faceOf(shown);
        const a = alongWall(scene.room, shown, face.wall, snapAlong(wallAt(scene.view, size, face.wall, sx, sy, face.out)[0] - held.dx), face);
        if (shown.wall === face.wall && (shown.out ?? 0) === face.out && shown.a === a) return; // still at the same place
        room = slidePiece(scene.room, held.index, face.wall, a, face.out);
      } else {
        const [fx, fy] = floorAt(scene.view, sx, sy);
        const [x, y] = [snap(fx - held.dx), snap(fy - held.dy)];
        if (shown.x === x && shown.y === y) return; // still over the same cell
        ({ room, index } = settle(movePiece(scene.room, held.index, x, y), held.index));
      }
      scene.preview = { room, layout: layoutOf(room), piece: index, fits: !problemsOf(room).length };
      scene.selected = index; // a door set in a wall may have another number
      redraw();
    },
    drop() {
      const { preview } = scene;
      if (!held) return;
      const { index } = held;
      held = null;
      if (!preview) return; // a click, not a drag
      if (preview.fits) return void take(preview.room, preview.piece, NO_FIT);
      scene.preview = null; // back where it was
      scene.selected = index;
      redraw();
      changed(NO_FIT);
    },
    tap(sx, sy) {
      if (!scene.editing) return;
      if (!drawing || sx === undefined || sy === undefined) {
        if (scene.selected !== null) editor.select(null);
        return;
      }
      const drawn = wallTo(sx, sy);
      if (!drawn) return;
      if (!corner) {
        // the first click: where it starts, shown as a cell of wall until the second
        corner = { ...drawn.end, joined: false };
        return editor.hover(sx, sy);
      }
      if (drawing === CUT) {
        // a cut is the one line, and the next starts afresh
        corner = null;
        scene.mark = null;
        if (drawn.room !== scene.room) return void (take(drawn.room, null, NO_FIT) && changed(howTo()));
        redraw();
        return changed('There is no wall there to cut.');
      }
      if (!take(drawn.room, null, NO_FIT)) return;
      corner = drawn.end; // and the next goes on from where this one ended
      changed('Click again to carry on from there. Esc stops.');
    },
    hover(sx, sy) {
      if (!scene.editing || !drawing || held) return;
      const drawn = wallTo(sx, sy);
      if (drawn && 'line' in drawn) {
        // a cut is shown as a line round what would go
        if (scene.mark && scene.mark.join() === drawn.line.join()) return;
        scene.mark = drawn.line;
        return redraw();
      }
      if (!drawn) {
        if (!scene.preview) return;
        scene.preview = null;
        return redraw();
      }
      const index = drawn.room.pieces.length - 1;
      const shown = scene.preview?.piece === index ? scene.preview.room.pieces[index] : undefined;
      if (shown && JSON.stringify(shown) === JSON.stringify(drawn.room.pieces[index])) return; // still to the same cell
      scene.preview = { room: drawn.room, layout: layoutOf(drawn.room), piece: index, fits: !problemsOf(drawn.room).length };
      redraw();
    },

    carry(kind, sx, sy) {
      if (!scene.editing || held) return;
      const made = withNew(kind, sx, sy);
      if (!made) return editor.letGo(); // over nothing it can go on
      const { room, index } = made;
      const shown = scene.preview?.piece === index ? scene.preview.room.pieces[index] : undefined;
      if (shown && JSON.stringify(shown) === JSON.stringify(room.pieces[index])) return; // still at the same place
      scene.preview = { room, layout: layoutOf(room), piece: index, fits: !problemsOf(room).length };
      scene.selected = index; // so that it is drawn with a line round it
      redraw();
    },
    put(kind, sx, sy) {
      if (!scene.editing || held) return;
      stopDrawing();
      const made = withNew(kind, sx, sy);
      const carried = scene.preview !== null;
      scene.preview = null;
      scene.selected = null;
      const taken = made ? take(made.room, made.index, NO_FIT) : false;
      if (!made) changed(WALL_KINDS[kind] ? 'That hangs on a wall. Drop it on one.' : NO_FIT);
      if (!taken && carried) redraw(); // without the piece that was shown
    },
    letGo() {
      if (!scene.preview || held) return;
      scene.preview = null;
      scene.selected = null;
      redraw();
      changed();
    },
    key(event) {
      if (!scene.editing) return false;
      const key = event.key.toLowerCase();
      if (event.ctrlKey || event.metaKey) {
        if (key === 'z' && !event.shiftKey) editor.undo();
        else if (key === 'y' || (key === 'z' && event.shiftKey)) editor.redo();
        else return false;
        return true;
      }
      if (drawing && key === 'escape') {
        // first the wall in hand is let go of, then the drawing
        if (!corner) return editor.build(null), true;
        corner = null;
        scene.preview = null;
        scene.mark = null;
        redraw();
        changed(howTo());
        return true;
      }
      if (!picked()) return false; // with nothing picked out, the arrows turn the room as ever
      if (key === 'arrowleft') editor.nudge(-1, 0);
      else if (key === 'arrowright') editor.nudge(1, 0);
      else if (key === 'arrowup') editor.nudge(0, -1);
      else if (key === 'arrowdown') editor.nudge(0, 1);
      else if (key === 'r') editor.turn();
      else if (key === '[') editor.stretch(-1);
      else if (key === ']') editor.stretch(1);
      else if (key === 'delete' || key === 'backspace') editor.remove();
      else if (key === 'escape') editor.select(null);
      else return false;
      return true;
    },
  };
  return editor;
}
