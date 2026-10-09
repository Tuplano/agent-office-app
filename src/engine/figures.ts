import { type Dir, LEGS, OPPOSITE } from './constants';
import { laptopSide, PLAY, type PlaySpot, SEATS } from './layout';
import { COBALT, GREIGE, HAIR, INK, METAL, PAPER, pick, PURPLE, SAGE, SCREEN_ON, SKIN, STEEL, TANGERINE, TROUSERS } from './palette';
import type { Pen } from './raster';
import type { Desk, Helper, Scene } from './scene';

export interface Build {
  wide: number;
  deep: number;
  tall: number;
  head: number;
  face: number;
  arm: number;
  eye: number;
}
export const ADULT: Build = { wide: 6, deep: 4, tall: 7, head: 6, face: 6, arm: 2, eye: 1 };
export const SMALL: Build = { wide: 4, deep: 3, tall: 4, head: 5, face: 5, arm: 1, eye: 0.5 };

export interface Look {
  size: Build;
  dir: Dir;
  base: number;
  stance: 'sit' | 'stand' | 'walk';
  stride: number;
  legs: string;
  shoes: string;
  shirt: string;
  skin: string;
  hair: string;
  style: number;
  arms: 'desk' | 'wave' | 'down' | 'reach';
  tap: number; // which hand is up this frame, or -1
  shut: boolean;
  cap?: string;
  robot?: boolean;
  light?: string;
  drop?: boolean;
  tie?: string;
  board?: boolean;
}

// A body's own axes at (cx, cy): f runs forward, l to the side. Turns boxes and
// patches given that way into world ones, so a figure is described once whichever
// way it faces.
export function bodyFrame(p: Pen, cx: number, cy: number, dir: Dir) {
  const flip = dir === 'N' || dir === 'W' ? -1 : 1;
  const alongY = dir === 'S' || dir === 'N'; // forward runs along y
  const behind = OPPOSITE[dir];
  const fwd = alongY ? cy : cx; // world coordinate that f moves along
  const lat = alongY ? cx : cy;
  const span = (f0: number, f1: number) => (flip > 0 ? [fwd + f0, fwd + f1] : [fwd - f1, fwd - f0]);
  return {
    box(f0: number, f1: number, l0: number, l1: number, z: number, h: number, hex: string) {
      const [a0, a1] = span(f0, f1);
      if (alongY) p.box(lat + l0, a0, z, l1 - l0, a1 - a0, h, hex);
      else p.box(a0, lat + l0, z, a1 - a0, l1 - l0, h, hex);
    },
    front: (f: number, l0: number, l1: number, z0: number, z1: number, hex: string) => p.face(dir, lat + l0, lat + l1, fwd + flip * f, z0, z1, hex),
    back: (f: number, l0: number, l1: number, z0: number, z1: number, hex: string) => p.face(behind, lat + l0, lat + l1, fwd + flip * f, z0, z1, hex),
    // on the left or right side, whichever l is on
    side(l: number, f0: number, f1: number, z0: number, z1: number, hex: string) {
      const [a0, a1] = span(f0, f1);
      p.face(alongY ? (l > 0 ? 'E' : 'W') : l > 0 ? 'S' : 'N', a0, a1, lat + l, z0, z1, hex);
    },
  };
}

// Draws one blocky person at (cx, cy).
function drawFigure(p: Pen, cx: number, cy: number, look: Look) {
  const { size } = look;
  const b = bodyFrame(p, cx, cy, look.dir);
  const zb = look.base;
  const hw = size.wide / 2;
  const hd = size.deep / 2;
  const light = look.light ?? GREIGE;
  // legs: thighs along the seat and shins down from the knee when sitting; one
  // leg ahead and one behind, swapping, when walking
  const swing = look.stance === 'walk' ? [1, 0, -1, 0][look.stride & 3] : 0;
  [[-hw, -1], [1, hw]].forEach(([l0, l1], i) => {
    if (look.stance === 'sit') {
      b.box(hd - 1, hd + 4, l0, l1, zb, 2, look.legs);
      b.box(hd + 2, hd + 4, l0, l1, 1, zb - 1, look.legs);
      b.box(hd + 2, hd + 5, l0, l1, 0, 1, look.shoes);
      return;
    }
    const ahead = swing * (i ? -1 : 1);
    const lift = ahead > 0 ? 0.5 : 0;
    b.box(-hd + 1 + ahead, hd + ahead, l0, l1, zb / 2, zb / 2, look.legs);
    b.box(-hd + 1 + ahead * 2, hd + ahead * 2, l0, l1, 1 + lift, zb / 2 - 1 - lift, look.legs);
    b.box(-hd + 1 + ahead * 2, hd + 1 + ahead * 2, l0, l1, lift, 1, look.shoes);
  });
  b.box(-hd, hd, -hw, hw, zb, size.tall, look.shirt);
  if (look.robot) b.front(hd, -1, 1, zb + 3, zb + 4.5, light);
  if (look.tie) {
    b.front(hd, -2, 2, zb + size.tall - 2, zb + size.tall, PAPER);
    b.front(hd, -0.5, 0.5, zb + 1, zb + size.tall - 1, look.tie);
  }

  // arms, one on each side of the torso
  [-hw - size.arm, hw].forEach((l0, i) => {
    const l1 = l0 + size.arm;
    if (look.arms === 'wave' && i === 1) {
      b.box(-1, 1, l0, l1, zb + size.tall - 2, 7, look.shirt);
      b.box(-1, 1, l0 + look.tap, l1 + look.tap, zb + size.tall + 5, 2, look.skin);
    } else if (look.arms === 'down' || (look.arms === 'reach' && i === 0)) {
      // swings against the leg on the same side
      const back = swing * (i ? 1 : -1) * 1.5;
      b.box(-1 + back, 1 + back, l0, l1, zb + 1, size.tall - 2, look.shirt);
    } else {
      // forearm forward, hand at the end
      const z = zb + size.tall - 1.5;
      b.box(-1, 3, l0, l1, z, 1.5, look.shirt);
      b.box(3, 5, l0, l1, z + (look.tap === i ? 0.5 : 0), 1.5, look.skin);
    }
  });
  if (look.board) b.box(3, 4, -2, 2, zb + size.tall - 4, 3, PAPER); // clipboard held out in front

  // head, a little forward of the shoulders
  const hs = size.head / 2;
  const hh = size.face;
  const lean = look.drop ? 2 : 0;
  const f0 = -hs + 1 + lean;
  const f1 = hs + 1 + lean;
  const hz = zb + size.tall - lean;
  const ez = hz + hh - 4;
  const e = size.eye;
  if (look.robot) {
    b.box(f0, f1, -hs, hs, hz, hh, METAL);
    b.front(f1, -hs + 0.5, hs - 0.5, ez - 0.5, ez + 2, INK);
    b.front(f1, -e - 1, -e, ez + 0.5, ez + 1.5, light);
    b.front(f1, e, e + 1, ez + 0.5, ez + 1.5, light);
    b.box(f0 + hs - 1, f0 + hs + 1, -1, 1, hz + hh, 1.5, STEEL);
    b.box(f0 + hs - 1, f0 + hs + 1, -1, 1, hz + hh + 1.5, 1, light);
    return;
  }
  const long = look.style === 1;
  b.box(f0, f1, -hs, hs, hz, hh, look.skin);
  // hair: a fringe, down both sides, and the back of the head
  b.front(f1, -hs, hs, hz + hh - 1, hz + hh, look.hair);
  if (long) {
    b.front(f1, -hs, -hs + 0.5, hz + 1, hz + hh - 1, look.hair);
    b.front(f1, hs - 0.5, hs, hz + 1, hz + hh - 1, look.hair);
  }
  for (const l of [-hs, hs]) {
    b.side(l, f0, f1, hz + (long ? 0 : hh - 2), hz + hh, look.hair);
    b.side(l, f0, f0 + 2, hz + (long ? 0 : hh - 4), hz + hh - 2, look.hair);
  }
  b.back(f0, -hs, hs, hz + (long ? 0 : 2), hz + hh, look.hair);
  // face
  for (const l of [-e - 1, e]) {
    if (look.shut) b.front(f1, l - 0.5, l + 1.5, ez + 0.5, ez + 1, INK);
    else b.front(f1, l, l + 1, ez, ez + 2, INK);
  }
  b.front(f1, -1, 1, ez - 1.5, ez - 1, '#8a4a3a');
  if (look.cap) {
    b.front(f1, -hs, hs, hz + hh - 1, hz + hh, look.cap);
    b.back(f0, -hs, hs, hz + hh - 1, hz + hh, look.cap);
    for (const l of [-hs, hs]) b.side(l, f0, f1, hz + hh - 1, hz + hh, look.cap);
    b.box(f1, f1 + 1, -hs, hs, hz + hh, 0.5, look.cap); // brim
  }
  b.box(f0, f1, -hs, hs, hz + hh, 1.5, look.cap || look.hair);
  if (look.style === 2 && !look.cap) b.box(f0 + 1, f0 + 4, -1.5, 1.5, hz + hh + 1.5, 1.5, look.hair);
}

export interface Pose {
  x: number;
  y: number;
  dir: Dir;
  doing: 'desk' | 'walk' | PlaySpot['kind'];
  base: number;
  sitting: boolean;
}

// Where a worker is right now and what they are doing there.
export function poseOf(desk: Desk): Pose {
  const seat = SEATS[desk.seat];
  if (!desk.at) return { x: seat.x, y: seat.y, dir: seat.dir, doing: 'desk', base: seat.z, sitting: true };
  const spot = PLAY[desk.play];
  if (spot && !desk.path.length) return { x: spot.x, y: spot.y, dir: spot.dir, doing: spot.kind, base: spot.z || LEGS, sitting: !!spot.z };
  return { x: desk.at.x, y: desk.at.y, dir: desk.facing, doing: 'walk', base: LEGS, sitting: false };
}

export const bossBusy = (desk: Desk) => !!desk.data.supervisor && desk.data.supervisor.status === 'busy';

export function drawWorker(scene: Scene, desk: Desk) {
  const { pen, frame, reduced } = scene;
  const s = desk.data;
  const pose = poseOf(desk);
  const busy = s.status === 'busy';
  const waiting = s.status === 'waiting';
  const idle = !busy && !waiting;
  const robot = s.background; // headless sessions get a robot worker
  const f = reduced ? 0 : frame + (desk.seed % 7);
  const atDesk = pose.doing === 'desk';
  const napping = pose.doing === 'sofa' || (atDesk && idle);
  const light = busy ? (f % 2 ? PURPLE : '#c9bcff') : waiting ? TANGERINE : GREIGE;
  drawFigure(pen, pose.x, pose.y, {
    size: ADULT,
    dir: pose.dir,
    base: pose.base + (pose.doing === 'walk' && f % 2 ? 0.5 : 0),
    stance: pose.sitting ? 'sit' : pose.doing === 'walk' ? 'walk' : 'stand',
    stride: f,
    legs: robot ? '#6e685f' : TROUSERS,
    shoes: robot ? STEEL : PAPER,
    shirt: robot ? STEEL : desk.tint,
    skin: robot ? METAL : pick(SKIN, desk.seed, 4),
    hair: pick(HAIR, desk.seed, 0),
    style: (desk.seed >>> 14) % 3,
    robot,
    light,
    shut: napping || (!reduced && (frame + desk.seed) % 23 === 0),
    drop: atDesk && idle, // slumped over the desk when asleep
    arms: !atDesk ? (pose.doing === 'pong' || pose.doing === 'arcade' ? 'reach' : 'down') : waiting && !robot ? 'wave' : 'desk',
    tap: waiting ? (f % 4 < 2 ? 0 : 1) : busy || !atDesk ? f % 2 : -1, // which hand is up this frame
  });
  if (pose.doing === 'pong') bodyFrame(pen, pose.x, pose.y, pose.dir).box(4, 5, 3, 5, LEGS + 5 + (f % 2), 2.5, TANGERINE); // paddle

  // laptop: a status light on the lid, and on the screen lines of code that
  // scroll while there is work; we see whichever side is turned to us
  const seat = SEATS[desk.seat];
  if (seat.kind !== 'bench' || !atDesk) return;
  const back = laptopSide(seat, false);
  pen.face(back.side, back.mid - 1, back.mid + 1, back.at, 14, 15.5, light, true);
  const screen = laptopSide(seat, true);
  const lit = (a0: number, a1: number, z0: number, z1: number, hex: string) => pen.face(screen.side, screen.mid + a0, screen.mid + a1, screen.at, z0, z1, hex, true);
  lit(-2.5, 2.5, 12.8, 17, SCREEN_ON);
  for (let i = 0; i < 4; i++) {
    const row = busy ? (i + f) % 4 : i;
    lit(-2, [1, -1, 1.5, 0][i], 13.3 + row * 0.85, 13.7 + row * 0.85, [STEEL, PURPLE, STEEL, COBALT][i]);
  }
}

// claude-mem's observer for this session. It wanders the office until there is
// something to write down, then hurries to the worker's side with a clipboard.
export function drawSupervisor(scene: Scene, desk: Desk) {
  const { frame, reduced } = scene;
  const boss = desk.boss;
  if (!boss || !boss.at) return;
  const walking = boss.path.length > 0;
  const noting = !walking && boss.goal === 'home' && bossBusy(desk);
  const f = reduced ? 0 : frame + (boss.seed % 5);
  drawFigure(scene.pen, boss.at.x, boss.at.y, {
    size: ADULT,
    dir: boss.facing,
    base: LEGS + (walking && f % 2 ? 0.5 : 0),
    stance: walking ? 'walk' : 'stand',
    stride: f,
    legs: '#1f1f1f',
    shoes: '#0f0f0f',
    shirt: '#34343a',
    tie: TANGERINE,
    skin: pick(SKIN, boss.seed, 4),
    hair: pick(HAIR, boss.seed, 0),
    style: (boss.seed >>> 14) % 2 ? 0 : 2,
    shut: !reduced && (frame + boss.seed) % 29 === 0,
    arms: walking ? 'down' : 'reach',
    tap: noting ? f % 2 : -1,
    board: !walking,
  });
}

// A subagent: a small intern in a cap. They come in by the door, settle on a
// floor cushion beside their worker with a laptop on their knees, and code.
export function drawIntern(scene: Scene, h: Helper, dir: Dir) {
  const { pen, frame, reduced } = scene;
  if (!h.at) return;
  const walking = h.path.length > 0;
  const f = reduced ? 0 : frame + h.slot * 3;
  const facing = walking ? h.facing : dir;
  const seat = 1.5; // cushion height
  if (!walking) {
    const b = bodyFrame(pen, h.at.x, h.at.y, facing);
    b.box(-2.5, 2, -2.5, 2.5, 0, seat, SAGE);
    // laptop: the lid shows a light from the front, lines of code from behind
    b.box(2, 5, -1.5, 1.5, seat + 2, 0.4, METAL);
    b.box(5, 5.5, -1.5, 1.5, seat + 2, 3.2, METAL);
    b.front(5.5, -0.5, 0.5, seat + 3.4, seat + 4.2, f % 2 ? h.color : PAPER);
    b.back(5, -1.2, 1.2, seat + 2.6, seat + 4.9, SCREEN_ON);
    for (let i = 0; i < 3; i++) {
      const row = (i + f) % 3;
      b.back(5, -1, [0.6, -0.2, 0.9][i], seat + 2.9 + row * 0.7, seat + 3.2 + row * 0.7, [STEEL, PURPLE, COBALT][i]);
    }
  }
  drawFigure(pen, h.at.x, h.at.y, {
    size: SMALL,
    dir: facing,
    base: walking ? 6 + (f % 2) * 0.5 : seat,
    stance: walking ? 'walk' : 'sit',
    stride: f,
    legs: STEEL,
    shoes: h.color,
    shirt: PAPER,
    cap: h.color,
    skin: pick(SKIN, h.seed, 4),
    hair: pick(HAIR, h.seed, 0),
    style: 0,
    shut: !reduced && (frame + h.seed) % 19 === 0,
    arms: walking ? 'down' : 'desk',
    tap: walking ? -1 : f % 2, // which hand is on the keys this frame
  });
}
