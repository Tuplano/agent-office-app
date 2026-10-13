import { CHARCOAL, FLOOR_A, FLOOR_B, GREIGE, hsl, IVORY, IVORY_SHADE, mix, OAK, OAK_DARK, OAK_LIGHT, PAPER } from './palette';
import type { Room } from './room';

// The colours a room is finished in: its walls, the two tones of its floor, the
// skirting, and the wood of its furniture. Whatever a room does not say is as
// the app has always had it.
export type Finish = NonNullable<Room['finish']>;

// A finish with nothing left unsaid, as the drawing wants it.
export interface Look {
  walls: string;
  shade: string; // the wall turned away from the light
  floor: string;
  stripe: string;
  trim: string;
  wood: { mid: string; light: string; dark: string };
}

export function lookOf(finish: Finish = {}): Look {
  const { walls, floor, wood } = finish;
  return {
    walls: walls ?? IVORY,
    shade: walls ? mix(walls, '#000000', 0.06) : IVORY_SHADE,
    floor: floor ?? FLOOR_A,
    stripe: finish.stripe ?? (floor ? mix(floor, '#000000', 0.04) : FLOOR_B),
    trim: finish.trim ?? GREIGE,
    wood: wood ? { mid: wood, light: mix(wood, '#ffffff', 0.25), dark: mix(wood, '#000000', 0.2) } : { mid: OAK, light: OAK_LIGHT, dark: OAK_DARK },
  };
}

// A whole finish picked at random, for trying a room on in other colours: walls
// in a pale wash of some hue, or now and then a dark one, a floor of wood or of
// stone, and furniture of some wood. `random` is there so that a test can script it.
export function randomFinish(random: () => number = Math.random): Finish {
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);
  const hue = random() * 360;
  const dark = random() < 0.2;
  const walls = hsl(hue, between(12, 32), dark ? between(28, 40) : between(82, 92));
  const floor = random() < 0.3 ? hsl(hue, between(3, 10), dark ? between(30, 45) : between(55, 82)) : hsl(between(20, 40), between(25, 45), dark ? between(30, 45) : between(50, 80));
  const wood = hsl(between(18, 42), between(20, 45), between(25, 78));
  const trim = [PAPER, GREIGE, CHARCOAL, mix(walls, '#000000', 0.35)][Math.floor(random() * 4)];
  return { walls, floor, stripe: mix(floor, '#000000', 0.05), trim, wood };
}

// A colour at random for a piece: any hue, strong enough to be the bright thing in the room.
export function randomTint(random: () => number = Math.random): string {
  return hsl(random() * 360, 45 + random() * 30, 45 + random() * 23);
}

// every part of a finish put back to how a room comes
export const PLAIN: { [K in keyof Finish]-?: null } = { walls: null, floor: null, stripe: null, trim: null, wood: null };
