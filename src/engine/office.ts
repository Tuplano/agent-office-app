import { towardCamera, towardRight } from './camera';
import { D, type Dir, FT, W, WH, WT } from './constants';
import { around, CLOCKS, laptopSide, SEATS } from './layout';
import {
  CAT, CHARCOAL, COBALT, DARK_GLASS, FLOOR_A, FLOOR_B, GREIGE, IVORY, IVORY_SHADE, LEAF, LEAF_LIGHT, LIGHT_POOL, LIME,
  METAL, OAK, OAK_DARK, OAK_LIGHT, OLIVE, PAPER, PURPLE, SAGE, SCREEN_OFF, TANGERINE, WARM_LIGHT,
} from './palette';
import { makePen } from './raster';
import type { Scene } from './scene';

type Strip = [a0: number, a1: number, z0: number, z1: number];

const MOONLIGHT = '#e6e2f0';
// where the stars sit in a window at night, as [along the wall, height], clear of its bars and the moon
const STARS = [[4, 19.5], [9, 12], [2, 11], [7, 21.5], [14, 21], [21.5, 11.5], [15.5, 13.5], [6, 17.5]];

// Draws the room and its furniture into the office buffer, from where the camera
// stands now. Where the furniture is in the way of walkers is layout.ts's business.
export function buildOffice(scene: Scene) {
  const { office, light } = scene;
  office.rgb.fill(0);
  office.depth.fill(-1e9);
  scene.layer = 0;
  const p = makePen(office, scene);
  const checker = (x0: number, x1: number, y0: number, y1: number, size: number, hex: string) => {
    for (let x = x0; x < x1; x += size) {
      for (let y = y0; y < y1; y += size) {
        if (((x - x0 + y - y0) / size) & 1) p.flat(x, Math.min(x + size, x1), y, Math.min(y + size, y1), 0, hex);
      }
    }
  };

  // plants, in three shapes
  const bush = (x: number, y: number, s: number, pot: string) => {
    p.box(x, y, 0, s, s, s * 0.6, pot);
    p.box(x - 1, y - 1, s * 0.6, s + 2, s + 2, s * 0.8, LEAF);
    p.box(x + 1, y + 1, s * 1.4, s - 2, s - 2, s * 0.35, LEAF_LIGHT);
    p.box(x + s + 1, y + 1, s * 0.6 + 1, 2, s - 2, 2, LEAF_LIGHT);
  };
  const tree = (x: number, y: number, pot: string) => {
    p.box(x, y, 0, 5, 5, 4, pot);
    p.box(x + 2, y + 2, 4, 1, 1, 13, OAK_DARK);
    p.box(x, y, 14, 5, 5, 4, LEAF);
    p.box(x - 2, y + 1, 11, 4, 3, 3, LEAF_LIGHT);
    p.box(x + 3, y - 1, 17, 4, 4, 3, LEAF_LIGHT);
    p.box(x + 1, y + 2, 20, 3, 3, 3, LEAF);
  };
  const blades = (x: number, y: number, pot: string) => {
    p.box(x, y, 0, 4, 4, 3, pot);
    p.box(x + 0.5, y + 1, 3, 1, 1, 9, LEAF);
    p.box(x + 2, y + 0.5, 3, 1, 1, 12, LEAF_LIGHT);
    p.box(x + 2.5, y + 2.5, 3, 1, 1, 7, LEAF);
    p.box(x + 1, y + 2.5, 3, 1, 1, 10, LEAF_LIGHT);
  };
  const sprig = (x: number, y: number, z: number, pot: string) => {
    p.box(x, y, z, 2, 2, 1.5, pot);
    p.box(x - 0.5, y - 0.5, z + 1.5, 3, 3, 2.5, LEAF);
  };
  // the office lights come on when it gets dark outside
  const bulb = light.now.lamps ? WARM_LIGHT : IVORY_SHADE;
  // a lamp hanging over (x, y), with the pool of warm light it throws on a table top when lit
  const pendant = (x: number, y: number, hex: string, table: number) => {
    p.box(x - 0.25, y - 0.25, 29, 0.5, 0.5, 9, CHARCOAL);
    p.box(x - 2, y - 2, 26, 4, 4, 3, hex);
    p.box(x - 1, y - 1, 25, 2, 2, 1, bulb);
    if (light.now.lamps) p.flat(x - 5, x + 5, y - 4, y + 4, table, LIGHT_POOL);
  };

  // Shell: the room has four walls, and the ones between the camera and the room are left out.
  // Each wall is named for where it stands; its inside looks the opposite way.
  const walls: Record<Dir, { inside: Dir; at: number; box: [number, number, number, number] }> = {
    W: { inside: 'E', at: 0, box: [-WT, 0, WT, D] },
    N: { inside: 'S', at: 0, box: [0, -WT, W, WT] },
    E: { inside: 'W', at: W, box: [W, 0, WT, D] },
    S: { inside: 'N', at: D, box: [0, D, W, WT] },
  };
  const names = Object.keys(walls) as Dir[];
  const standing = (name: Dir) => towardCamera(scene.view, walls[name].inside) > 0.08;
  for (const name of names) {
    if (!standing(name)) continue;
    const [x, y, w, d] = walls[name].box;
    p.box(x, y, -FT, w, d, WH + FT, IVORY);
  }
  const corners: [Dir, Dir, number, number][] = [['W', 'N', -WT, -WT], ['N', 'E', W, -WT], ['E', 'S', W, D], ['S', 'W', -WT, D]];
  for (const [a, b, x, y] of corners) {
    if (standing(a) && standing(b)) p.box(x, y, -FT, WT, WT, WH + FT, IVORY);
  }
  p.box(0, 0, -FT, W, D, FT, FLOOR_A);
  for (let y = 6; y < D; y += 12) p.flat(0, W, y, Math.min(y + 6, D), 0, FLOOR_B);

  // paints on the inside of a wall; a runs along it
  const panel = (name: Dir, a0: number, a1: number, z0: number, z1: number, hex: string, lit?: boolean) => {
    if (standing(name)) p.face(walls[name].inside, a0, a1, walls[name].at, z0, z1, hex, lit);
  };
  const windowAt = (name: Dir, a: number) => {
    if (!standing(name)) return;
    panel(name, a - 1, a + 25, 8.5, 23.5, CHARCOAL);
    // the view out: a moon and stars, a low sun, or clouds
    light.glow(() => {
      panel(name, a, a + 24, 9, 23, light.now.sky, true);
      if (light.now.sun === 'night') {
        panel(name, a + 17, a + 20, 18, 20, MOONLIGHT, true);
        for (const [da, z] of STARS) panel(name, a + da, a + da + 1, z, z + 0.5, MOONLIGHT, true);
      } else if (light.now.sun === 'low') {
        panel(name, a + 15, a + 20, 10.5, 13.5, '#ffe9b0', true);
      } else {
        panel(name, a + 3, a + 9, 19, 20, PAPER, true);
        panel(name, a + 5, a + 8, 20, 21, PAPER, true);
        panel(name, a + 15, a + 22, 12.5, 13.5, PAPER, true);
      }
    });
    panel(name, a + 11.6, a + 12.4, 9, 23, CHARCOAL);
    panel(name, a, a + 24, 15.7, 16.3, CHARCOAL);
    // sill
    if (name === 'W') p.box(0, a - 1, 7.5, 1, 26, 1, CHARCOAL);
    if (name === 'N') p.box(a - 1, 0, 7.5, 26, 1, 1, CHARCOAL);
    if (name === 'E') p.box(W - 1, a - 1, 7.5, 1, 26, 1, CHARCOAL);
    if (name === 'S') p.box(a - 1, D - 1, 7.5, 26, 1, 1, CHARCOAL);
  };
  for (const name of names) {
    // the wall turned to the right of the picture sits in shade
    panel(name, 0, W, 0, WH, towardRight(scene.view, walls[name].inside) > 0.35 ? IVORY_SHADE : IVORY, true);
    panel(name, 0, W, 0, 2, GREIGE);
    // a string of warm bulbs along the top
    panel(name, 0, W, WH - 3.4, WH - 3.1, CHARCOAL);
    for (let a = 4; a + 1 <= W; a += 7) panel(name, a, a + 1, WH - 5, WH - 3.4, bulb, true);
  }

  // north wall: two windows over the long table, a shelf of plants, a mood board
  windowAt('N', 28);
  windowAt('N', 56);
  if (standing('N')) {
    p.box(6, 0, 15, 14, 2, 0.8, OAK);
    sprig(7, 0, 15.8, CHARCOAL);
    sprig(12, 0, 15.8, IVORY_SHADE);
    p.box(16, 0.3, 15.8, 1, 1.5, 3, COBALT);
    p.box(17, 0.3, 15.8, 1, 1.5, 2.5, TANGERINE);
  }
  panel('N', 91, 117, 9, 25, OAK);
  panel('N', 92, 116, 9.5, 24.5, PAPER);
  const notes: [number, number, string][] = [[94, 20, LIME], [100, 20.5, PURPLE], [107, 19.5, TANGERINE], [95, 14.5, COBALT], [102, 15, PAPER], [109, 13.5, LIME], [102, 11, TANGERINE]];
  for (const [a, z, hex] of notes) panel('N', a, a + 4.5, z, z + 3, hex === PAPER ? GREIGE : hex);

  // west wall: a mural, the cafe shelf, a neon sign over the sofa
  panel('W', 8, 20, 4, 18, LIME);
  panel('W', 9, 19, 18, 20, LIME);
  panel('W', 10.5, 17.5, 20, 21.5, LIME);
  panel('W', 22, 36, 4, 11, PURPLE);
  const disc: Strip[] = [[26, 30, 15, 16], [25, 31, 16, 17.5], [24, 32, 17.5, 20.5], [25, 31, 20.5, 22], [26, 30, 22, 23]];
  for (const [a0, a1, z0, z1] of disc) panel('W', a0, a1, z0, z1, TANGERINE);
  panel('W', 6, 40, 24.5, 25.3, COBALT);
  if (standing('W')) {
    p.box(0, 54, 17, 2, 22, 0.8, OAK);
    sprig(0, 55, 17.8, CHARCOAL);
    p.box(0.3, 60, 17.8, 1.5, 1.5, 2.5, IVORY_SHADE);
    p.box(0.3, 63, 17.8, 1.5, 1.5, 3, TANGERINE);
    p.box(0.3, 66, 17.8, 1.5, 1.5, 2.5, IVORY_SHADE);
    sprig(0, 72, 17.8, IVORY_SHADE);
  }
  light.glow(() => {
    const outline: Strip[] = [[98, 118, 22, 22.7], [98, 118, 15.5, 16.2], [98, 98.7, 15.5, 22.7], [117.3, 118, 15.5, 22.7]];
    for (const [a0, a1, z0, z1] of outline) panel('W', a0, a1, z0, z1, PURPLE, true);
    const smile: Strip[] = [[103.5, 105.5, 19.5, 21], [110.5, 112.5, 19.5, 21], [103, 113, 17.3, 18], [102, 103, 18, 18.8], [113, 114, 18, 18.8]];
    for (const [a0, a1, z0, z1] of smile) panel('W', a0, a1, z0, z1, LIME, true);
  });

  // the other two walls, for when the room is turned round
  for (const a of [20, 104]) windowAt('E', a);
  for (const a of [14, 58, 102]) windowAt('S', a);
  panel('E', 48, 58, 4, 26, COBALT);
  panel('S', 42, 54, 4, 20, LIME);
  panel('S', 88, 98, 4, 14, PURPLE);
  // the clocks' cases; drawClock() lights the digits
  for (const clock of CLOCKS) {
    panel(clock.wall, clock.a - 1.5, clock.a + 18.5, clock.z - 1.2, clock.z + 6.2, CHARCOAL);
    panel(clock.wall, clock.a - 1, clock.a + 18, clock.z - 0.7, clock.z + 5.7, DARK_GLASS, true);
  }

  // long oak tables: charcoal trestles, a row of greenery down the middle, lamps overhead
  const bench = (x: number, y: number, w: number, d: number) => {
    const alongX = w > d;
    for (const t of [0.12, 0.88]) {
      if (alongX) p.box(x + w * t - 1, y + 2, 0, 2, d - 4, 10.5, CHARCOAL);
      else p.box(x + 2, y + d * t - 1, 0, w - 4, 2, 10.5, CHARCOAL);
    }
    p.box(x, y, 10.5, w, d, 1.5, OAK_LIGHT);
    for (const t of [0.25, 0.75]) {
      const cx = alongX ? x + w * t : x + w / 2;
      const cy = alongX ? y + d / 2 : y + d * t;
      pendant(cx, cy, CHARCOAL, 12);
    }
    const mx = x + w / 2;
    const my = y + d / 2;
    sprig(mx - 1, my - 1, 12, CHARCOAL);
    p.box(mx - (alongX ? 7 : 1), my - (alongX ? 1 : 7), 12, 2, 2, 2, IVORY_SHADE);
    p.box(mx + (alongX ? 5 : -1), my + (alongX ? -1 : 5), 12, 2, 2, 2.5, LIME);
  };
  bench(26, 17, 52, 14);
  bench(104, 26, 14, 52);

  SEATS.forEach((seat, n) => {
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
    // laptop and a mug
    put(6, 10, -3, 3, 12, 0.5, METAL);
    put(10, 11, -3, 3, 12, 5.5, METAL);
    const screen = laptopSide(seat, true);
    p.face(screen.side, screen.mid - 2.5, screen.mid + 2.5, screen.at, 12.8, 17, SCREEN_OFF, true);
    put(7, 9, 5, 7, 12, 2, [PAPER, TANGERINE, PAPER, COBALT][n % 4]);
  });

  // cafe: checkerboard floor, a back counter with the coffee machine, an island with stools
  checker(0, 36, 46, 86, 5, GREIGE);
  p.box(1, 50, 0, 6, 30, 10, OAK);
  p.box(1, 50, 10, 6, 30, 1, GREIGE);
  p.box(2, 54, 11, 4, 5, 5, CHARCOAL);
  p.box(2.5, 61, 11, 1.5, 1.5, 2, PAPER);
  p.box(4.5, 62, 11, 1.5, 1.5, 2, PAPER);
  p.box(2.5, 64, 11, 1.5, 1.5, 2, LIME);
  sprig(3, 74, 11, CHARCOAL);
  p.box(16, 52, 0, 6, 26, 10, OAK);
  p.box(15, 51, 10, 8, 28, 1, PAPER);
  pendant(19, 58, LIME, 11);
  pendant(19, 72, LIME, 11);
  tree(4, 86, CHARCOAL);

  // a planter in the middle of the room
  p.box(62, 60, 0, 14, 14, 5, OAK);
  p.flat(63, 75, 61, 73, 5, OAK_DARK);
  p.box(64, 62, 5, 5, 5, 7, LEAF);
  p.box(65, 63, 12, 3, 3, 3, LEAF_LIGHT);
  p.box(70, 66, 5, 4, 5, 5, LEAF_LIGHT);
  p.box(66, 69, 5, 1, 1, 10, LEAF);
  p.box(68, 70, 5, 1, 1, 13, LEAF_LIGHT);
  p.box(71, 62, 5, 3, 3, 3, LEAF);

  // phone booth in coloured glass
  for (const [x, y] of [[124, 2], [135, 2], [124, 13], [135, 13]]) p.box(x, y, 0, 1, 1, 24, CHARCOAL);
  p.box(124, 2, 24, 12, 12, 1, COBALT);
  const glass: [Dir, number, number, number][] = [['W', 2, 14, 124], ['E', 2, 14, 136], ['N', 124, 136, 2], ['S', 124, 136, 14]];
  for (const [side, a0, a1, at] of glass) p.face(side, a0, a1, at, 0.5, 24, COBALT, true, true);
  p.box(131, 4, 0, 3, 3, 7, OAK);
  p.box(126, 9, 9, 8, 3, 1, OAK_LIGHT);
  blades(118, 3, IVORY_SHADE);
  // the door in the north wall: frame, the dark beyond, a mat; the leaf is drawn as it swings
  panel('N', 81.5, 90.5, 0, 21, CHARCOAL);
  panel('N', 82.5, 89.5, 0, 20, DARK_GLASS, true);
  p.flat(82, 90, 1, 6, 0, LIME);
  tree(4, 4, IVORY_SHADE);

  // lounge: a purple sofa, bean bags, a low table, a floor lamp
  p.flat(4, 54, 90, 126, 0, '#f1e6d2');
  p.flat(4, 54, 90, 92, 0, GREIGE);
  p.flat(4, 54, 124, 126, 0, GREIGE);
  p.flat(48, 54, 92, 98, 0, LIME);
  p.box(2, 94, 0, 3, 28, 12, PURPLE);
  p.box(5, 94, 0, 8, 28, 6, PURPLE);
  p.box(5, 94, 6, 8, 2, 3, PURPLE);
  p.box(5, 120, 6, 8, 2, 3, PURPLE);
  p.box(5, 106, 6, 2, 4, 4, LIME);
  p.box(22, 102, 0, 10, 12, 5, OAK);
  p.box(24, 105, 5, 4, 3, 0.5, COBALT);
  sprig(28, 109, 5, CHARCOAL);
  const beanBags: [number, string][] = [[94, LIME], [114, TANGERINE]];
  for (const [y, hex] of beanBags) {
    p.box(38, y, 0, 8, 8, 4, hex);
    p.box(39, y + 1, 4, 6, 6, 1.5, hex);
  }
  p.box(17, 88, 0, 1, 1, 20, CHARCOAL);
  p.box(15, 86, 20, 5, 5, 4, bulb);
  bush(4, 128, 6, IVORY_SHADE);
  blades(50, 128, CHARCOAL);

  // games: ping-pong on a sage checkerboard, an arcade cabinet, the cat
  p.flat(66, 114, 100, 128, 0, '#eef0e2');
  checker(66, 114, 100, 128, 7, SAGE);
  for (const [x, y] of [[77, 107], [97, 107], [77, 117], [97, 117]]) p.box(x, y, 0, 2, 2, 7, CHARCOAL);
  p.box(76, 106, 7, 24, 14, 1, COBALT);
  p.flat(76, 100, 112.5, 113.5, 8, PAPER);
  p.box(87.5, 105, 8, 1, 16, 1.5, PAPER);
  p.box(118, 94, 0, 12, 10, 11, CHARCOAL);
  p.box(118, 94, 11, 12, 7, 11, CHARCOAL);
  p.south(120, 128, 101, 13, 19, DARK_GLASS);
  light.glow(() => p.south(119, 129, 101, 19.5, 21.5, LIME));
  p.flat(121, 123, 102, 103, 11, TANGERINE);
  p.flat(125, 127, 102, 103, 11, LIME);
  p.south(120, 128, 104, 3, 8, PURPLE);
  p.box(110, 130, 0, 5, 5, 3, CAT);
  p.box(110, 131, 3, 5, 5, 3, CAT);
  p.box(110, 133, 6, 1, 2, 1, CAT);
  p.box(114, 133, 6, 1, 2, 1, CAT);
  tree(131, 130, CHARCOAL);
  bush(131, 82, 5, IVORY_SHADE);

  // what the floor lamp throws on the lounge floor, over whatever lies there
  if (light.now.lamps) p.flat(10, 25, 82, 95, 0, LIGHT_POOL);
  scene.officeLayers = scene.layer;
}
