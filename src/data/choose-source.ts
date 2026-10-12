import { isTauri } from '@tauri-apps/api/core';
import { demoSource } from './demo-source';
import type { StateSource } from './source';
import { tauriSource } from './tauri-source';

// The demo when the build says so, or when there is no Tauri to ask; the Rust side
// otherwise.
export function pickSource(dataSource: string | undefined, inTauri: boolean): { source: StateSource; isDemo: boolean } {
  const isDemo = dataSource === 'demo' || !inTauri;
  return { source: isDemo ? demoSource : tauriSource, isDemo };
}

// Picked once, when the page loads. `isDemo` says which one it was, so the page can
// own up to made-up sessions whenever they are what it shows.
export const { source: chosenSource, isDemo } = pickSource(import.meta.env.VITE_DATA_SOURCE, isTauri());
