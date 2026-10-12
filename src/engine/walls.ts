import { outside, type Patch } from './outside';
import { CHARCOAL, COBALT, DARK_GLASS, GREIGE, IVORY_SHADE, LIME, mix, PAPER, PURPLE, TANGERINE, WARM_LIGHT } from './palette';
import { type Env, sprig } from './pieces';
import type { WallPen } from './place';
import type { WallPiece } from './room';
import type { Scene } from './scene';

// One kind of thing that goes on a wall. `a` runs along the wall from where the
// piece starts and `out` comes off the wall into the room; place.ts puts it on
// whichever wall the piece is on.
export interface WallKind {
  name: string; // what the palette calls it
  tint?: string; // the colour that is a piece of this kind's own to choose, as it comes
  // how far along the wall it reaches, from where the piece starts, and from how high to how high
  span(piece: WallPiece): readonly [from: number, to: number, z0: number, z1: number];
  draw(p: WallPen, env: Env, piece: WallPiece): void;
  hangout?: { a: number; out: number }; // where a supervisor stands to look at it
  door?: { a: number; out: number }; // just inside it, if this is how people come and go
  nap?: { a: number; out: number }; // where the cat curls up by it
  // what moves on it, drawn every frame
  live?(p: WallPen, scene: Scene, piece: WallPiece): void;
}

type Strip = [a0: number, a1: number, z0: number, z1: number];

const MOONLIGHT = '#e6e2f0';
const CLOCK_Z = 18; // the bottom of a clock's digits

const DIGITS = [
  [7, 5, 5, 5, 7], [2, 6, 2, 2, 7], [7, 1, 7, 4, 7], [7, 1, 7, 1, 7], [5, 5, 7, 1, 1],
  [7, 4, 7, 1, 7], [7, 4, 7, 5, 7], [7, 1, 1, 1, 1], [7, 5, 7, 5, 7], [7, 5, 7, 1, 7],
]; // each row of a digit as three bits
const HOUR12 = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12;

export const WALL_KINDS: Record<string, WallKind> = {
  // a window, and what is seen out of it at this hour
  window: {
    name: 'Window',
    span: () => [-1, 25, 7.5, 23.5],
    nap: { a: 2, out: 6 }, // under it
    draw(p, { light }, piece) {
      if (!p.standing) return;
      const { now } = light;
      const view = outside(piece.wall, piece.a, !!piece.sun);
      const patch = ([a0, a1, z0, z1]: Patch, hex: string) => p.panel(a0, a1, z0, z1, hex, true);
      p.panel(-1, 25, 8.5, 23.5, CHARCOAL);
      // the view out: the sky, whatever is up in it at this hour, and the land below
      light.glow(() => {
        p.panel(0, 24, 9, 23, now.sky, true);
        if (now.sun === 'night') {
          for (const star of view.stars) patch(star, MOONLIGHT);
          if (view.moon) patch(view.moon, MOONLIGHT);
        } else if (now.sun === 'low') {
          if (view.sun) patch(view.sun, '#ffe9b0');
        } else {
          for (const cloud of view.clouds) patch(cloud, PAPER);
        }
        const dark = now.sun === 'night';
        const far = view.land === 'city' ? mix(now.sky, dark ? '#0b0c16' : '#56607e', 0.5) : mix(now.sky, dark ? '#0a120d' : '#5d8a55', 0.5);
        for (const shape of view.skyline) patch(shape, far);
        if (now.lamps) for (const lit of view.lights) patch(lit, WARM_LIGHT);
      });
      p.panel(11.6, 12.4, 9, 23, CHARCOAL);
      p.panel(0, 24, 15.7, 16.3, CHARCOAL);
      p.box(-1, 0, 7.5, 26, 1, 1, CHARCOAL); // sill
    },
  },

  // a shelf of plants and a couple of books
  'plant-shelf': {
    name: 'Plant shelf',
    span: () => [0, 14, 15, 22],
    draw(p, { wood }) {
      if (!p.standing) return;
      p.box(0, 0, 15, 14, 2, 0.8, wood.mid);
      sprig(p, 1, 0, 15.8, CHARCOAL);
      sprig(p, 6, 0, 15.8, IVORY_SHADE);
      p.box(10, 0.3, 15.8, 1, 1.5, 3, COBALT);
      p.box(11, 0.3, 15.8, 1, 1.5, 2.5, TANGERINE);
    },
  },
  // the cafe's shelf of cups
  'cafe-shelf': {
    name: 'Cup shelf',
    span: () => [0, 22, 17, 22.5],
    draw(p, { wood }) {
      if (!p.standing) return;
      p.box(0, 0, 17, 22, 2, 0.8, wood.mid);
      sprig(p, 1, 0, 17.8, CHARCOAL);
      p.box(6, 0.3, 17.8, 1.5, 1.5, 2.5, IVORY_SHADE);
      p.box(9, 0.3, 17.8, 1.5, 1.5, 3, TANGERINE);
      p.box(12, 0.3, 17.8, 1.5, 1.5, 2.5, IVORY_SHADE);
      sprig(p, 18, 0, 17.8, IVORY_SHADE);
    },
  },

  'mood-board': {
    name: 'Mood board',
    span: () => [0, 26, 9, 25],
    hangout: { a: 13, out: 8 },
    draw(p, { wood }) {
      p.panel(0, 26, 9, 25, wood.mid);
      p.panel(1, 25, 9.5, 24.5, PAPER);
      const notes: [number, number, string][] = [[3, 20, LIME], [9, 20.5, PURPLE], [16, 19.5, TANGERINE], [4, 14.5, COBALT], [11, 15, PAPER], [18, 13.5, LIME], [11, 11, TANGERINE]];
      for (const [a, z, hex] of notes) p.panel(a, a + 4.5, z, z + 3, hex === PAPER ? GREIGE : hex);
    },
  },
  mural: {
    name: 'Mural',
    span: () => [0, 34, 4, 25.5],
    hangout: { a: 22, out: 14 },
    draw(p) {
      p.panel(2, 14, 4, 18, LIME);
      p.panel(3, 13, 18, 20, LIME);
      p.panel(4.5, 11.5, 20, 21.5, LIME);
      p.panel(16, 30, 4, 11, PURPLE);
      const disc: Strip[] = [[20, 24, 15, 16], [19, 25, 16, 17.5], [18, 26, 17.5, 20.5], [19, 25, 20.5, 22], [20, 24, 22, 23]];
      for (const [a0, a1, z0, z1] of disc) p.panel(a0, a1, z0, z1, TANGERINE);
      p.panel(0, 34, 24.5, 25.3, COBALT);
    },
  },
  // a neon sign: a smile in a frame
  neon: {
    name: 'Neon sign',
    span: () => [0, 20, 15.5, 22.7],
    draw(p, { light }) {
      light.glow(() => {
        const outline: Strip[] = [[0, 20, 22, 22.7], [0, 20, 15.5, 16.2], [0, 0.7, 15.5, 22.7], [19.3, 20, 15.5, 22.7]];
        for (const [a0, a1, z0, z1] of outline) p.panel(a0, a1, z0, z1, PURPLE, true);
        const smile: Strip[] = [[5.5, 7.5, 19.5, 21], [12.5, 14.5, 19.5, 21], [5, 15, 17.3, 18], [4, 5, 18, 18.8], [15, 16, 18, 18.8]];
        for (const [a0, a1, z0, z1] of smile) p.panel(a0, a1, z0, z1, LIME, true);
      });
    },
  },
  // a block of colour: `size` is how wide and how tall
  banner: {
    name: 'Banner',
    tint: COBALT,
    span: (piece) => [0, piece.size?.[0] ?? 10, 4, 4 + (piece.size?.[1] ?? 16)],
    draw(p, _env, piece) {
      const [wide = 10, tall = 16] = piece.size ?? [];
      p.panel(0, wide, 4, 4 + tall, piece.tint ?? COBALT);
    },
  },

  // the real time, in digits three cells wide and five tall
  clock: {
    name: 'Clock',
    span: () => [0, 20, CLOCK_Z - 1.2, CLOCK_Z + 6.2],
    draw(p) {
      p.panel(0, 20, CLOCK_Z - 1.2, CLOCK_Z + 6.2, CHARCOAL);
      p.panel(0.5, 19.5, CLOCK_Z - 0.7, CLOCK_Z + 5.7, DARK_GLASS, true);
    },
    live(p, scene, piece) {
      if (!p.standing) return;
      const now = new Date();
      const hours = HOUR12 ? now.getHours() % 12 || 12 : now.getHours();
      const text = `${String(hours).padStart(2, HOUR12 ? ' ' : '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      // seen from inside, the west and south walls read from high to low
      const flip = piece.wall === 'W' || piece.wall === 'S';
      const cell = (col: number, row: number) => {
        const a = 1.5 + (flip ? 16 - col : col);
        p.panel(a, a + 1, CLOCK_Z + 4 - row, CLOCK_Z + 5 - row, TANGERINE, true);
      };
      scene.light.glow(() => {
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
      });
    },
  },

  // the door everyone comes and goes by: frame, the dark beyond, a mat; the leaf is drawn as it swings
  door: {
    name: 'Door',
    tint: TANGERINE,
    span: () => [0, 9, 0, 21],
    door: { a: 4.5, out: 2 },
    nap: { a: 12.5, out: 10 }, // on the floor beside it
    draw(p) {
      p.panel(0, 9, 0, 21, CHARCOAL);
      p.panel(1, 8, 0, 20, DARK_GLASS, true);
      p.flat(0.5, 8.5, 1, 6, 0, LIME);
    },
    live(p, scene, piece) {
      if (!p.standing) return;
      const hex = piece.tint ?? TANGERINE;
      // swung into the room while someone is passing, shut otherwise
      if (scene.doorOpen) {
        p.box(1, 0, 0, 0.6, 7, 20, hex);
        return;
      }
      const { light } = scene;
      p.panel(1, 8, 0, 20, hex);
      light.glow(() => p.panel(3, 6, 11.5, 17, light.now.sky));
      p.panel(6.5, 7.5, 8.5, 9.5, CHARCOAL);
    },
  },
};
