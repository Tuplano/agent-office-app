import { clamp, HOME, PITCH, saveCamera, ZOOM } from './camera';
import { CENTRE_Y, SCENE_H, SCENE_W } from './constants';
import type { Hands } from './editor';
import type { Scene } from './scene';

const SLIP = 4; // how far the pointer may move, in pixels of the page, and still have clicked

// Drag to turn and tilt the room, drag with shift or the right button to slide
// it, pinch or scroll to zoom, double-click to go back to the starting view.
// In edit mode a drag that starts on a piece moves the piece, and the keys go to
// the piece picked out; `hands` is asked first. Returns what takes the listeners
// off again.
export function attachInput(scene: Scene, lookAgain: () => void, hands?: Hands): () => void {
  const { canvas, camera } = scene;
  const listening = new AbortController();
  const on = { signal: listening.signal };
  const fingers = new Map<number, [number, number]>();
  let pinch = 0;
  let holding = -1; // the pointer that has hold of a piece
  let pressed: [number, number] | null = null; // where the one pointer went down, until it has moved off
  let dragging = false;

  // a point of the page as a point of the picture
  function inScene(clientX: number, clientY: number): [number, number] {
    const box = canvas.getBoundingClientRect();
    return [((clientX - box.left) / box.width) * SCENE_W, ((clientY - box.top) / box.height) * SCENE_H];
  }

  // Zooms about a point on the page, so what is under the cursor stays under it.
  function zoomBy(factor: number, clientX: number, clientY: number) {
    const zoom = clamp(camera.zoom * factor, ZOOM);
    const by = zoom / camera.zoom;
    const [px, py] = inScene(clientX, clientY);
    camera.panX = px - (px - SCENE_W / 2 - camera.panX) * by - SCENE_W / 2;
    camera.panY = py - (py - CENTRE_Y - camera.panY) * by - CENTRE_Y;
    camera.zoom = zoom;
    lookAgain();
  }

  canvas.addEventListener(
    'pointerdown',
    (event) => {
      const alone = fingers.size === 0;
      fingers.set(event.pointerId, [event.clientX, event.clientY]);
      canvas.setPointerCapture(event.pointerId);
      pinch = 0;
      pressed = alone ? [event.clientX, event.clientY] : null;
      dragging = false;
      if (alone && event.button === 0 && !event.shiftKey && hands?.grab(...inScene(event.clientX, event.clientY))) holding = event.pointerId;
    },
    on,
  );
  canvas.addEventListener(
    'pointermove',
    (event) => {
      const last = fingers.get(event.pointerId);
      if (!last) return hands?.hover(...inScene(event.clientX, event.clientY)); // only passing over
      const dx = event.clientX - last[0];
      const dy = event.clientY - last[1];
      fingers.set(event.pointerId, [event.clientX, event.clientY]);
      if (pressed && Math.hypot(event.clientX - pressed[0], event.clientY - pressed[1]) > SLIP) pressed = null;
      if (holding === event.pointerId) {
        // a hand that only shook has not dragged anything
        if (!pressed) dragging = true;
        if (dragging) hands?.drag(...inScene(event.clientX, event.clientY));
        return;
      }
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
        if (holding === event.pointerId) {
          holding = -1;
          hands?.drop();
          return;
        }
        if (pressed && type === 'pointerup') hands?.tap(...inScene(event.clientX, event.clientY)); // a click on nothing
        pressed = null;
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
      // edit mode's keys work from its buttons too, though not from somewhere to type
      const typing = event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]');
      if (!typing && !event.altKey && hands?.key(event)) return event.preventDefault();
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
