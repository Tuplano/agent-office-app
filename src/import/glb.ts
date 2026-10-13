import type { Dir } from '../engine/constants';
import type { Mesh, Part } from './mesh';
import { Refusal, type SeatMark } from './voxels';

// A picture a model is painted with, as its pixels: four numbers each, red, green, blue and how solid.
export interface Picture {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}
export type Decode = (bytes: Uint8Array, type: string) => Promise<Picture>;

// The browser's own way of opening a PNG or a JPEG.
export const decodePicture: Decode = async (bytes, type) => {
  const bitmap = await createImageBitmap(new Blob([bytes as BlobPart], { type }));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  return ctx.getImageData(0, 0, bitmap.width, bitmap.height);
};

type Matrix = number[]; // four by four, a column after another, as glTF writes them
const IDENTITY: Matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
function times(a: Matrix, b: Matrix): Matrix {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  return out;
}
// where a node is, as one matrix, whether the file gives one or a move, a turn and a size
function matrixOf(node: { matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }): Matrix {
  if (node.matrix?.length === 16) return node.matrix;
  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  return [
    (1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0,
    2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0,
    2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

const WIDTHS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
// how each kind of number is read, how many bytes it is, and what it is divided by when it stands for a share of one
const NUMBERS: Record<number, [read: (view: DataView, at: number) => number, bytes: number, whole: number]> = {
  5120: [(view, at) => view.getInt8(at), 1, 127],
  5121: [(view, at) => view.getUint8(at), 1, 255],
  5122: [(view, at) => view.getInt16(at, true), 2, 32767],
  5123: [(view, at) => view.getUint16(at, true), 2, 65535],
  5125: [(view, at) => view.getUint32(at, true), 4, 1],
  5126: [(view, at) => view.getFloat32(at, true), 4, 1],
};

const toLinear = Array.from({ length: 256 }, (_, v) => (v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4));
const toScreen = (v: number) => Math.round(255 * Math.max(0, Math.min(1, v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)));

const NOT_GLB = 'It is not a GLB file.';
const SQUEEZED = ['KHR_draco_mesh_compression', 'EXT_meshopt_compression'];

// Reads a GLB file: one file with the model's description and its numbers in it,
// which is what Blender and most other tools write. Out of it come the triangles,
// each with the colour of the material or the picture it is painted with, and
// where the file says someone sits: an empty thing whose name begins with "seat".
// A tool's up is y and its front looks along z; the room's up is z and its south
// is y, so the two change places.
export async function readGlb(bytes: ArrayBuffer, decode: Decode = decodePicture): Promise<Mesh> {
  const file = new DataView(bytes);
  if (bytes.byteLength < 20 || file.getUint32(0, true) !== 0x46546c67) throw new Refusal(NOT_GLB);
  if (file.getUint32(4, true) !== 2) throw new Refusal('It is a GLB of an old kind. Export it as glTF 2.');
  let json: any = null;
  let bin: DataView | null = null;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const [long, kind] = [file.getUint32(offset, true), file.getUint32(offset + 4, true)];
    if (offset + 8 + long > bytes.byteLength) break;
    if (kind === 0x4e4f534a && !json) json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, offset + 8, long)));
    else if (kind === 0x004e4942 && !bin) bin = new DataView(bytes, offset + 8, long);
    offset += 8 + long;
  }
  if (!json || typeof json !== 'object') throw new Refusal(NOT_GLB);
  if (SQUEEZED.some((name) => json.extensionsRequired?.includes(name))) throw new Refusal('It is compressed, which cannot be read here. Export it without compression.');
  const numbers = bin;
  const list = <T = any>(name: string): T[] => (Array.isArray(json[name]) ? json[name] : []);

  // one of the file's runs of numbers: how many there are, how many each is made of, and a way to read one
  function run(index: unknown) {
    const accessor = list('accessors')[index as number];
    const view = list('bufferViews')[accessor?.bufferView];
    const kind = NUMBERS[accessor?.componentType];
    const width = WIDTHS[accessor?.type];
    if (!accessor || !view || !kind || !width || !numbers || (view.buffer ?? 0) !== 0) return null;
    const [read, size, whole] = kind;
    const from = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
    const stride = view.byteStride || size * width;
    const count = accessor.count | 0;
    if (count < 0 || from + (count - 1) * stride + size * width > numbers.byteLength) return null;
    const share = accessor.normalized && whole !== 1;
    return { count, width, get: (n: number, k: number) => (share ? Math.max(read(numbers, from + n * stride + k * size) / whole, -1) : read(numbers, from + n * stride + k * size)) };
  }

  const pictures = new Map<number, Promise<Picture | null>>();
  function picture(index: number): Promise<Picture | null> {
    let opened = pictures.get(index);
    if (!opened) {
      const image = list('images')[index];
      const view = list('bufferViews')[image?.bufferView];
      const within = view && numbers && (view.byteOffset ?? 0) + view.byteLength <= numbers.byteLength;
      // a picture that cannot be opened is done without: the thing has its material's plain colour
      opened = within ? decode(new Uint8Array(numbers.buffer, numbers.byteOffset + (view.byteOffset ?? 0), view.byteLength), image.mimeType ?? 'image/png').catch(() => null) : Promise.resolve(null);
      pictures.set(index, opened);
    }
    return opened;
  }

  const parts: Part[] = [];
  const seats: SeatMark[] = [];
  let triangles = 0;

  async function partOf(primitive: any, world: Matrix): Promise<Part | null> {
    if ((primitive.mode ?? 4) !== 4) return null; // points and lines are not things
    const places = run(primitive.attributes?.POSITION);
    if (!places || places.width !== 3) return null;
    const order = primitive.indices === undefined ? null : run(primitive.indices);
    const count = Math.floor((order ? order.count : places.count) / 3);
    triangles += count;
    if (triangles > 400000) throw new Refusal('It has too many triangles. Bring a simpler model.');
    const corner = (n: number) => (order ? order.get(n, 0) : n);
    const positions = new Float32Array(count * 9);
    for (let n = 0; n < count * 3; n++) {
      const i = corner(n);
      if (i >= places.count) return null;
      const [x, y, z] = [places.get(i, 0), places.get(i, 1), places.get(i, 2)];
      positions[n * 3] = world[0] * x + world[4] * y + world[8] * z + world[12];
      positions[n * 3 + 1] = world[2] * x + world[6] * y + world[10] * z + world[14]; // the tool's z is the room's y
      positions[n * 3 + 2] = world[1] * x + world[5] * y + world[9] * z + world[13]; // and its y is up
    }

    const material = list('materials')[primitive.material] ?? {};
    const gloss = material.extensions?.KHR_materials_pbrSpecularGlossiness;
    const paint = material.pbrMetallicRoughness ?? {};
    const [fr, fg, fb, fa]: number[] = paint.baseColorFactor ?? gloss?.diffuseFactor ?? [1, 1, 1, 1];
    const clear = material.alphaMode === 'MASK' || material.alphaMode === 'BLEND';
    const cutoff = material.alphaMode === 'MASK' ? (material.alphaCutoff ?? 0.5) : 0.5;
    const painted = paint.baseColorTexture ?? gloss?.diffuseTexture;
    const source = painted ? list('textures')[painted.index]?.source : undefined;
    const image = typeof source === 'number' ? await picture(source) : null;
    const across = image ? run(primitive.attributes?.[`TEXCOORD_${painted.texCoord ?? 0}`]) : null;
    const dyed = run(primitive.attributes?.COLOR_0);
    const pack = (r: number, g: number, b: number) => (toScreen(r) << 16) | (toScreen(g) << 8) | toScreen(b);

    if (!(image && across) && !dyed) {
      const plain = clear && fa < cutoff ? -1 : pack(fr, fg, fb);
      return { positions, colour: () => plain };
    }
    return {
      positions,
      colour(triangle, a, b, c) {
        const [i, j, k] = [corner(triangle * 3), corner(triangle * 3 + 1), corner(triangle * 3 + 2)];
        const mix = (from: { get(n: number, at: number): number }, at: number) => from.get(i, at) * a + from.get(j, at) * b + from.get(k, at) * c;
        let [r, g, bl, solid] = [fr, fg, fb, fa];
        if (dyed) {
          r *= mix(dyed, 0);
          g *= mix(dyed, 1);
          bl *= mix(dyed, 2);
          if (dyed.width === 4) solid *= mix(dyed, 3);
        }
        if (image && across) {
          // the picture is laid over and over, and the nearest of its pixels is the colour
          const [u, v] = [mix(across, 0), mix(across, 1)];
          const px = Math.min(image.width - 1, Math.floor((u - Math.floor(u)) * image.width));
          const py = Math.min(image.height - 1, Math.floor((v - Math.floor(v)) * image.height));
          const at = (py * image.width + px) * 4;
          r *= toLinear[image.data[at]];
          g *= toLinear[image.data[at + 1]];
          bl *= toLinear[image.data[at + 2]];
          solid *= image.data[at + 3] / 255;
        }
        return clear && solid < cutoff ? -1 : pack(r, g, bl);
      },
    };
  }

  // down through the things of the scene, each placed by all that it hangs under
  const nodes = list('nodes');
  const seen = new Set<number>();
  async function walk(index: number, parent: Matrix): Promise<void> {
    const node = nodes[index];
    if (!node || seen.has(index)) return;
    seen.add(index);
    const world = times(parent, matrixOf(node));
    const mesh = list('meshes')[node.mesh];
    if (mesh) {
      for (const primitive of Array.isArray(mesh.primitives) ? mesh.primitives : []) {
        const part = await partOf(primitive, world);
        if (part?.positions.length) parts.push(part);
      }
    } else if (typeof node.name === 'string' && /^seat/i.test(node.name)) {
      // the way its own z looks is the way the sitter looks
      const [fx, fy] = [world[8], world[10]];
      const dir: Dir = Math.abs(fx) > Math.abs(fy) ? (fx > 0 ? 'E' : 'W') : fy >= 0 ? 'S' : 'N';
      seats.push({ x: world[12], y: world[14], z: world[13], dir });
    }
    for (const child of Array.isArray(node.children) ? node.children : []) await walk(child, world);
  }
  const scene = list('scenes')[json.scene ?? 0];
  // with no scene to say, everything that hangs under nothing
  const hung = new Set(nodes.flatMap((node) => (Array.isArray(node?.children) ? node.children : [])));
  const roots: number[] = Array.isArray(scene?.nodes) ? scene.nodes : nodes.map((_, index) => index).filter((index) => !hung.has(index));
  for (const root of roots) await walk(root, IDENTITY);
  if (!parts.length) throw new Refusal('There is nothing in it to draw.');
  return { parts, seats };
}
