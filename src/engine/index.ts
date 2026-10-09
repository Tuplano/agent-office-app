import { draw } from './draw';
import { attachInput } from './input';
import { startLoop } from './loop';
import { makeScene, type SessionView } from './scene';
import { makeSim } from './sim';

export interface OfficeView {
  sessions: readonly SessionView[];
}

export interface Office {
  // shows the sessions as they are now
  apply(state: OfficeView): void;
  // marks one session's name tag as pointed at, or none
  point(id: string | null): void;
  destroy(): void;
}

// Draws the office on `canvas` and keeps it moving until destroyed. The name tags
// that follow people around go in `tagsLayer`, which lies over the canvas.
export function createOffice(canvas: HTMLCanvasElement, tagsLayer: HTMLElement): Office {
  const scene = makeScene(canvas, tagsLayer);
  const sim = makeSim(scene);
  const loop = startLoop(scene, sim);
  const detach = attachInput(scene, loop.lookAgain);
  return {
    apply(state) {
      sim.apply(state.sessions);
      draw(scene);
    },
    point: sim.point,
    destroy() {
      detach();
      loop.stop();
      for (const desk of scene.desks.values()) desk.tag.remove();
    },
  };
}

export { sessionTint } from './palette';
