import { describe, expect, it } from 'vitest';
import { CELL, GRID } from '../src/engine/constants';
import { makeFloor } from '../src/engine/floor';
import { DOOR, FOOTPRINTS, type Rect } from '../src/engine/layout';

// a ring of furniture round the cell at column 10, row 10
const WALLED: Rect[] = [[36, 36, 12, 4], [36, 44, 12, 4], [36, 40, 4, 4], [44, 40, 4, 4]];
const INSIDE = { x: 42, y: 42 };
const cellOf = (x: number, y: number) => Math.floor(y / CELL) * GRID + Math.floor(x / CELL);

describe('the floor', () => {
  it('finds a way between two points and ends at the second', () => {
    for (const footprints of [[], FOOTPRINTS, [[40, 0, 4, 100] as Rect]]) {
      const floor = makeFloor(footprints);
      const path = floor.route(DOOR.x, DOOR.y, 110, 120);
      expect(path.length).toBeGreaterThan(1);
      expect(path[path.length - 1]).toEqual({ x: 110, y: 120 });
      // every waypoint on the way stands on a free cell
      for (const { x, y } of path.slice(0, -1)) expect(floor.blocked[cellOf(x, y)]).toBe(0);
    }
  });

  it('goes round furniture, one cell at a time', () => {
    const path = makeFloor(FOOTPRINTS).route(DOOR.x, DOOR.y, 120, 100);
    for (let i = 1; i < path.length - 1; i++) expect(Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y)).toBe(CELL);
  });

  it('finds nothing when the target is walled in', () => {
    const floor = makeFloor(WALLED);
    expect(floor.blocked[cellOf(INSIDE.x, INSIDE.y)]).toBe(0);
    expect(floor.route(DOOR.x, DOOR.y, INSIDE.x, INSIDE.y)).toEqual([]);
    expect(floor.route(INSIDE.x, INSIDE.y, DOOR.x, DOOR.y)).toEqual([]);
    expect(floor.route(DOOR.x, DOOR.y, 100, 100).length).toBeGreaterThan(0);
  });

  it('never gives out a blocked cell or one that is taken', () => {
    for (const footprints of [[], WALLED, FOOTPRINTS]) {
      const floor = makeFloor(footprints);
      const given = new Set<number>();
      for (let i = 0; i < 200; i++) {
        const spot = floor.findSpot(30, 90, 30, 90);
        if (!spot) break;
        expect(floor.blocked[spot.cell]).toBe(0);
        expect(given.has(spot.cell)).toBe(false);
        expect(floor.taken.has(spot.cell)).toBe(true);
        given.add(spot.cell);
      }
      expect(given.size).toBeGreaterThan(20);
      expect(floor.taken.size).toBe(given.size);
    }
  });

  it('does not reach into a walled-in cell from outside', () => {
    const floor = makeFloor(WALLED);
    const spot = floor.findSpot(60, 60, INSIDE.x, INSIDE.y);
    expect(spot && spot.cell).not.toBe(cellOf(INSIDE.x, INSIDE.y));
  });

  it('gives a spot back when it is released', () => {
    const floor = makeFloor(FOOTPRINTS);
    const first = floor.findSpot(60, 90, 60, 90)!;
    const second = floor.findSpot(60, 90, 60, 90)!;
    expect(second.cell).not.toBe(first.cell);
    floor.release(first);
    expect(floor.taken.has(first.cell)).toBe(false);
    expect(floor.findSpot(60, 90, 60, 90)!.cell).toBe(first.cell);
    floor.release(null);
    floor.release(first);
    floor.release(second);
    expect(floor.taken.size).toBe(0);
  });
});
