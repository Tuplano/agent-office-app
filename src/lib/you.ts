import { useSyncExternalStore } from 'react';
import { FIRST_LOOK, LOOK_CHOICES, type YouLook } from '../engine';

// How you look in the room, as chosen in the settings, and remembered in this
// window's storage. Only what the choices hold is taken back from storage.

const KEY = 'agent-office-you';

export function chosenLook(saved: unknown): YouLook {
  const look = { ...FIRST_LOOK };
  if (saved && typeof saved === 'object') {
    for (const part of Object.keys(LOOK_CHOICES) as (keyof YouLook)[]) {
      const value = (saved as Record<string, unknown>)[part];
      if (typeof value === 'string' && LOOK_CHOICES[part].includes(value)) look[part] = value;
    }
  }
  return look;
}

function load(): YouLook {
  try {
    return chosenLook(JSON.parse(localStorage.getItem(KEY) ?? 'null'));
  } catch {
    return FIRST_LOOK; // storage is off, or holds something else
  }
}

let look = load();
const listeners = new Set<() => void>();

export function setLook(part: Partial<YouLook>): void {
  look = chosenLook({ ...look, ...part });
  try {
    localStorage.setItem(KEY, JSON.stringify(look));
  } catch {
    // storage is off: the look lasts as long as the window
  }
  for (const tell of listeners) tell();
}

const subscribe = (tell: () => void) => {
  listeners.add(tell);
  return () => listeners.delete(tell);
};

export const useLook = () => useSyncExternalStore(subscribe, () => look, () => look);
