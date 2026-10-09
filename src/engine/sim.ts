import { project } from './camera';
import { BOSS_GRACE_MS, type Dir, FACING, MAX_HELPERS, PLAY_AFTER_MS, SCENE_H, SCENE_W } from './constants';
import { ADULT, bossBusy, poseOf } from './figures';
import { step, type Waypoint } from './floor';
import { DOOR, HANGOUTS, PLAY, SEATS } from './layout';
import { hash, pick, SHIRT } from './palette';
import type { Boss, Desk, Helper, Scene, SessionView } from './scene';

// Who is in the office and where they are heading: a worker per session, the
// supervisor claude-mem gives it, and an intern for each of its subagents.
export interface Sim {
  // takes the sessions as they are now: new ones arrive, ended ones are cleared away
  apply(sessions: readonly SessionView[]): void;
  // one frame of everybody's comings and goings
  tick(): void;
  // puts the name tags back over their people after the view has changed
  moveTags(): void;
}

const here = ({ x, y }: Waypoint): Waypoint => ({ x, y });
const atDoor = (at: Waypoint) => Math.abs(at.x - DOOR.x) + Math.abs(at.y - DOOR.y) < 14;
const wantsPlay = (desk: Desk) => desk.data.status === 'idle' && Date.now() - (desk.data.statusSince || 0) > PLAY_AFTER_MS;

export function makeSim(scene: Scene): Sim {
  const { desks, floor } = scene;
  let doorFreeAt = 0; // the frame the next arrival may come through, so they arrive in single file

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
    const tint = pick(SHIRT, seed, 8);
    const tag = document.createElement('a');
    tag.className = 'tag';
    tag.href = `#s-${session.id}`;
    tag.style.setProperty('--tint', tint);
    // keep the first free chair for as long as the session lives
    const used = new Set([...desks.values()].map((d) => d.seat));
    const desk: Desk = {
      data: session,
      tag,
      seed,
      tint,
      seat: SEATS.findIndex((_, i) => !used.has(i)),
      at: null, // where they are when away from the chair
      path: [], // waypoints still to walk
      play: -1,
      facing: 'S',
      outside: false,
      enterAt: 0,
      boss: null,
      bossSeen: 0,
      helpers: new Map(),
    };
    tag.hidden = desk.seat < 0; // every chair is taken, so there is nobody to name
    if (desk.seat >= 0 && !scene.reduced) {
      // queues for the door, ahead of the supervisor and interns that follow them in
      desk.outside = true;
      desk.enterAt = queue();
      tag.hidden = true;
    }
    return desk;
  }

  // A worker whose turn at the door has come steps in and heads for their chair.
  function enterWorker(desk: Desk) {
    const seat = SEATS[desk.seat];
    desk.outside = false;
    desk.path = floor.route(DOOR.x, DOOR.y, seat.x, seat.y);
    desk.at = desk.path.length ? here(DOOR) : null;
    desk.tag.hidden = false;
    moveTag(desk);
  }

  // Sends idle workers off to play and calls them back when there is work.
  function directWorker(desk: Desk) {
    const seat = SEATS[desk.seat];
    if (!seat || desk.outside) return;
    if (wantsPlay(desk) && desk.play < 0) {
      const held = new Set([...desks.values()].map((d) => d.play));
      const order = PLAY.map((_, i) => (i + desk.seed) % PLAY.length);
      const spot = order.find((i) => !held.has(i));
      if (spot === undefined) return; // every game is taken: nap at the desk
      desk.play = spot;
      const from = desk.at || seat;
      desk.path = scene.reduced ? [] : floor.route(from.x, from.y, PLAY[spot].x, PLAY[spot].y);
      desk.at = desk.path.length ? here(from) : here(PLAY[spot]);
    } else if (!wantsPlay(desk) && desk.play >= 0) {
      // mid-walk they turn around where they are; otherwise they leave from the game
      const from = (desk.path.length && desk.at) || PLAY[desk.play];
      desk.play = -1;
      desk.path = scene.reduced ? [] : floor.route(from.x, from.y, seat.x, seat.y);
      desk.at = desk.path.length ? here(from) : null;
    }
  }

  function walk(desk: Desk) {
    if (!desk.at || !desk.path.length) return;
    step(desk, desk.play < 0 ? 4 : 2); // hurrying back to work
    if (!desk.path.length && desk.play < 0) desk.at = null; // back in the chair
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
      boss.path = jump || scene.reduced ? [] : floor.route(from.x, from.y, to.x, to.y);
      if (!boss.path.length) {
        boss.at = here(to);
        boss.facing = dir;
      }
    };
    if (bossBusy(desk)) {
      if (boss.goal !== 'home' && boss.home) go(boss.home, 'home', SEATS[desk.seat].dir);
      boss.linger = 25; // stays a moment after the last note
      return;
    }
    if (boss.path.length || boss.linger-- > 0) return;
    const held = new Set<Boss['goal'] | undefined>([...desks.values()].map((d) => d.boss?.goal));
    for (let i = 0; i < HANGOUTS.length; i++) {
      const n = (boss.seed + boss.trips + i) % HANGOUTS.length;
      if (held.has(n)) continue;
      boss.trips += i + 1;
      boss.linger = 70 + ((boss.seed >>> boss.trips % 16) % 90);
      go(HANGOUTS[n], n, HANGOUTS[n].dir);
      return;
    }
  }

  // A supervisor whose turn at the door has come steps in and reports to the desk.
  function enterBoss(desk: Desk, boss: Boss, home: Waypoint) {
    boss.goal = 'home';
    boss.turnTo = SEATS[desk.seat].dir;
    boss.linger = 25;
    boss.path = floor.route(DOOR.x, DOOR.y, home.x, home.y);
    boss.at = boss.path.length ? here(DOOR) : here(home);
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
    h.path = floor.route(DOOR.x, DOOR.y, spot.x, spot.y);
    h.at = h.path.length ? here(DOOR) : here(spot);
  }

  // Brings the people standing around a desk in line with its session.
  function syncStanding(desk: Desk) {
    // The supervisor belongs to the session, not to one observer process: observers
    // get replaced, and the same person should still be there afterwards.
    if (desk.data.supervisor) desk.bossSeen = Date.now();
    if (desk.boss && !desk.boss.leaving && !desk.data.supervisor && Date.now() - desk.bossSeen > BOSS_GRACE_MS) {
      // gone for good: walks out by the door, keeping the spot until through it
      const boss = desk.boss;
      boss.leaving = true;
      boss.goal = 'door';
      boss.path = boss.at && !scene.reduced ? floor.route(boss.at.x, boss.at.y, DOOR.x, DOOR.y) : [];
      if (!boss.path.length) {
        floor.release(boss.home);
        desk.boss = null;
      }
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
      // done: gives up the spot and heads for the door
      floor.release(h.spot);
      h.spot = null;
      h.leaving = true;
      h.path = h.at && !scene.reduced ? floor.route(h.at.x, h.at.y, DOOR.x, DOOR.y) : [];
      if (!h.path.length) desk.helpers.delete(id);
    }
    const used = new Set([...desk.helpers.values()].filter((h) => !h.leaving).map((h) => h.slot));
    for (const agent of active) {
      const known = desk.helpers.get(agent.id);
      if (known && !known.leaving) continue;
      let slot = 0;
      while (used.has(slot)) slot++;
      used.add(slot);
      const seed = hash(agent.id);
      desk.helpers.set(agent.id, { slot, seed, color: pick(SHIRT, seed, 3), spot: null, at: null, path: [], facing: 'S', leaving: false, enterAt: 0 });
    }

    // the supervisor's place is beside the chair, the interns line up behind it
    const seat = SEATS[desk.seat];
    if (!seat) return;
    const [fx, fy] = FACING[seat.dir];
    if (desk.boss && !desk.boss.home) {
      const home = floor.findSpot(seat.x, seat.y, seat.x - fx - fy * 9, seat.y - fy + fx * 9);
      if (home && scene.reduced) {
        Object.assign(desk.boss, { home, at: here(home), facing: seat.dir });
        directBoss(desk, true);
      } else if (home) {
        // queues for the door like the interns; enterBoss() brings them in
        desk.boss.home = home;
        desk.boss.enterAt = queue();
      }
    }
    for (const h of desk.helpers.values()) {
      if (h.spot || h.leaving) continue;
      const along = (h.slot - 2) * 6;
      h.spot = floor.findSpot(seat.x, seat.y, seat.x - fx * 12 - fy * along, seat.y - fy * 12 + fx * along);
      if (!h.spot) continue;
      if (scene.reduced) {
        h.at = here(h.spot);
        continue;
      }
      // queues for the door; enter() brings them in when it is their turn
      h.enterAt = queue();
    }
  }

  function removeDesk(desk: Desk) {
    floor.release(desk.boss && desk.boss.home);
    for (const h of desk.helpers.values()) floor.release(h.spot);
    desk.tag.remove();
  }

  // ---------- state ----------

  function apply(sessions: readonly SessionView[]) {
    const seen = new Set<string>();
    for (const session of sessions) {
      let desk = desks.get(session.id);
      if (!desk) {
        desk = makeDesk(session);
        desks.set(session.id, desk);
        scene.tags.append(desk.tag);
      }
      desk.data = session;
      syncStanding(desk);
      directWorker(desk);
      if (desk.seat >= 0) moveTag(desk);
      desk.tag.textContent = session.name;
      desk.tag.dataset.status = session.status;
      seen.add(session.id);
    }
    for (const [id, desk] of desks) {
      if (seen.has(id)) continue;
      removeDesk(desk);
      desks.delete(id);
    }
  }

  function tick() {
    const { frame } = scene;
    let passing = false; // someone is at the door
    for (const desk of desks.values()) {
      for (const [id, h] of desk.helpers) {
        if (!h.at && h.spot && frame >= h.enterAt) enter(h, h.spot);
        if (!h.at || !h.path.length) continue;
        step(h, 4);
        if (atDoor(h.at)) passing = true;
        if (h.leaving && !h.path.length) desk.helpers.delete(id);
      }
      if (desk.seat < 0) continue;
      if (desk.outside && frame >= desk.enterAt) enterWorker(desk);
      directWorker(desk);
      if (desk.at) {
        if (desk.path.length && atDoor(desk.at)) passing = true;
        walk(desk);
        moveTag(desk);
      }
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
    }
    scene.doorOpen = passing ? 3 : Math.max(0, scene.doorOpen - 1);
  }

  return {
    apply,
    tick,
    moveTags() {
      for (const desk of desks.values()) if (desk.seat >= 0) moveTag(desk);
    },
  };
}
