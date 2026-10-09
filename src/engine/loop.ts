import { aim } from './camera';
import { moveCat } from './cat';
import { draw } from './draw';
import { buildOffice } from './office';
import type { Scene } from './scene';
import type { Sim } from './sim';

const FRAME_MS = 180;
const RELIGHT_MS = 60 * 1000;

export interface Loop {
  // the camera or the light moved, so the office has to be redrawn from scratch
  lookAgain(): void;
  stop(): void;
}

export function startLoop(scene: Scene, sim: Sim): Loop {
  let stale = true;
  let queued = 0;

  function render() {
    queued = 0;
    if (stale) {
      scene.view = aim(scene.camera);
      buildOffice(scene);
      sim.moveTags();
      stale = false;
    }
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
    render();
  }, FRAME_MS);

  return {
    lookAgain,
    stop() {
      clearInterval(relighting);
      clearInterval(ticking);
      cancelAnimationFrame(queued);
    },
  };
}
