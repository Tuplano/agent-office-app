import { invoke } from '@tauri-apps/api/core';

// Brings forward the window of the program a session started elsewhere runs in
// (`src-tauri/src/host.rs`): VS Code, a terminal. Only where its `host.raise` says it can.
export const raiseSession = (pid: number, cwd: string) => invoke<void>('session_raise', { pid, cwd });
