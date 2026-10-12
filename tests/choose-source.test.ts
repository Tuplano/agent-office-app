// Which source the page ends up with.
import { afterEach, describe, expect, it, vi } from 'vitest';

const tauri = vi.hoisted(() => ({ inside: false }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => tauri.inside, invoke: async () => ({}) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));

import { pickSource } from '../src/data/choose-source';
import { demoSource } from '../src/data/demo-source';
import { tauriSource } from '../src/data/tauri-source';

describe('choosing the source', () => {
  it('is the demo when the build says so, even inside Tauri', () => {
    expect(pickSource('demo', true)).toEqual({ source: demoSource, isDemo: true });
    expect(pickSource('demo', false)).toEqual({ source: demoSource, isDemo: true });
  });

  it('is the Rust side inside Tauri', () => {
    expect(pickSource(undefined, true)).toEqual({ source: tauriSource, isDemo: false });
  });

  it('is the demo anywhere else', () => {
    expect(pickSource(undefined, false)).toEqual({ source: demoSource, isDemo: true });
  });
});

describe('the choice made when the page loads', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    tauri.inside = false;
  });

  it('follows the build setting and what the page runs in', async () => {
    vi.stubEnv('VITE_DATA_SOURCE', 'demo');
    expect((await import('../src/data/choose-source')).isDemo).toBe(true);

    vi.resetModules();
    vi.stubEnv('VITE_DATA_SOURCE', '');
    tauri.inside = true;
    expect((await import('../src/data/choose-source')).isDemo).toBe(false);
  });
});
