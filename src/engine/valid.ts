import { CELL, FACING, WH } from './constants';
import { type Face, faceFor, facesOf } from './faces';
import { makeFloor } from './floor';
import { layoutOf } from './layout';
import { FLOOR_KINDS } from './pieces';
import { INSIDE, placeRect, type Rect, wallLength } from './place';
import { onWall, type Room } from './room';
import { WALL_KINDS } from './walls';

// Something wrong with a room, in words, and the piece it is about if it is about one.
export interface Problem {
  piece: number | null;
  why: string;
}

export const SIDE: readonly [shortest: number, longest: number] = [96, 300]; // how long a wall may be

const overlap = (a: Rect, b: Rect) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

// What is wrong with a room; nothing, for one the office can take. Everything
// stands inside the walls and on a wall that is long and high enough, nothing stands on or
// hangs over anything else, and there is one door, with the way in clear. A rug
// may lie under whatever stands on it, though not over another rug. A seat nobody
// can walk to is not a fault: whoever has it is simply put there.
export function problemsOf(room: Room): Problem[] {
  const problems: Problem[] = [];
  const { w, d } = room.size;
  const sized = [w, d].every((side) => side >= SIDE[0] && side <= SIDE[1] && side % CELL === 0);
  if (!sized) problems.push({ piece: null, why: `A room is from ${SIDE[0]} to ${SIDE[1]} across and deep, in steps of ${CELL}.` });

  const standing: { kind: string; rect: Rect }[] = [];
  const lying: { kind: string; rect: Rect }[] = [];
  const hanging: { kind: string; wall: string; out: number; from: number; to: number }[] = [];
  let faces: Face[] | undefined; // the sides of the walls that stand in the room, once they are asked for
  let door = -1;
  room.pieces.forEach((piece, index) => {
    const wrong = (why: string) => problems.push({ piece: index, why });
    if (onWall(piece)) {
      const kind = WALL_KINDS[piece.kind];
      if (!kind) return;
      const [start, end, low, high] = kind.span(piece);
      const [from, to] = [piece.a + start, piece.a + end];
      const out = piece.out ?? 0;
      if (out) {
        // on a wall that stands in the room: there has to be wall behind all of it, and high enough
        const face = faceFor((faces ??= facesOf(room)), piece, from, to);
        if (!face) wrong('There is no wall behind it.');
        else if (low < 0 || high > face.top) wrong('It does not fit on its wall.');
      } else if (from < 0 || to > wallLength(room.size, piece.wall) || low < 0 || high > WH) wrong('It does not fit on its wall.');
      const other = hanging.find((h) => h.wall === piece.wall && h.out === out && from < h.to && h.from < to);
      if (other) wrong(`It hangs over the ${other.kind}.`);
      hanging.push({ kind: piece.kind, wall: piece.wall, out, from, to });
      if (!kind.door || out) return;
      if (door < 0) door = index;
      else wrong('A room has one door.');
      return;
    }
    const kind = FLOOR_KINDS[piece.kind];
    if (!kind) return;
    const box = kind.box(piece);
    const rect = placeRect(box, piece, [0, 0, ...box]);
    if (rect[0] < 0 || rect[1] < 0 || rect[0] + rect[2] > w || rect[1] + rect[3] > d) wrong('It is partly outside the room.');
    const flat = kind.blocks?.length === 0; // a rug, or a patch of floor
    const others = flat ? lying : standing;
    const other = others.find((o) => overlap(o.rect, rect));
    if (other) wrong(flat ? `It lies over the ${other.kind}.` : `It stands where the ${other.kind} does.`);
    others.push({ kind: piece.kind, rect });
  });

  const way = room.pieces[door];
  if (!way || !onWall(way)) problems.push({ piece: null, why: 'A room needs a door.' });
  else if (sized) {
    // the cell just inside the door, and the one beyond it
    const layout = layoutOf(room);
    const floor = makeFloor(room.size, layout.footprints);
    const [fx, fy] = FACING[INSIDE[way.wall]];
    const clear = [0, CELL].every((step) => floor.free(Math.floor((layout.door.x + fx * step) / CELL), Math.floor((layout.door.y + fy * step) / CELL)));
    if (!clear) problems.push({ piece: door, why: 'Something stands in the doorway.' });
  }
  return problems;
}
