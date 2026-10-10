// Renders the extension icon (gradient squircle with a 2×2 tile grid) to PNGs
// at the sizes Chromium wants. Dependency-free: a tiny PNG encoder over zlib.
// Usage: node scripts/make-icons.mjs

import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const SIZES = [16, 32, 48, 128];
// Home-screen icons for the hosted site. Phones round the corners themselves,
// so these fill the whole square instead of leaving transparent corners.
const FULL_BLEED = [180, 192, 512];
const OUT = new URL('../public/icons/', import.meta.url);
const SS = 4; // supersampling factor per axis

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Signed distance to a rounded rectangle centred at (cx, cy). */
function sdRoundRect(x, y, cx, cy, hw, hh, r) {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

const A = [0x7c, 0x6c, 0xff]; // accent violet
const B = [0x22, 0xd3, 0xee]; // cyan
const lerp = (a, b, t) => a + (b - a) * t;

function sample(u, v, bleed) {
  // u, v in [0,1]. Returns [r,g,b,a] premultiplied-free.
  const body = sdRoundRect(u, v, 0.5, 0.5, 0.46, 0.46, 0.22);
  if (body > 0 && !bleed) return [0, 0, 0, 0];
  const t = Math.min(1, Math.max(0, (u + v) / 2));
  let col = [lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)];
  // 2×2 grid of white tiles; the top-left one is solid, the others translucent.
  const tiles = [
    [0.355, 0.355, 1],
    [0.645, 0.355, 0.72],
    [0.355, 0.645, 0.72],
    [0.645, 0.645, 0.72],
  ];
  for (const [cx, cy, alpha] of tiles) {
    if (sdRoundRect(u, v, cx, cy, 0.115, 0.115, 0.045) <= 0) {
      col = col.map((c) => lerp(c, 255, alpha));
    }
  }
  return [...col, 255];
}

mkdirSync(OUT, { recursive: true });
for (const size of [...SIZES, ...FULL_BLEED]) {
  const bleed = FULL_BLEED.includes(size);
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const [sr, sg, sb, sa] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size, bleed);
          r += sr * sa;
          g += sg * sa;
          b += sb * sa;
          a += sa;
        }
      }
      const i = (y * size + x) * 4;
      buf[i] = a ? Math.round(r / a) : 0;
      buf[i + 1] = a ? Math.round(g / a) : 0;
      buf[i + 2] = a ? Math.round(b / a) : 0;
      buf[i + 3] = Math.round(a / (SS * SS));
    }
  }
  writeFileSync(new URL(`icon-${size}.png`, OUT), png(size, buf));
  console.log(`icon-${size}.png`);
}
