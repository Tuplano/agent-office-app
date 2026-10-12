import { towardRight } from './camera';
import { type Dir, FT, WH, WT } from './constants';
import { around, type Seat } from './layout';
import { CHARCOAL, COBALT, FLOOR_A, FLOOR_B, GREIGE, IVORY, IVORY_SHADE, OLIVE, PAPER, SAGE, TANGERINE, WARM_LIGHT } from './palette';
import { type Env, FLOOR_KINDS } from './pieces';
import { INSIDE, placedPen, standing, wallLength, wallPen } from './place';
import { makePen, type Pen } from './raster';
import { onWall } from './room';
import type { Scene } from './scene';
import { WALL_KINDS } from './walls';

const WALLS: Dir[] = ['W', 'N', 'E', 'S'];

// A chair with a back at a long table, or a bar stool, and the sitter's mug. `n`
// is the seat's number in the room, which the colours go by.
function drawChair(p: Pen, seat: Seat, n: number) {
  const put = (f0: number, f1: number, l0: number, l1: number, z: number, h: number, hex: string) => {
    const [x, y, w, d] = around(seat, f0, f1, l0, l1);
    p.box(x, y, z, w, d, h, hex);
  };
  if (seat.kind === 'stool') {
    put(-0.5, 0.5, -0.5, 0.5, 0, 8, CHARCOAL);
    put(-2.5, 2.5, -2.5, 2.5, 8, 1, TANGERINE);
    put(7, 9, -1, 1, 11, 2, PAPER);
    return;
  }
  const cloth = n % 3 === 2 ? OLIVE : SAGE;
  put(-1, 1, -1, 1, 0, 5, CHARCOAL);
  put(-4, 3, -4, 4, 5, 2, cloth);
  put(-5, -4, -4, 4, 5, 11, cloth);
  // a mug; the laptop is the worker's own, and comes and goes with them
  put(7, 9, 5, 7, 12, 2, [PAPER, TANGERINE, PAPER, COBALT][n % 4]);
}

// Draws the room and everything in it into the office buffer, from where the
// camera stands now. Where the furniture is in the way of walkers is layout.ts's
// business; both read the same room.
export function buildOffice(scene: Scene) {
  const { office, light, view, room, layout } = scene;
  const { w, d } = room.size;
  office.rgb.fill(0);
  office.depth.fill(-1e9);
  scene.layer = 0;
  const p = makePen(office, scene);
  // the office lights come on when it gets dark outside
  const env: Env = { light, bulb: light.now.lamps ? WARM_LIGHT : IVORY_SHADE };

  // Shell: the room has four walls, and the ones between the camera and the room are left out.
  const shell: Record<Dir, [x: number, y: number, w: number, d: number]> = { W: [-WT, 0, WT, d], N: [0, -WT, w, WT], E: [w, 0, WT, d], S: [0, d, w, WT] };
  for (const name of WALLS) {
    if (!standing(view, name)) continue;
    const [x, y, bw, bd] = shell[name];
    p.box(x, y, -FT, bw, bd, WH + FT, IVORY);
  }
  const corners: [Dir, Dir, number, number][] = [['W', 'N', -WT, -WT], ['N', 'E', w, -WT], ['E', 'S', w, d], ['S', 'W', -WT, d]];
  for (const [a, b, x, y] of corners) {
    if (standing(view, a) && standing(view, b)) p.box(x, y, -FT, WT, WT, WH + FT, IVORY);
  }
  p.box(0, 0, -FT, w, d, FT, FLOOR_A);
  for (let y = 6; y < d; y += 12) p.flat(0, w, y, Math.min(y + 6, d), 0, FLOOR_B);
  for (const name of WALLS) {
    const inside = wallPen(p, view, room.size, { kind: '', wall: name, a: 0 });
    const long = wallLength(room.size, name);
    // the wall turned to the right of the picture sits in shade
    inside.panel(0, long, 0, WH, towardRight(view, INSIDE[name]) > 0.35 ? IVORY_SHADE : IVORY, true);
    inside.panel(0, long, 0, 2, GREIGE);
    // a string of warm bulbs along the top
    inside.panel(0, long, WH - 3.4, WH - 3.1, CHARCOAL);
    for (let a = 4; a + 1 <= long; a += 7) inside.panel(a, a + 1, WH - 5, WH - 3.4, env.bulb, true);
  }

  // the pieces, in the room's order; a piece of a kind nobody knows is left out
  room.pieces.forEach((piece, index) => {
    if (onWall(piece)) {
      WALL_KINDS[piece.kind]?.draw(wallPen(p, view, room.size, piece), env, piece);
      return;
    }
    const kind = FLOOR_KINDS[piece.kind];
    if (!kind) return;
    kind.draw(placedPen(p, piece, kind.box(piece)), env, piece);
    layout.seats.forEach((seat, n) => {
      if (seat.piece === index) drawChair(p, seat, n);
    });
  });
  // what the lamps throw on the floor, over whatever lies there
  for (const piece of room.pieces) {
    if (onWall(piece)) continue;
    const kind = FLOOR_KINDS[piece.kind];
    kind?.pool?.(placedPen(p, piece, kind.box(piece)), env);
  }
  scene.officeLayers = scene.layer;
}
