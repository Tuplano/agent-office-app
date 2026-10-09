// Drives the Tauri source with a stand-in for the Rust side.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OfficeState } from '../src/shared/state';

const rust = vi.hoisted(() => ({
  send: (_payload: unknown) => {},
  answer: (_state: unknown) => {},
  stopped: 0,
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_event: string, handler: (event: { payload: unknown }) => void) => {
    rust.send = (payload) => handler({ payload });
    return () => {
      rust.stopped++;
    };
  },
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: () => new Promise((resolve) => (rust.answer = resolve)),
}));

import { tauriSource } from '../src/data/tauri-source';

const full: OfficeState = JSON.parse(
  readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'),
);
const empty: OfficeState = { home: full.home, sessions: [] };
// lets the source's promise chain run up to its next wait
const settle = () => new Promise((resolve) => setTimeout(resolve));

describe('the Tauri source', () => {
  const states: OfficeState[] = [];
  const statuses: boolean[] = [];
  const subscribe = () =>
    tauriSource.subscribe(
      (state) => states.push(state),
      (connected) => statuses.push(connected),
    );

  beforeEach(() => {
    states.length = 0;
    statuses.length = 0;
    rust.stopped = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('starts with the state it asks for, then follows the ones sent', async () => {
    subscribe();
    await settle();
    rust.answer(empty);
    await settle();
    rust.send(full);
    expect(states).toEqual([empty, full]);
    expect(statuses).toEqual([true, true]);
  });

  it('drops the state it asked for when a newer one was sent meanwhile', async () => {
    subscribe();
    await settle();
    rust.send(full);
    rust.answer(empty);
    await settle();
    expect(states).toEqual([full]);
  });

  it('keeps the last state and reports trouble when one cannot be read', async () => {
    subscribe();
    await settle();
    rust.answer(full);
    await settle();
    rust.send({ home: full.home, sessions: [{ id: 'half a session' }] });
    expect(states).toEqual([full]);
    expect(statuses).toEqual([true, false]);
    rust.send(empty);
    expect(statuses).toEqual([true, false, true]);
  });

  it('hears nothing more once unsubscribed', async () => {
    const unsubscribe = subscribe();
    await settle();
    unsubscribe();
    rust.answer(full);
    rust.send(full);
    await settle();
    expect(states).toEqual([]);
    expect(statuses).toEqual([]);
    expect(rust.stopped).toBe(1);
  });
});
