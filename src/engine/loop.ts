import { aim } from './camera';
import { draw } from './draw';
import { buildOffice } from './office';
import type { Scene } from './scene';

const FRAME_MS = 180;
const RELIGHT_MS = 60 * 1000;

export interface Loop {
  // the camera or the light moved, so the office has to be redrawn from scratch
  lookAgain(): void;
  stop(): void;
}

export function startLoop(scene: Scene): Loop {
  let stale = true;
  let queued = 0;

  function render() {
    queued = 0;
    if (stale) {
      scene.view = aim(scene.camera);
      buildOffice(scene);
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
    scene.doorOpen = Math.max(0, scene.doorOpen - 1);
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
