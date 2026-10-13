import { z } from 'zod';
import { CELL } from './constants';
import { FLOOR_KINDS, type FloorKind } from './pieces';
import { onWall, type Room } from './room';

// Furniture that was made in a 3D tool and brought in. It was turned into coloured
// boxes once, when it was imported (src/import), and that list of boxes is all that
// is kept of it. From here on it is a kind of piece like the ones written in code:
// the same pen draws it, at the same hours, and the room moves and turns it the same.

// How much one model may be. A room is at most 196 across; a wall is 30 high.
export const LIMITS = { floor: 64, high: 40, boxes: 400, colours: 8, seats: 8 } as const;

const colour = z.string().regex(/^#[0-9a-f]{6}$/i);
const within = (most: number) => z.number().min(0).max(most);
const side = z.number().positive().max(LIMITS.floor).multipleOf(CELL);

export const ModelSchema = z
  .object({
    // never the name of a kind written in code, nor of anything every object has
    id: z.string().regex(/^own-[a-z0-9]{4,24}$/),
    name: z.string().trim().min(1).max(40),
    box: z.tuple([side, side]), // the floor it takes up: whole cells, so what is in the way matches what is drawn
    high: z.number().positive().max(LIMITS.high),
    colours: z.array(colour).min(1).max(LIMITS.colours * 2),
    // each a box of one colour, in the piece's own coordinates: x, y, z, how wide, deep and high, which colour
    boxes: z
      .array(z.tuple([within(LIMITS.floor), within(LIMITS.floor), within(LIMITS.high), z.number().positive(), z.number().positive(), z.number().positive(), z.number().int().min(0)]))
      .min(1)
      .max(LIMITS.boxes),
    flat: z.boolean(), // lies on the floor like a rug, in nobody's way
    top: within(LIMITS.high).optional(), // how high its top is, if a laptop can stand on it
    seats: z.array(z.object({ x: within(LIMITS.floor), y: within(LIMITS.floor), z: within(LIMITS.high), dir: z.enum(['N', 'E', 'S', 'W']) })).max(LIMITS.seats),
  })
  .refine(({ box, high, colours, boxes, seats }) => {
    const inside = boxes.every(([x, y, z0, w, d, h, c]) => x + w <= box[0] && y + d <= box[1] && z0 + h <= high && c < colours.length);
    return inside && seats.every((seat) => seat.x <= box[0] && seat.y <= box[1] && seat.z <= high);
  }, 'Something of it is outside its own box.');

export type Model = z.infer<typeof ModelSchema>;

// The kind of piece a model is.
export function kindOf(model: Model): FloorKind {
  return {
    name: model.name,
    box: () => model.box,
    ...(model.flat && { blocks: [] }),
    ...(model.top !== undefined && { top: model.top }),
    sits: model.seats,
    draw(p) {
      for (const [x, y, z0, w, d, h, c] of model.boxes) p.box(x, y, z0, w, d, h, model.colours[c]);
    },
  };
}

const models = new Map<string, Model>();

export const modelOf = (kind: string): Model | undefined => models.get(kind);
export const listModels = (): Model[] => [...models.values()];
// the models a room has pieces of
export const modelsIn = (room: Room): Model[] => listModels().filter((model) => room.pieces.some((piece) => !onWall(piece) && piece.kind === model.id));

// Takes a model in as a kind of piece, in place of any there was by its name.
export function addModel(model: Model) {
  models.set(model.id, model);
  FLOOR_KINDS[model.id] = kindOf(model);
}

// A model is forgotten; pieces of it are then of a kind nobody knows, and are left out.
export function dropModel(id: string) {
  if (models.delete(id)) delete FLOOR_KINDS[id];
}

const STORE = 'agent-office-models';
const VERSION = 1;

// The models that were brought in before, taken in again. One that is not sound is left behind.
export function loadModels() {
  for (const id of [...models.keys()]) dropModel(id);
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? 'null');
    if (saved?.version !== VERSION || !Array.isArray(saved.models)) return;
    for (const given of saved.models) {
      const model = ModelSchema.safeParse(given);
      if (model.success) addModel(model.data);
    }
  } catch {
    // nothing saved, or storage is off
  }
}

export function saveModels() {
  try {
    localStorage.setItem(STORE, JSON.stringify({ version: VERSION, models: listModels() }));
  } catch {
    // storage is off, or full; the models are there until the app is closed
  }
}
