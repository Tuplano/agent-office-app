import { project, towardCamera } from './camera';
import { drawCat } from './cat';
import { FACING } from './constants';
import { ADULT, drawIntern, drawSupervisor, drawWorker, poseOf } from './figures';
import { type Clock, CLOCKS, SEATS } from './layout';
import { CHARCOAL, INK, LIME, PAPER, TANGERINE } from './palette';
import type { Desk, Scene } from './scene';

const DIGITS = [
  [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
]; // each row of a digit as three bits
const HOUR12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;

function drawClock(scene: Scene, clock: Clock) {
  if (towardCamera(scene.view, clock.inside) <= 0.08) return; // its wall is not standing
  const now = new Date();
  const hours = HOUR12 ? now.getHours() % 12 || 12 : now.getHours();
  const text = `${String(hours).padStart(2, HOUR12 ? ' ' : '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const cell = (col: number, row: number) => {
    const a = clock.a + (clock.flip ? 16 - col : col);
    scene.pen.face(clock.inside, a, a + 1, clock.at, clock.z + 4 - row, clock.z + 5 - row, TANGERINE, true);
  };
  let col = 0;
  for (const c of text) {
    if (c === ':') {
      // blinks with the seconds
      if (scene.reduced || now.getSeconds() % 2 === 0) {
        cell(col, 1);
        cell(col, 3);
      }
      col += 2;
      continue;
    }
    const rows = DIGITS[parseInt(c, 10)] || []; // a space, for a one-digit hour, draws nothing
    rows.forEach((bits, row) => {
      for (let i = 0; i < 3; i++) if (bits & (4 >> i)) cell(col + i, row);
    });
    col += 4;
  }
}

// the things in the room that move on their own
function drawProps(scene: Scene) {
  const { pen, light } = scene;
  const f = scene.reduced ? 1 : scene.frame;
  // door: swung into the room while someone is passing, shut otherwise
  if (towardCamera(scene.view, 'S') > 0.08) {
    if (scene.doorOpen) {
      pen.box(82.5, 0, 0, 0.6, 7, 20, TANGERINE);
    } else {
      pen.south(82.5, 89.5, 0, 0, 20, TANGERINE);
      light.glow(() => pen.south(84.5, 87.5, 0, 11.5, 17, light.now.sky));
      pen.south(88, 89, 0, 8.5, 9.5, CHARCOAL);
    }
  }
  light.glow(() => {
    // coffee machine light
    pen.east(6, 55, 56, 13.5, 14.5, f % 6 < 3 ? TANGERINE : '#7a3a26', true);
    // arcade screen
    pen.south(121 + (f % 6), 123 + (f % 6), 101, 16.5, 17.5, LIME);
    pen.south(123, 125, 101, 13.5, 14, TANGERINE);
    pen.south(124, 125, 101, 14.5 + (f % 3) * 0.5, 15 + (f % 3) * 0.5, PAPER);
    for (const clock of CLOCKS) drawClock(scene, clock);
  });
  drawCat(scene);
  // ping-pong ball: a rally with two players, keepy-uppy with one, at rest with none
  const playing = (i: number) => [...scene.desks.values()].some((d) => d.play === i && d.at && !d.path.length);
  const west = playing(0);
  const east = playing(1);
  const beat = f % 8;
  const hopZ = [0, 2, 3, 2, 0, 2, 3, 2][beat];
  if (west && east) pen.box(78 + [0, 5, 10, 15, 20, 15, 10, 5][beat], 112, 9 + hopZ, 1, 1, 1, PAPER);
  else if (west || east) pen.box(west ? 78 : 97, 112, 9 + hopZ * 1.5, 1, 1, 1, PAPER);
  else pen.box(82, 110, 8, 1, 1, 1, PAPER);
}

// things that float above a worker's head, never hidden
function drawMarks(scene: Scene, desk: Desk) {
  const s = desk.data;
  const pose = poseOf(desk);
  const f = scene.reduced ? 0 : scene.frame + (desk.seed % 7);
  const [fx, fy] = FACING[pose.dir];
  const head = pose.base + ADULT.tall + ADULT.face;
  // a screen-space rectangle pinned to a world point, drawn over everything
  const dotAt = (x: number, y: number, z: number) => {
    const [sx, sy] = project(scene.view, x, y, z);
    return (dx: number, dy: number, w: number, h: number, color: string) => {
      scene.ctx.fillStyle = color;
      scene.ctx.fillRect(Math.round(sx) + dx, Math.round(sy) + dy, w, h);
    };
  };
  if (s.status === 'waiting') {
    // speech bubble with a blinking "!"
    const dot = dotAt(pose.x, pose.y, head + 1);
    dot(13, -8, 12, 14, INK);
    dot(14, -7, 10, 12, PAPER);
    dot(15, 6, 3, 1, INK);
    dot(15, 7, 2, 1, INK);
    if (f % 4 < 3) {
      dot(18, -5, 2, 5, '#c2410c');
      dot(18, 1, 2, 2, '#c2410c');
    }
  } else if (pose.doing === 'sofa' || (pose.doing === 'desk' && s.status !== 'busy')) { // asleep
    // drifting z
    const dot = dotAt(pose.x + fx * 3, pose.y + fy * 3, head - 1);
    const drift = Math.floor(f / 3) % 3;
    const dx = 12 + drift * 2;
    const dy = -6 - drift * 3;
    dot(dx - 1, dy - 1, 6, 6, PAPER);
    dot(dx, dy, 4, 1, INK);
    dot(dx + 2, dy + 1, 1, 1, INK);
    dot(dx + 1, dy + 2, 1, 1, INK);
    dot(dx, dy + 3, 4, 1, INK);
  }
}

// One frame: the office as it was last built, then everything that moves.
export function draw(scene: Scene) {
  scene.live.rgb.set(scene.office.rgb);
  scene.live.depth.set(scene.office.depth);
  scene.layer = scene.officeLayers;
  drawProps(scene);
  const seated = [...scene.desks.values()].filter((desk) => SEATS[desk.seat]);
  for (const desk of seated) {
    if (!desk.outside) drawWorker(scene, desk);
    drawSupervisor(scene, desk);
    for (const h of desk.helpers.values()) drawIntern(scene, h, SEATS[desk.seat].dir);
  }
  scene.ctx.putImageData(scene.image, 0, 0);
  for (const desk of seated) if (!desk.outside) drawMarks(scene, desk);
}
