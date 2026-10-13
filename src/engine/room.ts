import { z } from 'zod';
import { CHARCOAL, COBALT, IVORY_SHADE, LIME, PURPLE, TANGERINE } from './palette';

// The room, as data: how big it is and everything in it. The picture, the floor
// that is in the way of walkers, the chairs and the games are all worked out from
// this (office.ts, layout.ts); pieces.ts and walls.ts say what each kind of piece is.
const colour = z.string().regex(/^#[0-9a-f]{6}$/i);
const common = {
  kind: z.string(), // one that pieces.ts or walls.ts knows; a piece of any other kind is left out
  tint: colour.optional(), // the one colour that is the piece's to choose: a pot, a bean bag, a sofa, a banner
  size: z.array(z.number().positive()).max(2).optional(), // its own measures, for the kinds that come in sizes
  sun: z.boolean().optional(), // a window that the sun and the moon pass
};

// Something standing on the floor: where its low corner is, and how many quarter
// turns it has had. A turn takes what faced south to face west.
const FloorPieceSchema = z.object({
  ...common,
  x: z.number(),
  y: z.number(),
  turn: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

// Something on a wall: which one, and how far along it starts. On a wall that
// stands in the room it is the same, with how far out from the room's own wall
// that side of the wall is: `wall` is then the one that faces the same way.
const WallPieceSchema = z.object({
  ...common,
  wall: z.enum(['N', 'E', 'S', 'W']),
  a: z.number(),
  out: z.number().positive().optional(),
});

export const RoomSchema = z.object({
  size: z.object({
    w: z.number().positive(), // across, along x
    d: z.number().positive(), // deep, along y
  }),
  // in the order they are drawn, which is also the order their games and hangouts are numbered in
  pieces: z.array(z.union([FloorPieceSchema, WallPieceSchema])),
  // where the cat is at home; the other places it goes to sleep come with the furniture
  cat: z.array(z.object({ x: z.number(), y: z.number() })),
  // the colours the room is finished in, where it is not as the app has always had it (finish.ts)
  finish: z
    .object({
      walls: colour.optional(),
      floor: colour.optional(),
      stripe: colour.optional(), // the floor's second tone
      trim: colour.optional(), // the skirting
      wood: colour.optional(), // table tops, counters, shelves
    })
    .optional(),
});

export type Room = z.infer<typeof RoomSchema>;
export type Size = Room['size'];
export type FloorPiece = z.infer<typeof FloorPieceSchema>;
export type WallPiece = z.infer<typeof WallPieceSchema>;
export type Piece = FloorPiece | WallPiece;
export type Turn = FloorPiece['turn'];
export const onWall = (piece: Piece): piece is WallPiece => 'wall' in piece;

// a piece on the floor, written short, and one on a wall
export const floor = (kind: string, x: number, y: number, rest: Partial<FloorPiece> = {}): FloorPiece => ({ kind, x, y, turn: 0, ...rest });
const wall = (kind: string, on: WallPiece['wall'], a: number, rest: Partial<WallPiece> = {}): WallPiece => ({ kind, wall: on, a, ...rest });

// The room the app starts with.
export const DEFAULT_ROOM: Room = {
  size: { w: 140, d: 140 },
  pieces: [
    // north wall: two windows over the long table, a shelf of plants
    wall('window', 'N', 28, { sun: true }),
    wall('window', 'N', 56),
    wall('plant-shelf', 'N', 6),
    // The cafe's back counter, with the coffee machine. It is up here, and the mural
    // comes before the north wall's mood board, because a supervisor's rounds go by
    // this order and have always begun: coffee, mural, mood board.
    floor('counter', 1, 50),
    // west wall: a mural, the cafe shelf, a neon sign over the sofa
    wall('mural', 'W', 6),
    wall('mood-board', 'N', 91),
    wall('cafe-shelf', 'W', 54),
    wall('neon', 'W', 98),
    // the other two walls, for when the room is turned round
    wall('window', 'E', 20, { sun: true }),
    wall('window', 'E', 104),
    wall('window', 'S', 14),
    wall('window', 'S', 58, { sun: true }),
    wall('window', 'S', 102),
    wall('banner', 'E', 48, { tint: COBALT, size: [10, 22] }),
    wall('banner', 'S', 42, { tint: LIME, size: [12, 16] }),
    wall('banner', 'S', 88, { tint: PURPLE, size: [10, 10] }),
    wall('clock', 'W', 77),
    wall('clock', 'E', 60),
    // the two long tables
    floor('table', 26, 7),
    floor('table', 94, 26, { turn: 1 }),
    // cafe: checkerboard floor, an island with stools
    floor('cafe-floor', 0, 46),
    floor('island', 15, 51),
    floor('tree', 4, 86, { tint: CHARCOAL }),
    floor('booth', 124, 2),
    floor('planter', 62, 60),
    floor('grass', 118, 3, { tint: IVORY_SHADE }),
    wall('door', 'N', 81.5),
    floor('tree', 4, 4, { tint: IVORY_SHADE }),
    // lounge: a purple sofa, bean bags, a low table
    floor('lounge-rug', 4, 90),
    floor('sofa', 2, 94),
    floor('low-table', 22, 102),
    floor('bean-bag', 38, 94, { tint: LIME }),
    floor('bean-bag', 38, 114, { tint: TANGERINE }),
    floor('bush', 4, 128, { tint: IVORY_SHADE, size: [6] }),
    floor('grass', 50, 128, { tint: CHARCOAL }),
    // games: ping-pong on a sage checkerboard, an arcade cabinet
    floor('games-floor', 66, 100),
    floor('ping-pong', 76, 106),
    floor('arcade', 118, 94),
    floor('floor-lamp', 15, 86), // in the lounge; the last stop on the rounds
    floor('tree', 131, 130, { tint: CHARCOAL }),
    floor('bush', 131, 82, { tint: IVORY_SHADE, size: [5] }),
  ],
  // by the south wall, looking out at the room
  cat: [{ x: 112.5, y: 132.5 }],
};
