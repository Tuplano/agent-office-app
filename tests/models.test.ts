// Furniture from 3D tools: reading a model file, turning it into coloured boxes,
// and the kind of piece that makes: where it stands, who sits on it, and what a
// seat is in front of.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { draw } from '../src/engine/draw';
import { drawLaptop, laptopOf, placeOf } from '../src/engine/figures';
import { layoutOf } from '../src/engine/layout';
import { addModel, dropModel, kindOf, LIMITS, listModels, loadModels, type Model, ModelSchema, modelsIn, saveModels } from '../src/engine/models';
import { FLOOR_KINDS } from '../src/engine/pieces';
import type { Pen } from '../src/engine/raster';
import type { Piece, Room } from '../src/engine/room';
import { readWritten, writeRoom } from '../src/engine/store';
import { problemsOf } from '../src/engine/valid';
import { readGlb } from '../src/import/glb';
import { type Mesh, voxelise } from '../src/import/mesh';
import { readModel } from '../src/import/read';
import { readVox } from '../src/import/vox';
import { at, boxesOf, fewColours, fitting, makeModel, markAt, Refusal, resized, seatHeight, sizeOf, turned, type Voxels } from '../src/import/voxels';
import { boxTriangles, CHAIR, glbFile, glbOf, type MadeBox, TABLE, voxOf } from './models-made-up';
import { fakeElement, motionPreference, officeIn, session } from './stand-ins';

const DOOR: Piece = { kind: 'door', wall: 'N', a: 81.5 };
const room = (pieces: Piece[]): Room => ({ size: { w: 140, d: 140 }, pieces: [DOOR, ...pieces], cat: [] });
const GREY: [number, number, number] = [0.5, 0.5, 0.5];
const RED: [number, number, number] = [1, 0, 0];

// boxes as a mesh the converter takes: the tool's y is up and its z is the room's y
const meshOf = (boxes: MadeBox[], colours = boxes.map((_, i) => 0x101010 * (i + 1))): Mesh => ({
  parts: boxes.map((box, i) => {
    const tool = boxTriangles(box);
    const positions = new Float32Array(tool.length);
    for (let n = 0; n < tool.length; n += 3) positions.set([tool[n], tool[n + 2], tool[n + 1]], n);
    return { positions, colour: () => colours[i] };
  }),
  seats: [],
});
const plain = { name: 'Thing', turn: 0, flat: false, top: null, seats: [] };
const filledCells = (v: Voxels) => [...v.cells].filter((cell) => cell > 0).length;

describe('a model turned into blocks', () => {
  it('makes one box of a cube, standing in the middle of the cells it takes up', () => {
    // two units a side: four cubes each way, solid through
    const { voxels } = voxelise(meshOf([{ low: [0, 0, 0], high: [2, 2, 2], colour: GREY }]), 1);
    expect([voxels.nx, voxels.ny, voxels.nz]).toEqual([4, 4, 4]);
    expect(filledCells(voxels)).toBe(64);
    expect(voxels.cells[at(voxels, 1, 1, 1)]).toBe(1); // shut in on every side
    expect(boxesOf(voxels)).toEqual([[0, 0, 0, 4, 4, 4, 0]]);
    const model = makeModel(voxels, plain);
    expect(model).toMatchObject({ name: 'Thing', box: [4, 4], high: 2, flat: false, seats: [], boxes: [[1, 1, 0, 2, 2, 2, 0]] });
    expect(model.id).toMatch(/^own-[a-z0-9]+$/);
    expect(ModelSchema.safeParse(model).success).toBe(true);
    // the same model is the same kind, whatever it is called; another is another
    expect(makeModel(voxels, { ...plain, name: 'Other' }).id).toBe(model.id);
    expect(makeModel(voxels, { ...plain, flat: true }).id).not.toBe(model.id);
  });

  it('is as many cubes as its size comes to, at whatever size it is asked for', () => {
    const cube = meshOf([{ low: [0, 0, 0], high: [1, 1, 1], colour: GREY }]);
    expect(sizeOf(voxelise(cube, 1).voxels)).toEqual([1, 1, 1]);
    expect(sizeOf(voxelise(cube, 16).voxels)).toEqual([16, 16, 16]);
    expect(sizeOf(voxelise(cube, 0.2).voxels)).toEqual([0.5, 0.5, 0.5]); // never less than a cube
    // wherever it was in its own file, it stands on the floor in the corner of its grid
    const far = meshOf([{ low: [100, 50, -30], high: [101, 52, -29], colour: GREY }]);
    expect(sizeOf(voxelise(far, 2).voxels)).toEqual([2, 2, 4]);
  });

  it('makes two boxes of an L, and no more', () => {
    const el = meshOf([
      { low: [0, 0, 0], high: [4, 2, 2], colour: GREY },
      { low: [0, 0, 2], high: [2, 2, 4], colour: GREY },
    ], [0x808080, 0x808080]);
    const { voxels } = voxelise(el, 1);
    expect([voxels.nx, voxels.ny, voxels.nz]).toEqual([8, 8, 4]);
    expect(voxels.cells[at(voxels, 6, 6, 0)]).toBe(0); // the corner the L leaves out
    expect(boxesOf(voxels)).toEqual([[0, 0, 0, 8, 4, 4, 0], [0, 4, 0, 4, 4, 4, 0]]);
    // turned, it is the same L a quarter round: what faced south faces west
    const round = turned(voxels, 1);
    expect(round.cells[at(round, 1, 6, 0)]).toBe(0);
    expect(filledCells(round)).toBe(filledCells(voxels));
    expect(filledCells(turned(voxels, 4))).toBe(filledCells(voxels));
    expect([...turned(voxels, 4).cells]).toEqual([...voxels.cells]);
  });

  it('keeps two colours apart: a top of one, a leg of another', () => {
    const table = meshOf([
      { low: [0, 1.5, 0], high: [4, 2, 2], colour: GREY }, // the top
      { low: [1.5, 0, 0.5], high: [2.5, 1.5, 1.5], colour: RED }, // one leg under the middle
    ], [0xc08040, 0x202020]);
    const { voxels } = voxelise(table, 1);
    expect(voxels.colours).toHaveLength(2);
    const boxes = boxesOf(voxels);
    expect(boxes).toHaveLength(2);
    const [leg, top] = boxes;
    expect(leg.slice(0, 6)).toEqual([3, 1, 0, 2, 2, 3]);
    expect(top.slice(0, 6)).toEqual([0, 0, 3, 8, 4, 1]);
    expect(voxels.colours[leg[6]]).not.toBe(voxels.colours[top[6]]);
    // and each is near enough the colour it was given
    const near = (hex: string, rgb: number) => [16, 8, 0].every((shift) => Math.abs(((parseInt(hex.slice(1), 16) >> shift) & 255) - ((rgb >> shift) & 255)) <= 8);
    expect(near(voxels.colours[top[6]], 0xc08040)).toBe(true);
    expect(near(voxels.colours[leg[6]], 0x202020)).toBe(true);
  });

  it('cuts many colours down to a handful', () => {
    const counts = new Map<number, number>();
    for (let n = 0; n < 200; n++) counts.set((n << 16) | ((255 - n) << 8) | ((n * 7) & 255), 1 + (n % 5));
    const { colours, indexOf } = fewColours(counts, LIMITS.colours);
    expect(colours).toHaveLength(LIMITS.colours);
    expect(new Set(colours).size).toBe(LIMITS.colours);
    expect([...indexOf.keys()]).toHaveLength(200);
    expect([...indexOf.values()].every((index) => index >= 0 && index < LIMITS.colours)).toBe(true);
    // a few are left as they are
    const few = fewColours(new Map([[0xff0000, 3], [0x00ff00, 1]]), LIMITS.colours);
    expect(few.colours.sort()).toEqual(['#00ff00', '#ff0000']);
    // a striped thing of thirty colours still comes to a handful, and to no more boxes than stripes
    const stripes = meshOf(Array.from({ length: 30 }, (_, n) => ({ low: [n, 0, 0], high: [n + 1, 1, 1], colour: GREY })), Array.from({ length: 30 }, (_, n) => (n * 8) << 16));
    const { voxels } = voxelise(stripes, 1);
    expect(voxels.colours.length).toBeLessThanOrEqual(LIMITS.colours);
    expect(boxesOf(voxels).length).toBeLessThanOrEqual(30);
  });

  it('turns down a model that is too big, or too much, and says why', () => {
    const big = voxelise(meshOf([{ low: [0, 0, 0], high: [100, 10, 10], colour: GREY }]), 1).voxels;
    expect(() => makeModel(big, plain)).toThrow(Refusal);
    expect(() => makeModel(big, plain)).toThrow('It is 100 by 10 and 10 high, and the most is 64 by 64 and 40 high. Make it smaller.');
    // what it has to be multiplied by to fit, and then it does
    expect(fitting([100, 10, 10])).toBeCloseTo(0.64);
    expect(fitting([10, 10, 80])).toBe(0.5);
    expect(makeModel(voxelise(meshOf([{ low: [0, 0, 0], high: [100, 10, 10], colour: GREY }]), 0.64).voxels, plain).box).toEqual([64, 8]);
    expect(() => voxelise(meshOf([{ low: [0, 0, 0], high: [1000, 1, 1], colour: GREY }]), 1)).toThrow('It is far too big at this size.');
    // a checkerboard of two colours, each cube a box of its own: more than may be kept
    const squares = 32;
    const checks = { nx: squares, ny: squares, nz: 1, cells: Uint8Array.from({ length: squares * squares }, (_, n) => 2 + (((n % squares) + Math.floor(n / squares)) & 1)), colours: ['#000000', '#ffffff'] };
    expect(() => makeModel(checks, plain)).toThrow(`It comes to 1024 boxes, and the most is ${LIMITS.boxes}. Make it smaller, or bring a simpler model.`);
    expect(() => voxelise({ parts: [], seats: [] }, 1)).toThrow('There is nothing in it to draw.');
  });

  it('can be made bigger or smaller once it is cubes', () => {
    const { voxels } = voxelise(meshOf([{ low: [0, 0, 0], high: [2, 2, 2], colour: GREY }]), 1);
    expect(sizeOf(resized(voxels, 2))).toEqual([4, 4, 4]);
    expect(boxesOf(resized(voxels, 2))).toEqual([[0, 0, 0, 8, 8, 8, 0]]);
    expect(sizeOf(resized(voxels, 0.5))).toEqual([1, 1, 1]);
    expect(resized(voxels, 1)).toBe(voxels);
  });
});

describe('a model file', () => {
  it('is read as a GLB: boxes in metres, y up, each the colour of its material', async () => {
    const mesh = await readGlb(glbOf(TABLE));
    expect(mesh.parts).toHaveLength(5);
    expect(mesh.parts[0].positions).toHaveLength(12 * 9);
    // the tool's linear colour, as the screen shows it
    expect(mesh.parts[4].colour(0, 1, 0, 0).toString(16)).toBe('aa8b65');
    const table = await readModel('work-table.glb', glbOf(TABLE));
    expect(table.name).toBe('Work table');
    expect(table.size).toEqual([22.5, 11.5, 12]); // 1.4m by 0.7m and 0.75m high, at 16 units to the metre
    const model = makeModel(table.blocks(1).voxels, { ...plain, name: table.name, top: 12 });
    expect(model).toMatchObject({ box: [24, 12], high: 12, top: 12 });
    expect(model.colours).toHaveLength(2);
    // Four legs and the top. The top's underside is not on a line between cubes, so
    // the cubes where a leg meets it are the leg's, and the top is in a few boxes round them.
    expect(model.boxes.length).toBeGreaterThanOrEqual(5);
    expect(model.boxes.length).toBeLessThanOrEqual(20);
    expect(ModelSchema.safeParse(model).success).toBe(true);
  });

  it('takes the colour of the picture a thing is painted with, and leaves out what is see-through', async () => {
    // one square on the floor, two metres by one, painted with a picture of three pixels: red, blue, and nothing
    const corners = [[0, 0, 0], [0, 0, 1], [2, 0, 1], [0, 0, 0], [2, 0, 1], [2, 0, 0]];
    const places = new Float32Array(corners.flat());
    const across = new Float32Array(corners.flatMap(([x, , z]) => [x / 2, z]));
    const bin = new Uint8Array(places.byteLength + across.byteLength + 4);
    bin.set(new Uint8Array(places.buffer), 0);
    bin.set(new Uint8Array(across.buffer), places.byteLength);
    const file = (alphaMode: string) =>
      glbFile(
        {
          asset: { version: '2.0' },
          scenes: [{ nodes: [0] }],
          nodes: [{ mesh: 0 }],
          meshes: [{ primitives: [{ attributes: { POSITION: 0, TEXCOORD_0: 1 }, material: 0 }] }],
          materials: [{ alphaMode, pbrMetallicRoughness: { baseColorTexture: { index: 0 } } }],
          textures: [{ source: 0 }],
          images: [{ bufferView: 2, mimeType: 'image/png' }],
          accessors: [{ bufferView: 0, componentType: 5126, count: 6, type: 'VEC3' }, { bufferView: 1, componentType: 5126, count: 6, type: 'VEC2' }],
          bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: places.byteLength }, { buffer: 0, byteOffset: places.byteLength, byteLength: across.byteLength }, { buffer: 0, byteOffset: places.byteLength + across.byteLength, byteLength: 4 }],
          buffers: [{ byteLength: bin.byteLength }],
        },
        bin,
      );
    const opened: string[] = [];
    const picture = async (_bytes: Uint8Array, type: string) => {
      opened.push(type);
      return { width: 3, height: 1, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255, 0, 255, 0, 0]) };
    };
    const [part] = (await readGlb(file('MASK'), picture)).parts;
    expect(opened).toEqual(['image/png']);
    // the second triangle runs from the near corner to the far ones: at its first corner the picture is red
    expect(part.colour(1, 0.9, 0.05, 0.05)).toBe(0xff0000);
    expect(part.colour(1, 0.5, 0.25, 0.25)).toBe(0x0000ff); // half way along
    expect(part.colour(1, 0.06, 0.47, 0.47)).toBe(-1); // where the picture is nothing
    // a thing that is solid all through takes the pixel's colour, however clear the picture says it is
    const [solid] = (await readGlb(file('OPAQUE'), picture)).parts;
    expect(solid.colour(1, 0.06, 0.47, 0.47)).toBe(0x00ff00);
    // a picture that will not open is done without: the thing is its material's plain colour
    const [bare] = (await readGlb(file('OPAQUE'), () => Promise.reject(new Error('no')))).parts;
    expect(bare.colour(1, 0.9, 0.05, 0.05)).toBe(0xffffff);
    // as blocks: red, then blue, and a gap where the picture is clear
    const { voxels } = voxelise(await readGlb(file('MASK'), picture), 3);
    expect(voxels.colours.sort()).toEqual(['#0404fc', '#fc0404']);
    expect([voxels.nx, voxels.ny, voxels.nz]).toEqual([12, 6, 1]);
    expect(voxels.cells[at(voxels, 10, 3, 0)]).toBe(0);
    expect(voxels.cells[at(voxels, 1, 3, 0)]).not.toBe(voxels.cells[at(voxels, 6, 3, 0)]);
  });

  it('says where someone sits, by an empty thing whose name begins with seat', async () => {
    const half = Math.SQRT1_2;
    const marked = await readGlb(glbOf(CHAIR, [
      { name: 'seat', at: [0.225, 0.45, 0.25] },
      { name: 'Seat.001', at: [0.1, 0.45, 0.1], rotation: [0, half, 0, half] }, // turned a quarter about the upright: looking along the tool's x
      { name: 'cushion', at: [0, 0, 0] },
    ]));
    expect(mesh(marked.seats)).toEqual([[0.225, 0.25, 0.45, 'S'], [0.1, 0.1, 0.45, 'E']]);
    const { seats } = voxelise(marked, 16);
    expect(seats[0]).toMatchObject({ x: 3.6, y: 4, dir: 'S' });
    expect(seats[0].z).toBeCloseTo(7.2);
    function mesh(seats: Mesh['seats']) {
      return seats.map((seat) => [seat.x, seat.y, seat.z, seat.dir].map((v) => (typeof v === 'number' ? Math.round(v * 1000) / 1000 : v)));
    }
  });

  it('is turned down, with the reason, when it is not one that can be read', async () => {
    const said = async (run: Promise<unknown>) => run.then(() => 'taken', (error) => (error instanceof Refusal ? error.message : `threw ${error}`));
    expect(await said(readModel('chair.obj', new ArrayBuffer(8)))).toContain('Bring a .glb file');
    expect(await said(readModel('chair.glb', new ArrayBuffer(64)))).toBe('It is not a GLB file.');
    expect(await said(readModel('chair.glb', new TextEncoder().encode('glTF and then nothing of use at all').buffer as ArrayBuffer))).toBe('It is a GLB of an old kind. Export it as glTF 2.');
    expect(await said(readModel('chair.glb', glbOf(CHAIR, [], { extensionsRequired: ['KHR_draco_mesh_compression'] })))).toBe('It is compressed, which cannot be read here. Export it without compression.');
    expect(await said(readModel('chair.glb', glbOf([])))).toBe('There is nothing in it to draw.');
    expect(await said(readModel('chair.vox', new ArrayBuffer(64)))).toBe('It is not a MagicaVoxel file.');
    // a model of ten metres comes in, and has to be made smaller to be kept
    const huge = await readModel('hall.glb', glbOf([{ low: [0, 0, 0], high: [10, 1, 1], colour: GREY }]));
    expect(huge.size).toEqual([160, 16, 16]);
    expect(fitting(huge.size)).toBe(0.4);
    expect(makeModel(huge.blocks(0.4).voxels, plain).box).toEqual([64, 8]);
  });

  it('is read as a MagicaVoxel file: cube for cube, its front to the south, its colours its own', async () => {
    // an L lying on the floor, two cubes high: red along x, and one blue cube at the far end of y
    const cubes: [number, number, number, number][] = [];
    for (let z = 0; z < 2; z++) {
      for (let x = 0; x < 4; x++) cubes.push([x, 0, z, 1]);
      cubes.push([0, 1, z, 2], [0, 2, z, 2]);
    }
    const voxels = readVox(voxOf([4, 3, 2], cubes, [[255, 0, 0], [0, 0, 255]]));
    expect([voxels.nx, voxels.ny, voxels.nz]).toEqual([4, 3, 2]);
    expect(voxels.colours.sort()).toEqual(['#0000ff', '#ff0000']);
    // the file's low y is its front, and the room's front is its high y
    expect(voxels.cells[at(voxels, 3, 2, 0)]).toBeGreaterThan(1);
    expect(voxels.cells[at(voxels, 3, 0, 0)]).toBe(0);
    expect(boxesOf(voxels)).toHaveLength(2);
    const source = await readModel('L_shape.vox', voxOf([4, 3, 2], cubes, [[255, 0, 0], [0, 0, 255]]));
    expect(source).toMatchObject({ name: 'L shape', size: [2, 1.5, 1] });
    expect(sizeOf(source.blocks(2).voxels)).toEqual([4, 3, 2]);
    expect(() => readVox(voxOf([4, 3, 2], [], []))).toThrow('There is nothing in it to draw.');
  });
});

describe('a piece made from a model', () => {
  let chair: Model;
  let table: Model;
  beforeEach(async () => {
    vi.stubGlobal('matchMedia', motionPreference(false));
    vi.stubGlobal('document', { createElement: () => ({ ...fakeElement(), hidden: false }) });
    const read = async (name: string, boxes: MadeBox[], rest: object) => {
      const { voxels } = (await readModel(name, glbOf(boxes))).blocks(1);
      return { voxels, model: makeModel(voxels, { ...plain, name, ...rest }) };
    };
    const sat = await read('chair.glb', CHAIR, {});
    const [w, d] = sizeOf(sat.voxels);
    chair = makeModel(sat.voxels, { ...plain, name: 'Chair', seats: [{ x: w / 2, y: d / 2, z: seatHeight(sat.voxels, w / 2, d / 2), dir: 'S' }] });
    table = (await read('table.glb', TABLE, { top: 12 })).model;
    addModel(chair);
    addModel(table);
  });
  afterEach(() => {
    for (const model of listModels()) dropModel(model.id);
    vi.unstubAllGlobals();
  });

  it('is a kind like any other: it has a name and a box, is in the way, and can be turned and moved', () => {
    // 7.5 across, in a box of 8 it stands a whole number of cubes into: its middle is at 3.75
    expect(chair).toMatchObject({ box: [8, 8], high: 15.5, seats: [{ x: 3.75, y: 3.75, z: 7.5, dir: 'S' }] });
    expect(FLOOR_KINDS[chair.id]).toMatchObject({ name: 'Chair', sits: chair.seats });
    expect(FLOOR_KINDS[table.id].top).toBe(12);
    expect(kindOf({ ...table, flat: true }).blocks).toEqual([]); // a rug is in nobody's way
    const placed = room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 60, y: 60, turn: 1 }]);
    expect(problemsOf(placed)).toEqual([]);
    expect(layoutOf(placed).footprints).toEqual([[40, 40, 8, 8], [60, 60, 12, 24]]);
    expect(problemsOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 44, y: 44, turn: 0 }]))[0].why).toBe('It stands where the Chair does.'.replace('Chair', chair.id));
    const { scene } = officeIn(placed);
    expect(() => draw(scene)).not.toThrow();
  });

  it('turns its seats with it', () => {
    // someone sitting off to one side of a bench, looking out of its front
    const bench: Voxels = { nx: 8, ny: 16, nz: 4, cells: new Uint8Array(8 * 16 * 4).fill(2), colours: ['#808080'] };
    const mark = { x: 1, y: 6, z: 2, dir: 'S' as const };
    expect(makeModel(bench, { ...plain, seats: [mark] }).seats).toEqual([{ x: 1, y: 6, z: 2, dir: 'S' }]);
    const round = makeModel(bench, { ...plain, turn: 1, seats: [mark] });
    expect(round.box).toEqual([8, 4]);
    expect(round.seats).toEqual([{ x: 2, y: 1, z: 2, dir: 'W' }]);
    // and a point of the turned model is found again on the model as it came
    for (const turn of [0, 1, 2, 3]) {
      const [seat] = makeModel(bench, { ...plain, turn, seats: [mark] }).seats;
      expect(markAt(bench, turn, seat.x, seat.y, seat.z, seat.dir), `turn ${turn}`).toEqual(mark);
    }
    // in the room, the piece's own turn carries the seat round again
    addModel(round);
    const layout = layoutOf(room([{ kind: round.id, x: 40, y: 40, turn: 1 }]));
    expect(layout.play.map(({ x, y, dir, kind, z }) => [x, y, dir, kind, z])).toEqual([[43, 42, 'N', 'sofa', 2]]);
  });

  it('pairs a seat with the top in front of it, and makes a place to rest of a seat with none', () => {
    // a chair alone is somewhere to sit and rest, like a sofa
    const alone = layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }]));
    expect(alone.seats).toEqual([]);
    expect(alone.play).toMatchObject([{ x: 43.75, y: 43.75, dir: 'S', kind: 'sofa', z: 7.5, piece: 1 }]);
    // with a table before it, it is a seat to work at, and the laptop goes on that top
    const paired = layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 32, y: 48, turn: 0 }]));
    expect(paired.play).toEqual([]);
    expect(paired.seats).toEqual([{ x: 43.75, y: 43.75, dir: 'S', kind: 'own', z: 7.5, piece: 1, top: 12 }]);
    expect(paired.footprints).toEqual([[40, 40, 8, 8], [32, 48, 24, 12]]); // and no chair is put there beside its own
    // a table behind it, or off to the side, is no desk
    expect(layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 32, y: 28, turn: 0 }])).seats).toEqual([]);
    expect(layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 2 }, { kind: table.id, x: 32, y: 28, turn: 0 }])).seats).toHaveLength(1); // unless it is turned to face it
    expect(layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 60, y: 48, turn: 0 }])).seats).toEqual([]);
    // a rug before it is not a top, and nor is a plant
    addModel({ ...table, id: 'own-rug1', flat: true, top: undefined });
    expect(layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: 'own-rug1', x: 32, y: 48, turn: 0 }])).seats).toEqual([]);
    expect(layoutOf(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: 'planter', x: 40, y: 48, turn: 0 }])).seats).toEqual([]);
    // the end of a long table written in code will do: its four chairs stay its own, and this is a fifth
    const fifth = layoutOf(room([{ kind: 'small-table', x: 40, y: 40, turn: 0 }, { kind: chair.id, x: 32, y: 52, turn: 3 }]));
    expect(fifth.seats.map((seat) => seat.kind).sort()).toEqual(['bench', 'bench', 'own']);
    expect(fifth.seats.find((seat) => seat.kind === 'own')).toMatchObject({ x: 35.75, y: 56.25, dir: 'E', top: 12 });
  });

  it('sits a worker at a chair and a table brought in, with a laptop on the table', () => {
    const { scene, sim } = officeIn(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: table.id, x: 32, y: 48, turn: 0 }, { kind: chair.id, x: 100, y: 100, turn: 0 }]));
    sim.apply([session('a'), session('b')]);
    const [a, b] = [scene.desks.get('a')!, scene.desks.get('b')!];
    expect(a.seat).toBe(0);
    expect(placeOf(a)).toMatchObject({ x: 43.75, y: 43.75, dir: 'S', z: 7.5 });
    expect(laptopOf(a)).toBe('desk');
    // the other has the chair that stands alone, as they would a sofa, and their laptop on their knees
    expect(b.seat).toBe(-1);
    expect(b.spare).toMatchObject({ x: 103.75, y: 103.75, lounge: 0 });
    expect(laptopOf(b)).toBe('lap');
    // the laptop is drawn on the table's top, whatever height that is
    const standsAt = (given: typeof scene, who: string) => {
      const heights: number[] = [];
      const pen = { box: (_x: number, _y: number, z: number) => void heights.push(z), face() {} } as unknown as Pen;
      drawLaptop(given, given.desks.get(who)!, pen);
      return heights;
    };
    expect(standsAt(scene, 'a')).toEqual([12, 12]); // its base and its lid
    expect(standsAt(scene, 'b')).toEqual([9.5, 9.5]); // two above the seat they sit on
    addModel({ ...table, id: 'own-low1', top: 9 });
    const low = officeIn(room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: 'own-low1', x: 32, y: 48, turn: 0 }]));
    low.sim.apply([session('a')]);
    expect(standsAt(low.scene, 'a')).toEqual([9, 9]);
    expect(() => draw(scene)).not.toThrow();
    expect(() => draw(low.scene)).not.toThrow();
  });

  it('is kept beside the room, and comes back when the office is opened again', () => {
    const kept: Record<string, string> = {};
    vi.stubGlobal('localStorage', { getItem: (key: string) => kept[key] ?? null, setItem: (key: string, value: string) => void (kept[key] = value) });
    saveModels();
    expect(JSON.parse(kept['agent-office-models'])).toMatchObject({ version: 1, models: [{ id: chair.id }, { id: table.id }] });
    for (const model of listModels()) dropModel(model.id);
    expect(FLOOR_KINDS[chair.id]).toBeUndefined();
    loadModels();
    expect(listModels().map((model) => model.id)).toEqual([chair.id, table.id]);
    expect(FLOOR_KINDS[table.id].top).toBe(12);
    // what is not a sound model is left behind, and the rest are taken
    kept['agent-office-models'] = JSON.stringify({ version: 1, models: [{ ...chair, id: 'constructor' }, { ...chair, boxes: [[0, 0, 0, 900, 1, 1, 0]] }, { ...chair, name: '' }, { ...chair, colours: ['red'] }, table, 'nonsense'] });
    loadModels();
    expect(listModels().map((model) => model.id)).toEqual([table.id]);
    for (const broken of ['not json {', JSON.stringify({ version: 2, models: [chair] }), 'null']) {
      kept['agent-office-models'] = broken;
      loadModels();
      expect(listModels()).toEqual([]);
    }
  });

  it('goes with a room that is copied out, and a piece whose kind is missing is left out', () => {
    const furnished = room([{ kind: chair.id, x: 40, y: 40, turn: 0 }, { kind: 'sofa', x: 80, y: 80, turn: 0 }]);
    expect(modelsIn(furnished).map((model) => model.id)).toEqual([chair.id]); // the table is in no piece of it
    const text = writeRoom(furnished, modelsIn(furnished));
    expect(readWritten(text)).toMatchObject({ room: furnished, models: [{ id: chair.id, name: 'Chair' }] });
    expect(writeRoom(room([]))).not.toContain('models'); // a room of no models is written as it always was
    // in an office that has never seen the chair
    for (const model of listModels()) dropModel(model.id);
    expect(problemsOf(furnished)).toEqual([]);
    expect(layoutOf(furnished).footprints).toEqual([[80, 80, 11, 28]]);
    expect(() => draw(officeIn(furnished).scene)).not.toThrow();
    // models that came along and are not sound are dropped, and the room is still read
    const spoiled = JSON.stringify({ ...JSON.parse(text), models: [{ ...chair, high: -1 }, chair, 7] });
    expect(readWritten(spoiled)!.models.map((model) => model.id)).toEqual([chair.id]);
  });
});
