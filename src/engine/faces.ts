import { type Dir, WH } from './constants';
import { FLOOR_KINDS } from './pieces';
import { placeRect, wallLength } from './place';
import { onWall, type Room, type Size, type WallPiece } from './room';

// A side of a wall that things can hang on: one of the room's four, or either side
// of a wall that stands in the room. It is named as the room's own wall that
// faces the same way is, with how far out from that wall it stands; `from` and
// `to` are how far along it runs, and `top` how high it goes.
export interface Face {
  wall: Dir;
  out: number;
  from: number;
  to: number;
  top: number;
}

export const outerFace = (size: Size, wall: Dir): Face => ({ wall, out: 0, from: 0, to: wallLength(size, wall), top: WH });

// The two sides of every wall that stands in the room. Lengths of wall that run
// on from each other in one line make one side between them, as high as the lowest.
export function facesOf(room: Room): Face[] {
  const { w, d } = room.size;
  const sides: Face[] = [];
  for (const piece of room.pieces) {
    const kind = onWall(piece) ? undefined : FLOOR_KINDS[piece.kind];
    if (onWall(piece) || !kind?.long || !kind.tall) continue;
    const box = kind.box(piece);
    const [x, y, pw, pd] = placeRect(box, piece, [0, 0, ...box]);
    const top = kind.tall;
    if (piece.turn % 2 === 0) {
      sides.push({ wall: 'N', out: y + pd, from: x, to: x + pw, top }, { wall: 'S', out: d - y, from: x, to: x + pw, top });
    } else {
      sides.push({ wall: 'W', out: x + pw, from: y, to: y + pd, top }, { wall: 'E', out: w - x, from: y, to: y + pd, top });
    }
  }
  sides.sort((p, q) => p.wall.localeCompare(q.wall) || p.out - q.out || p.from - q.from);
  const faces: Face[] = [];
  for (const side of sides) {
    const last = faces[faces.length - 1];
    if (last && last.wall === side.wall && last.out === side.out && side.from <= last.to) {
      last.to = Math.max(last.to, side.to);
      last.top = Math.min(last.top, side.top);
    } else faces.push({ ...side });
  }
  return faces;
}

// The side of a wall in the room that a piece hangs on, if there is wall behind
// the whole of it, from `from` to `to` along.
export function faceFor(faces: readonly Face[], piece: WallPiece, from: number, to: number): Face | undefined {
  return faces.find((face) => face.wall === piece.wall && face.out === piece.out && face.from <= from && to <= face.to);
}
