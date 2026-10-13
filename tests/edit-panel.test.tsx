import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditPanel } from '../src/components/EditPanel';
import { Header } from '../src/components/Header';
import { ImportForm } from '../src/components/ImportForm';
import { type Editor, type EditState, PALETTE, READY_ROOMS } from '../src/engine';

const editor = {} as Editor; // nothing is clicked here
const noImport = () => {};
const state = (rest: Partial<EditState> = {}): EditState => ({
  on: true,
  selected: null,
  canUndo: false,
  canRedo: false,
  canReset: false,
  ready: 'default',
  size: { w: 140, d: 140 },
  finish: {},
  palette: PALETTE.map((piece) => ({ ...piece, own: false, used: 0 })),
  pieces: [
    { index: 0, name: 'Window', wall: true, tint: null },
    { index: 3, name: 'Coffee counter', wall: false, tint: null },
    { index: 29, name: 'Sofa', wall: false, tint: '#8b6dff' },
  ],
  note: '',
  ...rest,
});

describe('the edit panel', () => {
  const panel = (edit: EditState) => renderToStaticMarkup(<EditPanel editor={editor} edit={edit} onImport={noImport} />);

  it('lists every kind of piece there is to add, as buttons', () => {
    const html = panel(state());
    for (const { name } of PALETTE) expect(html).toContain(`<button type="button">${name}</button>`);
    expect(html).toContain('Table for two');
    expect(html).toContain('<h2>Add to the floor</h2>');
    expect(html).toContain('<h2>Add to a wall</h2>');
    expect(html).not.toContain('>Door<'); // there is only ever the one
  });

  it('lists the pieces that were brought in with the rest, each to be renamed or deleted, and takes a model file', () => {
    const plain = panel(state());
    expect(plain).not.toContain('Pieces you brought in');
    expect(plain).toContain('<input type="file" accept=".glb,.vox"/><span>Bring in a model…</span>');
    expect(plain.indexOf('Bring in a model')).toBeLessThan(plain.indexOf('<h2>Add to a wall</h2>')); // with what goes on the floor
    const palette = [...state().palette, { kind: 'own-chair1', name: 'My chair', wall: false, own: true, used: 2 }];
    const html = panel(state({ palette }));
    expect(html).toContain('<ul class="own" aria-label="Pieces you brought in"><li><button type="button">My chair</button>');
    expect(html).toContain('<button type="button" aria-label="Rename My chair">Rename</button><button type="button" aria-label="Delete My chair">Delete</button>');
    expect(html.match(/My chair<\/button>/g)).toHaveLength(1); // once, and not among the kinds written in code
    expect(html).not.toContain('goes too'); // nothing is asked until Delete is clicked
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

  it('offers the ready-made rooms to start from, marks the one the room is, and takes a room as text', () => {
    const html = panel(state({ ready: 'lounge' }));
    expect(html).toContain('<h2 id="start-from">Start from</h2>');
    expect(READY_ROOMS.map((one) => one.name)).toEqual(['The office', 'All desks', 'Mostly lounge', 'Empty']);
    for (const { id, name } of READY_ROOMS) expect(html).toContain(`<button type="button" aria-pressed="${id === 'lounge'}">${name}</button>`);
    expect(panel(state({ ready: null }))).not.toContain('aria-pressed="true"'); // a room of the user's own making
    expect(html).toContain('<textarea aria-label="A room, as text" placeholder="Paste a room here" rows="3" spellCheck="false"></textarea>');
    // there is nothing to use until something is pasted
    expect(html).toContain('<button type="button">Copy room</button><button type="button" disabled="">Use this room</button>');
    // above the sizes and the colours, for whoever wants neither
    expect(html.indexOf('Start from')).toBeLessThan(html.indexOf('Room size'));
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

  it('offers any colour for a piece that has one of its own, starting from the one it has', () => {
    const sofa = panel(state({ selected: 29 }));
    expect(sofa).toContain('<span>Colour</span><input type="color" class="mix" aria-label="Its colour" value="#8b6dff"/>');
    expect(sofa).toContain('<button type="button">Random</button><button type="button">As it comes</button>');
    const counter = panel(state({ selected: 3 }));
    expect(counter).not.toContain('aria-label="Its colour"');
    expect(counter).not.toContain('>Random<'); // only the room's own colours are left
  });

  it('offers any colour for each part of the room, a whole finish at random, and no ready-made ones', () => {
    const plain = panel(state());
    expect(plain).toContain('<h2 id="room-colours">Room colours</h2>');
    // a room that says nothing starts each picker at the colour it comes in
    const comes = { Walls: '#f5f0e8', Floor: '#e6d3b0', Trim: '#b8b0a4', Wood: '#c9a878' };
    for (const [row, hex] of Object.entries(comes)) expect(plain).toContain(`<span>${row}</span><input type="color" class="mix" aria-label="${row}" value="${hex}"/>`);
    // there is nothing to put back in a room that is as it comes
    expect(plain).toContain('<button type="button">Random colours</button><button type="button" disabled="">As it comes</button>');
    expect(plain).not.toContain('chip');
    expect(plain).not.toContain('Night shift');

    const own = panel(state({ finish: { walls: '#123456', floor: '#5e6168' } }));
    expect(own).toContain('aria-label="Walls" value="#123456"');
    expect(own).toContain('aria-label="Floor" value="#5e6168"');
    expect(own).toContain('aria-label="Trim" value="#b8b0a4"');
    expect(own).toContain('<button type="button">Random colours</button><button type="button">As it comes</button>');
  });

  it('says what to do when nothing is picked, and why something was not done', () => {
    const html = panel(state({ note: 'It does not fit there.' }));
    expect(html).toContain('<h2>Nothing picked</h2>');
    expect(html).not.toContain('>Delete<');
    expect(html).toContain('<p class="note" role="status">It does not fit there.</p>');
  });
});

describe('the form a model is brought in through', () => {
  it('reads the file first, and has nothing to add until it has', () => {
    const html = renderToStaticMarkup(<ImportForm file={new File([], 'office-chair.glb')} editor={editor} onDone={() => {}} />);
    expect(html).toContain('<div class="import" role="dialog" aria-modal="true" aria-labelledby="import-title">');
    expect(html).toContain('<h2 id="import-title">Bring in a model</h2>');
    expect(html).toContain('Reading office-chair.glb…');
    expect(html).toContain('aria-label="The model as it will look in the room"');
    expect(html).toContain('<button type="button">Cancel</button><button type="button" class="primary" disabled="">Add to the room</button>');
    expect(html).not.toContain('Seats'); // nothing to ask about yet
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
