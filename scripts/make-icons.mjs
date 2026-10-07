/**
 * Generate the extension icons - `pnpm icons`.
 *
 * Hand-rolled rather than pulled from a dependency: it is one deflate call and
 * a CRC table, and it keeps a build-time image toolchain out of the project.
 * Shapes are defined in normalised 0..1 coordinates and supersampled 4x4, so
 * the same source renders cleanly at 16px and at 512px.
 */

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icon");
const SIZES = [16, 32, 48, 128, 512];
const SUPERSAMPLE = 4;

const BLUE = [47, 107, 216];
const WHITE = [255, 255, 255];
const FOLD = [199, 219, 252];
const LINE = [47, 107, 216];

// --- geometry ---------------------------------------------------------------

const PAGE = { x0: 0.26, y0: 0.19, x1: 0.74, y1: 0.81 };
const FOLD_SIZE = 0.17;

/** The page outline, with the top-right corner cut off for the fold. */
const PAGE_POLY = [
  [PAGE.x0, PAGE.y0],
  [PAGE.x1 - FOLD_SIZE, PAGE.y0],
  [PAGE.x1, PAGE.y0 + FOLD_SIZE],
  [PAGE.x1, PAGE.y1],
  [PAGE.x0, PAGE.y1],
];

const FOLD_POLY = [
  [PAGE.x1 - FOLD_SIZE, PAGE.y0],
  [PAGE.x1, PAGE.y0 + FOLD_SIZE],
  [PAGE.x1 - FOLD_SIZE, PAGE.y0 + FOLD_SIZE],
];

/** Text lines inside the page - only legible once the icon is big enough. */
const LINES = [0.47, 0.57, 0.67].map((y) => ({
  x0: PAGE.x0 + 0.07,
  x1: PAGE.x1 - 0.07,
  y0: y,
  y1: y + 0.045,
}));

function insideRoundedRect(x, y, radius) {
  if (x < 0 || x > 1 || y < 0 || y > 1) return false;
  const cx = Math.min(Math.max(x, radius), 1 - radius);
  const cy = Math.min(Math.max(y, radius), 1 - radius);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function insidePolygon(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const straddles = yi > y !== yj > y;
    if (straddles && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideRect(x, y, r) {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

/** Topmost opaque colour at a point, or null for transparent. */
function colourAt(x, y, showLines) {
  if (showLines) {
    for (const line of LINES) {
      if (insideRect(x, y, line) && insidePolygon(x, y, PAGE_POLY)) return LINE;
    }
  }
  if (insidePolygon(x, y, FOLD_POLY)) return FOLD;
  if (insidePolygon(x, y, PAGE_POLY)) return WHITE;
  if (insideRoundedRect(x, y, 0.22)) return BLUE;
  return null;
}

function render(size) {
  const showLines = size >= 48;
  const rgba = Buffer.alloc(size * size * 4);
  const step = 1 / (size * SUPERSAMPLE);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hits = 0;

      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px * SUPERSAMPLE + sx + 0.5) * step;
          const y = (py * SUPERSAMPLE + sy + 0.5) * step;
          const colour = colourAt(x, y, showLines);
          if (!colour) continue;
          r += colour[0];
          g += colour[1];
          b += colour[2];
          hits++;
        }
      }

      const samples = SUPERSAMPLE * SUPERSAMPLE;
      const offset = (py * size + px) * 4;
      if (hits === 0) continue;
      // Premultiplication is not wanted here; PNG stores straight alpha.
      rgba[offset] = Math.round(r / hits);
      rgba[offset + 1] = Math.round(g / hits);
      rgba[offset + 2] = Math.round(b / hits);
      rgba[offset + 3] = Math.round((hits / samples) * 255);
    }
  }
  return rgba;
}

// --- PNG container ----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function toPng(rgba, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  // One filter byte (0 = None) per scanline.
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `${size}.png`);
  writeFileSync(file, toPng(render(size), size));
  console.log(`wrote icon/${size}.png`);
}
