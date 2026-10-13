// Models made up for the tests, the way a 3D tool would write them: boxes of one
// colour each, with y up and the front along z, in metres; and the files they
// would be saved as.
export interface MadeBox {
  low: [number, number, number];
  high: [number, number, number];
  colour: [number, number, number]; // red, green and blue from 0 to 1, as the tool has them, before the screen's curve
}

// the twelve triangles of a box, each anticlockwise seen from outside
export function boxTriangles({ low: [x0, y0, z0], high: [x1, y1, z1] }: MadeBox): number[] {
  const faces = [
    [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]],
    [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]],
    [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]],
    [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]],
    [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]],
    [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]],
  ];
  return faces.flatMap(([a, b, c, d]) => [...a, ...b, ...c, ...a, ...c, ...d]);
}

// A GLB file of some boxes, a thing each, and of empty things with names, such as the one a seat is marked by.
export function glbOf(boxes: MadeBox[], empties: { name: string; at: [number, number, number]; rotation?: number[] }[] = [], extra: Record<string, unknown> = {}): ArrayBuffer {
  const runs = boxes.map((box) => new Float32Array(boxTriangles(box)));
  const bin = new Uint8Array(runs.reduce((sum, run) => sum + run.byteLength, 0));
  let offset = 0;
  const bufferViews = runs.map((run) => {
    bin.set(new Uint8Array(run.buffer), offset);
    const view = { buffer: 0, byteOffset: offset, byteLength: run.byteLength };
    offset += run.byteLength;
    return view;
  });
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [...boxes.map((_, i) => i), ...empties.map((_, i) => boxes.length + i)] }],
    nodes: [...boxes.map((_, mesh) => ({ mesh, name: `box ${mesh}` })), ...empties.map(({ name, at, rotation }) => ({ name, translation: at, ...(rotation && { rotation }) }))],
    meshes: boxes.map((_, i) => ({ primitives: [{ attributes: { POSITION: i }, material: i }] })),
    materials: boxes.map(({ colour }) => ({ pbrMetallicRoughness: { baseColorFactor: [...colour, 1] } })),
    accessors: runs.map((run, bufferView) => ({ bufferView, componentType: 5126, count: run.length / 3, type: 'VEC3' })),
    bufferViews,
    buffers: [{ byteLength: bin.byteLength }],
    ...extra,
  };
  return glbFile(json, bin);
}

// A GLB file of a description and the numbers it speaks of.
export function glbFile(json: unknown, bin: Uint8Array): ArrayBuffer {
  let text = JSON.stringify(json);
  text += ' '.repeat((4 - (text.length % 4)) % 4);
  const words = new TextEncoder().encode(text);
  const file = new Uint8Array(12 + 8 + words.byteLength + 8 + bin.byteLength);
  const view = new DataView(file.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, file.byteLength, true);
  view.setUint32(12, words.byteLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  file.set(words, 20);
  view.setUint32(20 + words.byteLength, bin.byteLength, true);
  view.setUint32(24 + words.byteLength, 0x004e4942, true);
  file.set(bin, 28 + words.byteLength);
  return file.buffer;
}

// A MagicaVoxel file of some cubes: where each is, and which of the file's colours it is, from 1.
export function voxOf(size: [number, number, number], cubes: [x: number, y: number, z: number, colour: number][], colours: [number, number, number][]): ArrayBuffer {
  const chunk = (name: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.byteLength);
    out.set(new TextEncoder().encode(name));
    new DataView(out.buffer).setUint32(4, body.byteLength, true);
    out.set(body, 12);
    return out;
  };
  const sized = new Uint8Array(new Uint32Array(size).buffer);
  const placed = new Uint8Array(4 + cubes.length * 4);
  new DataView(placed.buffer).setUint32(0, cubes.length, true);
  cubes.forEach((cube, i) => placed.set(cube, 4 + i * 4));
  const palette = new Uint8Array(1024);
  colours.forEach(([r, g, b], i) => palette.set([r, g, b, 255], i * 4));
  const chunks = [chunk('SIZE', sized), chunk('XYZI', placed), chunk('RGBA', palette)];
  const under = chunks.reduce((sum, one) => sum + one.byteLength, 0);
  const file = new Uint8Array(20 + under);
  file.set(new TextEncoder().encode('VOX '));
  const view = new DataView(file.buffer);
  view.setUint32(4, 150, true);
  file.set(new TextEncoder().encode('MAIN'), 8);
  view.setUint32(16, under, true);
  let offset = 20;
  for (const one of chunks) {
    file.set(one, offset);
    offset += one.byteLength;
  }
  return file.buffer;
}

// A chair and a table as someone would make them in Blender, in metres: a seat 45cm
// up on four legs with a back, and a top 75cm up on four legs.
const OAK: [number, number, number] = [0.4, 0.26, 0.13];
const CLOTH: [number, number, number] = [0.1, 0.25, 0.6];
const leg = (x: number, z: number, high: number, colour: [number, number, number]): MadeBox => ({ low: [x, 0, z], high: [x + 0.05, high, z + 0.05], colour });
export const CHAIR: MadeBox[] = [
  ...[0, 0.4].flatMap((x) => [0, 0.4].map((z) => leg(x, z, 0.4, OAK))),
  { low: [0, 0.4, 0], high: [0.45, 0.45, 0.45], colour: CLOTH },
  { low: [0, 0.45, 0], high: [0.45, 0.95, 0.05], colour: CLOTH }, // its back, away from its front
];
export const TABLE: MadeBox[] = [
  ...[0, 1.35].flatMap((x) => [0, 0.65].map((z) => leg(x, z, 0.7, [0.05, 0.05, 0.05]))),
  { low: [0, 0.7, 0], high: [1.4, 0.75, 0.7], colour: OAK },
];
