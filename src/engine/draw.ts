import { project } from './camera';
import { drawCat } from './cat';
import { FACING } from './constants';
import { ADULT, drawIntern, drawSupervisor, drawWorker, placeOf, poseOf } from './figures';
import { MISFIT } from './office';
import { INK, PAPER, PURPLE } from './palette';
import { FLOOR_KINDS } from './pieces';
import { placedPen, placeRect, wallPen } from './place';
import { onWall } from './room';
import type { Desk, Scene } from './scene';
import { WALL_KINDS } from './walls';

// The things in the room that move on their own: what each piece has moving on it, then the cat.
function drawProps(scene: Scene) {
  const { pen, view } = scene;
  const { room } = scene.preview ?? scene;
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

// A line round the piece picked out in edit mode, on the floor or on its wall:
// purple, or red while it is held somewhere it cannot go, with a pale one inside
// it so that it shows against a piece of its own colour.
function drawSelection(scene: Scene) {
  const { pen, light, preview } = scene;
  const { room } = preview ?? scene;
  const piece = scene.selected === null ? undefined : room.pieces[scene.selected];
  if (!scene.editing || !piece) return;
  const hex = preview && !preview.fits ? MISFIT : PURPLE;
  if (onWall(piece)) {
    const kind = WALL_KINDS[piece.kind];
    if (!kind) return;
    const wall = wallPen(pen, scene.view, room.size, piece);
    const [a0, a1, low, z1] = kind.span(piece);
    const z0 = Math.max(low, 2); // not down behind the skirting
    // a frame `out` wide, that far outside the piece
    const frame = (out: number, colour: string) => {
      wall.panel(a0 - out, a1 + out, z1, z1 + out, colour, true);
      if (z0 - out >= 0) wall.panel(a0 - out, a1 + out, z0 - out, z0, colour, true);
      wall.panel(a0 - out, a0, z0, z1, colour, true);
      wall.panel(a1, a1 + out, z0, z1, colour, true);
    };
    light.glow(() => {
      frame(1.6, hex);
      frame(0.8, PAPER);
    });
    return;
  }
  const kind = FLOOR_KINDS[piece.kind];
  if (!kind) return;
  const box = kind.box(piece);
  const [x, y, w, d] = placeRect(box, piece, [0, 0, ...box]);
  const frame = (out: number, colour: string) => {
    pen.flat(x - out, x + w + out, y - out, y, 0.2, colour);
    pen.flat(x - out, x + w + out, y + d, y + d + out, 0.2, colour);
    pen.flat(x - out, x, y, y + d, 0.2, colour);
    pen.flat(x + w, x + w + out, y, y + d, 0.2, colour);
  };
  light.glow(() => {
    frame(2, hex);
    frame(1, PAPER);
    // what lies flat is pulled out by its corners: a grip on each
    if (!kind.spread) return;
    for (const [cx, cy] of [[x, y], [x + w, y], [x, y + d], [x + w, y + d]]) {
      pen.flat(cx - 3, cx + 3, cy - 3, cy + 3, 0.25, hex);
      pen.flat(cx - 1.8, cx + 1.8, cy - 1.8, cy + 1.8, 0.3, PAPER);
    }
  });
}

// The stretch of wall about to be cut away, in edit mode: a red line round the
// floor it stands on, and another round the top of it, which shows from any side.
function drawMark(scene: Scene) {
  const { pen, light, mark } = scene;
  if (!scene.editing || !mark) return;
  const [x, y, w, d] = mark;
  const frame = (out: number, z: number, colour: string) => {
    pen.flat(x - out, x + w + out, y - out, y, z, colour);
    pen.flat(x - out, x + w + out, y + d, y + d + out, z, colour);
    pen.flat(x - out, x, y, y + d, z, colour);
    pen.flat(x + w, x + w + out, y, y + d, z, colour);
  };
  light.glow(() => {
    for (const z of [0.2, 27.2]) {
      frame(1.5, z, MISFIT);
      frame(0.6, z, PAPER);
    }
  });
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
  drawSelection(scene);
  drawMark(scene);
  const seated = [...scene.desks.values()].filter((desk) => placeOf(desk));
  for (const desk of seated) {
    if (!desk.outside) drawWorker(scene, desk);
    drawSupervisor(scene, desk);
    for (const h of desk.helpers.values()) drawIntern(scene, h, placeOf(desk)!.dir);
  }
  scene.ctx.putImageData(scene.image, 0, 0);
  for (const desk of seated) if (!desk.outside && !desk.gone) drawMarks(scene, desk);
}
