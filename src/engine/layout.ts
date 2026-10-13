import { CELL, type Dir, FACING, OPPOSITE } from './constants';
import { makeFloor } from './floor';
import { FLOOR_KINDS } from './pieces';
import { placePoint, placeRect, type Rect, turnDir, wallPoint } from './place';
import { onWall, type Room } from './room';
import { WALL_KINDS } from './walls';

export interface Seat {
  x: number;
  y: number;
  dir: Dir; // the way the sitter looks
  // a chair at a long table, a bar stool, or a piece that is its own chair
  kind: 'bench' | 'stool' | 'own';
  z: number; // seat height
  piece: number; // the piece of the room it belongs to
  top?: number; // how high the top in front of it is, where that is not a long table's
}

export interface PlaySpot {
  x: number;
  y: number;
  dir: Dir;
  kind: 'pong' | 'arcade' | 'sofa' | 'bean';
  z?: number; // seat height, for the spots where people sit
  piece: number;
  slot: number; // which of its piece's spots it is
}

export interface Spot {
  x: number;
  y: number;
  dir: Dir;
}

// Where everything in a room is for the people in it. All of it is worked out
// from the room; the same pieces are drawn by office.ts.
export interface Layout {
  // where people sit to work, in the order the chairs are given out
  seats: readonly Seat[];
  // where idle people go to play, or to flop
  play: readonly PlaySpot[];
  // places a supervisor drifts between while there is nothing to note down
  hangouts: readonly Spot[];
  // what stands on the floor and is in the way of anyone walking
  footprints: readonly Rect[];
  door: { x: number; y: number }; // just inside the door everyone comes in by
  // open floor where a session with no chair and no lounge seat sits
  spare: Spot | null;
  // where the cat likes to be: home first, then the places it goes to sleep,
  // which are by the furniture and the windows
  cat: readonly { x: number; y: number }[];
}

export const TABLE_TOP = 12; // how high a long table's top is, which a laptop stands on
const REACH = 8; // how far in front of a sitter the middle of their laptop is

// A footprint given relative to a seat (f is forward from the sitter, l is sideways), as [x, y, w, d].
export function around(seat: Spot, f0: number, f1: number, l0: number, l1: number): Rect {
  const { x, y, dir } = seat;
  if (dir === 'S') return [x + l0, y + f0, l1 - l0, f1 - f0];
  if (dir === 'N') return [x + l0, y - f1, l1 - l0, f1 - f0];
  if (dir === 'E') return [x + f0, y + l0, f1 - f0, l1 - l0];
  return [x - f1, y + l0, f1 - f0, l1 - l0];
}

// One side of the laptop in front of a seat: the screen, which faces the sitter, or the lid's back.
export function laptopSide(seat: Spot, screen: boolean): { side: Dir; mid: number; at: number } {
  const [fx, fy] = FACING[seat.dir];
  const far = screen ? 10 : 11;
  const side = screen ? OPPOSITE[seat.dir] : seat.dir;
  return fx === 0 ? { side, mid: seat.x, at: seat.y + fy * far } : { side, mid: seat.y, at: seat.x + fx * far };
}

// Takes one from each pile in turn, so that no pile is used up before the others are begun.
function deal<T>(piles: T[][]): T[] {
  const out: T[] = [];
  for (let round = 0; piles.some((pile) => round < pile.length); round++) {
    for (const pile of piles) if (round < pile.length) out.push(pile[round]);
  }
  return out;
}

// The items that share a key, a pile for each key, in the order the keys first turn up.
function by<T>(items: readonly T[], key: (item: T) => unknown): T[][] {
  const piles = new Map<unknown, T[]>();
  for (const item of items) {
    const pile = piles.get(key(item));
    if (pile) pile.push(item);
    else piles.set(key(item), [item]);
  }
  return [...piles.values()];
}

export function layoutOf(room: Room): Layout {
  const seats: Seat[] = [];
  const play: PlaySpot[] = [];
  const hangouts: Spot[] = [];
  const footprints: Rect[] = [];
  const beds: { x: number; y: number }[] = []; // where the cat curls up, by this piece or that
  const tops: { rect: Rect; z: number }[] = []; // what a laptop can stand on
  const sits: { x: number; y: number; dir: Dir; z: number; piece: number; slot: number }[] = []; // the seats that are pieces themselves
  let door: Layout['door'] | null = null;
  let spare: Spot | null = null;

  for (const [index, piece] of room.pieces.entries()) {
    if (onWall(piece)) {
      const kind = WALL_KINDS[piece.kind];
      if (!kind) continue;
      const at = ({ a, out }: { a: number; out: number }) => {
        const [x, y] = wallPoint(room.size, piece.wall, piece.a + a, out + (piece.out ?? 0));
        return { x, y };
      };
      if (kind.hangout) hangouts.push({ ...at(kind.hangout), dir: piece.wall }); // looking at it
      if (kind.door) door ??= at(kind.door);
      if (kind.nap) beds.push(at(kind.nap));
      continue;
    }
    const kind = FLOOR_KINDS[piece.kind];
    if (!kind) continue;
    const box = kind.box(piece);
    const put = <T extends Spot>(offer: T): T => {
      const [x, y] = placePoint(box, piece, offer.x, offer.y);
      return { ...offer, x, y, dir: turnDir(offer.dir, piece.turn) };
    };
    for (const rect of kind.blocks ?? [[0, 0, ...box] as const]) {
      footprints.push(placeRect(box, piece, rect));
      if (kind.top !== undefined) tops.push({ rect: placeRect(box, piece, rect), z: kind.top });
    }
    for (const offer of kind.seats ?? []) seats.push({ ...put(offer), piece: index });
    (kind.sits ?? []).forEach((offer, slot) => sits.push({ ...put(offer), piece: index, slot }));
    (kind.play ?? []).forEach((offer, slot) => play.push({ ...put(offer), piece: index, slot }));
    if (kind.hangout) hangouts.push(put(kind.hangout));
    if (kind.spare) spare ??= put(kind.spare);
    if (kind.nap) beds.push(put({ ...kind.nap, dir: 'S' }));
  }

  // A piece that is its own chair pairs up with whatever stands before it: with a
  // top where its sitter's laptop would go it is a seat to work at, and the laptop
  // goes on that top; with nothing there it is somewhere to rest, like a sofa.
  for (const { slot, ...sit } of sits) {
    const [fx, fy] = FACING[sit.dir];
    const [px, py] = [sit.x + fx * REACH, sit.y + fy * REACH];
    const top = tops.find(({ rect: [x, y, w, d] }) => px >= x && px < x + w && py >= y && py < y + d);
    if (top) seats.push({ ...sit, kind: 'own', top: top.z });
    else play.push({ ...sit, kind: 'sofa', slot });
  }

  // The chairs facing the starting view fill first, then the ones with their backs
  // to it, and the bar stools take the overflow; each time a chair from every table
  // in turn, so that people spread out over the tables.
  const rank = (seat: Seat) => (seat.kind === 'stool' ? 2 : seat.dir === 'S' || seat.dir === 'E' ? 0 : 1);
  const chairs = [0, 1, 2].flatMap((n) => deal(by(seats.filter((seat) => rank(seat) === n), (seat) => seat.piece)));
  // a chair with its back, or a bar stool; a piece that is its own chair is in the way already
  for (const seat of chairs) {
    if (seat.kind !== 'own') footprints.push(seat.kind === 'stool' ? around(seat, -2.5, 2.5, -2.5, 2.5) : around(seat, -5, 3, -4, 4));
  }

  // Somewhere to stand has to be clear floor inside the walls: a spot that has
  // ended up in the furniture or through a wall is not offered.
  const floor = makeFloor(room.size, footprints);
  const clear = ({ x, y }: { x: number; y: number }) => floor.free(Math.floor(x / CELL), Math.floor(y / CELL));
  const games = play.filter((spot) => !spot.z && clear(spot));
  // the cat's places likewise; with no home left it makes one on the clear floor nearest the middle of the room
  const homes = room.cat.filter(clear);
  let middle = { x: room.size.w / 2, y: room.size.d / 2 };
  if (!homes.length) {
    const centre = middle;
    const off = (at: { x: number; y: number }) => (at.x - centre.x) ** 2 + (at.y - centre.y) ** 2;
    let best = Infinity;
    for (let r = 0; r < floor.rows; r++) {
      for (let c = 0; c < floor.cols; c++) {
        const at = { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 };
        if (!floor.free(c, r) || off(at) >= best) continue;
        best = off(at);
        middle = at;
      }
    }
  }

  return {
    seats: chairs,
    // the games first, then the places to flop, one of each sort in turn
    play: [...games, ...deal(by(play.filter((spot) => spot.z), (spot) => spot.kind))],
    hangouts: hangouts.filter(clear),
    footprints,
    door: door ?? { x: room.size.w / 2, y: 2 },
    spare,
    cat: [...(homes.length ? homes : [middle]), ...beds.filter(clear).map(({ x, y }) => ({ x, y }))],
  };
}
