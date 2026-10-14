import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LookRows } from '../src/components/Header';
import { FIRST_LOOK, LOOK_CHOICES } from '../src/engine/you';

describe('the rows that choose your look', () => {
  it('offer every choice for each part, by name, the one in use pressed', () => {
    const html = renderToStaticMarkup(<LookRows />);
    expect(html.match(/class="swatch"/g)).toHaveLength(LOOK_CHOICES.shirt.length + LOOK_CHOICES.skin.length + LOOK_CHOICES.hair.length);
    expect(html).toContain('aria-label="Your shirt"');
    expect(html).toContain(`style="--swatch:${FIRST_LOOK.shirt}" aria-label="blue" title="blue" aria-pressed="true"`);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(3);
  });
});
