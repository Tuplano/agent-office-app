import { floorAt, wallAt } from './camera';
import { CELL, WH } from './constants';
import {
  addPiece, alongWall, begin, commit, duplicatePiece, GROW, type History, movePiece, nameOf, PALETTE, pieceOf, redo, removePiece, resizeRoom,
  slidePiece, snap, snapAlong, STEP, stepOn, turnPiece, undo, WALLS,
} from './edit';
import { layoutOf } from './layout';
import { standing, wallLength } from './place';
import { DEFAULT_ROOM, onWall, type Room, RoomSchema } from './room';
import { pieceAt, type Scene } from './scene';
import type { Sim } from './sim';
import { saveRoom } from './store';
import { problemsOf } from './valid';

// What the page needs to know about the editing, to show its buttons.
export interface EditState {
  on: boolean;
  selected: number | null; // the piece picked out, by its number in the room
  canUndo: boolean;
  canRedo: boolean;
  canReset: boolean; // the room is not the one the app starts with
  size: { w: number; d: number }; // how wide and how deep the room is
  pieces: readonly { index: number; name: string; wall: boolean }[]; // what is in the room, and whether it hangs on a wall
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
  undo(): void;
  redo(): void;
  // back to the room the app starts with; can be undone
  reset(): void;
}

const NO_FIT = 'It does not fit there.';
const PALETTE_NAMES = new Map(PALETTE.map(({ kind, name }) => [kind, name]));
// Whether two rooms are the same room. One that has been saved and read back has
// its pieces' fields in the schema's order, so both are put in that order first.
const written = (room: Room) => JSON.stringify(RoomSchema.parse(room));
const DEFAULT = written(DEFAULT_ROOM);
const isDefault = (room: Room) => room === DEFAULT_ROOM || written(room) === DEFAULT;

export function makeEditor(scene: Scene, sim: Sim, redraw: () => void): Editor {
  let history: History = begin(scene.room);
  // the piece in hand, and how far its corner is from the point it is held by
  let held: { index: number; dx: number; dy: number } | null = null;
  let note = '';
  const listeners = new Set<() => void>();

  const snapshot = (): EditState => ({
    on: scene.editing,
    selected: scene.selected,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    canReset: !isDefault(scene.room),
    size: scene.room.size,
    pieces: scene.room.pieces.flatMap((_, index) => {
      const piece = pieceOf(scene.room, index);
      return piece ? [{ index, name: nameOf(piece), wall: onWall(piece) }] : [];
    }),
    note,
  });
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
  // takes a changed room if it is a sound one; says why not otherwise
  function take(room: Room | null, selected: number | null, whyNot: string) {
    const wrong = room && problemsOf(room)[0];
    if (!room || wrong) return changed(whyNot || (wrong ? wrong.why : ''));
    history = commit(history, room);
    keep(room, selected);
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
      history = begin(scene.room);
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
      take(room, room && room.pieces.length - 1, noRoom(PALETTE_NAMES.get(kind) ?? 'piece'));
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
      const room = resizeRoom(scene.room, w + wider * GROW, d + deeper * GROW);
      // a wall cannot come in past what stands or hangs in its way
      const [wrong] = problemsOf(room);
      const piece = wrong && pieceOf(room, wrong.piece);
      take(room, scene.selected, piece ? `The ${nameOf(piece).toLowerCase()} is in the way.` : '');
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
      if (scene.editing && !isDefault(scene.room)) take(DEFAULT_ROOM, null, '');
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
