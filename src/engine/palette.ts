export const HAIR = ['#3b2f2f', '#6b4423', '#d9a441', '#b55239', '#2b2b3a', '#8a8a9a'];
export const SKIN = ['#f2c9a0', '#d9a57a', '#a8744f', '#7a4f33'];
// The palette: mostly warm neutrals, then wood, with the four bright colours
// kept for small things: a sofa, a stool, a mural, somebody's shirt.
export const IVORY = '#f5f0e8';
export const IVORY_SHADE = '#e9e2d5';
export const OAK = '#c9a878';
export const OAK_LIGHT = '#dcc096';
export const OAK_DARK = '#a5875a';
export const GREIGE = '#b8b0a4';
export const CHARCOAL = '#252525';
export const LIME = '#b7e44c';
export const PURPLE = '#8b6dff';
export const TANGERINE = '#ff7548';
export const COBALT = '#4267e8';
export const SAGE = '#a3ad85';
export const OLIVE = '#7d8650';
export const LEAF = '#5e8c4a';
export const LEAF_LIGHT = '#7fa862';
export const WARM_LIGHT = '#ffe2a6';
export const LIGHT_POOL = '#f2e2bf'; // what a lamp throws on a table top
export const FLOOR_A = '#e6d3b0';
export const FLOOR_B = '#dfc9a2';
export const SHIRT = [PURPLE, COBALT, TANGERINE, LIME, OLIVE, '#4a4a4a'];
export const INK = CHARCOAL;
export const PAPER = '#fbf8f2';
export const METAL = '#cfc9bf';
export const STEEL = '#8e877c';
export const SCREEN_OFF = '#34343a';
export const SCREEN_ON = '#e4ecff';
export const TROUSERS = '#3a3a3a';
export const DARK_GLASS = '#15151c'; // an unlit screen, a clock face, the dark past the door
export const CAT = '#e8a34a';

export function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
export const pick = <T>(list: readonly T[], h: number, shift: number): T => list[(h >>> shift) % list.length];
