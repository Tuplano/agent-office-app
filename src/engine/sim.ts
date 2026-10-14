import { project } from './camera';
import { BOSS_GRACE_MS, CELL, type Dir, FACING, MAX_HELPERS, PLAY_AFTER_MS, SCENE_H, SCENE_W } from './constants';
import { ADULT, bossBusy, placeOf, poseOf } from './figures';
import { step, type Waypoint } from './floor';
import { hash, pick, sessionTint, SHIRT } from './palette';
import type { Room } from './room';
import { type Boss, type Desk, furnish, type Helper, type Scene, type SessionView, type Spare } from './scene';

// Who is in the office and where they are heading: a worker per session, the
// supervisor claude-mem gives it, and an intern for each of its subagents.
export interface Sim {
  // takes the sessions as they are now: new ones arrive, ended ones walk out. The
  // first call is the first load: everyone in it is already in place.
  apply(sessions: readonly SessionView[]): void;
  // one frame of everybody's comings and goings
  tick(): void;
  // puts the name tags back over their people after the view has changed
  moveTags(): void;
  // marks one session's name tag as pointed at, or none
  point(id: string | null): void;
  // marks one session's name tag as the one picked out, or none
  pickOut(id: string | null): void;
  // Swaps the room for another, and puts everyone straight where they now belong,
  // as on a first load. The room has to be a sound one (valid.ts).
  setRoom(room: Room): void;
}

const here = ({ x, y }: Waypoint): Waypoint => ({ x, y });
// How far from each other people sit down on the open floor: well apart while
// there is room for it, with space for whoever stands or sits by them; and once
// that is used up, wherever there is a gap, but never nearer than this.
const APART = CELL * 7;
const NEAR = CELL * 4;
const wantsPlay = (desk: Desk) => desk.data.status === 'idle' && Date.now() - (desk.data.statusSince || 0) > PLAY_AFTER_MS;

export function makeSim(scene: Scene): Sim {
  const { desks } = scene;
  let { floor } = scene;
  // the room's chairs, games and door; looked up each time, since the room can change
  const seats = () => scene.layout.seats;
  const games = () => scene.layout.play;
  const door = () => scene.layout.door;
  const atDoor = (at: Waypoint) => Math.abs(at.x - door().x) + Math.abs(at.y - door().y) < 14;
  let doorFreeAt = 0; // the frame the next arrival may come through, so they arrive in single file
  let loaded = false; // the first sessions have been given
  let settling = false; // those first sessions are being put in place
  const frozen = () => scene.reduced || scene.editing; // nobody walks at all: less motion was asked for, or the room is being rearranged
  const still = () => frozen() || settling; // nobody walks: they are put straight where they belong

  // a turn at the door
  function queue(): number {
    const turn = Math.max(scene.frame + 1, doorFreeAt);
    doorFreeAt = turn + 3;
    return turn;
  }

  // ---------- desks ----------

  function moveTag(desk: Desk) {
    const pose = poseOf(desk);
    const [sx, sy] = project(scene.view, pose.x, pose.y, pose.base + ADULT.tall + ADULT.face + 8);
    desk.tag.style.left = `${(sx / SCENE_W) * 100}%`;
    desk.tag.style.top = `${(sy / SCENE_H) * 100}%`;
  }

  function makeDesk(session: SessionView): Desk {
    const seed = hash(session.id);
    const tint = sessionTint(session.id);
    const tag = document.createElement('a');
    tag.className = 'tag';
    tag.dataset.session = session.id;
    tag.href = `#s-${session.id}`;
    tag.style.setProperty('--tint', tint);
    // keep the first free chair for as long as the session lives
    const used = new Set([...desks.values()].map((d) => d.seat));
    const desk: Desk = {
      data: session,
      layout: scene.layout,
      tag,
      seed,
      tint,
      seat: seats().findIndex((_, i) => !used.has(i)),
      spare: null,
      gone: false,
      at: null, // where they are when away from the chair
      path: [], // waypoints still to walk
      play: -1,
      facing: 'S',
      outside: false,
      unpacked: still(), // already in place, and so is their laptop; anyone else brings theirs in
      enterAt: 0,
      boss: null,
      bossSeen: 0,
      helpers: new Map(),
    };
    if (desk.seat < 0) desk.spare = findSpare(desk.seed); // every chair is taken
    tag.hidden = !placeOf(desk); // nowhere at all to sit, so there is nobody to name
    if (placeOf(desk) && !still()) {
      // queues for the door, ahead of the supervisor and interns that follow them in
      desk.outside = true;
      desk.enterAt = queue();
      tag.hidden = true;
    }
    return desk;
  }

  // The play spots someone holds, for a game or for a seat in place of a chair.
  const heldPlay = () => new Set([...desks.values()].flatMap((d) => [d.play, d.spare ? d.spare.lounge : -1]));

  // Somewhere to sit and work without a chair: a free lounge seat first, then a
  // cushion beside the rug, and with neither a cushion anywhere on the open floor.
  // Null only when there is no floor left to sit on.
  function findSpare(seed: number): Spare | null {
    const held = heldPlay();
    const play = games();
    const order = play.map((_, i) => (i + seed) % play.length);
    const lounge = order.find((i) => play[i].z && !held.has(i));
    if (lounge !== undefined) return { x: play[lounge].x, y: play[lounge].y, dir: play[lounge].dir, z: play[lounge].z!, lounge, spot: null };
    const { spare } = scene.layout;
    const spot = spare && floor.findSpot(spare.x, spare.y, spare.x, spare.y);
    return spot ? { x: spot.x, y: spot.y, dir: spare.dir, z: 3, lounge: -1, spot } : openFloor();
  }

  // A cushion on the open floor, for a room with nowhere else: the clear place
  // nearest the middle of the room that is apart from everyone else's, and out
  // of the doorway. They sit looking the way the room is first seen from.
  function openFloor(): Spare | null {
    const { w, d } = scene.room.size;
    const others = [...desks.values()].flatMap((desk) => (desk.spare && desk.spare.lounge < 0 ? [desk.spare] : []));
    const clearOf = (x: number, y: number, from: { x: number; y: number }) => Math.hypot(x - from.x, y - from.y) >= NEAR;
    // the middle of the cell in the middle of the room, and so many steps of the gap either way from it
    const along = (side: number, gap: number) => {
      const mid = Math.floor(side / 2 / CELL) * CELL + CELL / 2;
      const out: number[] = [];
      for (let at = mid - Math.floor((mid - CELL * 2) / gap) * gap; at < side - CELL * 2; at += gap) out.push(at);
      return out;
    };
    for (const gap of [APART, CELL]) {
      const places = along(d, gap).flatMap((y) => along(w, gap).map((x) => ({ x, y, off: (x - w / 2) ** 2 + (y - d / 2) ** 2 })));
      for (const { x, y } of places.sort((a, b) => a.off - b.off)) {
        const cell = Math.floor(y / CELL) * floor.cols + Math.floor(x / CELL);
        if (!floor.free(Math.floor(x / CELL), Math.floor(y / CELL)) || floor.taken.has(cell)) continue;
        if (!clearOf(x, y, door()) || !others.every((other) => clearOf(x, y, other))) continue;
        const spot = floor.findSpot(x, y, x, y);
        if (spot?.cell === cell) return { x, y, dir: 'S', z: 3, lounge: -1, spot };
        floor.release(spot);
      }
    }
    return null;
  }

  // A worker whose turn at the door has come steps in and heads for their chair.
  function enterWorker(desk: Desk) {
    const seat = placeOf(desk)!;
    desk.outside = false;
    desk.path = floor.route(door().x, door().y, seat.x, seat.y);
    desk.at = desk.path.length ? here(door()) : null;
    desk.tag.hidden = false;
    moveTag(desk);
  }

  // Sends idle workers off to play and calls them back when there is work.
  function directWorker(desk: Desk) {
    const seat = seats()[desk.seat];
    if (!seat || desk.outside || desk.gone) return;
    const play = games();
    if (wantsPlay(desk) && desk.play < 0) {
      const held = heldPlay();
      const order = play.map((_, i) => (i + desk.seed) % play.length);
      const spot = order.find((i) => !held.has(i));
      if (spot === undefined) return; // every game is taken: nap at the desk
      desk.play = spot;
      const from = desk.at || seat;
      desk.path = still() ? [] : floor.route(from.x, from.y, play[spot].x, play[spot].y);
      desk.at = desk.path.length ? here(from) : here(play[spot]);
    } else if (!wantsPlay(desk) && desk.play >= 0) {
      // mid-walk they turn around where they are; otherwise they leave from the game
      const from = (desk.path.length && desk.at) || play[desk.play];
      desk.play = -1;
      desk.path = still() ? [] : floor.route(from.x, from.y, seat.x, seat.y);
      desk.at = desk.path.length ? here(from) : null;
    }
  }

  function walk(desk: Desk) {
    if (!desk.at || !desk.path.length) return;
    step(desk, desk.play < 0 ? 4 : 2); // hurrying back to work
    if (desk.path.length) return;
    if (desk.gone) {
      // through the door
      desk.outside = true;
      desk.at = null;
      desk.tag.hidden = true;
    } else if (desk.play < 0) desk.at = null; // back in the chair
  }

  // ---------- supervisors ----------

  // Decides where a supervisor should be heading. `jump` skips the walk.
  function directBoss(desk: Desk, jump: boolean) {
    const boss = desk.boss;
    if (!boss || !boss.at || boss.leaving) return;
    const from = boss.at;
    const go = (to: Waypoint, goal: Boss['goal'], dir: Dir) => {
      boss.goal = goal;
      boss.turnTo = dir;
      boss.path = jump || still() ? [] : floor.route(from.x, from.y, to.x, to.y);
      if (!boss.path.length) {
        boss.at = here(to);
        boss.facing = dir;
      }
    };
    if (bossBusy(desk)) {
      if (boss.goal !== 'home' && boss.home) go(boss.home, 'home', placeOf(desk)!.dir);
      boss.linger = 25; // stays a moment after the last note
      return;
    }
    if (boss.path.length || boss.linger-- > 0) return;
    const held = new Set<Boss['goal'] | undefined>([...desks.values()].map((d) => d.boss?.goal));
    const { hangouts } = scene.layout;
    for (let i = 0; i < hangouts.length; i++) {
      const n = (boss.seed + boss.trips + i) % hangouts.length;
      if (held.has(n)) continue;
      boss.trips += i + 1;
      boss.linger = 70 + ((boss.seed >>> boss.trips % 16) % 90);
      go(hangouts[n], n, hangouts[n].dir);
      return;
    }
  }

  // A supervisor whose turn at the door has come steps in and reports to the desk.
  function enterBoss(desk: Desk, boss: Boss, home: Waypoint) {
    boss.goal = 'home';
    boss.turnTo = placeOf(desk)!.dir;
    boss.linger = 25;
    boss.path = floor.route(door().x, door().y, home.x, home.y);
    boss.at = boss.path.length ? here(door()) : here(home);
    if (!boss.path.length) boss.facing = boss.turnTo;
  }

  function walkBoss(boss: Boss) {
    if (!boss.path.length) return;
    step(boss, typeof boss.goal === 'number' ? 2 : 4); // strolls between hangouts, brisk otherwise
    if (!boss.path.length) boss.facing = boss.turnTo;
  }

  // ---------- interns ----------

  // An intern whose turn at the door has come steps in and heads for the desk.
  function enter(h: Helper, spot: Waypoint) {
    h.path = floor.route(door().x, door().y, spot.x, spot.y);
    h.at = h.path.length ? here(door()) : here(spot);
  }

  // Sends a supervisor off by the door, keeping their spot until they are through it.
  function sendOut(desk: Desk, boss: Boss) {
    boss.leaving = true;
    boss.goal = 'door';
    boss.path = boss.at && !frozen() ? floor.route(boss.at.x, boss.at.y, door().x, door().y) : [];
    if (!boss.path.length) {
      floor.release(boss.home);
      desk.boss = null;
    }
  }

  // Gives up an intern's spot and sends them to the door.
  function sendOutHelper(desk: Desk, id: string, h: Helper) {
    floor.release(h.spot);
    h.spot = null;
    h.leaving = true;
    h.path = h.at && !frozen() ? floor.route(h.at.x, h.at.y, door().x, door().y) : [];
    if (!h.path.length) desk.helpers.delete(id);
  }

  // The supervisor's place is beside the chair, the interns line up behind it. Those
  // already in the room walk there; the rest wait for their turn at the door.
  function placeStanding(desk: Desk) {
    const seat = placeOf(desk);
    if (!seat) return;
    const [fx, fy] = FACING[seat.dir];
    const boss = desk.boss;
    if (boss && !boss.leaving && !boss.home) {
      const home = floor.findSpot(seat.x, seat.y, seat.x - fx - fy * 9, seat.y - fy + fx * 9);
      if (home && still()) {
        Object.assign(boss, { home, at: here(home), facing: seat.dir });
        directBoss(desk, true);
      } else if (home && boss.at) {
        boss.home = home;
        boss.goal = 'home';
        boss.turnTo = seat.dir;
        boss.linger = 25;
        boss.path = floor.route(boss.at.x, boss.at.y, home.x, home.y);
        if (!boss.path.length) boss.at = here(home);
      } else if (home) {
        // queues for the door like the interns; enterBoss() brings them in
        boss.home = home;
        boss.enterAt = queue();
      }
    }
    for (const h of desk.helpers.values()) {
      if (h.spot || h.leaving) continue;
      const along = (h.slot - 2) * 6;
      h.spot = floor.findSpot(seat.x, seat.y, seat.x - fx * 12 - fy * along, seat.y - fy * 12 + fx * along);
      if (!h.spot) continue;
      if (still()) {
        h.at = here(h.spot);
        continue;
      }
      if (h.at) {
        h.path = floor.route(h.at.x, h.at.y, h.spot.x, h.spot.y);
        if (!h.path.length) h.at = here(h.spot);
        continue;
      }
      // queues for the door; enter() brings them in when it is their turn
      h.enterAt = queue();
    }
  }

  // Brings the people standing around a desk in line with its session.
  function syncStanding(desk: Desk) {
    // The supervisor belongs to the session, not to one observer process: observers
    // get replaced, and the same person should still be there afterwards.
    if (desk.data.supervisor) desk.bossSeen = Date.now();
    if (desk.boss && !desk.boss.leaving && !desk.data.supervisor && Date.now() - desk.bossSeen > BOSS_GRACE_MS) {
      // gone for good: walks out by the door, keeping the spot until through it
      sendOut(desk, desk.boss);
    }
    if (desk.data.supervisor && desk.boss && desk.boss.leaving) {
      // back before reaching the door: turns around where they are
      Object.assign(desk.boss, { leaving: false, path: [], linger: 0 });
    }
    if (desk.data.supervisor && !desk.boss) {
      desk.boss = { seed: hash(`${desk.data.id} supervisor`), home: null, at: null, path: [], facing: 'S', goal: 'home', turnTo: 'S', linger: 0, trips: 0, leaving: false, enterAt: 0 };
    }

    const active = desk.data.agents.slice(0, MAX_HELPERS);
    const ids = new Set(active.map((a) => a.id));
    for (const [id, h] of desk.helpers) {
      if (ids.has(id) || h.leaving) continue;
      sendOutHelper(desk, id, h); // done: gives up the spot and heads for the door
    }
    const used = new Set([...desk.helpers.values()].filter((h) => !h.leaving).map((h) => h.slot));
    for (const agent of active) {
      const known = desk.helpers.get(agent.id);
      if (known && !known.leaving) continue;
      if (known) {
        // back before reaching the door: turns around where they are
        known.leaving = false;
        known.path = [];
        used.add(known.slot);
        continue;
      }
      let slot = 0;
      while (used.has(slot)) slot++;
      used.add(slot);
      const seed = hash(agent.id);
      desk.helpers.set(agent.id, { slot, seed, color: pick(SHIRT, seed, 3), spot: null, at: null, path: [], facing: 'S', leaving: false, enterAt: 0 });
    }
    placeStanding(desk);
  }

  function removeDesk(desk: Desk) {
    floor.release(desk.boss && desk.boss.home);
    for (const h of desk.helpers.values()) floor.release(h.spot);
    floor.release(desk.spare && desk.spare.spot);
    desk.tag.remove();
  }

  // Clears a desk away, and its chair goes to whoever has waited longest without one.
  function drop(desk: Desk) {
    removeDesk(desk);
    desks.delete(desk.data.id);
    const used = new Set([...desks.values()].map((d) => d.seat));
    const seat = seats().findIndex((_, i) => !used.has(i));
    const waiting = [...desks.values()].find((d) => d.seat < 0 && !d.gone);
    if (seat >= 0 && waiting) claim(waiting, seat);
  }

  // A worker with no chair takes this one, and their supervisor and interns go with them.
  function claim(desk: Desk, seat: number) {
    const from = desk.at || placeOf(desk);
    floor.release(desk.spare && desk.spare.spot);
    desk.spare = null;
    desk.seat = seat;
    desk.unpacked = false; // they bring a laptop to the desk with them
    if (!desk.outside) {
      desk.path = frozen() || !from ? [] : floor.route(from.x, from.y, seats()[seat].x, seats()[seat].y);
      desk.at = desk.path.length && from ? here(from) : null;
      desk.tag.hidden = false;
      moveTag(desk);
    }
    if (desk.boss && !desk.boss.leaving) {
      floor.release(desk.boss.home);
      desk.boss.home = null;
    }
    for (const h of desk.helpers.values()) {
      if (h.leaving) continue;
      floor.release(h.spot);
      h.spot = null;
    }
    placeStanding(desk);
  }

  // The session is gone: everyone walks out by the door, and the desk goes once they are through it.
  function leave(desk: Desk) {
    if (frozen()) return drop(desk);
    desk.gone = true;
    desk.tag.classList.add('gone');
    desk.tag.removeAttribute('href');
    desk.play = -1; // gives up the game at once
    desk.unpacked = false; // and takes the laptop along
    const place = placeOf(desk);
    if (place && !desk.outside) {
      const from = desk.at || place;
      desk.path = floor.route(from.x, from.y, door().x, door().y);
      desk.at = desk.path.length ? here(from) : null;
      if (!desk.path.length) {
        desk.outside = true; // no way to the door: gone at once
        desk.tag.hidden = true;
      }
    }
    if (desk.boss && !desk.boss.leaving) sendOut(desk, desk.boss);
    for (const [id, h] of desk.helpers) if (!h.leaving) sendOutHelper(desk, id, h);
    finish(desk);
  }

  // The session is back before its people were all out: the worker turns round too.
  function revive(desk: Desk) {
    desk.gone = false;
    desk.tag.classList.remove('gone');
    desk.tag.href = `#s-${desk.data.id}`;
    if (desk.outside) {
      desk.enterAt = queue(); // already out: comes in again by the door
      return;
    }
    const place = placeOf(desk);
    if (!place || !desk.at) return;
    desk.path = floor.route(desk.at.x, desk.at.y, place.x, place.y);
    if (!desk.path.length) desk.at = null;
  }

  // A desk whose session has ended goes once nobody of it is left in the room.
  function finish(desk: Desk) {
    if (desk.gone && (desk.outside || !placeOf(desk)) && !desk.boss && !desk.helpers.size) drop(desk);
  }

  // ---------- a new room ----------

  // Every chair, lounge seat, game and standing spot is given up and handed out
  // again, in the order the sessions arrived. Nobody walks: they are simply there.
  // Whoever was on the way out is gone.
  function resettle() {
    doorFreeAt = 0;
    for (const desk of [...desks.values()]) {
      if (!desk.gone) continue;
      desk.tag.remove();
      desks.delete(desk.data.id);
    }
    for (const desk of desks.values()) {
      Object.assign(desk, { layout: scene.layout, seat: -1, spare: null, play: -1, at: null, path: [], outside: false, unpacked: true, enterAt: 0 });
      if (desk.boss?.leaving) desk.boss = null;
      if (desk.boss) Object.assign(desk.boss, { home: null, at: null, path: [], goal: 'home', linger: 0, enterAt: 0 });
      for (const [id, h] of desk.helpers) {
        if (h.leaving) desk.helpers.delete(id);
        else Object.assign(h, { spot: null, at: null, path: [], enterAt: 0 });
      }
    }
    settling = true;
    for (const desk of desks.values()) {
      const used = new Set([...desks.values()].map((d) => d.seat));
      desk.seat = seats().findIndex((_, i) => !used.has(i));
      if (desk.seat < 0) desk.spare = findSpare(desk.seed);
      desk.tag.hidden = !placeOf(desk);
      placeStanding(desk);
      directWorker(desk);
      if (placeOf(desk)) moveTag(desk);
    }
    settling = false;
  }

  // ---------- state ----------

  function apply(sessions: readonly SessionView[]) {
    settling = !loaded;
    loaded = true;
    const seen = new Set<string>();
    for (const session of sessions) {
      let desk = desks.get(session.id);
      if (!desk) {
        desk = makeDesk(session);
        desks.set(session.id, desk);
        scene.tags.append(desk.tag);
      } else if (desk.gone) {
        revive(desk);
      }
      desk.data = session;
      syncStanding(desk);
      directWorker(desk);
      if (placeOf(desk)) moveTag(desk);
      desk.tag.textContent = session.name;
      desk.tag.dataset.status = session.status;
      seen.add(session.id);
    }
    settling = false;
    for (const desk of [...desks.values()]) {
      if (!seen.has(desk.data.id) && !desk.gone) leave(desk);
    }
  }

  function tick() {
    const { frame } = scene;
    let passing = false; // someone is at the door
    for (const desk of [...desks.values()]) {
      for (const [id, h] of desk.helpers) {
        if (!h.at && h.spot && frame >= h.enterAt) enter(h, h.spot);
        if (!h.at || !h.path.length) continue;
        step(h, 4);
        if (atDoor(h.at)) passing = true;
        if (h.leaving && !h.path.length) desk.helpers.delete(id);
      }
      if (!placeOf(desk)) continue;
      if (desk.outside && !desk.gone && frame >= desk.enterAt) enterWorker(desk);
      directWorker(desk);
      if (desk.at) {
        if (desk.path.length && atDoor(desk.at)) passing = true;
        walk(desk);
        moveTag(desk);
      }
      if (!desk.at && !desk.outside) desk.unpacked = true; // sat down, so the laptop comes out
      const boss = desk.boss;
      if (boss && boss.home) {
        if (!boss.at && frame >= boss.enterAt) enterBoss(desk, boss, boss.home);
        directBoss(desk, false);
        walkBoss(boss);
        if (boss.at && boss.path.length && atDoor(boss.at)) passing = true;
        if (boss.leaving && !boss.path.length) {
          floor.release(boss.home);
          desk.boss = null;
        }
      }
      finish(desk);
    }
    scene.doorOpen = passing ? 3 : Math.max(0, scene.doorOpen - 1);
  }

  return {
    apply,
    tick,
    moveTags() {
      for (const desk of desks.values()) if (placeOf(desk)) moveTag(desk);
    },
    point(id) {
      for (const desk of desks.values()) desk.tag.classList.toggle('hot', !desk.gone && desk.data.id === id);
    },
    pickOut(id) {
      for (const desk of desks.values()) desk.tag.classList.toggle('picked', !desk.gone && desk.data.id === id);
    },
    setRoom(room) {
      furnish(scene, room);
      floor = scene.floor;
      resettle();
    },
  };
}
