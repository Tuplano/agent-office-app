import { LIGHT_POOL, SCREEN_ON, WARM_LIGHT } from './palette';

export interface Daylight {
  ambient: number[]; // what every colour is multiplied by: red, green, blue
  sky: string;
  sun: 'night' | 'low' | 'day';
  lamps: boolean; // dark enough outside for the office lights to be on
}

// The room is lit by the real time of day. Each entry is an hour, what every
// colour is multiplied by at that hour (red, green, blue) and the sky outside;
// the hours in between are a blend of their neighbours. The day runs from a pink
// dawn to a blue morning, an orange late afternoon, a purple dusk and a dark night.
// After dark the room is lit by its own lamps, so it turns warm rather than black.
const LAMPLIT: [number, number, number] = [0.86, 0.77, 0.66];
const DAYLIGHT: [number, [number, number, number], string][] = [
  [0, LAMPLIT, '#1f2136'],
  [5, LAMPLIT, '#1f2136'],
  [6, [0.88, 0.8, 0.8], '#f3b9a2'],
  [7.25, [1, 1, 1], '#c4e2f3'],
  [15, [1, 1, 1], '#c4e2f3'],
  [16.5, [1, 0.87, 0.74], '#ffb27a'],
  [17.5, [1, 0.87, 0.74], '#ffb27a'],
  [18.25, [0.9, 0.79, 0.72], '#5d4b7a'],
  [19.25, LAMPLIT, '#1f2136'],
  [24, LAMPLIT, '#1f2136'],
];

export function hourNow(): number {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
}

export function lightAt(hour: number): Daylight {
  const i = DAYLIGHT.findIndex(([h]) => h > hour);
  const [h0, a0, s0] = DAYLIGHT[i - 1];
  const [h1, a1, s1] = DAYLIGHT[i];
  const mix = (a: number, b: number) => a + ((b - a) * (hour - h0)) / (h1 - h0);
  const rgb = (hex: string) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  const to = rgb(s1);
  return {
    // in steps, so the room is only redrawn when the light has really moved
    ambient: a0.map((v, k) => Math.round(mix(v, a1[k]) * 50) / 50),
    sky: `#${rgb(s0).map((v, k) => Math.round(mix(v, to[k]) / 4) * 4).map((v) => Math.min(255, v).toString(16).padStart(2, '0')).join('')}`,
    sun: hour < 5.5 || hour >= 18.25 ? 'night' : hour < 6.75 || hour >= 15.75 ? 'low' : 'day',
    lamps: hour < 6.25 || hour >= 17.5,
  };
}

// Things that give off light of their own keep their colour whatever the hour:
// these colours always, and anything drawn inside glow().
const LAMPS = new Set([WARM_LIGHT, LIGHT_POOL, SCREEN_ON]);

export interface Light {
  now: Daylight;
  // A hex colour mixed towards white (amount > 0) or black (amount < 0) and lit by
  // the hour, packed as a pixel.
  tone(hex: string, amount: number): number;
  glow(drawIt: () => void): void;
  // true when the light has moved on since it was last looked at
  relight(): boolean;
}

export function makeLight(): Light {
  const tones = new Map<string, number>();
  let glowing = false;
  const light: Light = {
    now: lightAt(hourNow()),
    tone(hex, amount) {
      const own = glowing || LAMPS.has(hex);
      const key = hex + amount + (own ? '*' : '');
      let out = tones.get(key);
      if (out === undefined) {
        const n = parseInt(hex.slice(1), 16);
        const target = amount < 0 ? 0 : 255;
        const k = Math.abs(amount);
        const [red, green, blue] = own ? [1, 1, 1] : light.now.ambient;
        const ch = (shift: number, lit: number) => Math.min(255, Math.round((((n >> shift) & 255) * (1 - k) + target * k) * lit));
        out = ((255 << 24) | (ch(0, blue) << 16) | (ch(8, green) << 8) | ch(16, red)) >>> 0;
        if (tones.size > 4000) tones.clear();
        tones.set(key, out);
      }
      return out;
    },
    glow(drawIt) {
      glowing = true;
      drawIt();
      glowing = false;
    },
    relight() {
      const next = lightAt(hourNow());
      if (JSON.stringify(next) === JSON.stringify(light.now)) return false;
      light.now = next;
      tones.clear();
      return true;
    },
  };
  return light;
}
