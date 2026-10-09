import { clamp, HOME, PITCH, saveCamera, ZOOM } from './camera';
import { CENTRE_Y, SCENE_H, SCENE_W } from './constants';
import type { Scene } from './scene';

// Drag to turn and tilt the room, drag with shift or the right button to slide
// it, pinch or scroll to zoom, double-click to go back to the starting view.
// Returns what takes the listeners off again.
export function attachInput(scene: Scene, lookAgain: () => void): () => void {
  const { canvas, camera } = scene;
  const listening = new AbortController();
  const on = { signal: listening.signal };
  const fingers = new Map<number, [number, number]>();
  let pinch = 0;

  // Zooms about a point on the page, so what is under the cursor stays under it.
  function zoomBy(factor: number, clientX: number, clientY: number) {
    const zoom = clamp(camera.zoom * factor, ZOOM);
    const by = zoom / camera.zoom;
    const box = canvas.getBoundingClientRect();
    const px = ((clientX - box.left) / box.width) * SCENE_W;
    const py = ((clientY - box.top) / box.height) * SCENE_H;
    camera.panX = px - (px - SCENE_W / 2 - camera.panX) * by - SCENE_W / 2;
    camera.panY = py - (py - CENTRE_Y - camera.panY) * by - CENTRE_Y;
    camera.zoom = zoom;
    lookAgain();
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      fingers.set(event.pointerId, [event.clientX, event.clientY]);
      canvas.setPointerCapture(event.pointerId);
      pinch = 0;
    },
    on,
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      const last = fingers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last[0];
      const dy = event.clientY - last[1];
      fingers.set(event.pointerId, [event.clientX, event.clientY]);
      if (fingers.size > 1) {
        const [a, b] = [...fingers.values()];
        const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (pinch) zoomBy(gap / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        pinch = gap;
      } else if (event.shiftKey || event.buttons & 6) {
        const scale = SCENE_W / canvas.clientWidth;
        camera.panX += dx * scale;
        camera.panY += dy * scale;
      } else {
        camera.yaw -= dx * 0.008;
        camera.pitch = clamp(camera.pitch + dy * 0.005, PITCH);
      }
      lookAgain();
    },
    on,
  );
  for (const type of ['pointerup', 'pointercancel'] as const) {
    canvas.addEventListener(
      type,
      (event) => {
        fingers.delete(event.pointerId);
        pinch = 0;
        saveCamera(camera);
      },
      on,
    );
  }
  canvas.addEventListener('contextmenu', (event) => event.preventDefault(), on);
  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
      saveCamera(camera);
    },
    { passive: false, signal: listening.signal },
  );
  canvas.addEventListener(
    'dblclick',
    () => {
      Object.assign(camera, HOME);
      lookAgain();
      saveCamera(camera);
    },
    on,
  );
  addEventListener(
    'keydown',
    (event) => {
      if (event.target !== document.body || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'ArrowLeft') camera.yaw += Math.PI / 12;
      else if (event.key === 'ArrowRight') camera.yaw -= Math.PI / 12;
      else if (event.key === 'ArrowUp') camera.pitch = clamp(camera.pitch + Math.PI / 36, PITCH);
      else if (event.key === 'ArrowDown') camera.pitch = clamp(camera.pitch - Math.PI / 36, PITCH);
      else if (event.key === '+' || event.key === '=') camera.zoom = clamp(camera.zoom * 1.2, ZOOM);
      else if (event.key === '-') camera.zoom = clamp(camera.zoom / 1.2, ZOOM);
      else return;
      event.preventDefault();
      lookAgain();
      saveCamera(camera);
    },
    on,
  );

  return () => listening.abort();
}
