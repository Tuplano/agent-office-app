import { floorAt, project } from './camera';
import { CELL, LEGS, SCENE_H, SCENE_W } from './constants';
import { ADULT, drawFigure } from './figures';
import { type Spot, step, type Waypoint } from './floor';
import { HAIR, PAPER, SHIRT, SKIN, TROUSERS } from './palette';
import type { Scene, Walker } from './scene';

// You: the person at the screen, in the room. You run no session: you go where
// you are sent and stand there. Like everyone standing, you hold the cell of floor
// you stand on, so nobody is put down on top of you; walking, as everyone does,
// you pass through people.

export interface Look {
  shirt: string;
  skin: string;
  hair: string;
}

// what a look can be made of: what the workers are dressed from
export const LOOK_CHOICES: { readonly [K in keyof Look]: readonly string[] } = { shirt: SHIRT, skin: SKIN, hair: HAIR };
export const FIRST_LOOK: Look = { shirt: SHIRT[1], skin: SKIN[1], hair: HAIR[0] };

export interface You extends Walker {
  at: Waypoint;
  // the cell you hold: where you stand, or where you are walking to
  spot: Spot | null;
  look: Look;
  tag: HTMLElement;
}

const SPEED = 4; // a brisk walk, as workers hurrying back to their desks

// Just inside the door, a few steps into the room: where you stand when the office
// opens, and when the room changes from under you.
function byTheDoor(scene: Scene): Spot | null {
  const { door } = scene.layout;
  const { w, d } = scene.room.size;
  const far = Math.hypot(w / 2 - door.x, d / 2 - door.y) || 1;
  const tx = door.x + ((w / 2 - door.x) / far) * CELL * 3;
  const ty = door.y + ((d / 2 - door.y) / far) * CELL * 3;
  return scene.floor.findSpot(door.x, door.y, tx, ty);
}

export function makeYou(scene: Scene, look: Look = FIRST_LOOK): You {
  const tag = document.createElement('span');
  tag.className = 'tag you';
  tag.textContent = 'You';
  scene.tags.append(tag);
  const spot = byTheDoor(scene);
  return { at: spot ? { x: spot.x, y: spot.y } : { ...scene.layout.door }, path: [], facing: 'S', spot, look, tag };
}

// Walks you to the floor under a point of the picture: to the free cell nearest it
// that can be got to. Off the floor, or with no way there, you stay where you are,
// and it says so.
export function walkTo(scene: Scene, sx: number, sy: number): boolean {
  const { you, floor } = scene;
  if (!you || scene.editing) return false;
  const [x, y] = floorAt(scene.view, sx, sy);
  floor.release(you.spot); // where you stand is somewhere you can be sent
  const spot = floor.findSpot(x, y, x, y);
  const path = spot ? floor.route(you.at.x, you.at.y, spot.x, spot.y) : [];
  if (!spot || !path.length) {
    floor.release(spot);
    if (you.spot) floor.taken.add(you.spot.cell);
    return false;
  }
  you.spot = spot;
  you.path = path;
  if (scene.reduced) arrive(you);
  return true;
}

function arrive(you: You) {
  const end = you.path[you.path.length - 1];
  if (end) you.at = { x: end.x, y: end.y };
  you.path = [];
}

// One frame of your walk. While the room is edited you stand still.
export function moveYou(scene: Scene) {
  const { you } = scene;
  if (!you || scene.editing || !you.path.length) return;
  if (scene.reduced) return arrive(you);
  step(you, SPEED);
}

// After the room has changed: where you stood, if that is still floor; otherwise
// by the door. The floor is a new one, so the cell is taken again.
export function resettleYou(scene: Scene) {
  const { you, floor } = scene;
  if (!you) return;
  you.path = [];
  const [c, r] = [Math.floor(you.at.x / CELL), Math.floor(you.at.y / CELL)];
  const spot = floor.free(c, r) ? floor.findSpot(you.at.x, you.at.y, you.at.x, you.at.y) : byTheDoor(scene);
  you.spot = spot;
  if (spot) you.at = { x: spot.x, y: spot.y };
}

export function drawYou(scene: Scene) {
  const { you, reduced } = scene;
  if (!you || scene.editing) return; // out of the way of the furniture, as the name tags are
  const walking = you.path.length > 0;
  const f = reduced ? 0 : scene.frame;
  drawFigure(scene.pen, you.at.x, you.at.y, {
    size: ADULT,
    dir: you.facing,
    base: LEGS + (walking && f % 2 ? 0.5 : 0),
    stance: walking ? 'walk' : 'stand',
    stride: f,
    legs: TROUSERS,
    shoes: PAPER,
    shirt: you.look.shirt,
    skin: you.look.skin,
    hair: you.look.hair,
    style: 1,
    arms: 'down',
    tap: walking ? f % 2 : -1,
    shut: !reduced && f % 29 === 0,
  });
}

// your name tag, over your head
export function moveYouTag(scene: Scene) {
  const { you } = scene;
  if (!you) return;
  const [sx, sy] = project(scene.view, you.at.x, you.at.y, LEGS + ADULT.tall + ADULT.face + 8);
  you.tag.style.left = `${(sx / SCENE_W) * 100}%`;
  you.tag.style.top = `${(sy / SCENE_H) * 100}%`;
}
