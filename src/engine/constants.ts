export type Dir = 'N' | 'E' | 'S' | 'W';

export const MAX_HELPERS = 5;
export const PLAY_AFTER_MS = 30 * 1000; // idle this long, then off to the break area
export const BOSS_GRACE_MS = 90 * 1000; // a supervisor outlasts a gap this long between observers

// Room geometry in world units: x and y across the floor, z up, walls at the edges.
export const W = 140;
export const D = 140;
export const WH = 30; // wall height
export const WT = 3; // wall thickness
export const FT = 3; // floor thickness
export const SCENE_W = 580;
export const SCENE_H = 420;
export const CENTRE_Y = 236; // where the middle of the floor sits on the canvas
export const SEAT_Z = 7; // height of a chair seat
export const LEGS = 9; // height of a standing adult's legs
export const CELL = 4; // the floor is a grid of cells this wide, for standing and walking
export const GRID = W / CELL;

export const FACING: Record<Dir, readonly [number, number]> = { E: [1, 0], S: [0, 1], N: [0, -1], W: [-1, 0] };
export const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' };
