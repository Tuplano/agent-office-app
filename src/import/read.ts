import { METRE } from '../engine/constants';
import { readVox } from './vox';
import { CUBE, Refusal, resized, type SeatMark, sizeOf, type Voxels } from './voxels';

// A model that has been read, whatever it was read from.
export interface Source {
  name: string; // what to call it to begin with, from the file's name
  size: readonly [w: number, d: number, h: number]; // how big it is as it comes, in the room's units
  // The model as blocks, at so many times the size it comes in, and where the file
  // says someone sits on it. Says no, in words, to a model it cannot make blocks of.
  blocks(by: number): { voxels: Voxels; seats: SeatMark[] };
}

// "office-chair_v2.glb" as "Office chair v2"
function nameOf(file: string): string {
  const bare = file.replace(/\.[^.]*$/, '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return bare ? bare[0].toUpperCase() + bare.slice(1) : 'Piece';
}

// Reads a model file by what its name ends in. A GLB is measured in metres, and
// comes in at the size a metre is for the people in the room. A MagicaVoxel file
// is cubes already, and comes in cube for cube. The GLB reader is fetched only now.
export async function readModel(file: string, bytes: ArrayBuffer): Promise<Source> {
  const name = nameOf(file);
  if (/\.vox$/i.test(file)) {
    const voxels = readVox(bytes);
    return { name, size: sizeOf(voxels), blocks: (by) => ({ voxels: resized(voxels, by), seats: [] }) };
  }
  if (/\.glb$/i.test(file)) {
    const [{ readGlb }, { boundsOf, voxelise }] = await Promise.all([import('./glb'), import('./mesh')]);
    const mesh = await readGlb(bytes);
    const { size } = boundsOf(mesh);
    const whole = (side: number) => Math.max(CUBE, Math.ceil((side * METRE) / CUBE - 1e-4) * CUBE);
    return { name, size: [whole(size[0]), whole(size[1]), whole(size[2])], blocks: (by) => voxelise(mesh, METRE * by) };
  }
  throw new Refusal('It is not a model that can be read here. Bring a .glb file (Blender and most other tools) or a .vox file (MagicaVoxel).');
}
