#!/usr/bin/env node
/**
 * Generates the extension icons.
 *
 * Written as a tiny PNG encoder on top of Node's built-in zlib so the repo
 * stays dependency-free -- `npm install` is not required to build the icons,
 * and there are no binary blobs in version control that nobody can regenerate.
 *
 *   node tools/make-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* -------------------------------------------------------------------------- *
 * Minimal PNG encoder (8-bit RGBA, no interlacing)
 * -------------------------------------------------------------------------- */

const CRC_TABLE = (function buildCrcTable() {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: RGBA
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace

  // Each scanline is prefixed with filter type 0 (None).
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* -------------------------------------------------------------------------- *
 * Geometry
 * -------------------------------------------------------------------------- */

/** Signed coverage test for a rounded square centred in the canvas. */
function insideRoundedSquare(x, y, size, radius) {
  const inset = size * 0.04;
  const min = inset;
  const max = size - inset;

  if (x < min || x > max || y < min || y > max) return false;

  const nearLeft = x < min + radius;
  const nearRight = x > max - radius;
  const nearTop = y < min + radius;
  const nearBottom = y > max - radius;

  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const cx = nearLeft ? min + radius : max - radius;
    const cy = nearTop ? min + radius : max - radius;
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
  }
  return true;
}

function insidePolygon(x, y, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function insideRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

function insideRing(x, y, cx, cy, outer, inner) {
  const d2 = (x - cx) ** 2 + (y - cy) ** 2;
  return d2 <= outer * outer && d2 >= inner * inner;
}

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/* -------------------------------------------------------------------------- *
 * The CUNY wordmark
 *
 * "CU" over "NY" in a heavy geometric grotesque, drawn as coverage tests
 * rather than font glyphs so that this script keeps its one useful property:
 * it runs on a bare checkout with no npm install and no binary blobs.
 *
 * The letters sit tighter here than in the official square lockup, which
 * carries far more air around the mark. At 16px that air turns the whole
 * thing to mush, so the wordmark is scaled up to stay readable in a toolbar.
 * -------------------------------------------------------------------------- */

/** C -- a ring with a horizontal slot cut out of its right side. */
function insideC(x, y, x0, y0, side, stroke) {
  const cx = x0 + side / 2;
  const cy = y0 + side / 2;
  if (!insideRing(x, y, cx, cy, side / 2, side / 2 - stroke)) return false;
  const mouth = x >= cx && Math.abs(y - cy) <= side * 0.17;
  return !mouth;
}

/** U -- two stems closed by a half-bowl. */
function insideU(x, y, x0, y0, side, stroke) {
  const radius = side / 2;
  const bowlY = y0 + side - radius;
  if (insideRect(x, y, x0, y0, x0 + stroke, bowlY)) return true;
  if (insideRect(x, y, x0 + side - stroke, y0, x0 + side, bowlY)) return true;
  return y >= bowlY &&
    insideRing(x, y, x0 + radius, bowlY, radius, radius - stroke);
}

/** N -- two stems bridged by a diagonal. */
function insideN(x, y, x0, y0, side, stroke) {
  if (insideRect(x, y, x0, y0, x0 + stroke, y0 + side)) return true;
  if (insideRect(x, y, x0 + side - stroke, y0, x0 + side, y0 + side)) return true;
  // Slanted strokes need extra horizontal width to read as heavy as the stems.
  const wide = stroke * 1.3;
  return insidePolygon(x, y, [
    [x0, y0],
    [x0 + wide, y0],
    [x0 + side, y0 + side],
    [x0 + side - wide, y0 + side],
  ]);
}

/** Y -- two arms meeting above a stem. */
function insideY(x, y, x0, y0, side, stroke) {
  const cx = x0 + side / 2;
  const joint = y0 + side * 0.54;
  const wide = stroke * 1.25;

  if (insideRect(x, y, cx - stroke / 2, joint, cx + stroke / 2, y0 + side)) return true;
  if (insidePolygon(x, y, [
    [x0, y0],
    [x0 + wide, y0],
    [cx + stroke / 2, joint],
    [cx - stroke / 2, joint],
  ])) {
    return true;
  }
  return insidePolygon(x, y, [
    [x0 + side - wide, y0],
    [x0 + side, y0],
    [cx + stroke / 2, joint],
    [cx - stroke / 2, joint],
  ]);
}

/** True when the point falls on one of the four white letters. */
function insideWordmark(x, y, size) {
  const cell = size * 0.315;      // one glyph, square
  const stroke = cell * 0.32;
  const columnGap = size * 0.015;
  const rowGap = size * 0.01;

  const left = (size - (cell * 2 + columnGap)) / 2;
  const top = (size - (cell * 2 + rowGap)) / 2;
  const right = left + cell + columnGap;
  const bottom = top + cell + rowGap;

  if (x < left || x > left + cell * 2 + columnGap) return false;

  if (y <= bottom) {
    return x <= right
      ? insideC(x, y, left, top, cell, stroke)
      : insideU(x, y, right, top, cell, stroke);
  }
  return x <= right
    ? insideN(x, y, left, bottom, cell, stroke)
    : insideY(x, y, right, bottom, cell, stroke);
}

/* -------------------------------------------------------------------------- *
 * Rendering
 * -------------------------------------------------------------------------- */

/** CUNY Blue, #0033A1, straight off the university identity palette. */
const CUNY_BLUE = [0, 51, 161];
const LETTER_COLOR = [255, 255, 255];

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.14;

  // Supersampling keeps the small sizes from looking ragged; the letterforms
  // need more of it than the old star did.
  const samples = size <= 32 ? 6 : 4;
  const step = 1 / samples;
  const offset = step / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgHits = 0;
      let letterHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + offset + sx * step;
          const py = y + offset + sy * step;
          if (insideRoundedSquare(px, py, size, radius)) {
            bgHits += 1;
            if (insideWordmark(px, py, size)) letterHits += 1;
          }
        }
      }

      const total = samples * samples;
      const bgAlpha = bgHits / total;

      // Composite the letters over the blue, then the whole thing over
      // transparency using the rounded-square coverage as the alpha.
      const t = bgAlpha > 0 ? letterHits / total / bgAlpha : 0;
      const index = (y * size + x) * 4;
      rgba[index] = mix(CUNY_BLUE[0], LETTER_COLOR[0], t);
      rgba[index + 1] = mix(CUNY_BLUE[1], LETTER_COLOR[1], t);
      rgba[index + 2] = mix(CUNY_BLUE[2], LETTER_COLOR[2], t);
      rgba[index + 3] = Math.round(bgAlpha * 255);
    }
  }

  return encodePng(size, size, rgba);
}

function main() {
  const outputDir = path.join(__dirname, '..', 'icons');
  fs.mkdirSync(outputDir, { recursive: true });

  [16, 32, 48, 128].forEach(function (size) {
    const file = path.join(outputDir, 'icon-' + size + '.png');
    fs.writeFileSync(file, renderIcon(size));
    console.log('wrote ' + path.relative(path.join(__dirname, '..'), file));
  });
}

main();
