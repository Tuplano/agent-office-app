import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionCard } from '../src/components/SessionCard';
import { sessionTint } from '../src/engine';
import type { OfficeState } from '../src/shared/state';

const { home, sessions }: OfficeState = JSON.parse(readFileSync(new URL('./fixtures/office-state.json', import.meta.url), 'utf8'));
const NOW = 1_760_000_600_000;
const card = (index: number, hot = false) =>
  renderToStaticMarkup(<SessionCard session={sessions[index]} home={home} now={NOW} hot={hot} onPoint={() => {}} />);

describe('a session card', () => {
  it('shows the name, the folder, what is going on, the staff and the rest', () => {
    const html = card(0);
    expect(html).toContain('<h2>agent-office-app</h2>');
    expect(html).toContain('<p class="where" title="/home/sam/code/agent-office-app">~/code/agent-office-app</p>');
    expect(html).toContain('<p class="state" data-status="busy">working · Edit · 1 intern</p>');
    expect(html).toContain('<li>supervisor · doing the rounds</li><li>intern · Explore: Find the session readers</li>');
    expect(html).toContain('<p class="meta">terminal · up 10m · 412 MB · 3 interns so far</p>');
  });

  it('is where its name tag points, in the colour the two share', () => {
    const html = card(0);
    expect(html).toContain(`id="s-${sessions[0].id}"`);
    expect(html).toContain(`style="--tint:${sessionTint(sessions[0].id)}"`);
  });

  it('has an empty staff list when nobody stands around the desk', () => {
    expect(card(1)).toContain('<ul class="agents"></ul>');
    expect(card(1)).toContain('<p class="state" data-status="waiting">waiting on you · permission to run Bash</p>');
  });

  it('is marked while its name tag is pointed at', () => {
    expect(card(0)).toContain('class="card"');
    expect(card(0, true)).toContain('class="card hot"');
  });
});
