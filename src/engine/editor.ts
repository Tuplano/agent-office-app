import { floorAt, wallAt } from './camera';
import { CELL, WH } from './constants';
import {
  addPiece, alongWall, begin, commit, duplicatePiece, finishRoom, GROW, type History, movePiece, nameOf, paintPiece, PALETTE, pieceOf, redo,
  removePiece, resizeRoom, slidePiece, snap, snapAlong, STEP, stepOn, tintOf, turnPiece, undo, WALLS,
} from './edit';
import type { Finish } from './finish';
import { layoutOf } from './layout';
import { addModel, dropModel, listModels, type Model, modelOf, ModelSchema, modelsIn, saveModels } from './models';
import { FLOOR_KINDS } from './pieces';
import { standing, wallLength } from './place';
import { onWall, type Room, RoomSchema } from './room';
import { DEFAULT_ID, READY_ROOMS } from './rooms';
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
  ready: string | null; // the ready-made room this one is, if it is one of them just as it comes
  size: { w: number; d: number }; // how wide and how deep the room is
  finish: Finish; // the colours the room has that are not the ones it comes in
  // What there is to add to a room: the kinds written in code, then the models
  // that were brought in, each with how many of it the room has.
  palette: readonly { kind: string; name: string; wall: boolean; own: boolean; used: number }[];
  // what is in the room: whether each hangs on a wall, and its colour if it has one of its own to choose
  pieces: readonly { index: number; name: string; wall: boolean; tint: string | null }[];
  note: string; // why the last thing asked for was not done, or nothing
}

// What edit mode does with the pointer and the keys; input.ts asks it first.
export interface Hands {
  // takes hold of the piece at a point of the picture; false when there is none, or no editing
  grab(sx: number, sy: number): boolean;
  drag(sx: number, sy: number): void;
  drop(): void;
  // a click on nothing lets go of the piece picked out
  tap(): void;
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
  // these act on the piece picked out; a turn takes a piece on a wall round to the next wall
  turn(): void;
  remove(): void;
  duplicate(): void;
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
  // the room replaced by one of the ready-made ones; can be undone
  startFrom(id: string): void;
  // the room written out, with the models its pieces are of, to be pasted in somewhere else
  copy(): string;
  // A model that was made in a 3D tool joins the palette, for good, and one of it
  // is put in the room if there is room.
  importModel(model: Model): void;
  renameModel(id: string, name: string): void;
  // the model is forgotten, and every piece of it leaves the room
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
const READY = new Map(READY_ROOMS.map(({ id, room }) => [id, room]));
const READY_IDS = new Map(READY_ROOMS.map(({ id, room }) => [written(room), id]));
const readyOf = (room: Room) => READY_IDS.get(written(room)) ?? null;

export function makeEditor(scene: Scene, sim: Sim, redraw: () => void): Editor {
  let history: History = begin(scene.room);
  // the piece in hand, and how far its corner is from the point it is held by
  let held: { index: number; dx: number; dy: number } | null = null;
  let note = '';
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
      pieces: scene.room.pieces.flatMap((_, index) => {
        const piece = pieceOf(scene.room, index);
        return piece ? [{ index, name: nameOf(piece), wall: onWall(piece), tint: tintOf(piece) }] : [];
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

    add(kind) {
      if (!scene.editing) return;
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
      take(movePiece(scene.room, scene.selected!, stepOn(piece.x, x, CELL), stepOn(piece.y, y, CELL)), scene.selected, NO_FIT);
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
      keep(history.now, null);
    },
    redo() {
      if (!scene.editing || !history.future.length) return;
      history = redo(history);
      keep(history.now, null);
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
      if (!scene.editing || !modelOf(id)) return;
      const room: Room = { ...scene.room, pieces: scene.room.pieces.filter((piece) => piece.kind !== id) };
      dropModel(id);
      saveModels();
      if (room.pieces.length === scene.room.pieces.length) return changed();
      history = commit(history, room);
      keep(room, null);
    },

    grab(sx, sy) {
      if (!scene.editing) return false;
      const index = pieceAt(scene, sx, sy);
      const piece = pieceOf(scene.room, index);
      if (!piece) return false;
      if (onWall(piece)) {
        // held by the point of its wall that was under the pointer
        held = { index, dx: wallAt(scene.view, scene.room.size, piece.wall, sx, sy)[0] - piece.a, dy: 0 };
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
      const shown = (scene.preview ?? scene).room.pieces[held.index];
      let room: Room;
      if (onWall(shown)) {
        // along the wall it is on, or onto another wall once the pointer is over that one
        const over = (wall: (typeof WALLS)[number]) => {
          const [a, z] = wallAt(scene.view, size, wall, sx, sy);
          return a >= 0 && a <= wallLength(size, wall) && z >= 0 && z <= WH;
        };
        const wall = WALLS.find((other) => other !== shown.wall && standing(scene.view, other) && over(other)) ?? shown.wall;
        const a = alongWall(scene.room, shown, wall, snapAlong(wallAt(scene.view, size, wall, sx, sy)[0] - held.dx));
        if (shown.wall === wall && shown.a === a) return; // still at the same place
        room = slidePiece(scene.room, held.index, wall, a);
      } else {
        const [fx, fy] = floorAt(scene.view, sx, sy);
        const [x, y] = [snap(fx - held.dx), snap(fy - held.dy)];
        if (shown.x === x && shown.y === y) return; // still over the same cell
        room = movePiece(scene.room, held.index, x, y);
      }
      scene.preview = { room, layout: layoutOf(room), piece: held.index, fits: !problemsOf(room).length };
      redraw();
    },
    drop() {
      const { preview } = scene;
      if (!held) return;
      const { index } = held;
      held = null;
      if (!preview) return; // a click, not a drag
      if (preview.fits) return take(preview.room, index, NO_FIT);
      scene.preview = null; // back where it was
      redraw();
      changed(NO_FIT);
    },
    tap() {
      if (scene.editing && scene.selected !== null) editor.select(null);
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
      if (!picked()) return false; // with nothing picked out, the arrows turn the room as ever
      if (key === 'arrowleft') editor.nudge(-1, 0);
      else if (key === 'arrowright') editor.nudge(1, 0);
      else if (key === 'arrowup') editor.nudge(0, -1);
      else if (key === 'arrowdown') editor.nudge(0, 1);
      else if (key === 'r') editor.turn();
      else if (key === 'delete' || key === 'backspace') editor.remove();
      else if (key === 'escape') editor.select(null);
      else return false;
      return true;
    },
  };
  return editor;
}
