// Generates the PNG app icons in public/ without any native dependencies.
// Usage: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const segDist = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - ax - t * dx, py - ay - t * dy)
}
const polyDist = (px, py, pts) => {
  let d = Infinity
  for (let i = 1; i < pts.length; i++) d = Math.min(d, segDist(px, py, pts[i - 1], pts[i]))
  return d
}
const inRoundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x1 - r, x)), cy = Math.max(y0 + r, Math.min(y1 - r, y))
  return Math.hypot(x - cx, y - cy) <= r
}

const signature = Array.from({ length: 60 }, (_, i) => {
  const t = i / 59
  return [0.3 + t * 0.42, 0.68 - Math.sin(t * Math.PI * 3) * 0.04 * (1 - t * 0.5) - t * 0.03]
})
const check = [[0.56, 0.3], [0.61, 0.35], [0.7, 0.24]]
const textLines = [0.32, 0.4, 0.48].map((y, i) => [[0.32, y], [i === 0 ? 0.5 : 0.68, y]])

function colorAt(x, y) {
  // background: diagonal red gradient
  const g = (x + y) / 2
  let c = [215 - g * 50, 38 - g * 20, 61 - g * 20]
  if (inRoundRect(x, y, 0.24, 0.16, 0.76, 0.84, 0.035)) {
    c = [255, 255, 255]
    if (textLines.some((l) => polyDist(x, y, l) < 0.012)) c = [200, 203, 210]
    if (polyDist(x, y, check) < 0.018) c = [30, 120, 60]
    if (polyDist(x, y, signature) < 0.016) c = [25, 45, 120]
  }
  return c
}

function png(size) {
  const ss = 4
  const raw = Buffer.alloc((size * 3 + 1) * size)
  for (let py = 0; py < size; py++) {
    raw[py * (size * 3 + 1)] = 0
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0]
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const c = colorAt((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
          acc[0] += c[0]; acc[1] += c[1]; acc[2] += c[2]
        }
      const o = py * (size * 3 + 1) + 1 + px * 3
      for (let k = 0; k < 3; k++) raw[o + k] = Math.round(acc[k] / (ss * ss))
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const size of [180, 192, 512]) writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png(size))
console.log('icons written')
