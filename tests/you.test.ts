import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { project } from '../src/engine/camera';
import { CELL } from '../src/engine/constants';
import { DEFAULT_ROOM } from '../src/engine/room';
import type { Scene } from '../src/engine/scene';
import { drawYou, FIRST_LOOK, LOOK_CHOICES, makeYou, moveYou, resettleYou, walkTo } from '../src/engine/you';
import { chosenLook } from '../src/lib/you';
import { fakeElement, motionPreference, officeIn, storage } from './stand-ins';

function office(reduced = false) {
  vi.stubGlobal('matchMedia', motionPreference(reduced));
  const { scene, sim } = officeIn(DEFAULT_ROOM);
  scene.you = makeYou(scene);
  return { scene, sim, you: scene.you };
}

// the point of the picture over a point of the floor
const over = (scene: Scene, x: number, y: number): [number, number] => {
  const [sx, sy] = project(scene.view, x, y, 0);
  return [sx, sy];
};
const cellAt = (scene: Scene, x: number, y: number) => Math.floor(y / CELL) * scene.floor.cols + Math.floor(x / CELL);
const centre = (n: number) => n * CELL + CELL / 2;

// a free cell of floor at least `far` cells from a point, by its centre
function freeFloor(scene: Scene, from: { x: number; y: number }, far: number) {
  const { floor } = scene;
  for (let r = 1; r < floor.rows - 1; r++) {
    for (let c = 1; c < floor.cols - 1; c++) {
      const [x, y] = [centre(c), centre(r)];
      const around = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]].every(([dc, dr]) => floor.free(c + dc, r + dr));
      if (around && !floor.taken.has(r * floor.cols + c) && Math.hypot(x - from.x, y - from.y) > far * CELL) return { x, y };
    }
  }
  throw new Error('no free floor');
}

function walkThere(scene: Scene) {
  for (let i = 0; i < 1000 && scene.you!.path.length; i++) {
    scene.frame++;
    moveYou(scene);
  }
  expect(scene.you!.path).toEqual([]);
}

beforeEach(() => {
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { createElement: () => fakeElement() });
});
afterEach(() => vi.unstubAllGlobals());

describe('you, in the room', () => {
  it('stand just inside the door when the office opens, on a cell that is yours', () => {
    const { scene, you } = office();
    expect(you.spot).not.toBeNull();
    expect(scene.floor.taken.has(you.spot!.cell)).toBe(true);
    expect(you.at).toEqual({ x: you.spot!.x, y: you.spot!.y });
    const { door } = scene.layout;
    expect(Math.hypot(you.at.x - door.x, you.at.y - door.y)).toBeLessThan(CELL * 5);
    expect(you.tag.textContent).toBe('You');
  });

  it('walk where the floor is clicked, round the furniture, and hold the cell you stop on', () => {
    const { scene, you } = office();
    const before = you.spot!.cell;
    const to = freeFloor(scene, you.at, 8);
    expect(walkTo(scene, ...over(scene, to.x, to.y))).toBe(true);
    expect(you.path.length).toBeGreaterThan(1);
    expect(scene.floor.taken.has(before)).toBe(false);
    expect(scene.floor.taken.has(you.spot!.cell)).toBe(true);
    walkThere(scene);
    expect(you.at).toEqual(to);
    expect(cellAt(scene, you.at.x, you.at.y)).toBe(you.spot!.cell);
  });

  it('go to the floor beside a piece of furniture that is clicked', () => {
    const { scene, you } = office();
    const { floor } = scene;
    const blocked = floor.blocked.findIndex((b, i) => b && floor.free(i % floor.cols, Math.floor(i / floor.cols) + 1));
    const [x, y] = [centre(blocked % floor.cols), centre(Math.floor(blocked / floor.cols))];
    expect(walkTo(scene, ...over(scene, x, y))).toBe(true);
    expect(floor.blocked[you.spot!.cell]).toBe(0);
    expect(Math.hypot(you.spot!.x - x, you.spot!.y - y)).toBeLessThanOrEqual(CELL * 2);
  });

  it('stay where you are for a click off the floor, and keep your cell', () => {
    const { scene, you } = office();
    const spot = you.spot;
    expect(walkTo(scene, -5000, -5000)).toBe(false);
    expect(you.spot).toBe(spot);
    expect(you.path).toEqual([]);
    expect(scene.floor.taken.has(spot!.cell)).toBe(true);
  });

  it('are there at once when less motion is asked for', () => {
    const { scene, you } = office(true);
    const to = freeFloor(scene, you.at, 8);
    expect(walkTo(scene, ...over(scene, to.x, to.y))).toBe(true);
    expect(you.at).toEqual(to);
    expect(you.path).toEqual([]);
  });

  it('stand still while the room is being edited, and are not sent anywhere', () => {
    const { scene, you } = office();
    const to = freeFloor(scene, you.at, 8);
    scene.editing = true;
    expect(walkTo(scene, ...over(scene, to.x, to.y))).toBe(false);
    scene.editing = false;
    walkTo(scene, ...over(scene, to.x, to.y));
    const at = { ...you.at };
    scene.editing = true;
    moveYou(scene);
    expect(you.at).toEqual(at);
  });

  it('keep your place when the room changes, if it is still floor, and go back to the door if not', () => {
    const { scene, sim, you } = office();
    const to = freeFloor(scene, you.at, 8);
    walkTo(scene, ...over(scene, to.x, to.y));
    walkThere(scene);
    sim.setRoom(DEFAULT_ROOM);
    expect(you.at).toEqual(to);
    expect(scene.floor.taken.has(you.spot!.cell)).toBe(true);

    scene.floor.blocked[you.spot!.cell] = 1; // something now stands there
    resettleYou(scene);
    const { door } = scene.layout;
    expect(Math.hypot(you.at.x - door.x, you.at.y - door.y)).toBeLessThan(CELL * 5);
  });

  it('are drawn, but not while the room is being edited', () => {
    const { scene } = office();
    // drawn over the room as it was built, as each frame is (`draw`)
    const drawn = () => {
      scene.live.rgb.set(scene.office.rgb);
      scene.live.depth.set(scene.office.depth);
      drawYou(scene);
      return scene.live.rgb.some((px, i) => px !== scene.office.rgb[i]);
    };
    expect(drawn()).toBe(true);
    scene.editing = true;
    expect(drawn()).toBe(false);
  });
});

describe('your look', () => {
  it('is what was chosen, part by part, where it is one of the choices', () => {
    expect(chosenLook({ shirt: LOOK_CHOICES.shirt[2], hair: LOOK_CHOICES.hair[3] })).toEqual({ ...FIRST_LOOK, shirt: LOOK_CHOICES.shirt[2], hair: LOOK_CHOICES.hair[3] });
    expect(chosenLook({ shirt: 'url(javascript:)', skin: 7 })).toEqual(FIRST_LOOK);
    expect(chosenLook(null)).toEqual(FIRST_LOOK);
    expect(chosenLook('a string')).toEqual(FIRST_LOOK);
  });
});
