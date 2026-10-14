import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionView } from '../src/components/SessionView';
import { pickedOf } from '../src/lib/picked';
import type { OfficeState } from '../src/shared/state';

const { home, sessions }: OfficeState = JSON.parse(readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'));
const view = (hot = false) => renderToStaticMarkup(<SessionView session={sessions[0]} home={home} hot={hot} onPoint={() => {}} onBack={() => {}} />);

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
});
