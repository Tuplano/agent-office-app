import { onWall, type Piece } from './room';

// What you can do with each kind of piece in the room, besides what its chairs,
// sofas, bean bags and games are for (those come from the room's layout). Every
// kind there is is listed, those with nothing to do with an empty list, so that a
// kind made without saying what it is for fails a test (`tests/uses.test.ts`).

export type Hold = 'cup' | 'water' | 'can' | 'snack' | 'file' | 'phone' | 'watering' | 'magazine';

// How a use is done: standing at the piece and looking at it, or with your hands on
// it; sat in one of its chairs, or at it with a laptop; sat, or lying, on the floor
// by it; leaning on it, back to it; on the phone; or out of the door and back in.
export type How = 'look' | 'reach' | 'seat' | 'work' | 'floor' | 'lie' | 'lean' | 'call' | 'out';

export interface Use {
  id: string;
  label: string; // in the menu
  doing: string; // after your name, while you are at it: "You · getting some water"
  how: How;
  hold?: Hold; // in your hand while you do it
  keep?: boolean; // and still in your hand after you go
}

const use = (id: string, label: string, doing: string, how: How, hold?: Hold, keep = false): Use => ({ id, label, doing, how, hold, keep });

const DESK = [use('work', 'Work', 'working', 'work')];
const WATER = use('water', 'Water it', 'watering the plants', 'reach', 'watering');
const RUG = [use('sit', 'Sit on the rug', 'sitting on the rug', 'floor')];
const LEAN = use('lean', 'Lean on it', 'leaning on the wall', 'lean');
const LOOK_AT = use('look', 'Look at it', 'having a look', 'look');

export const USES: Readonly<Record<string, readonly Use[]>> = {
  // floor
  table: DESK,
  'small-table': DESK,
  'boss-desk': DESK,
  cubicle: DESK,
  'meeting-table': DESK,
  island: [use('coffee', 'Have a coffee', 'having a coffee', 'seat', 'cup')],
  counter: [use('make', 'Make a coffee', 'making a coffee', 'reach', 'cup', true), use('drink', 'Drink a coffee', 'drinking a coffee', 'look', 'cup')],
  'water-cooler': [use('water', 'Get some water', 'getting some water', 'reach', 'water', true)],
  fridge: [use('open', 'Open the fridge', 'looking in the fridge', 'reach', 'snack', true)],
  vending: [use('drink', 'Get a drink', 'getting a drink', 'reach', 'can', true)],
  cabinet: [use('file', 'Look for a file', 'looking for a file', 'reach', 'file', true)],
  booth: [use('call', 'Make a call', 'on the phone', 'call', 'phone')],
  planter: [WATER],
  bush: [WATER],
  tree: [WATER, use('shade', 'Sit under it', 'sitting under the tree', 'floor')],
  grass: [use('sit', 'Sit on the grass', 'sitting on the grass', 'floor'), use('lie', 'Lie in the grass', 'lying in the grass', 'lie')],
  carpet: RUG,
  'lounge-rug': RUG,
  'low-table': [use('magazine', 'Read a magazine', 'reading a magazine', 'floor', 'magazine')],
  'floor-lamp': [use('read', 'Read by the lamp', 'reading by the lamp', 'floor', 'magazine')],
  partition: [LEAN],
  'half-wall': [LEAN],
  'glass-wall': [LEAN, use('through', 'Look through', 'looking through the glass', 'look')],
  // what the room's layout already gives them a use for
  sofa: [],
  'bean-bag': [],
  'ping-pong': [],
  arcade: [],
  // floor to walk on, and a door to walk through
  'cafe-floor': [],
  'games-floor': [],
  'inner-door': [],
  // on the walls
  window: [use('out', 'Look out', 'looking out of the window', 'look')],
  'plant-shelf': [use('water', 'Water the plants', 'watering the plants', 'reach', 'watering')],
  'cafe-shelf': [use('cup', 'Take a cup', 'taking a cup', 'reach', 'cup', true)],
  'mood-board': [use('check', 'Check it', 'checking the board', 'look')],
  whiteboard: [use('read', 'Read it', 'reading the whiteboard', 'look'), use('write', 'Write on it', 'writing on the whiteboard', 'reach')],
  mural: [use('look', 'Look at it', 'looking at the mural', 'look')],
  neon: [use('look', 'Look at it', 'looking at the sign', 'look')],
  banner: [use('read', 'Read it', 'reading the banner', 'look')],
  clock: [use('time', 'Check the time', 'checking the time', 'look')],
  door: [use('out', 'Step out', 'stepping out', 'out')],
};

// What a piece is for. A kind not listed is a model brought in from a 3D tool:
// it can be looked at, and sat on where it has seat markers (those are its chairs).
export function usesOf(piece: Piece): readonly Use[] {
  return USES[piece.kind] ?? (onWall(piece) ? [] : [LOOK_AT]);
}
