import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionView } from '../src/components/SessionView';
import { pickedOf } from '../src/lib/picked';
import type { OfficeState } from '../src/shared/state';

const { home, sessions }: OfficeState = JSON.parse(readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'));
const view = (hot = false, terminal: number | null = null) =>
  renderToStaticMarkup(<SessionView session={{ ...sessions[0], terminal }} home={home} hot={hot} onPoint={() => {}} onBack={() => {}} readable={false} />);
const readable = (tool = 'claude') =>
  renderToStaticMarkup(<SessionView session={{ ...sessions[0], tool }} home={home} hot={false} onPoint={() => {}} onBack={() => {}} readable />);

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

  it('says where the session is answered', () => {
    expect(view()).toContain('<p class="empty">Answer this session in the terminal it runs in.</p>');
  });

  it('shows the terminal in place of that where the session runs in one of the app\'s own', () => {
    const html = view(false, 4);
    expect(html).toContain('<div class="term"></div>');
    expect(html).not.toContain('class="empty"');
    expect(html).not.toContain('<button type="button" class="try"');
  });

  it('reads along with a Claude Code session started elsewhere, where there is a Rust side to read from', () => {
    const html = readable();
    expect(html).toContain('<p class="readonly">Read only. Answer it in the terminal it runs in.</p>');
    expect(html).toContain('<div class="talk" role="log" aria-label="Conversation"><p class="empty">Reading…</p></div>');
    expect(html).not.toContain('class="empty">Answer this session');
  });

  it('only says where to answer a session of a tool it cannot read yet', () => {
    expect(readable('codex')).not.toContain('class="talk"');
    expect(readable('codex')).toContain('<p class="empty">Answer this session in the terminal it runs in.</p>');
  });

  it('offers to end a session started in the app, and only that one', () => {
    expect(view(false, 4)).toContain('<div class="ending"><button type="button">End session</button></div>');
    expect(view()).not.toContain('End session');
  });
});
