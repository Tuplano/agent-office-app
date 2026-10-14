import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActionMenu } from '../src/components/ActionMenu';
import type { Menu } from '../src/engine';

const menu: Menu = {
  piece: 4,
  name: 'Sofa',
  sx: 290,
  sy: 210,
  actions: [
    { id: 'sit', label: 'Sit', taken: false },
    { id: 'lie', label: 'Lie down', taken: true },
    { id: 'walk', label: 'Walk here', taken: false },
  ],
};

describe('the menu of a piece', () => {
  it('names the piece and lists what to do with it as buttons, a taken one not to be chosen', () => {
    const html = renderToStaticMarkup(<ActionMenu menu={menu} onChoose={() => {}} onClose={() => {}} />);
    expect(html).toContain('role="menu" aria-label="What to do with the sofa"');
    expect(html).toContain('<p>Sofa</p>');
    expect(html).toContain('<button type="button" role="menuitem">Sit</button>');
    expect(html).toContain('<button type="button" role="menuitem" disabled="">Lie down<span> · taken</span></button>');
    expect(html).toContain('<button type="button" role="menuitem">Walk here</button>');
  });

  it('stands at the click, kept inside the picture', () => {
    expect(renderToStaticMarkup(<ActionMenu menu={menu} onChoose={() => {}} onClose={() => {}} />)).toContain('style="left:50%;top:50%"');
    const corner = renderToStaticMarkup(<ActionMenu menu={{ ...menu, sx: 0, sy: 9999 }} onChoose={() => {}} onClose={() => {}} />);
    expect(corner).toContain('style="left:12%;top:78%"');
  });
});
