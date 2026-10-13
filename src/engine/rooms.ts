import { CHARCOAL, COBALT, IVORY_SHADE, LIME, TANGERINE } from './palette';
import { DEFAULT_ROOM, floor, onWall, type Piece, type Room } from './room';

// Rooms to start from, for anyone who would rather not furnish one from nothing.
// They are rooms like any other: made in edit mode, copied out, and kept here.
export interface ReadyRoom {
  id: string;
  name: string; // what it is called where rooms are chosen
  about: string; // and what is said of it there
  room: Room;
}

export const DEFAULT_ID = 'default'; // the room the app starts with

// They all have the default room's walls, with more or less of what hangs on them.
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

// A room of one's own begins as this: a big bare floor and the door, which a room
// cannot do without. It is not one of the ready-made rooms, and is not shown with them.
export const BLANK_ID = 'blank';
export const BLANK_ROOM: Room = { size: { w: 240, d: 240 }, pieces: [{ kind: 'door', wall: 'N', a: 116 }], cat: [{ x: 122, y: 122 }] };

export const READY_ROOMS: readonly ReadyRoom[] = [
  { id: DEFAULT_ID, name: 'The office', about: 'As it comes: two long tables, the cafe, a lounge and the games.', room: DEFAULT_ROOM },
  { id: 'desks', name: 'All desks', about: 'Six long tables in three rows: a chair for twenty-four.', room: DESKS },
  { id: 'lounge', name: 'Mostly lounge', about: 'Three sofas, six bean bags, the cafe and the games, and one table for two.', room: LOUNGE },
  { id: 'empty', name: 'Empty', about: 'Four walls, the windows and the door. The rest is yours to put in.', room: EMPTY },
];
