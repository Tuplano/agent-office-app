import { Refusal, type Voxels, voxelsOf } from './voxels';

// A MagicaVoxel file: a box of cubes, each one of 255 colours. Its cubes become
// the room's cubes one for one, and its colours a handful. In MagicaVoxel z is up and the front of a model
// looks toward the low end of y, so y is turned about for the front to face south.
export function readVox(bytes: ArrayBuffer): Voxels {
  const data = new DataView(bytes);
  const word = (offset: number) => String.fromCharCode(data.getUint8(offset), data.getUint8(offset + 1), data.getUint8(offset + 2), data.getUint8(offset + 3));
  if (bytes.byteLength < 20 || word(0) !== 'VOX ' || word(8) !== 'MAIN') throw new Refusal('It is not a MagicaVoxel file.');
  let size: [number, number, number] | null = null;
  let cubes: Uint8Array | null = null;
  let palette: Uint8Array | null = null;
  // the chunks inside MAIN, one after another: a name, how long it is, how long what hangs under it is
  for (let offset = 20; offset + 12 <= bytes.byteLength; ) {
    const [name, long, under] = [word(offset), data.getUint32(offset + 4, true), data.getUint32(offset + 8, true)];
    const from = offset + 12;
    if (from + long > bytes.byteLength) break;
    if (name === 'SIZE' && !size && long >= 12) size = [data.getUint32(from, true), data.getUint32(from + 4, true), data.getUint32(from + 8, true)];
    // only the first model of a file that holds several
    else if (name === 'XYZI' && !cubes && long >= 4) cubes = new Uint8Array(bytes, from + 4, Math.min(data.getUint32(from, true), Math.floor((long - 4) / 4)) * 4);
    else if (name === 'RGBA' && long >= 1024) palette = new Uint8Array(bytes, from, 1024);
    offset = from + long + under;
  }
  if (!size || !cubes || !cubes.length) throw new Refusal('There is nothing in it to draw.');
  const [nx, ny, nz] = size;
  if (![nx, ny, nz].every((n) => n >= 1 && n <= 256)) throw new Refusal('It is not a MagicaVoxel file.');

  const filled = new Map<number, number>();
  for (let i = 0; i < cubes.length; i += 4) {
    const [x, y, z, c] = [cubes[i], cubes[i + 1], cubes[i + 2], cubes[i + 3]];
    if (x >= nx || y >= ny || z >= nz || !c) continue;
    // colour 1 is the first in the file's list; a file with no list gets greys
    const [r, g, b] = palette ? [palette[(c - 1) * 4], palette[(c - 1) * 4 + 1], palette[(c - 1) * 4 + 2]] : [c, c, c];
    filled.set((z * ny + (ny - 1 - y)) * nx + x, (r << 16) | (g << 8) | b);
  }
  if (!filled.size) throw new Refusal('There is nothing in it to draw.');
  return voxelsOf(nx, ny, nz, filled);
}
