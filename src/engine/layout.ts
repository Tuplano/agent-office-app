import { type Dir, FACING, OPPOSITE } from './constants';
import { FLOOR_KINDS } from './pieces';
import { placePoint, placeRect, type Rect, turnDir, wallPoint } from './place';
import { onWall, type Room } from './room';
import { WALL_KINDS } from './walls';

export interface Seat {
  x: number;
  y: number;
  dir: Dir; // the way the sitter looks
  kind: 'bench' | 'stool';
  z: number; // seat height
  piece: number; // the piece of the room it belongs to
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
  // where the cat likes to be: home first, then the places it goes to sleep
  cat: readonly { x: number; y: number }[];
}

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
  let door: Layout['door'] | null = null;
  let spare: Spot | null = null;

  for (const [index, piece] of room.pieces.entries()) {
    if (onWall(piece)) {
      const kind = WALL_KINDS[piece.kind];
      if (!kind) continue;
      const at = ({ a, out }: { a: number; out: number }) => {
        const [x, y] = wallPoint(room.size, piece.wall, piece.a + a, out);
        return { x, y };
      };
      if (kind.hangout) hangouts.push({ ...at(kind.hangout), dir: piece.wall }); // looking at it
      if (kind.door) door ??= at(kind.door);
      continue;
    }
    const kind = FLOOR_KINDS[piece.kind];
    if (!kind) continue;
    const box = kind.box(piece);
    const put = <T extends Spot>(offer: T): T => {
      const [x, y] = placePoint(box, piece, offer.x, offer.y);
      return { ...offer, x, y, dir: turnDir(offer.dir, piece.turn) };
    };
    for (const rect of kind.blocks ?? [[0, 0, ...box] as const]) footprints.push(placeRect(box, piece, rect));
    for (const offer of kind.seats ?? []) seats.push({ ...put(offer), piece: index });
    (kind.play ?? []).forEach((offer, slot) => play.push({ ...put(offer), piece: index, slot }));
    if (kind.hangout) hangouts.push(put(kind.hangout));
    if (kind.spare) spare ??= put(kind.spare);
  }

  // The chairs facing the starting view fill first, then the ones with their backs
  // to it, and the bar stools take the overflow; each time a chair from every table
  // in turn, so that people spread out over the tables.
  const rank = (seat: Seat) => (seat.kind === 'stool' ? 2 : seat.dir === 'S' || seat.dir === 'E' ? 0 : 1);
  const chairs = [0, 1, 2].flatMap((n) => deal(by(seats.filter((seat) => rank(seat) === n), (seat) => seat.piece)));
  // a chair with its back, or a bar stool
  for (const seat of chairs) footprints.push(seat.kind === 'stool' ? around(seat, -2.5, 2.5, -2.5, 2.5) : around(seat, -5, 3, -4, 4));

  return {
    seats: chairs,
    // the games first, then the places to flop, one of each sort in turn
    play: [...play.filter((spot) => !spot.z), ...deal(by(play.filter((spot) => spot.z), (spot) => spot.kind))],
    hangouts,
    footprints,
    door: door ?? { x: room.size.w / 2, y: 2 },
    spare,
    cat: room.cat.length ? room.cat : [{ x: room.size.w / 2, y: room.size.d / 2 }],
  };
}
