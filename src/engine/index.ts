import { draw } from './draw';
import { type Editor, makeEditor } from './editor';
import { loadModels } from './models';
import { attachInput } from './input';
import { startLoop } from './loop';
import type { Room } from './room';
import { makeScene, type SessionView } from './scene';
import { makeSim } from './sim';
import { loadRoom, saveRoom } from './store';
import { type Problem, problemsOf } from './valid';
import { type Look, makeYou, walkTo } from './you';

export interface OfficeView {
  sessions: readonly SessionView[];
}

export interface Office {
  // shows the sessions as they are now
  apply(state: OfficeView): void;
  // marks one session's name tag as pointed at, or none
  point(id: string | null): void;
  // marks one session's name tag as the one picked out, or none
  pickOut(id: string | null): void;
  // Swaps the room for another and keeps it for next time. Everyone is put where
  // they now belong. A room with something wrong with it is not taken: what is
  // wrong comes back, and nothing changes.
  setRoom(room: Room): Problem[];
  // how you look in the room
  setLook(look: Look): void;
  // rearranging the furniture on the canvas
  edit: Editor;
  destroy(): void;
}

// Draws the office on `canvas` and keeps it moving until destroyed. The name tags
// that follow people around go in `tagsLayer`, which lies over the canvas.
export function createOffice(canvas: HTMLCanvasElement, tagsLayer: HTMLElement): Office {
  loadModels(); // before the room, which may have pieces of them
  const scene = makeScene(canvas, tagsLayer, loadRoom());
  scene.you = makeYou(scene); // before anyone else is given a place on the floor
  const sim = makeSim(scene);
  const loop = startLoop(scene, sim);
  const edit = makeEditor(scene, sim, loop.redraw);
  // a click on the room walks you there
  const detach = attachInput(scene, loop.lookAgain, edit, (sx, sy) => walkTo(scene, sx, sy) && draw(scene));
  return {
    apply(state) {
      sim.apply(state.sessions);
      draw(scene);
    },
    point: sim.point,
    setLook(look) {
      if (!scene.you) return;
      scene.you.look = look;
      draw(scene);
    },
    pickOut: sim.pickOut,
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
      scene.you?.tag.remove();
    },
  };
}

export { sessionTint } from './palette';
export { DEFAULT_ROOM, type Room } from './room';
export { BLANK_ID, READY_ROOMS, type ReadyRoom } from './rooms';
export type { Editor, EditState } from './editor';
export { CUT, GROW, PALETTE } from './edit';
export { LIMITS, type Model } from './models';
export { drawPreview, drawRoom, previewPoint } from './preview';
export { drawThumb, THUMB } from './thumbs';
export type { View } from './camera';
export { SCENE_H, SCENE_W } from './constants';
export { TABLE_TOP } from './layout';
export { type Finish, lookOf, PLAIN, randomFinish, randomTint } from './finish';
export { type Problem, SIDE } from './valid';
export { FIRST_LOOK, LOOK_CHOICES, type Look as YouLook } from './you';
