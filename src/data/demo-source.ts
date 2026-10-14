import type { Agent, OfficeState, Session } from '../shared/state';
import type { StateSource } from './source';

// A made-up day in the office, for the hosted page and for anywhere the app cannot
// read a real machine. Every name, path and pid is invented. The day is a loop of
// LOOP_S seconds; it is a pure function of the time, so the source below is only a
// timer around `demoState`.

export const LOOP_S = 96;
const LOOP_MS = LOOP_S * 1000;
const HOME = '/home/demo';
const MINUTE = 60 * 1000;

type Status = Session['status'];
interface Step<T> {
  at: number; // second of the loop this takes over
  value: T;
}

// The step in force at `p` seconds into the loop, and when it began, which is in the
// loop before when it began before the wrap. Steps must be in order and none at 0.
function stepAt<T>(steps: readonly Step<T>[], p: number): { value: T; since: number } {
  let step = steps[steps.length - 1];
  let since = step.at - LOOP_S;
  for (const s of steps) {
    if (s.at > p) break;
    step = s;
    since = s.at;
  }
  return { value: step.value, since };
}

const steps = <T>(...pairs: [number, T][]): Step<T>[] => pairs.map(([at, value]) => ({ at, value }));

interface Resident {
  id: string;
  pid: number;
  name: string;
  memMb: number;
  background: boolean;
  age: number; // minutes it was already up when the visit began
  // omitted when the status never changes
  status?: Step<{ status: Status; waitingFor?: string }>[];
  activity: Step<string>[];
  supervisor?: Step<'busy' | 'idle'>[];
}

const RESIDENTS: Resident[] = [
  {
    id: 'demo-harbor-api',
    pid: 31021,
    name: 'harbor-api',
    memMb: 486,
    background: false,
    age: 42,
    activity: steps([3, 'Edit'], [11, 'thinking'], [17, 'Bash'], [25, 'writing'], [32, 'Edit'], [40, 'Grep'], [47, 'thinking'], [54, 'Edit'], [62, 'Bash'], [71, 'writing'], [79, 'Read'], [87, 'Edit']),
    supervisor: steps([9, 'busy'], [21, 'idle'], [44, 'busy'], [58, 'idle'], [70, 'busy'], [86, 'idle']),
  },
  {
    id: 'demo-tide-docs',
    pid: 31178,
    name: 'tide-docs',
    memMb: 351,
    background: false,
    age: 18,
    status: steps(
      [28, { status: 'waiting', waitingFor: 'permission to run Bash' }],
      [44, { status: 'busy' }],
      [78, { status: 'waiting', waitingFor: 'a reply' }],
      [90, { status: 'busy' }],
    ),
    activity: steps([6, 'thinking'], [10, 'Read'], [16, 'Edit'], [22, 'writing'], [44, 'Bash'], [52, 'Edit'], [60, 'thinking'], [68, 'Grep'], [90, 'Read']),
  },
  {
    id: 'demo-quill-mobile',
    pid: 31344,
    name: 'quill-mobile',
    memMb: 298,
    background: false,
    age: 65,
    // idle for 44 s: long enough to wander off and play, then called back
    status: steps([8, { status: 'idle' }], [52, { status: 'busy' }]),
    activity: steps([5, 'Read'], [52, 'thinking'], [56, 'Edit'], [66, 'Bash'], [74, 'writing'], [84, 'Edit']),
  },
  {
    id: 'demo-ledger-cli',
    pid: 31502,
    name: 'ledger-cli',
    memMb: 207,
    background: true,
    age: 9,
    activity: steps([4, 'Bash'], [14, 'writing'], [23, 'Bash'], [36, 'thinking'], [45, 'Read'], [57, 'Bash'], [68, 'writing'], [81, 'Bash']),
  },
];

// An interns' stint: when it starts and ends within a loop, on which resident.
const INTERNS = [
  { resident: 'demo-harbor-api', type: 'Explore', desc: 'Find where invoices are totalled', from: 4, to: 24 },
  { resident: 'demo-harbor-api', type: 'general-purpose', desc: 'Write tests for the retry helper', from: 14, to: 40 },
  { resident: 'demo-harbor-api', type: 'Explore', desc: 'Map the queue consumers', from: 60, to: 82 },
  { resident: 'demo-tide-docs', type: 'Plan', desc: 'Outline the migration guide', from: 48, to: 70 },
];

// Callers come and go: one walks in at ARRIVE_S and walks out at LEAVE_S of the
// loop after, so there is always at most one, and it is the same one across the wrap.
const ARRIVE_S = 58;
const LEAVE_S = 30;
const IDLE_S = 8; // it sits idle for a moment on the way out
const VISITORS = ['pixel-forge', 'mailroom', 'orbit-site', 'canary-web', 'atlas-sync', 'loom-ui'];

const abs = (loopStart: number, seconds: number) => loopStart + seconds * 1000;

export function demoState(now: number, startedAt: number): OfficeState {
  const elapsed = Math.max(0, now - startedAt);
  const loop = Math.floor(elapsed / LOOP_MS);
  const loopStart = startedAt + loop * LOOP_MS;
  const p = (elapsed % LOOP_MS) / 1000;
  const sessions: Session[] = [];

  // the visitor that arrived in the loop before is still here until LEAVE_S
  const visitor = (n: number): Session => {
    const arrived = abs(startedAt, (n - 1) * LOOP_S + ARRIVE_S);
    const idleAt = abs(startedAt, n * LOOP_S + IDLE_S);
    const idle = now >= idleAt;
    return {
      id: `demo-visitor-${n}`,
      pid: 40100 + n,
      name: VISITORS[n % VISITORS.length],
      cwd: `${HOME}/code/${VISITORS[n % VISITORS.length]}`,
      background: false,
      status: idle ? 'idle' : 'busy',
      waitingFor: null,
      activity: idle ? null : ['Read', 'thinking', 'Edit', 'writing', 'Bash'][Math.floor((now - arrived) / 9000) % 5],
      startedAt: arrived,
      statusSince: idle ? idleAt : arrived,
      memMb: 180 + (n % 4) * 23,
      agents: [],
      agentsSpawned: 0,
      supervisor: null,
      tool: 'claude',
      terminal: null,
    };
  };
  // visitor n arrives in loop n - 1 at ARRIVE_S; the first loop opens with number 0 already in
  for (const r of RESIDENTS) sessions.push(resident(r, p, loop, loopStart, startedAt));
  // last in the list either side of the wrap, so nobody changes seats
  if (p < LEAVE_S) sessions.push(visitor(loop));
  if (p >= ARRIVE_S) sessions.push(visitor(loop + 1));
  return { home: HOME, sessions };
}

function resident(r: Resident, p: number, loop: number, loopStart: number, startedAt: number): Session {
  const born = startedAt - r.age * MINUTE;
  const current = r.status ? stepAt(r.status, p) : null;
  const status: Status = current?.value.status ?? 'busy';
  const agents: Agent[] = INTERNS.flatMap((intern, i) =>
    intern.resident === r.id && p >= intern.from && p < intern.to
      ? [{ id: `demo-intern-${loop}-${i}`, type: intern.type, desc: intern.desc, startedAt: abs(loopStart, intern.from) }]
      : [],
  );
  const stints = INTERNS.filter((intern) => intern.resident === r.id);
  const spawned = stints.length * loop + stints.filter((intern) => p >= intern.from).length;
  return {
    id: r.id,
    pid: r.pid,
    name: r.name,
    cwd: `${HOME}/code/${r.name}`,
    background: r.background,
    status,
    waitingFor: status === 'waiting' ? (current?.value.waitingFor ?? null) : null,
    activity: status === 'busy' ? stepAt(r.activity, p).value : null,
    startedAt: born,
    statusSince: current ? abs(loopStart, current.since) : born,
    memMb: r.memMb,
    agents,
    agentsSpawned: spawned,
    supervisor: r.supervisor ? { status: stepAt(r.supervisor, p).value } : null,
    tool: 'claude',
    terminal: null,
  };
}

// Plays the day from the moment of subscribing, once a second, and only says
// something when the picture has changed, as the Rust side does.
export const demoSource: StateSource = {
  subscribe(onState, onStatus) {
    const startedAt = Date.now();
    let last = '';
    const tick = () => {
      const state = demoState(Date.now(), startedAt);
      const text = JSON.stringify(state);
      if (text === last) return;
      last = text;
      onState(state);
    };
    tick();
    onStatus(true);
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  },
};
