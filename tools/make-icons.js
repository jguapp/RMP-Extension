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
  const inset = size * 0.055;
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

/** Vertices of a five-pointed star, outer point up. */
function starPolygon(cx, cy, outerRadius) {
  const innerRadius = outerRadius * 0.4;
  const points = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
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

function mix(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/* -------------------------------------------------------------------------- *
 * Rendering
 * -------------------------------------------------------------------------- */

const TOP_COLOR = [37, 99, 235];    // indigo-blue
const BOTTOM_COLOR = [13, 148, 136]; // teal
const STAR_COLOR = [255, 255, 255];

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const radius = size * 0.22;
  const star = starPolygon(size / 2, size * 0.495, size * 0.31);

  // 4x4 supersampling keeps the small sizes from looking ragged.
  const samples = size <= 32 ? 4 : 3;
  const step = 1 / samples;
  const offset = step / 2;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgHits = 0;
      let starHits = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = x + offset + sx * step;
          const py = y + offset + sy * step;
          if (insideRoundedSquare(px, py, size, radius)) {
            bgHits += 1;
            if (insidePolygon(px, py, star)) starHits += 1;
          }
        }
      }

      const total = samples * samples;
      const bgAlpha = bgHits / total;
      const starAlpha = starHits / total;

      const gradient = y / Math.max(1, size - 1);
      const base = [
        mix(TOP_COLOR[0], BOTTOM_COLOR[0], gradient),
        mix(TOP_COLOR[1], BOTTOM_COLOR[1], gradient),
        mix(TOP_COLOR[2], BOTTOM_COLOR[2], gradient),
      ];

      // Composite the star over the gradient, then the whole thing over
      // transparency using the rounded-square coverage as the alpha.
      const t = bgAlpha > 0 ? starAlpha / bgAlpha : 0;
      const index = (y * size + x) * 4;
      rgba[index] = mix(base[0], STAR_COLOR[0], t);
      rgba[index + 1] = mix(base[1], STAR_COLOR[1], t);
      rgba[index + 2] = mix(base[2], STAR_COLOR[2], t);
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
