import { aim } from './camera';
import { moveCat } from './cat';
import { draw } from './draw';
import { buildOffice } from './office';
import type { Scene } from './scene';
import type { Sim } from './sim';
import { moveYou, moveYouTag } from './you';

const FRAME_MS = 180;
const RELIGHT_MS = 60 * 1000;

export interface Loop {
  // the camera or the light moved, so the office has to be redrawn from scratch
  lookAgain(): void;
  // the same, without waiting for the next frame: the room itself has changed
  redraw(): void;
  stop(): void;
}

export function startLoop(scene: Scene, sim: Sim): Loop {
  let stale = true;
  let queued = 0;

  function render() {
    queued = 0;
    if (stale) {
      scene.view = aim(scene.camera, scene.room.size);
      buildOffice(scene);
      sim.moveTags();
      stale = false;
    }
    moveYouTag(scene);
    draw(scene);
  }
  function lookAgain() {
    stale = true;
    if (queued) return;
    queued = requestAnimationFrame(render);
  }

  render();
  // the light follows the time of day
  const relighting = setInterval(() => {
    if (scene.light.relight()) lookAgain();
  }, RELIGHT_MS);
  const ticking = setInterval(() => {
    scene.frame++;
    sim.tick();
    moveCat(scene);
    moveYou(scene);
    render();
  }, FRAME_MS);

  return {
    lookAgain,
    redraw() {
      stale = true;
      render();
    },
    stop() {
      clearInterval(relighting);
      clearInterval(ticking);
      cancelAnimationFrame(queued);
    },
  };
}
