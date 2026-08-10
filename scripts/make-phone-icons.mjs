/**
 * Generates the phone app's PNG icons with no image dependencies at all —
 * just zlib, which ships with Node. Run it only when the mark changes:
 *
 *   node scripts/make-phone-icons.mjs
 *
 * The generated PNGs are committed, so building and publishing the phone app
 * never depends on regenerating them.
 *
 * The mark: a gold ring (the "zero") with a gold dot at its centre (the
 * "point"), on the studio's dark navy. Same colours the app already uses.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'phone', 'public')

const BG = [0x0b, 0x0f, 0x1a] // #0b0f1a — studio background
const GOLD = [0xe8, 0xb9, 0x23] // #e8b923 — studio accent

/** PNG chunk: length + type + data + CRC32. */
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([len, body, crc])
}

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return c ^ 0xffffffff
}

/**
 * @param size    pixel width/height
 * @param inset   fraction of the canvas left as padding around the mark
 *                (maskable icons need a generous safe zone, plain ones don't)
 * @param bgRound true to fill only a rounded square, false to fill the whole canvas
 */
function renderIcon(size, inset, bgRound) {
  const rows = []
  const cx = (size - 1) / 2
  const cy = (size - 1) / 2

  const markRadius = (size / 2) * (1 - inset)
  const ringOuter = markRadius
  const ringInner = markRadius * 0.72
  const dotRadius = markRadius * 0.2
  const corner = size * 0.22

  // 4x supersampling — cheap here, and it removes the jaggies that make a
  // hand-rolled icon look amateurish next to real app icons.
  const S = 4

  for (let y = 0; y < size; y++) {
    // Filter byte 0 (None) at the start of every scanline.
    const row = Buffer.alloc(1 + size * 3)
    for (let x = 0; x < size; x++) {
      let goldHits = 0
      let bgHits = 0
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const px = x + (sx + 0.5) / S
          const py = y + (sy + 0.5) / S
          const d = Math.hypot(px - cx, py - cy)
          const inRing = d <= ringOuter && d >= ringInner
          const inDot = d <= dotRadius
          if (inRing || inDot) goldHits++
          if (!bgRound || insideRoundedSquare(px, py, size, corner)) bgHits++
        }
      }
      const total = S * S
      const gold = goldHits / total
      const bgA = bgHits / total
      // Composite gold over the (possibly rounded) background, over black.
      for (let c = 0; c < 3; c++) {
        const base = BG[c] * bgA
        row[1 + x * 3 + c] = Math.round(base * (1 - gold) + GOLD[c] * gold)
      }
    }
    rows.push(row)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // 8 bits per channel
  ihdr[9] = 2 // colour type 2 = truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function insideRoundedSquare(px, py, size, r) {
  const x = Math.min(px, size - px)
  const y = Math.min(py, size - py)
  if (x >= r || y >= r) return px >= 0 && py >= 0 && px <= size && py <= size
  return Math.hypot(r - x, r - y) <= r
}

const targets = [
  // Plain icons: full-bleed dark background, comfortable ring.
  ['icon-192.png', 192, 0.24, false],
  ['icon-512.png', 512, 0.24, false],
  // Maskable: Android may crop to a circle, so keep the mark well inside the
  // 80% safe zone and let the platform round the corners.
  ['icon-maskable-512.png', 512, 0.36, false]
]

for (const [name, size, inset, round] of targets) {
  writeFileSync(join(OUT, name), renderIcon(size, inset, round))
  console.log(`wrote phone/public/${name} (${size}x${size})`)
}
