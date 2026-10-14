import { invoke } from '@tauri-apps/api/core';

// The conversation of a Claude Code session started elsewhere, read from its
// transcript by the Rust side (`src-tauri/src/conversation.rs`) while its view is
// open, and kept nowhere.

export interface Entry {
  id: string;
  fromUser: boolean;
  text: string | null; // what was typed, or written back
  tool: { name: string; note: string | null } | null; // or a tool called, and what for
}

// the entries in the file between two places in it, `start` and `end`
export interface Page {
  entries: Entry[];
  start: number;
  end: number;
}

// The end of it, or what comes before `before`.
export const conversationBefore = (sessionId: string, cwd: string, before: number | null) =>
  invoke<Page>('conversation_before', { sessionId, cwd, before });

// What has been added since `from`.
export const conversationAfter = (sessionId: string, cwd: string, from: number) =>
  invoke<Page>('conversation_after', { sessionId, cwd, from });
