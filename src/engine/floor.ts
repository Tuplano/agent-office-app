import { CELL, GRID } from './constants';
import type { Rect } from './layout';

export interface Waypoint {
  x: number;
  y: number;
}

// A cell someone is standing on, and its centre.
export interface Spot extends Waypoint {
  cell: number;
  score: number;
}

type Cell = [c: number, r: number];

export interface Floor {
  blocked: Uint8Array; // 1 where furniture stands
  taken: Set<number>; // cells holding a standing figure
  free(c: number, r: number): boolean;
  // The free cell nearest to (tx, ty) that can be walked to from (x, y), so nobody
  // ends up inside a desk or on the far side of a wall. The cell is then taken.
  findSpot(x: number, y: number, tx: number, ty: number): Spot | null;
  release(spot: Spot | null): void;
  // A walkable path between two points as a list of waypoints ending at the second;
  // empty when there is no way through.
  route(ax: number, ay: number, bx: number, by: number): Waypoint[];
}

const STEPS: Cell[] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const cellOf = (v: number) => Math.floor(v / CELL);
const centre = (c: number) => c * CELL + CELL / 2;

export function makeFloor(footprints: readonly Rect[]): Floor {
  const blocked = new Uint8Array(GRID * GRID);
  const taken = new Set<number>();
  const free = (c: number, r: number) => c >= 0 && r >= 0 && c < GRID && r < GRID && !blocked[r * GRID + c];

  // marks the cells whose centre lies under a footprint
  for (const [x, y, w, d] of footprints) {
    for (let r = Math.ceil(y / CELL - 0.5); r <= Math.floor((y + d) / CELL - 0.5); r++) {
      for (let c = Math.ceil(x / CELL - 0.5); c <= Math.floor((x + w) / CELL - 0.5); c++) {
        if (c >= 0 && r >= 0 && c < GRID && r < GRID) blocked[r * GRID + c] = 1;
      }
    }
  }

  // free cells within `reach` cells of a point
  function cellsNear(x: number, y: number, reach: number): Cell[] {
    const cells: Cell[] = [];
    for (let r = cellOf(y) - reach; r <= cellOf(y) + reach; r++) {
      for (let c = cellOf(x) - reach; c <= cellOf(x) + reach; c++) if (free(c, r)) cells.push([c, r]);
    }
    return cells;
  }

  function findSpot(x: number, y: number, tx: number, ty: number): Spot | null {
    const seen = new Set<number>();
    let ring = cellsNear(x, y, 2);
    for (const [c, r] of ring) seen.add(r * GRID + c);
    let best: Spot | null = null;
    for (let step = 0; step < 8 && ring.length; step++) {
      const next: Cell[] = [];
      for (const [c, r] of ring) {
        const cell = r * GRID + c;
        const score = (centre(c) - tx) ** 2 + (centre(r) - ty) ** 2;
        if (!taken.has(cell) && (!best || score < best.score)) best = { cell, score, x: centre(c), y: centre(r) };
        for (const [dc, dr] of STEPS) {
          const id = (r + dr) * GRID + c + dc;
          if (seen.has(id) || !free(c + dc, r + dr)) continue;
          seen.add(id);
          next.push([c + dc, r + dr]);
        }
      }
      ring = next;
    }
    if (best) taken.add(best.cell);
    return best;
  }

  function route(ax: number, ay: number, bx: number, by: number): Waypoint[] {
    const nearest = (x: number, y: number): Cell | undefined =>
      cellsNear(x, y, 3).sort((p, q) => (centre(p[0]) - x) ** 2 + (centre(p[1]) - y) ** 2 - (centre(q[0]) - x) ** 2 - (centre(q[1]) - y) ** 2)[0];
    const start = nearest(ax, ay);
    const goal = nearest(bx, by);
    if (!start || !goal) return [];
    const from = new Map<number, number>([[start[1] * GRID + start[0], -1]]);
    let ring: Cell[] = [start];
    const goalId = goal[1] * GRID + goal[0];
    while (ring.length && !from.has(goalId)) {
      const next: Cell[] = [];
      for (const [c, r] of ring) {
        for (const [dc, dr] of STEPS) {
          const id = (r + dr) * GRID + c + dc;
          if (from.has(id) || !free(c + dc, r + dr)) continue;
          from.set(id, r * GRID + c);
          next.push([c + dc, r + dr]);
        }
      }
      ring = next;
    }
    if (!from.has(goalId)) return [];
    const path: Waypoint[] = [{ x: bx, y: by }];
    for (let id = goalId; id !== -1; id = from.get(id)!) path.unshift({ x: centre(id % GRID), y: centre(Math.floor(id / GRID)) });
    return path;
  }

  return {
    blocked,
    taken,
    free,
    findSpot,
    release(spot) {
      if (spot) taken.delete(spot.cell);
    },
    route,
  };
}
