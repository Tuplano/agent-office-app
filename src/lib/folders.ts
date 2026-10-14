import type { Session } from '../shared/state';

// The folders a new session can start in: those used for one before, newest
// first, then those of the sessions open now. Remembered in this window's storage.

const KEY = 'agent-office-folders';
const MOST = 8;

export function rememberedFolders(): string[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return []; // storage is off, or holds something else
  }
}

export function rememberFolder(folder: string): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([folder, ...rememberedFolders().filter((f) => f !== folder)].slice(0, MOST)));
  } catch {
    // storage is off: the folder is simply not offered first next time
  }
}

export function folderChoices(remembered: readonly string[], sessions: readonly Session[]): string[] {
  return [...new Set([...remembered, ...sessions.map((s) => s.cwd)])];
}
