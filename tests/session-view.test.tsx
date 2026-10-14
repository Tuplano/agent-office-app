import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionView } from '../src/components/SessionView';
import { pickedOf } from '../src/lib/picked';
import type { OfficeState, Session } from '../src/shared/state';

const { home, sessions }: OfficeState = JSON.parse(readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'));
const view = (hot = false, terminal: number | null = null) =>
  renderToStaticMarkup(<SessionView session={{ ...sessions[0], terminal }} home={home} hot={hot} onPoint={() => {}} onBack={() => {}} readable={false} />);
const readable = (rest: Partial<Session> = {}) =>
  renderToStaticMarkup(<SessionView session={{ ...sessions[0], ...rest }} home={home} hot={false} onPoint={() => {}} onBack={() => {}} readable />);
const reply = '<div class="answer"><button type="button" title="Brings its window forward. The tab in it, if there are several, is yours to pick.">Reply in VS Code</button></div>';

describe('the session picked out', () => {
  it('is the one with that id, while it is open', () => {
    expect(pickedOf(sessions, sessions[1].id)).toBe(sessions[1]);
  });

  it('is nobody before a click, and nobody again once the session has ended', () => {
    expect(pickedOf(sessions, null)).toBeNull();
    expect(pickedOf(sessions.slice(1), sessions[0].id)).toBeNull();
    expect(pickedOf([], sessions[0].id)).toBeNull();
  });
});

describe('the view of one session', () => {
  it('starts with the way back to the list, where the keyboard is put', () => {
    expect(view()).toMatch(/^<div class="side view"><button type="button" class="back" autofocus="">← All sessions<\/button>/);
  });

  it('shows its card, which is where its name tag points and opens nothing more', () => {
    const html = view();
    expect(html).toContain(`<article class="card" id="s-${sessions[0].id}"`);
    expect(html).toContain('<h2>agent-office-app</h2>');
    expect(html).toContain('<p class="state" data-status="busy">working · Edit · 1 intern</p>');
    expect(view(true)).toContain('<article class="card hot"');
  });

  it('says where the session is answered: in the program it runs in, where the app knows it', () => {
    expect(view()).toContain('<p class="readonly">Answer it in VS Code.</p>'); // the demo: nothing to bring forward
    expect(readable({ host: null })).toContain('<p class="readonly">Answer it in the terminal it runs in.</p>');
    expect(readable({ host: { name: 'tmux', raise: false } })).toContain('<p class="readonly">Answer it in tmux.</p>');
  });

  it('offers to bring the window it runs in forward, where that can be done', () => {
    expect(readable()).toContain(reply);
    expect(readable({ host: { name: 'VS Code', raise: false } })).not.toContain('Reply in');
  });

  it('reads along with a Claude Code session started elsewhere, where there is a Rust side to read from', () => {
    const html = readable();
    expect(html).toContain(`${reply}<div class="talk" role="log" aria-label="Conversation (read only)"><p class="empty">Reading…</p></div>`);
    expect(view()).not.toContain('class="talk"');
  });

  it('reads along with a Codex session too, and only says where to answer one it cannot read', () => {
    expect(readable({ tool: 'codex' })).toContain('class="talk"');
    expect(readable({ tool: 'gemini' })).not.toContain('class="talk"');
    expect(readable({ tool: 'gemini' })).toContain(reply);
  });

  it('shows the terminal in place of that where the session runs in one of the app\'s own', () => {
    const html = view(false, 4);
    expect(html).toContain('<div class="term"></div>');
    expect(html).not.toContain('class="empty"');
    expect(html).not.toContain('<button type="button" class="try"');
  });

  it('offers to end a session started in the app, and only that one', () => {
    expect(view(false, 4)).toContain('<div class="ending"><button type="button">End session</button></div>');
    expect(view()).not.toContain('End session');
  });
});
