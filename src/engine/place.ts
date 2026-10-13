import { towardCamera, type View } from './camera';
import type { Dir } from './constants';
import type { Pen } from './raster';
import type { FloorPiece, Size, WallPiece } from './room';

export type Rect = readonly [x: number, y: number, w: number, d: number];
// the floor a piece takes up before it is turned
export type Box = readonly [w: number, d: number];

const ROUND: Dir[] = ['S', 'W', 'N', 'E']; // each quarter turn takes one to the next
export const turnDir = (dir: Dir, turn: number): Dir => ROUND[(ROUND.indexOf(dir) + turn) & 3];

// A rectangle given in a piece's own coordinates, as it lies on the floor once
// the piece is put down and turned.
export function placeRect([w, d]: Box, piece: FloorPiece, [x, y, rw, rd]: Rect): Rect {
  if (piece.turn === 1) return [piece.x + (d - y - rd), piece.y + x, rd, rw];
  if (piece.turn === 2) return [piece.x + (w - x - rw), piece.y + (d - y - rd), rw, rd];
  if (piece.turn === 3) return [piece.x + y, piece.y + (w - x - rw), rd, rw];
  return [piece.x + x, piece.y + y, rw, rd];
}

export function placePoint(box: Box, piece: FloorPiece, u: number, v: number): [x: number, y: number] {
  const [x, y] = placeRect(box, piece, [u, v, 0, 0]);
  return [x, y];
}

// A pen for one piece on the floor. A kind is drawn once, in its own coordinates
// and facing its own way, and this puts every stroke where the piece stands.
export interface Placed extends Pen {
  raw: Pen; // the room's own pen, for what does not turn with the piece
  at(u: number, v: number): [x: number, y: number];
}

export function placedPen(pen: Pen, piece: FloorPiece, box: Box): Placed {
  const { x: ox, y: oy, turn } = piece;
  const rect = (x: number, y: number, w: number, d: number) => placeRect(box, piece, [x, y, w, d]);
  const placed: Placed = {
    raw: pen,
    at: (u, v) => placePoint(box, piece, u, v),
    flat(x0, x1, y0, y1, z, hex) {
      if (!turn) return pen.flat(ox + x0, ox + x1, oy + y0, oy + y1, z, hex);
      const [x, y, w, d] = rect(x0, y0, x1 - x0, y1 - y0);
      pen.flat(x, x + w, y, y + d, z, hex);
    },
    box(x, y, z, w, d, h, hex) {
      if (!turn) return pen.box(ox + x, oy + y, z, w, d, h, hex);
      const [px, py, pw, pd] = rect(x, y, w, d);
      pen.box(px, py, z, pw, pd, h, hex);
    },
    face(side, a0, a1, at, z0, z1, hex, lit, sparse) {
      const across = side === 'N' || side === 'S'; // the face runs along x
      if (!turn) return pen.face(side, (across ? ox : oy) + a0, (across ? ox : oy) + a1, (across ? oy : ox) + at, z0, z1, hex, lit, sparse);
      // a face is a rectangle with no thickness
      const [x, y, w, d] = across ? rect(a0, at, a1 - a0, 0) : rect(at, a0, 0, a1 - a0);
      const turned = turnDir(side, turn);
      if (turned === 'N' || turned === 'S') pen.face(turned, x, x + w, y, z0, z1, hex, lit, sparse);
      else pen.face(turned, y, y + d, x, z0, z1, hex, lit, sparse);
    },
    south: (x0, x1, y, z0, z1, hex, sparse) => placed.face('S', x0, x1, y, z0, z1, hex, false, sparse),
    north: (x0, x1, y, z0, z1, hex, sparse) => placed.face('N', x0, x1, y, z0, z1, hex, false, sparse),
    east: (x, y0, y1, z0, z1, hex, lit, sparse) => placed.face('E', y0, y1, x, z0, z1, hex, lit, sparse),
    west: (x, y0, y1, z0, z1, hex, lit, sparse) => placed.face('W', y0, y1, x, z0, z1, hex, lit, sparse),
  };
  return placed;
}

// The four walls. Each is named for where it stands; its inside looks the opposite way.
export const INSIDE: Record<Dir, Dir> = { W: 'E', N: 'S', E: 'W', S: 'N' };
export const wallLength = (size: Size, wall: Dir) => (wall === 'N' || wall === 'S' ? size.w : size.d);
// the walls between the camera and the room are left out
export const standing = (view: View, wall: Dir) => towardCamera(view, INSIDE[wall]) > 0.08;

// A point `a` along a wall and `out` from it into the room, as a point on the floor.
export function wallPoint(size: Size, wall: Dir, a: number, out: number): [x: number, y: number] {
  if (wall === 'N') return [a, out];
  if (wall === 'W') return [out, a];
  if (wall === 'E') return [size.w - out, a];
  return [a, size.d - out];
}

// A pen for one piece on a wall: `a` runs along the wall from where the piece
// starts, `out` comes off the wall into the room.
export interface WallPen {
  standing: boolean;
  // paints on the inside of the wall; not drawn when the wall is not standing
  panel(a0: number, a1: number, z0: number, z1: number, hex: string, lit?: boolean): void;
  box(a: number, out: number, z: number, wide: number, deep: number, h: number, hex: string): void;
  flat(a0: number, a1: number, out0: number, out1: number, z: number, hex: string): void;
}

export function wallPen(pen: Pen, view: View, size: Size, { wall, a: from }: WallPiece): WallPen {
  const up = standing(view, wall);
  const where = wall === 'N' || wall === 'W' ? 0 : wall === 'E' ? size.w : size.d;
  return {
    standing: up,
    panel(a0, a1, z0, z1, hex, lit) {
      if (up) pen.face(INSIDE[wall], from + a0, from + a1, where, z0, z1, hex, lit);
    },
    box(a, out, z, wide, deep, h, hex) {
      if (wall === 'N') pen.box(from + a, out, z, wide, deep, h, hex);
      else if (wall === 'W') pen.box(out, from + a, z, deep, wide, h, hex);
      else if (wall === 'E') pen.box(size.w - out - deep, from + a, z, deep, wide, h, hex);
      else pen.box(from + a, size.d - out - deep, z, wide, deep, h, hex);
    },
    flat(a0, a1, out0, out1, z, hex) {
      if (wall === 'N') pen.flat(from + a0, from + a1, out0, out1, z, hex);
      else if (wall === 'W') pen.flat(out0, out1, from + a0, from + a1, z, hex);
      else if (wall === 'E') pen.flat(size.w - out1, size.w - out0, from + a0, from + a1, z, hex);
      else pen.flat(from + a0, from + a1, size.d - out1, size.d - out0, z, hex);
    },
  };
}
