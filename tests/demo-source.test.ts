// The scripted day: what it holds second by second, and the timer around it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { demoSource, demoState, LOOP_S } from '../src/data/demo-source';
import { OfficeStateSchema, type OfficeState } from '../src/shared/state';

const START = 1_760_000_000_000;
const at = (seconds: number) => demoState(START + seconds * 1000, START);
const LOOPS = 3;
const seconds = Array.from({ length: LOOPS * LOOP_S + 1 }, (_, i) => i);
const days = seconds.map(at);
const sessionsOf = (id: string) => days.map((d) => d.sessions.find((s) => s.id === id));
const ids = [...new Set(days.flatMap((d) => d.sessions.map((s) => s.id)))];

describe('the demo day', () => {
  it('is a valid state every second, within the chairs, with unique ids', () => {
    for (const day of days) {
      expect(OfficeStateSchema.safeParse(day).success).toBe(true);
      expect(day.sessions.length).toBeLessThanOrEqual(10);
      expect(new Set(day.sessions.map((s) => s.id)).size).toBe(day.sessions.length);
      expect(new Set(day.sessions.map((s) => s.pid)).size).toBe(day.sessions.length);
      const internIds = day.sessions.flatMap((s) => s.agents.map((a) => a.id));
      expect(new Set(internIds).size).toBe(internIds.length);
    }
  });

  it('is made up: nothing outside the invented home', () => {
    for (const day of days) {
      expect(day.home).toBe('/home/demo');
      for (const s of day.sessions) expect(s.cwd.startsWith('/home/demo/')).toBe(true);
    }
  });

  it('has the fields that go with the status, as real data does', () => {
    for (const s of days.flatMap((d) => d.sessions)) {
      expect(s.activity !== null).toBe(s.status === 'busy');
      expect(s.waitingFor !== null).toBe(s.status === 'waiting');
      expect(s.agentsSpawned).toBeGreaterThanOrEqual(s.agents.length);
    }
  });

  it('keeps times honest: since moves only with the status, and start never moves', () => {
    for (const id of ids) {
      let before: ReturnType<typeof sessionsOf>[number];
      sessionsOf(id).forEach((s, i) => {
        if (!s) return (before = undefined);
        expect(s.statusSince).toBeLessThanOrEqual(START + i * 1000);
        expect(s.startedAt).toBeLessThanOrEqual(s.statusSince!);
        if (before && before.status === s.status) {
          expect(s.statusSince).toBe(before.statusSince);
          expect(s.startedAt).toBe(before.startedAt);
          expect(s.agentsSpawned).toBeGreaterThanOrEqual(before.agentsSpawned);
        }
        before = s;
      });
    }
  });

  it('never lets the intern tally go down', () => {
    for (const id of ids.filter((i) => !i.startsWith('demo-visitor'))) {
      const tally = sessionsOf(id).map((s) => s!.agentsSpawned);
      expect(tally).toEqual([...tally].sort((a, b) => a - b));
    }
  });

  it('shows every kind of event within a loop', () => {
    const loop = days.slice(LOOP_S, 2 * LOOP_S);
    const all = loop.flatMap((d) => d.sessions);
    const activities = new Set(all.map((s) => s.activity));
    expect(activities.has('writing') && activities.has('thinking')).toBe(true);
    expect([...activities].filter((a) => a && a !== 'writing' && a !== 'thinking').length).toBeGreaterThanOrEqual(2);
    expect(all.some((s) => s.status === 'waiting' && s.waitingFor)).toBe(true);
    const crowd = loop.map((d) => d.sessions.reduce((n, s) => n + s.agents.length, 0));
    expect(Math.max(...crowd)).toBeGreaterThan(0);
    expect(crowd.some((n, i) => i > 0 && n > crowd[i - 1])).toBe(true);
    expect(crowd.some((n, i) => i > 0 && n < crowd[i - 1])).toBe(true);
    const boss = new Set(all.map((s) => s.supervisor?.status));
    expect(boss.has('busy') && boss.has('idle')).toBe(true);
    expect(all.some((s) => s.background)).toBe(true);
    // idle for longer than the office waits before sending someone to play, then back at work
    const idle = sessionsOf('demo-quill-mobile').slice(LOOP_S, 2 * LOOP_S);
    const idleFor = idle.filter((s) => s!.status === 'idle').length;
    expect(idleFor).toBeGreaterThan(35);
    expect(idle.at(-1)!.status).toBe('busy');
    // one walks out and another walks in
    const visitors = (d: OfficeState) => d.sessions.filter((s) => s.id.startsWith('demo-visitor')).map((s) => s.id);
    expect(loop.some((d, i) => i > 0 && visitors(loop[i - 1]).some((v) => !visitors(d).includes(v)))).toBe(true);
    expect(loop.some((d, i) => i > 0 && visitors(d).some((v) => !visitors(loop[i - 1]).includes(v)))).toBe(true);
  });

  it('has something to see in the first few seconds', () => {
    const first = new Set(days.slice(0, 7).map((d) => JSON.stringify(d)));
    expect(first.size).toBeGreaterThan(2);
  });

  it('joins up: the end of a loop is the start of the next', () => {
    for (let k = 1; k <= LOOPS; k++) expect(days[k * LOOP_S]).toEqual(days[k * LOOP_S - 1]);
  });
});

describe('the demo source', () => {
  const states: OfficeState[] = [];
  const statuses: boolean[] = [];
  const subscribe = () =>
    demoSource.subscribe(
      (state) => states.push(state),
      (connected) => statuses.push(connected),
    );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    states.length = 0;
    statuses.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('hands over the first state at once and says it is connected', () => {
    subscribe();
    expect(states).toEqual([at(0)]);
    expect(statuses).toEqual([true]);
  });

  it('follows the day, and only says something when it has changed', () => {
    subscribe();
    vi.advanceTimersByTime(1000);
    expect(states).toHaveLength(1); // nothing happens in the first second
    vi.advanceTimersByTime(30_000);
    expect(states.length).toBeGreaterThan(1);
    expect(states.length).toBeLessThan(31);
    for (let i = 1; i < states.length; i++) expect(states[i]).not.toEqual(states[i - 1]);
    expect(states.at(-1)).toEqual(at(31));
  });

  it('says nothing more once unsubscribed', () => {
    const unsubscribe = subscribe();
    unsubscribe();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(states).toHaveLength(1);
  });
});
