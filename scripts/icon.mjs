// Draws the app icon: one office worker, head and shoulders, on a 32 x 32 grid of
// big pixels, written as a 1024 x 1024 PNG (src-tauri/app-icon.png). Needs Node 22.2
// or later for zlib.crc32. The colours are the app's, from src/engine/palette.ts.
// The tray paints an orange dot over the bottom right, so nothing is drawn there
// beyond the flat shirt.
//
//   node scripts/icon.mjs && npm run tauri icon src-tauri/app-icon.png

import { writeFileSync } from "node:fs";
import { crc32, deflateSync } from "node:zlib";

const GRID = 32;
const SIZE = 1024;
const CELL = SIZE / GRID;

const OAK_LIGHT = "#dcc096"; // the background
const COBALT = "#4267e8"; // the shirt
const SKIN = "#f2c9a0";
const SKIN_SHADE = "#d9a57a"; // the neck
const HAIR = "#3b2f2f";
const INK = "#252525"; // the eyes

const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));

// one entry per cell: [r, g, b, a]
const cells = Array.from({ length: GRID * GRID }, () => [...rgb(OAK_LIGHT), 255]);

// both corners inclusive
function rect(x0, y0, x1, y1, hex) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) cells[y * GRID + x] = [...rgb(hex), 255];
  }
}

// shirt: narrow at the shoulders' top, wide below, down to the bottom edge
rect(7, 18, 22, 19, COBALT);
rect(5, 20, 24, 21, COBALT);
rect(3, 22, 26, 31, COBALT);
// neck
rect(13, 16, 16, 18, SKIN_SHADE);
// head
rect(9, 4, 20, 15, SKIN);
// hair: the top, a fringe, and down both sides
rect(9, 4, 20, 7, HAIR);
rect(9, 8, 10, 10, HAIR);
rect(19, 8, 20, 10, HAIR);
// eyes, one cell wide and two tall like the workers' in the room
rect(12, 9, 12, 10, INK);
rect(17, 9, 17, 10, INK);

// the corners are cut away
const CUT = 3;
for (let y = 0; y < GRID; y++) {
  for (let x = 0; x < GRID; x++) {
    const dx = Math.min(x, GRID - 1 - x);
    const dy = Math.min(y, GRID - 1 - y);
    if (dx + dy < CUT - 1) cells[y * GRID + x][3] = 0;
  }
}

// scaled up with hard edges
const row = Buffer.alloc(1 + SIZE * 4);
const raw = Buffer.alloc(SIZE * row.length);
for (let y = 0; y < SIZE; y++) {
  const gy = Math.floor(y / CELL);
  for (let x = 0; x < SIZE; x++) {
    row.set(cells[gy * GRID + Math.floor(x / CELL)], 1 + x * 4);
  }
  row.copy(raw, y * row.length);
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const header = Buffer.alloc(13);
header.writeUInt32BE(SIZE, 0);
header.writeUInt32BE(SIZE, 4);
header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA

writeFileSync(
  new URL("../src-tauri/app-icon.png", import.meta.url),
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]),
);
