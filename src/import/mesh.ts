import { LIMITS } from '../engine/models';
import { CUBE, Refusal, type SeatMark, type Voxels, voxelsOf } from './voxels';

// A model as triangles, the way a 3D tool keeps it, with x and y across the floor
// and z up as in the room, in the model's own measure.
export interface Part {
  // Nine numbers a triangle: three corners, a, b and c, in the order that makes
  // (b - a) x (c - a) point into the thing. That is how a tool's anticlockwise
  // faces come out once its up and its front are the room's.
  positions: Float32Array;
  // The colour at a point of a triangle, given how near it is to each corner
  // (three shares that add up to one), as 0xrrggbb; -1 where it is see-through.
  colour(triangle: number, a: number, b: number, c: number): number;
}
export interface Mesh {
  parts: Part[];
  seats: SeatMark[]; // where the file says someone sits, in the model's measure
}

const MOST_SAMPLES = 2e7; // past this a model is too fine to be worth turning into blocks

// The size of a mesh, and its low corner.
export function boundsOf(mesh: Mesh): { low: [number, number, number]; size: [number, number, number] } {
  const low: [number, number, number] = [Infinity, Infinity, Infinity];
  const high: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of mesh.parts) {
    for (let i = 0; i < positions.length; i++) {
      const v = positions[i];
      if (v < low[i % 3]) low[i % 3] = v;
      if (v > high[i % 3]) high[i % 3] = v;
    }
  }
  if (!low.every(Number.isFinite) || !high.every(Number.isFinite)) throw new Refusal('There is nothing in it to draw.');
  return { low, size: [high[0] - low[0], high[1] - low[1], high[2] - low[2]] };
}

// A mesh as blocks, at so many units to one of its own measure. Every triangle is
// gone over point by point, closely enough to miss no cube it passes through, and
// each cube takes the colour most of the points in it had. The colours are kept a
// little coarse while they are counted, so that a texture's noise does not make a
// thousand of them. The model is stood on the floor in the corner of its grid.
export function voxelise(mesh: Mesh, perUnit: number): { voxels: Voxels; seats: SeatMark[] } {
  const { low, size } = boundsOf(mesh);
  const [nx, ny, nz] = size.map((side) => Math.max(1, Math.ceil((side * perUnit) / CUBE - 1e-4)));
  if (nx > (LIMITS.floor / CUBE) * 2 || ny > (LIMITS.floor / CUBE) * 2 || nz > (LIMITS.high / CUBE) * 2) throw new Refusal('It is far too big at this size.');
  const scale = perUnit / CUBE; // cubes to one of its own measure
  const tally = new Map<number, Map<number, number>>();
  let samples = 0;
  for (const part of mesh.parts) {
    const p = part.positions;
    for (let t = 0; t * 9 < p.length; t++) {
      const corner = (n: number, axis: number) => (p[t * 9 + n * 3 + axis] - low[axis]) * scale;
      const [ax, ay, az, bx, by, bz, cx, cy, cz] = [0, 1, 2].flatMap((n) => [corner(n, 0), corner(n, 1), corner(n, 2)]);
      // A point on a face that lies exactly between two cubes, or on an edge that
      // does, has to fall in the cube the thing is in: so each is taken a little
      // way in from the face, and a little way in from the triangle's edges.
      const [mx, my, mz] = [(ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3];
      let [ox, oy, oz] = [(by - ay) * (cz - az) - (bz - az) * (cy - ay), (bz - az) * (cx - ax) - (bx - ax) * (cz - az), (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)];
      const long = Math.hypot(ox, oy, oz);
      [ox, oy, oz] = long > 1e-9 ? [(ox / long) * 0.05, (oy / long) * 0.05, (oz / long) * 0.05] : [0, 0, 0];
      const edge = Math.max(Math.hypot(bx - ax, by - ay, bz - az), Math.hypot(cx - bx, cy - by, cz - bz), Math.hypot(ax - cx, ay - cy, az - cz));
      const steps = Math.max(1, Math.ceil(edge * 2));
      samples += ((steps + 1) * (steps + 2)) / 2;
      if (samples > MOST_SAMPLES) throw new Refusal('It is too finely made to turn into blocks. Bring a simpler model, or make it smaller.');
      for (let i = 0; i <= steps; i++) {
        for (let j = 0; j <= steps - i; j++) {
          const [a, b] = [i / steps, j / steps];
          const c = 1 - a - b;
          const rgb = part.colour(t, a, b, c);
          if (rgb < 0) continue;
          const [px, py, pz] = [ax * a + bx * b + cx * c, ay * a + by * b + cy * c, az * a + bz * b + cz * c];
          const off = Math.hypot(mx - px, my - py, mz - pz);
          const pull = off > 1e-9 ? Math.min(1, 0.05 / off) : 0;
          const x = Math.min(nx - 1, Math.max(0, Math.floor(px + (mx - px) * pull + ox)));
          const y = Math.min(ny - 1, Math.max(0, Math.floor(py + (my - py) * pull + oy)));
          const z = Math.min(nz - 1, Math.max(0, Math.floor(pz + (mz - pz) * pull + oz)));
          const cell = (z * ny + y) * nx + x;
          const coarse = rgb & 0xf8f8f8;
          let seen = tally.get(cell);
          if (!seen) tally.set(cell, (seen = new Map()));
          seen.set(coarse, (seen.get(coarse) ?? 0) + 1);
        }
      }
    }
  }
  const filled = new Map<number, number>();
  for (const [cell, seen] of tally) {
    let [best, most] = [0, 0];
    for (const [rgb, count] of seen) if (count > most) [best, most] = [rgb, count];
    filled.set(cell, best | 0x040404); // the middle of the coarse step it fell in
  }
  if (!filled.size) throw new Refusal('There is nothing in it to draw.');
  const seats = mesh.seats.map((seat) => ({ ...seat, x: (seat.x - low[0]) * perUnit, y: (seat.y - low[1]) * perUnit, z: Math.max(0, (seat.z - low[2]) * perUnit) }));
  return { voxels: voxelsOf(nx, ny, nz, filled), seats };
}
