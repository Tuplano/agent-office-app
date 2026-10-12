import { project } from './camera';
import { drawCat } from './cat';
import { FACING } from './constants';
import { ADULT, drawIntern, drawSupervisor, drawWorker, placeOf, poseOf } from './figures';
import { INK, PAPER } from './palette';
import { FLOOR_KINDS } from './pieces';
import { placedPen, wallPen } from './place';
import { onWall } from './room';
import type { Desk, Scene } from './scene';
import { WALL_KINDS } from './walls';

// The things in the room that move on their own: what each piece has moving on it, then the cat.
function drawProps(scene: Scene) {
  const { pen, view, room } = scene;
  room.pieces.forEach((piece, index) => {
    if (onWall(piece)) {
      const kind = WALL_KINDS[piece.kind];
      kind?.live?.(wallPen(pen, view, room.size, piece), scene, piece);
      return;
    }
    const kind = FLOOR_KINDS[piece.kind];
    kind?.live?.(placedPen(pen, piece, kind.box(piece)), scene, index);
  });
  drawCat(scene);
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
  const seated = [...scene.desks.values()].filter((desk) => placeOf(desk));
  for (const desk of seated) {
    if (!desk.outside) drawWorker(scene, desk);
    drawSupervisor(scene, desk);
    for (const h of desk.helpers.values()) drawIntern(scene, h, placeOf(desk)!.dir);
  }
  scene.ctx.putImageData(scene.image, 0, 0);
  for (const desk of seated) if (!desk.outside && !desk.gone) drawMarks(scene, desk);
}
