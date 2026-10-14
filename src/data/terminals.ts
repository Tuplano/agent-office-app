import { Channel, invoke } from '@tauri-apps/api/core';

// The terminals the Rust side runs for the app (`src-tauri/src/terminals.rs`).
// Each is known by the number it was given when it was opened.

// what a terminal sends down its channel: what it printed, as bytes, or its end
export type TerminalMessage = ArrayBuffer | { exit: number | null };

// The tools the app can start that are installed here, by name ('claude', 'codex', 'gemini', 'agy').
export const toolsFound = () => invoke<string[]>('tools_found');

// A folder picked in the system's own picker, or null when none was.
export const chooseFolder = () => invoke<string | null>('choose_folder');

// Starts one of the tools the app knows in `cwd`, and gives its number. The
// session it runs is `term-<number>` in the office's state.
export const openTerminal = (tool: string, cwd: string) => invoke<number>('terminal_open', { tool, cwd });

// What was kept of it, then everything it prints, until it ends or `detach` is
// called with the number this gives back.
export const attachTerminal = (id: number, onMessage: (message: TerminalMessage) => void) =>
  invoke<number>('terminal_attach', { id, channel: new Channel<TerminalMessage>(onMessage) });

export const detachTerminal = (id: number, watch: number) => invoke<void>('terminal_detach', { id, watch });
export const writeTerminal = (id: number, data: string) => invoke<void>('terminal_write', { id, data });
export const resizeTerminal = (id: number, cols: number, rows: number) => invoke<void>('terminal_resize', { id, cols, rows });
export const closeTerminal = (id: number) => invoke<void>('terminal_close', { id });
