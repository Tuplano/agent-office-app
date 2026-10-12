import { draw } from './draw';
import { type Editor, makeEditor } from './editor';
import { attachInput } from './input';
import { startLoop } from './loop';
import type { Room } from './room';
import { makeScene, type SessionView } from './scene';
import { makeSim } from './sim';
import { loadRoom, saveRoom } from './store';
import { type Problem, problemsOf } from './valid';

export interface OfficeView {
  sessions: readonly SessionView[];
}

export interface Office {
  // shows the sessions as they are now
  apply(state: OfficeView): void;
  // marks one session's name tag as pointed at, or none
  point(id: string | null): void;
  // Swaps the room for another and keeps it for next time. Everyone is put where
  // they now belong. A room with something wrong with it is not taken: what is
  // wrong comes back, and nothing changes.
  setRoom(room: Room): Problem[];
  // rearranging the furniture on the canvas
  edit: Editor;
  destroy(): void;
}

// Draws the office on `canvas` and keeps it moving until destroyed. The name tags
// that follow people around go in `tagsLayer`, which lies over the canvas.
export function createOffice(canvas: HTMLCanvasElement, tagsLayer: HTMLElement): Office {
  const scene = makeScene(canvas, tagsLayer, loadRoom());
  const sim = makeSim(scene);
  const loop = startLoop(scene, sim);
  const edit = makeEditor(scene, sim, loop.redraw);
  const detach = attachInput(scene, loop.lookAgain, edit);
  return {
    apply(state) {
      sim.apply(state.sessions);
      draw(scene);
    },
    point: sim.point,
    edit,
    setRoom(room) {
      const problems = problemsOf(room);
      if (problems.length) return problems;
      sim.setRoom(room);
      loop.redraw();
      saveRoom(room);
      return [];
    },
    destroy() {
      detach();
      loop.stop();
      for (const desk of scene.desks.values()) desk.tag.remove();
    },
  };
}

export { sessionTint } from './palette';
export { DEFAULT_ROOM, type Room } from './room';
export type { Editor, EditState } from './editor';
export { PALETTE } from './edit';
export type { Problem } from './valid';
