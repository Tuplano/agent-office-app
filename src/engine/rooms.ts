import { CHARCOAL, COBALT, IVORY_SHADE, LEAF, LEAF_LIGHT, LIME, PURPLE, TANGERINE } from './palette';
import { DEFAULT_ROOM, floor, onWall, type Piece, type Room, wall } from './room';

// Rooms to start from, for anyone who would rather not furnish one from nothing.
// They are rooms like any other: made in edit mode, copied out, and kept here.
export interface ReadyRoom {
  id: string;
  name: string; // what it is called where rooms are chosen
  about: string; // and what is said of it there
  room: Room;
}

export const DEFAULT_ID = 'default'; // the room the app starts with

// The first four all have the default room's walls, with more or less of what hangs on them.
const { size, cat } = DEFAULT_ROOM;
const hung = (...kinds: string[]): Piece[] => DEFAULT_ROOM.pieces.filter((piece) => onWall(piece) && (!kinds.length || kinds.includes(piece.kind)));

// Six long tables in three rows, with an aisle down the middle: a chair for twenty-four.
const DESKS: Room = {
  size,
  pieces: [
    ...hung('window', 'door', 'plant-shelf', 'mood-board', 'banner', 'clock'),
    floor('table', 8, 8),
    floor('table', 80, 8),
    floor('table', 8, 52),
    floor('table', 80, 52),
    floor('table', 8, 96),
    floor('table', 80, 96),
    floor('tree', 0, 0, { tint: IVORY_SHADE }),
    floor('tree', 132, 0, { tint: CHARCOAL }),
    floor('tree', 0, 132, { tint: CHARCOAL }),
    floor('tree', 132, 132, { tint: IVORY_SHADE }),
  ],
  cat,
};

// Three corners to sit about in, the cafe and the games, and one table for two for
// whoever has work to do; everyone else takes a sofa or a bean bag.
const LOUNGE: Room = {
  size,
  pieces: [
    ...hung(),
    // north-west: a sofa and two bean bags round a low table
    floor('lounge-rug', 4, 12, { tint: TANGERINE }),
    floor('sofa', 4, 16, { tint: COBALT }),
    floor('low-table', 24, 24),
    floor('bean-bag', 40, 16, { tint: TANGERINE }),
    floor('bean-bag', 40, 36, { tint: LIME }),
    floor('floor-lamp', 20, 8),
    // the cafe, where it has always been
    floor('cafe-floor', 0, 48),
    floor('counter', 0, 52),
    floor('island', 16, 52),
    // south-west: the same again
    floor('lounge-rug', 4, 88),
    floor('sofa', 4, 92),
    floor('low-table', 24, 100),
    floor('bean-bag', 40, 92, { tint: LIME }),
    floor('bean-bag', 40, 112, { tint: TANGERINE }),
    floor('floor-lamp', 16, 84),
    // south-east: and once more, facing the other way
    floor('lounge-rug', 88, 88, { tint: COBALT }),
    floor('sofa', 124, 92, { turn: 2, tint: TANGERINE }),
    floor('low-table', 104, 100),
    floor('bean-bag', 92, 92, { turn: 2, tint: COBALT }),
    floor('bean-bag', 92, 112, { turn: 2, tint: LIME }),
    floor('floor-lamp', 128, 84, { turn: 2 }),
    // the games in the middle of it all
    floor('games-floor', 48, 56),
    floor('ping-pong', 60, 64),
    floor('arcade', 120, 56),
    floor('planter', 64, 104),
    // the one table, by the door
    floor('small-table', 100, 12),
    floor('tree', 0, 0, { tint: IVORY_SHADE }),
    floor('tree', 132, 0, { tint: CHARCOAL }),
    floor('tree', 0, 132, { tint: CHARCOAL }),
    floor('tree', 132, 132, { tint: IVORY_SHADE }),
  ],
  cat,
};

// Four walls, the windows and the door.
const EMPTY: Room = { size, pieces: hung('window', 'door'), cat };

// The rooms after these are other sizes, each finished in colours of its own.
const PINK = '#ff5fa2';

// Wide, dark and loud: neon on the walls, the games along the top, a lounge in
// the corner, and small tables for whoever does have work to do.
const LOFT: Room = {
  size: { w: 200, d: 160 },
  finish: { walls: '#2a2140', floor: '#3b3156', stripe: '#352b4e', trim: PINK, wood: '#7c6bd6' },
  pieces: [
    wall('neon', 'N', 20),
    wall('neon', 'N', 60),
    wall('banner', 'N', 100, { tint: PINK, size: [12, 18] }),
    wall('clock', 'N', 120),
    wall('door', 'N', 150, { tint: LIME }),
    wall('mural', 'W', 10),
    wall('neon', 'W', 60),
    wall('window', 'W', 100),
    wall('window', 'E', 20, { sun: true }),
    wall('window', 'E', 70),
    wall('banner', 'E', 110, { tint: LIME, size: [10, 22] }),
    wall('window', 'S', 20),
    wall('window', 'S', 80, { sun: true }),
    wall('window', 'S', 140),
    // the lounge, in the corner
    floor('lounge-rug', 8, 8, { tint: PINK }),
    floor('sofa', 8, 12, { tint: PINK }),
    floor('low-table', 28, 20),
    floor('bean-bag', 44, 12, { tint: LIME }),
    floor('bean-bag', 44, 32, { tint: PURPLE }),
    floor('floor-lamp', 24, 4),
    // the games, along the top
    floor('games-floor', 72, 12, { tint: PURPLE }),
    floor('ping-pong', 84, 20, { tint: PINK }),
    floor('arcade', 128, 8),
    floor('arcade', 172, 8),
    // four small tables, each its own colour, and two long ones
    floor('small-table', 16, 72, { tint: PINK }),
    floor('small-table', 56, 72, { tint: LIME }),
    floor('small-table', 16, 116, { tint: COBALT }),
    floor('small-table', 56, 116, { tint: TANGERINE }),
    floor('table', 112, 64, { tint: PURPLE }),
    floor('table', 112, 112, { tint: LIME }),
    floor('booth', 184, 60, { tint: PINK }),
    floor('planter', 180, 100),
    floor('bean-bag', 184, 132, { tint: LIME }),
    floor('tree', 0, 0, { tint: PINK }),
    floor('tree', 192, 0, { tint: PURPLE }),
    floor('tree', 0, 152, { tint: LIME }),
    floor('tree', 192, 152, { tint: PINK }),
  ],
  cat: [{ x: 98, y: 154 }],
};

// As small as a room gets: a table for two, a sofa, and something green.
const STUDIO: Room = {
  size: { w: 96, d: 96 },
  finish: { walls: '#fbe9e4', floor: '#ecd9c6', stripe: '#e5cfba', trim: '#e8a598', wood: '#d9b08c' },
  pieces: [
    wall('window', 'N', 10, { sun: true }),
    wall('plant-shelf', 'N', 44),
    wall('door', 'N', 70, { tint: '#e8a598' }),
    wall('window', 'W', 30),
    wall('mood-board', 'E', 40),
    wall('window', 'S', 36),
    floor('small-table', 8, 12, { tint: '#e8a598' }),
    floor('floor-lamp', 4, 52),
    floor('sofa', 4, 60, { tint: '#9ec5ab' }),
    floor('low-table', 20, 68),
    floor('bean-bag', 36, 64, { tint: '#f2c14e' }),
    floor('planter', 60, 60),
    floor('tree', 88, 4, { tint: IVORY_SHADE }),
    floor('grass', 88, 88, { tint: '#e8a598' }),
  ],
  cat: [{ x: 50, y: 90 }],
};

// The biggest: an open floor of long tables, and down the east side two offices
// behind glass, each with a door of its own.
const GLASS: Room = {
  size: { w: 240, d: 180 },
  finish: { walls: '#eef3f7', floor: '#d3dbe0', stripe: '#c9d2d8', trim: COBALT, wood: '#9fb0bd' },
  pieces: [
    wall('window', 'N', 10, { sun: true }),
    wall('window', 'N', 50),
    wall('window', 'N', 100),
    wall('door', 'N', 140, { tint: COBALT }),
    wall('window', 'N', 180),
    wall('clock', 'N', 212),
    wall('mural', 'W', 20),
    wall('window', 'W', 70),
    wall('neon', 'W', 130),
    wall('window', 'E', 20, { sun: true }),
    wall('window', 'E', 130),
    wall('window', 'S', 20),
    wall('window', 'S', 70),
    wall('window', 'S', 190, { sun: true }),
    // the office to the north: glass on two sides
    floor('glass-wall', 160, 0, { turn: 1, size: [32] }),
    floor('inner-door', 160, 32, { turn: 1, tint: COBALT }),
    floor('glass-wall', 160, 48, { turn: 1, size: [36] }),
    floor('glass-wall', 164, 80, { size: [76] }),
    floor('boss-desk', 184, 28),
    floor('tree', 228, 4, { tint: CHARCOAL }),
    // the office to the south: a wall to pin things to, and glass to the floor
    floor('partition', 164, 100, { size: [76] }),
    floor('glass-wall', 160, 100, { turn: 1, size: [32] }),
    floor('inner-door', 160, 132, { turn: 1, tint: TANGERINE }),
    floor('glass-wall', 160, 148, { turn: 1, size: [32] }),
    wall('mood-board', 'N', 180, { out: 104 }),
    floor('table', 176, 124, { tint: COBALT }),
    floor('grass', 232, 88, { tint: CHARCOAL }),
    // the open floor
    floor('table', 16, 16),
    floor('table', 84, 16),
    floor('table', 16, 64),
    floor('table', 84, 64),
    floor('lounge-rug', 8, 124, { tint: COBALT }),
    floor('sofa', 8, 128, { tint: COBALT }),
    floor('low-table', 28, 136),
    floor('bean-bag', 44, 128, { tint: TANGERINE }),
    floor('bean-bag', 44, 148, { tint: LIME }),
    floor('island', 100, 128, { tint: COBALT }),
    floor('planter', 132, 136),
    floor('tree', 0, 0, { tint: CHARCOAL }),
    floor('tree', 0, 172, { tint: CHARCOAL }),
  ],
  cat: [{ x: 150, y: 170 }],
};

// Green and wood: plants in every corner, shelves of them on the walls, and a cafe by the door.
const GARDEN: Room = {
  size: { w: 160, d: 120 },
  finish: { walls: '#e9f0df', floor: '#cdb98f', stripe: '#c4af83', trim: LEAF, wood: '#a5875a' },
  pieces: [
    wall('door', 'N', 20, { tint: LEAF }),
    wall('window', 'N', 50, { sun: true }),
    wall('window', 'N', 90),
    wall('plant-shelf', 'N', 130),
    wall('plant-shelf', 'W', 20),
    wall('cafe-shelf', 'W', 56),
    wall('window', 'E', 40),
    wall('plant-shelf', 'E', 90),
    wall('window', 'S', 10),
    wall('window', 'S', 60, { sun: true }),
    wall('window', 'S', 110),
    floor('table', 60, 12, { tint: LEAF_LIGHT }),
    floor('counter', 0, 52),
    floor('island', 16, 52, { tint: LEAF }),
    floor('planter', 60, 72),
    floor('sofa', 96, 84, { tint: LEAF_LIGHT }),
    floor('bean-bag', 112, 100, { tint: TANGERINE }),
    floor('small-table', 124, 56, { tint: LEAF }),
    floor('tree', 0, 0, { tint: IVORY_SHADE }),
    floor('tree', 152, 0, { tint: IVORY_SHADE }),
    floor('tree', 0, 112, { tint: IVORY_SHADE }),
    floor('tree', 152, 112, { tint: IVORY_SHADE }),
    floor('bush', 40, 100, { tint: IVORY_SHADE, size: [6] }),
    floor('grass', 84, 108, { tint: IVORY_SHADE }),
    floor('bush', 132, 100, { tint: IVORY_SHADE, size: [6] }),
    floor('grass', 44, 8, { tint: IVORY_SHADE }),
  ],
  cat: [{ x: 70, y: 100 }],
};

// Head office, in grey and navy with dark wood: sixteen cubicles in rows set back
// to back, a meeting room behind glass, the boss behind a wall and a door, and
// along the south side a pantry and a lounge.
const NAVY = '#1f2a44';
const SLATE = '#8792a2';
const PALE = '#c9ced6';
// a row of four cubicles, in two pairs with a way between: open to the north, or turned to open to the south
const row = (y: number, turn: 0 | 2, tint: string) => [12, 44, 84, 116].map((x) => floor('cubicle', x, y, { turn, tint }));
const CORPORATE: Room = {
  size: { w: 280, d: 232 },
  finish: { walls: '#eceef1', floor: '#cdd1d6', stripe: '#c3c8ce', trim: NAVY, wood: '#6b5a4a' },
  pieces: [
    wall('window', 'N', 10, { sun: true }),
    wall('window', 'N', 50),
    wall('window', 'N', 90),
    wall('banner', 'N', 118, { tint: NAVY, size: [10, 20] }),
    wall('door', 'N', 132, { tint: NAVY }),
    wall('whiteboard', 'N', 166),
    wall('clock', 'N', 200),
    wall('window', 'N', 236),
    wall('banner', 'W', 20, { tint: NAVY, size: [10, 22] }),
    wall('window', 'W', 60),
    wall('window', 'W', 110),
    wall('mood-board', 'W', 140),
    wall('cafe-shelf', 'W', 172),
    wall('window', 'E', 20, { sun: true }),
    wall('window', 'E', 130),
    wall('window', 'E', 192),
    wall('window', 'S', 20),
    wall('window', 'S', 64),
    wall('window', 'S', 110),
    wall('window', 'S', 190, { sun: true }),
    wall('window', 'S', 236),
    // carpet under the desks, in the meeting room and in the boss's office
    floor('carpet', 4, 12, { size: [152, 148], tint: '#3a4a68' }),
    floor('carpet', 164, 0, { size: [116, 80], tint: '#56627a' }),
    floor('carpet', 164, 108, { size: [116, 68], tint: '#4a3f3a' }),
    // the cubicles: two rows back to back, an aisle, and two more
    ...row(20, 0, SLATE),
    ...row(48, 2, PALE),
    ...row(96, 0, PALE),
    ...row(124, 2, SLATE),
    floor('cabinet', 76, 0, { turn: 2 }),
    floor('cabinet', 84, 0, { turn: 2 }),
    floor('tree', 0, 0, { tint: CHARCOAL }),
    floor('tree', 148, 4, { tint: CHARCOAL }),
    // the meeting room, behind glass
    floor('glass-wall', 160, 0, { turn: 1, size: [32] }),
    floor('inner-door', 160, 32, { turn: 1, tint: NAVY }),
    floor('glass-wall', 160, 48, { turn: 1, size: [36] }),
    floor('glass-wall', 164, 80, { size: [116] }),
    floor('meeting-table', 168, 24, { tint: NAVY }),
    floor('tree', 272, 4, { tint: CHARCOAL }),
    floor('tree', 272, 88, { tint: CHARCOAL }),
    floor('planter', 236, 88),
    // the boss's office, behind walls
    floor('partition', 164, 104, { size: [116], tint: '#dfe2e7' }),
    floor('partition', 160, 104, { turn: 1, size: [28], tint: '#dfe2e7' }),
    floor('inner-door', 160, 132, { turn: 1, tint: NAVY }),
    floor('partition', 160, 148, { turn: 1, size: [32], tint: '#dfe2e7' }),
    floor('partition', 164, 176, { size: [116], tint: '#dfe2e7' }),
    wall('mural', 'N', 200, { out: 108 }),
    floor('boss-desk', 208, 132),
    floor('sofa', 168, 148, { tint: '#8a2f3a' }),
    floor('low-table', 184, 156),
    floor('floor-lamp', 172, 112),
    floor('cabinet', 244, 108, { turn: 2 }),
    floor('cabinet', 252, 108, { turn: 2 }),
    floor('cabinet', 260, 108, { turn: 2 }),
    floor('tree', 272, 168, { tint: CHARCOAL }),
    // the pantry, in the south-west corner: a counter, a fridge and a machine along
    // the wall, an island with stools and a table for two on the tiles
    floor('cafe-floor', 4, 168, { tint: SLATE }),
    floor('cafe-floor', 40, 168, { tint: SLATE }),
    floor('counter', 0, 172),
    floor('fridge', 0, 208, { turn: 3 }),
    floor('vending', 0, 220, { turn: 3, tint: NAVY }),
    floor('island', 24, 176, { tint: NAVY }),
    floor('small-table', 56, 176, { tint: NAVY }),
    floor('water-cooler', 48, 224),
    floor('planter', 100, 196),
    floor('bush', 124, 220, { tint: CHARCOAL, size: [6] }),
    // the lounge, in the south-east: two sofas across a rug, with the board on the wall behind
    wall('mood-board', 'N', 200, { out: 180 }),
    floor('lounge-rug', 172, 188, { tint: NAVY }),
    floor('sofa', 172, 192, { tint: NAVY }),
    floor('low-table', 192, 200),
    floor('bean-bag', 208, 192, { tint: SLATE }),
    floor('bean-bag', 208, 212, { tint: PALE }),
    floor('sofa', 236, 192, { turn: 2, tint: SLATE }),
    floor('floor-lamp', 184, 184),
    floor('planter', 256, 200),
    floor('tree', 272, 224, { tint: CHARCOAL }),
  ],
  cat: [{ x: 142, y: 202 }],
};

// A room of one's own begins as this: a big bare floor and the door, which a room
// cannot do without. It is not one of the ready-made rooms, and is not shown with them.
export const BLANK_ID = 'blank';
export const BLANK_ROOM: Room = { size: { w: 240, d: 240 }, pieces: [{ kind: 'door', wall: 'N', a: 116 }], cat: [{ x: 122, y: 122 }] };

export const READY_ROOMS: readonly ReadyRoom[] = [
  { id: DEFAULT_ID, name: 'The office', about: 'As it comes: two long tables, the cafe, a lounge and the games.', room: DEFAULT_ROOM },
  { id: 'desks', name: 'All desks', about: 'Six long tables in three rows: a chair for twenty-four.', room: DESKS },
  { id: 'lounge', name: 'Mostly lounge', about: 'Three sofas, six bean bags, the cafe and the games, and one table for two.', room: LOUNGE },
  { id: 'empty', name: 'Empty', about: 'Four walls, the windows and the door. The rest is yours to put in.', room: EMPTY },
  { id: 'loft', name: 'Gen Z loft', about: 'Wide, dark and loud: neon on the walls, two arcades, ping-pong, and tables in every colour.', room: LOFT },
  { id: 'studio', name: 'Tiny studio', about: 'As small as a room gets, in soft pink: a table for two, a sofa and a plant.', room: STUDIO },
  { id: 'glass', name: 'Glass offices', about: 'The biggest: an open floor of long tables, and two offices behind glass, each with its own door: one for the boss.', room: GLASS },
  { id: 'garden', name: 'Garden room', about: 'Green and wood: plants in every corner, shelves of them on the walls, and a cafe by the door.', room: GARDEN },
  { id: 'corporate', name: 'Corporate office', about: 'Head office, in grey and navy: sixteen cubicles, a meeting room behind glass, the boss behind a door, a pantry and a lounge.', room: CORPORATE },
];
