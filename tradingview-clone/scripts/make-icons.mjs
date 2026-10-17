// Generates the PNG app icons in public/ without any native dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex("#131722");
const GRID = hex("#1e2433");
const UP = hex("#26a69a");
const DOWN = hex("#ef5350");
const LINE = hex("#d97757");

// Candles in unit coordinates (0..1): x center, open, close, high, low (y grows downward).
const candles = [
  [0.22, 0.66, 0.56, 0.5, 0.72, DOWN],
  [0.37, 0.58, 0.46, 0.4, 0.64, UP],
  [0.52, 0.5, 0.58, 0.44, 0.66, DOWN],
  [0.67, 0.52, 0.36, 0.3, 0.57, UP],
  [0.82, 0.38, 0.24, 0.18, 0.43, UP],
];
const trend = [
  [0.14, 0.78],
  [0.9, 0.3],
];

const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};

function colorAt(x, y) {
  let c = BG;
  if (Math.abs((y * 8) % 1) < 0.012 || Math.abs((x * 8) % 1) < 0.012) c = GRID;
  for (const [cx, o, cl, hi, lo, col] of candles) {
    const top = Math.min(o, cl);
    const bottom = Math.max(o, cl);
    if (Math.abs(x - cx) < 0.012 && y >= hi && y <= lo) c = col;
    if (Math.abs(x - cx) < 0.05 && y >= top && y <= bottom) c = col;
  }
  if (segDist(x, y, trend[0], trend[1]) < 0.022) c = LINE;
  return c;
}

function png(size) {
  const ss = 3; // supersampling for smooth edges
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0;
    for (let px = 0; px < size; px++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [cr, cg, cb] = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          r += cr;
          g += cg;
          b += cb;
        }
      }
      const o = py * (size * 3 + 1) + 1 + px * 3;
      raw[o] = r / ss / ss;
      raw[o + 1] = g / ss / ss;
      raw[o + 2] = b / ss / ss;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

for (const size of [180, 192, 512]) {
  writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size));
  console.log(`public/icon-${size}.png`);
}
