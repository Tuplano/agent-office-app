import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { metaLine, staffLines, statusLine, summaryLine, windowTitle } from '../src/lib/describe';
import { chooseTheme } from '../src/lib/theme';
import type { OfficeState, Session } from '../src/shared/state';

const { sessions }: OfficeState = JSON.parse(readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'));
const [working, waiting] = sessions;
const NOW = 1_760_000_600_000; // ten minutes after the working session started
const session = (rest: Partial<Session>): Session => ({ ...working, agents: [], supervisor: null, ...rest });

describe('the line under the title', () => {
  it('counts sessions, the working, the waiting and the interns', () => {
    expect(summaryLine(sessions)).toBe('2 sessions · 1 working · 1 waiting on you · 1 intern active');
  });

  it('leaves the waiting out when nobody is', () => {
    expect(summaryLine([working])).toBe('1 session · 1 working · 1 intern active');
    expect(summaryLine([])).toBe('0 sessions · 0 working · 0 interns active');
  });
});

describe("the window's title", () => {
  it('puts the waiting first, then the working, then nothing', () => {
    expect(windowTitle(sessions)).toBe('(1 waiting) Agent Office');
    expect(windowTitle([working, session({ id: 'x' })])).toBe('(2 working) Agent Office');
    expect(windowTitle([session({ status: 'idle' })])).toBe('Agent Office');
    expect(windowTitle([])).toBe('Agent Office');
  });
});

describe("a card's lines", () => {
  it('say what a busy session is doing and how many interns it has', () => {
    expect(statusLine(working, NOW)).toBe('working · Edit · 1 intern');
    expect(statusLine(session({ activity: null }), NOW)).toBe('working');
  });

  it('say what a waiting session waits for', () => {
    expect(statusLine(waiting, NOW)).toBe('waiting on you · permission to run Bash');
    expect(statusLine(session({ status: 'waiting', waitingFor: null }), NOW)).toBe('waiting on you');
  });

  it('say how long an idle session has been idle', () => {
    expect(statusLine(session({ status: 'idle', statusSince: NOW - 240_000 }), NOW)).toBe('idle for 4m');
    expect(statusLine(session({ status: 'idle', statusSince: null }), NOW)).toBe('idle');
  });

  it('list the supervisor and each intern', () => {
    expect(staffLines(working)).toEqual(['supervisor · doing the rounds', 'intern · Explore: Find the session readers']);
    expect(staffLines(session({ supervisor: { status: 'busy' }, agents: [{ id: 'a', type: 'agent', desc: '', startedAt: 1 }] }))).toEqual([
      'supervisor · taking notes',
      'intern · agent',
    ]);
    expect(staffLines(waiting)).toEqual([]);
  });

  it('end with where it runs, how long it has been up, its memory and its interns so far', () => {
    expect(metaLine(working, NOW)).toBe('terminal · up 10m · 412 MB · 3 interns so far');
    expect(metaLine(waiting, NOW)).toBe('background');
  });
});

describe('the theme', () => {
  it('is the saved choice, or else the system one', () => {
    expect(chooseTheme('dark', false)).toBe('dark');
    expect(chooseTheme('light', true)).toBe('light');
    expect(chooseTheme(null, true)).toBe('dark');
    expect(chooseTheme(null, false)).toBe('light');
  });
});
