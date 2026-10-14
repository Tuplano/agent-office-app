import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CELL } from '../src/engine/constants';
import { FLOOR_KINDS } from '../src/engine/pieces';
import { onWall, type Room } from '../src/engine/room';
import { READY_ROOMS } from '../src/engine/rooms';
import type { Scene } from '../src/engine/scene';
import { USES, usesOf } from '../src/engine/uses';
import { WALL_KINDS } from '../src/engine/walls';
import { doAt, drawYou, type Held, makeYou, menuFor, moveYou, resettleYou, tagText, walkTo } from '../src/engine/you';
import { fakeElement, motionPreference, officeIn, storage } from './stand-ins';

const none: Held = { seats: new Set(), play: new Set() };

function office(room: Room) {
  const { scene, sim } = officeIn(room);
  scene.you = makeYou(scene);
  return { scene, sim, you: scene.you };
}

// drawn over the room as it was built, as each frame is
function drawn(scene: Scene) {
  scene.live.rgb.set(scene.office.rgb);
  scene.live.depth.set(scene.office.depth);
  drawYou(scene);
  return scene.live.rgb.some((px, i) => px !== scene.office.rgb[i]);
}

function settle(scene: Scene) {
  for (let i = 0; i < 400 && (scene.you!.path.length || scene.you!.doing?.started === undefined); i++) {
    scene.frame++;
    moveYou(scene);
  }
}

// back to just inside the door, doing nothing
function home(scene: Scene) {
  const { you, floor } = scene;
  floor.release(you!.spot);
  you!.at = { x: -500, y: -500 };
  resettleYou(scene);
  you!.holding = null;
}

beforeEach(() => {
  vi.stubGlobal('matchMedia', motionPreference(true)); // there at once
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { createElement: () => fakeElement() });
});
afterEach(() => vi.unstubAllGlobals());

describe('what each kind of piece is for', () => {
  it('is said for every kind there is, and only for those', () => {
    const kinds = [...Object.keys(FLOOR_KINDS).filter((kind) => !kind.startsWith('model-')), ...Object.keys(WALL_KINDS)].sort();
    expect(Object.keys(USES).sort()).toEqual(kinds);
  });

  it('is named and told apart, use by use', () => {
    for (const [kind, uses] of Object.entries(USES)) {
      expect(new Set(uses.map((u) => u.id)).size, kind).toBe(uses.length);
      for (const u of uses) expect(u.label && u.doing, `${kind} ${u.id}`).toBeTruthy();
    }
  });

  it('is looking at it, for a model brought in from a 3D tool', () => {
    expect(usesOf({ kind: 'model-chair-1', x: 0, y: 0, turn: 0 }).map((u) => u.label)).toEqual(['Look at it']);
  });
});

describe('using every piece in every ready-made room', () => {
  for (const ready of READY_ROOMS) {
    it(`can be done from the door, by the piece, in ${ready.name.toLowerCase()}`, () => {
      const { scene, you } = office(ready.room);
      scene.room.pieces.forEach((piece, index) => {
        for (const use of usesOf(piece)) {
          home(scene);
          const menu = menuFor(scene, index, none, 0, 0)!;
          const what = `${piece.kind} #${index}: ${use.label}`;
          expect(doAt(scene, none, menu, `use:${use.id}`), what).toBe(true);
          settle(scene);
          const doing = you.doing!;
          expect(doing.use?.id, what).toBe(use.id);
          if (use.how === 'seat' || use.how === 'work') {
            expect(doing.seats.length, what).toBe(1);
          } else if (use.how !== 'out') {
            // on free floor, right by the piece, and holding it
            const [c, r] = [Math.floor(doing.x / CELL), Math.floor(doing.y / CELL)];
            expect(scene.floor.free(c, r), what).toBe(true);
            expect(scene.floor.taken.has(you.spot!.cell), what).toBe(true);
          }
          expect(drawn(scene) || use.how === 'out', what).toBe(true);
          walkTo(scene, -5000, -5000); // nowhere: stays, still doing it
        }
      });
    });
  }
});

describe('doing it', () => {
  const room = READY_ROOMS[0].room;
  const piece = (scene: Scene, kind: string) => {
    const index = scene.room.pieces.findIndex((p) => p.kind === kind);
    if (index < 0) throw new Error(`no ${kind} in the room`);
    return index;
  };
  const doIt = (scene: Scene, kind: string, use: string) => {
    expect(doAt(scene, none, menuFor(scene, piece(scene, kind), none, 0, 0)!, `use:${use}`)).toBe(true);
    settle(scene);
  };

  it('says on your name tag what you are doing, and what time the clock says', () => {
    const { scene, you } = office(room);
    expect(tagText(you)).toBe('You');
    doIt(scene, 'counter', 'make');
    expect(tagText(you)).toBe('You · making a coffee');
    if (scene.room.pieces.some((p) => p.kind === 'clock')) {
      doIt(scene, 'clock', 'time');
      expect(tagText(you, new Date(2026, 9, 14, 15, 42))).toMatch(/^You · it's 3:42/);
    }
  });

  it('keeps the coffee you made in your hand when you go, and puts it down to play', () => {
    const { scene, you } = office(room);
    doIt(scene, 'counter', 'make');
    expect(you.holding).toBeNull();
    const to = scene.layout.door;
    walkTo(scene, -1, -1);
    home(scene);
    doIt(scene, 'counter', 'make');
    // leaving for anywhere: what you made goes with you
    const menu = menuFor(scene, piece(scene, 'window'), none, 0, 0)!;
    doAt(scene, none, menu, 'use:out');
    expect(you.holding).toBe('cup');
    expect(drawn(scene)).toBe(true);
    const arcade = scene.layout.play.find((s) => s.kind === 'arcade');
    if (arcade) {
      doAt(scene, none, menuFor(scene, arcade.piece, none, 0, 0)!, 'play');
      expect(you.holding).toBeNull();
    }
    expect(to).toBeTruthy();
  });

  it('steps you out of the door, out of sight, and brings you back in', () => {
    const { scene, you } = office(room);
    doIt(scene, 'door', 'out');
    expect(you.away).toBeGreaterThan(scene.frame);
    expect(drawn(scene)).toBe(false);
    for (let i = 0; i < 40; i++) {
      scene.frame++;
      moveYou(scene);
    }
    expect(you.away).toBe(0);
    expect(you.doing).toBeNull();
    const { door } = scene.layout;
    expect(Math.hypot(you.at.x - door.x, you.at.y - door.y)).toBeLessThan(CELL * 5);
    expect(drawn(scene)).toBe(true);
  });

  it('sits you at a table with a laptop of your own to work', () => {
    const { scene, you } = office(room);
    doIt(scene, 'table', 'work');
    expect(you.doing).toMatchObject({ act: 'use', z: expect.any(Number), top: expect.any(Number) });
    expect(tagText(you)).toBe('You · working');
    expect(drawn(scene)).toBe(true);
  });

  it('is not offered on a wall piece, nor anything there is no use for', () => {
    const { scene } = office(room);
    const floorArea = scene.room.pieces.findIndex((p) => !onWall(p) && !usesOf(p).length && FLOOR_KINDS[p.kind] && !scene.layout.play.some((s) => s.piece === scene.room.pieces.indexOf(p)));
    if (floorArea >= 0) expect(menuFor(scene, floorArea, none, 0, 0)!.actions.map((a) => a.id)).toEqual(['walk']);
  });
});
