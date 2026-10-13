import { describe, expect, it } from 'vitest';
import { cutWalls, doorInWall, drawWall, duplicatePiece, longOf, PALETTE, removePiece, resizeRoom, slidePiece, stretchPiece, turnPiece } from '../src/engine/edit';
import { facesOf } from '../src/engine/faces';
import { makeFloor } from '../src/engine/floor';
import { layoutOf } from '../src/engine/layout';
import { LONG } from '../src/engine/pieces';
import type { FloorPiece, Piece, Room } from '../src/engine/room';
import { problemsOf } from '../src/engine/valid';

const DOOR: Piece = { kind: 'door', wall: 'N', a: 40 };
const room = (pieces: Piece[]): Room => ({ size: { w: 96, d: 96 }, pieces: [DOOR, ...pieces], cat: [] });
// a wall right across the room, in two lengths, with whatever is put between them
const across = (kind: string, gap: Piece[]): Room =>
  room([{ kind, x: 0, y: 48, turn: 0, size: [40] }, ...gap, { kind, x: 56, y: 48, turn: 0, size: [40] }]);
const way = (given: Room) => {
  const layout = layoutOf(given);
  return makeFloor(given.size, layout.footprints).route(layout.door.x, layout.door.y, 48, 80);
};

describe('the walls that stand in a room', () => {
  it('are listed apart from the furniture, and only they are', () => {
    expect(PALETTE.filter((piece) => piece.build).map((piece) => piece.kind)).toEqual(['partition', 'glass-wall', 'half-wall', 'inner-door']);
  });

  it('shut off the floor behind them, whatever they are made of', () => {
    for (const kind of ['partition', 'glass-wall', 'half-wall']) {
      const shut = across(kind, [{ kind, x: 40, y: 48, turn: 0, size: [16] }]);
      expect(problemsOf(shut), kind).toEqual([]);
      expect(way(shut), kind).toEqual([]);
    }
    expect(way(across('partition', [])).length).toBeGreaterThan(0); // a gap is a way through
  });

  it('let people through a door, which fills the gap between two of them', () => {
    const office = across('glass-wall', [{ kind: 'inner-door', x: 40, y: 48, turn: 0 }]);
    expect(problemsOf(office)).toEqual([]);
    const path = way(office);
    expect(path.length).toBeGreaterThan(0);
    // and it is the door they go by: between its posts
    const through = path.filter((point) => point.y > 48 && point.y < 52);
    expect(through.length).toBeGreaterThan(0);
    for (const point of through) expect(point.x > 44 && point.x < 52).toBe(true);
  });

  it('meet at a corner, and do not stand in each other', () => {
    const corner = room([{ kind: 'partition', x: 20, y: 40, turn: 0 }, { kind: 'partition', x: 40, y: 44, turn: 1 }]);
    expect(problemsOf(corner)).toEqual([]);
    const crossed = room([{ kind: 'partition', x: 20, y: 40, turn: 0 }, { kind: 'partition', x: 28, y: 32, turn: 1 }]);
    expect(problemsOf(crossed).map((problem) => problem.why)).toEqual(['It stands where the partition does.']);
  });

  it('are drawn in a straight line from one cell to another, along whichever way is further', () => {
    const bare = room([]);
    const start = { c: 5, r: 10, joined: false };
    const east = drawWall(bare, 'partition', start, 12, 11)!;
    expect(east.room.pieces[1]).toEqual({ kind: 'partition', x: 20, y: 40, turn: 0, size: [32] });
    expect(east.end).toEqual({ c: 12, r: 10, joined: true });
    expect(problemsOf(east.room)).toEqual([]);
    // back the other way it is the same wall, and a single cell is a wall too
    expect(drawWall(bare, 'partition', { c: 12, r: 10, joined: false }, 5, 10)!.room.pieces[1]).toEqual(east.room.pieces[1]);
    expect(drawWall(bare, 'partition', start, 5, 10)!.room.pieces[1]).toMatchObject({ x: 20, y: 40, size: [4] });
    // the next goes on from the end of the last, beside it and not on it: round the corner, or straight on
    const south = drawWall(east.room, 'glass-wall', east.end, 13, 18)!;
    expect(south.room.pieces[2]).toEqual({ kind: 'glass-wall', x: 48, y: 44, turn: 1, size: [32] });
    expect(south.end).toEqual({ c: 12, r: 18, joined: true });
    expect(problemsOf(south.room)).toEqual([]);
    expect(drawWall(east.room, 'partition', east.end, 15, 10)!.room.pieces[2]).toMatchObject({ x: 52, y: 40, turn: 0, size: [12] });
    expect(drawWall(east.room, 'partition', east.end, 12, 10)).toBeNull(); // nowhere yet
    expect(drawWall(bare, 'sofa', start, 12, 10)).toBeNull(); // only walls are drawn
  });

  it('give up to a door the length it takes, wherever on them it is put down', () => {
    const walled = room([{ kind: 'partition', x: 0, y: 48, turn: 0, size: [96], tint: '#123456' }]);
    // dropped across the wall, facing the wrong way: it is turned and set in the wall's line
    const dropped: Room = { ...walled, pieces: [...walled.pieces, { kind: 'inner-door', x: 44, y: 44, turn: 1 }] };
    const fitted = doorInWall(dropped, 2);
    expect(fitted.pieces).toEqual([
      DOOR,
      { kind: 'partition', x: 0, y: 48, turn: 0, size: [40], tint: '#123456' },
      { kind: 'inner-door', x: 40, y: 48, turn: 0 },
      { kind: 'partition', x: 56, y: 48, turn: 0, size: [40], tint: '#123456' },
    ]);
    expect(problemsOf(fitted)).toEqual([]);
    expect(way(fitted).length).toBeGreaterThan(0);
    // at the end of a wall there is one length left, and on no wall nothing changes
    const end = doorInWall({ ...walled, pieces: [...walled.pieces, { kind: 'inner-door', x: 80, y: 48, turn: 0 }] }, 2);
    expect(end.pieces).toHaveLength(3);
    expect(end.pieces[1]).toMatchObject({ x: 0, size: [80] });
    const apart: Room = { ...walled, pieces: [...walled.pieces, { kind: 'inner-door', x: 40, y: 20, turn: 0 }] };
    expect(doorInWall(apart, 2)).toBe(apart);
    expect(doorInWall(walled, 1)).toBe(walled); // a wall is not a door
    // a wall that runs down the room takes a door the same
    const down = room([{ kind: 'glass-wall', x: 48, y: 20, turn: 1, size: [60] }, { kind: 'inner-door', x: 40, y: 44, turn: 0 }]);
    const set = doorInWall(down, 2);
    expect(set.pieces.slice(1)).toEqual([
      { kind: 'glass-wall', x: 48, y: 20, turn: 1, size: [20] },
      { kind: 'inner-door', x: 48, y: 40, turn: 1 },
      { kind: 'glass-wall', x: 48, y: 56, turn: 1, size: [24] },
    ]);
    expect(problemsOf(set)).toEqual([]);
  });

  it('are cut away along a line from one cell to another, and left in what lengths remain', () => {
    const walled = room([{ kind: 'partition', x: 0, y: 48, turn: 0, size: [96], tint: '#123456' }, { kind: 'sofa', x: 60, y: 60, turn: 0 }]);
    const at = (c: number, r: number) => ({ c, r, joined: false });
    // out of the middle: two lengths, the second last, and a way through
    const gap = cutWalls(walled, at(10, 12), 13, 12);
    expect(gap.pieces).toEqual([
      DOOR,
      { kind: 'partition', x: 0, y: 48, turn: 0, size: [40], tint: '#123456' },
      { kind: 'sofa', x: 60, y: 60, turn: 0 },
      { kind: 'partition', x: 56, y: 48, turn: 0, size: [40], tint: '#123456' },
    ]);
    expect(problemsOf(gap)).toEqual([]);
    // off one end, a single cell, and the whole of it
    expect(cutWalls(walled, at(20, 12), 23, 12).pieces[1]).toMatchObject({ x: 0, size: [80] });
    expect(cutWalls(walled, at(0, 12), 0, 12).pieces[1]).toMatchObject({ x: 4, size: [92] });
    expect(cutWalls(walled, at(0, 12), 23, 12).pieces.map((piece) => piece.kind)).toEqual(['door', 'sofa']);
    // a line across a wall takes the one cell it crosses; a line that meets none changes nothing, furniture least of all
    expect(cutWalls(walled, at(5, 8), 5, 16).pieces).toHaveLength(4);
    expect(cutWalls(walled, at(5, 8), 5, 16).pieces[1]).toMatchObject({ x: 0, size: [20] });
    expect(cutWalls(walled, at(2, 2), 9, 2)).toBe(walled);
    expect(cutWalls(walled, at(15, 15), 17, 15)).toBe(walled);
    // a wall that runs down the room is cut the same
    const down = room([{ kind: 'glass-wall', x: 48, y: 20, turn: 1, size: [60] }]);
    expect(cutWalls(down, at(12, 9), 12, 11).pieces.slice(1)).toEqual([
      { kind: 'glass-wall', x: 48, y: 20, turn: 1, size: [16] },
      { kind: 'glass-wall', x: 48, y: 48, turn: 1, size: [32] },
    ]);
  });

  it('take what hangs on a wall, on either side of them, where there is wall behind it', () => {
    // a wall from 20 to 60 across, its north side at 48 and its south at 52
    const wall: Piece = { kind: 'partition', x: 20, y: 48, turn: 0, size: [40] };
    const why = (given: Room) => problemsOf(given).map((problem) => problem.why);
    expect(facesOf(room([wall]))).toEqual([
      { wall: 'N', out: 52, from: 20, to: 60, top: 26 },
      { wall: 'S', out: 48, from: 20, to: 60, top: 26 },
    ]);
    const south = room([wall, { kind: 'clock', wall: 'N', a: 30, out: 52 }]);
    expect(why(south)).toEqual([]);
    expect(why(room([wall, { kind: 'mood-board', wall: 'S', a: 26, out: 48 }]))).toEqual([]);
    // whoever looks at it stands before it, on the side it is on
    expect(layoutOf(room([wall, { kind: 'mood-board', wall: 'S', a: 26, out: 48 }])).hangouts).toEqual([{ x: 39, y: 40, dir: 'S' }]);
    // not past the end of the wall, not in the air, not over what hangs there already, and not on a wall too low for it
    expect(why(room([wall, { kind: 'clock', wall: 'N', a: 44, out: 52 }]))).toEqual(['There is no wall behind it.']);
    expect(why(room([wall, { kind: 'clock', wall: 'N', a: 30, out: 60 }]))).toEqual(['There is no wall behind it.']);
    expect(why(room([wall, { kind: 'clock', wall: 'N', a: 22, out: 52 }, { kind: 'clock', wall: 'N', a: 38, out: 52 }]))).toEqual(['It hangs over the clock.']);
    expect(why(room([wall, { kind: 'clock', wall: 'N', a: 30, out: 52 }, { kind: 'clock', wall: 'S', a: 30, out: 48 }]))).toEqual([]); // back to back
    expect(why(room([{ ...wall, kind: 'half-wall' }, { kind: 'clock', wall: 'N', a: 30, out: 52 }]))).toEqual(['It does not fit on its wall.']);
    // two lengths in one line are one wall to hang on
    const joined = room([{ ...wall, size: [20] }, { ...wall, x: 40, size: [20] }, { kind: 'mood-board', wall: 'N', a: 30, out: 52 }]);
    expect(why(joined)).toEqual([]);
    // a wall that runs down the room has an east side and a west
    expect(why(room([{ kind: 'glass-wall', x: 48, y: 20, turn: 1, size: [40] }, { kind: 'clock', wall: 'W', a: 30, out: 52 }, { kind: 'clock', wall: 'E', a: 30, out: 48 }]))).toEqual([]);

    // it goes with its wall: taken away, cut through, or opened for a door
    expect(removePiece(south, 1).pieces).toEqual([DOOR]);
    expect(cutWalls(south, { c: 8, r: 12, joined: false }, 9, 12).pieces.map((piece) => piece.kind)).toEqual(['door', 'partition', 'partition']);
    expect(cutWalls(south, { c: 5, r: 12, joined: false }, 6, 12).pieces.map((piece) => piece.kind)).toEqual(['door', 'partition', 'clock']);
    // and it is slid along, moved to one of the room's own walls, or copied onto one
    expect(slidePiece(south, 2, 'N', 36, 52).pieces[2]).toEqual({ kind: 'clock', wall: 'N', a: 36, out: 52 });
    expect(slidePiece(south, 2, 'W', 36).pieces[2]).toEqual({ kind: 'clock', wall: 'W', a: 36 });
    expect(turnPiece(south, 2).pieces[2]).toEqual({ kind: 'clock', wall: 'E', a: 30 });
    expect(duplicatePiece(south, 2)!.pieces[3]).toMatchObject({ kind: 'clock', wall: 'N' });
    expect('out' in duplicatePiece(south, 2)!.pieces[3]).toBe(false);
    // a room made bigger moves its far walls, and not the wall in it
    const bigger = resizeRoom(room([wall, { kind: 'clock', wall: 'S', a: 30, out: 48 }]), 104, 104);
    expect(bigger.pieces[2]).toMatchObject({ wall: 'S', a: 30, out: 56 });
    expect(why(bigger)).toEqual([]);
  });

  it('come in lengths, a step of the grid at a time, between the shortest and the longest', () => {
    const one = room([{ kind: 'partition', x: 20, y: 40, turn: 0 }, { kind: 'sofa', x: 60, y: 60, turn: 0 }]);
    const wall = (given: Room) => given.pieces[1] as FloorPiece;
    expect(longOf(wall(one))).toBe(24);
    expect(longOf(one.pieces[2])).toBeNull();
    expect(stretchPiece(one, 2, 1)).toBe(one); // a sofa is as long as it is
    const longer = stretchPiece(one, 1, 1);
    expect(wall(longer)).toMatchObject({ x: 20, y: 40, size: [28] });
    let short = one;
    for (let i = 0; i < 10; i++) short = stretchPiece(short, 1, -1);
    expect(longOf(wall(short))).toBe(LONG[0]);
    expect(stretchPiece(short, 1, -1)).toBe(short);
    // turned, it is as long the other way
    const turned = turnPiece(longer, 1);
    expect(layoutOf(turned).footprints[0].slice(2)).toEqual([4, 28]);
  });
});
