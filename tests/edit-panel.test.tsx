import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../src/components/EditPanel';
import { Header } from '../src/components/Header';
import { type Editor, type EditState, PALETTE } from '../src/engine';

const editor = {} as Editor; // nothing is clicked here
const state = (rest: Partial<EditState> = {}): EditState => ({
  on: true,
  selected: null,
  canUndo: false,
  canRedo: false,
  canReset: false,
  size: { w: 140, d: 140 },
  pieces: [
    { index: 0, name: 'Window', wall: true },
    { index: 3, name: 'Coffee counter', wall: false },
    { index: 29, name: 'Sofa', wall: false },
  ],
  note: '',
  ...rest,
});

describe('the edit panel', () => {
  const panel = (edit: EditState) => renderToStaticMarkup(<EditPanel editor={editor} edit={edit} />);

  it('lists every kind of piece there is to add, as buttons', () => {
    const html = panel(state());
    for (const { name } of PALETTE) expect(html).toContain(`<button type="button">${name}</button>`);
    expect(html).toContain('Table for two');
    expect(html).toContain('<h2>Add to the floor</h2>');
    expect(html).toContain('<h2>Add to a wall</h2>');
    expect(html).not.toContain('>Door<'); // there is only ever the one
  });

  it('lists what is in the room, and marks the piece picked out', () => {
    const html = panel(state({ selected: 29 }));
    expect(html).toContain('<button type="button" aria-pressed="false">Coffee counter</button>');
    expect(html).toContain('<button type="button" aria-pressed="true">Sofa</button>');
    expect(html).toContain('<h2>Sofa</h2>');
    for (const what of ['Turn', 'Duplicate', 'Delete']) expect(html).toContain(`<button type="button">${what}</button>`);
    // what hangs on a wall goes round to the next wall where a piece on the floor turns
    const hung = panel(state({ selected: 0 }));
    expect(hung).toContain('<h2>Window</h2>');
    expect(hung).toContain('<button type="button">Next wall</button>');
    expect(hung).not.toContain('>Turn<');
  });

  it('shows how big the room is, with buttons to change it that stop at the limits', () => {
    const html = panel(state());
    expect(html).toContain('<h2 id="room-size">Room size</h2>');
    expect(html).toContain('<span>Width</span><button type="button" aria-label="Narrower">−</button><output>140</output><button type="button" aria-label="Wider">+</button>');
    expect(html).toContain('<button type="button" aria-label="Shallower">−</button><output>140</output><button type="button" aria-label="Deeper">+</button>');
    const edge = panel(state({ size: { w: 96, d: 196 } }));
    expect(edge).toContain('<button type="button" aria-label="Narrower" disabled="">−</button><output>96</output>');
    expect(edge).toContain('<output>196</output><button type="button" aria-label="Deeper" disabled="">+</button>');
  });

  it('says what to do when nothing is picked, and why something was not done', () => {
    const html = panel(state({ note: 'It does not fit there.' }));
    expect(html).toContain('<h2>Nothing picked</h2>');
    expect(html).not.toContain('>Delete<');
    expect(html).toContain('<p class="note" role="status">It does not fit there.</p>');
  });
});

describe('the header', () => {
  beforeEach(() => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
    vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} });
  });
  afterEach(() => vi.unstubAllGlobals());
  const header = (edit: EditState, given: Editor | null = editor) =>
    renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <Header editor={given} edit={edit} />
      </QueryClientProvider>,
    );

  it('offers to edit the room once there is an office to edit', () => {
    expect(header(state({ on: false }), null)).toContain('<button type="button" disabled="">Edit room</button>');
    expect(header(state({ on: false }))).toContain('<button type="button">Edit room</button>');
  });

  it('has the tools of edit mode while it is on, with the ones that have nothing to do greyed out', () => {
    const html = header(state({ canUndo: true }));
    expect(html).not.toContain('Edit room');
    expect(html).toContain('<button type="button">Undo</button>');
    expect(html).toContain('<button type="button" disabled="">Redo</button>');
    expect(html).toContain('<button type="button" disabled="">Reset</button>');
    expect(html).toContain('<button type="button" class="primary">Done</button>');
  });
});
