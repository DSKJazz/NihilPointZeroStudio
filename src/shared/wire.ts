/**
 * The wire format between the studio UI and the PC when the UI is running in a phone
 * browser instead of inside Electron.
 *
 * WHY THIS IS NEEDED
 * Inside the app, the UI and the PC exchange values over Electron's IPC, which uses
 * the structured-clone algorithm: it carries byte arrays and dates through unchanged.
 * Over the network the same values have to travel as JSON, and JSON has neither —
 * a Uint8Array turns into `{"0":72,"1":105,...}` and a Date into a bare string.
 *
 * That is not a theoretical problem. Dictation sends recorded audio as a Uint8Array;
 * without this, the PC would receive an object with a hundred thousand numeric keys
 * and the transcription would fail with something unhelpful.
 *
 * So both ends run THIS file — literally the same code — to pack those two types into
 * plain JSON on the way out and unpack them on the way in. Everything else passes
 * through untouched.
 */

/**
 * Marker keys. Deliberately ugly and app-specific: an object that happens to contain
 * a key called `data` is common, one containing `__npzBin` is not.
 */
const BIN = '__npzBin'
const DATE = '__npzDate'

/** Deep structures are capped so a cyclic value fails fast instead of hanging. */
const MAX_DEPTH = 64

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/**
 * Base64, written out by hand rather than using `Buffer` (Node only) or `btoa`
 * (browser only, and it mangles bytes above 127). One implementation, both ends,
 * no surprises.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const out: string[] = []
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0
    const n = (a << 16) | (b << 8) | c
    out.push(
      B64[(n >> 18) & 63],
      B64[(n >> 12) & 63],
      i + 1 < bytes.length ? B64[(n >> 6) & 63] : '=',
      i + 2 < bytes.length ? B64[n & 63] : '='
    )
  }
  return out.join('')
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '')
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4))
  let p = 0
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((i + 2 < clean.length ? B64.indexOf(clean[i + 2]) : 0) << 6) |
      (i + 3 < clean.length ? B64.indexOf(clean[i + 3]) : 0)
    if (p < bytes.length) bytes[p++] = (n >> 16) & 255
    if (p < bytes.length) bytes[p++] = (n >> 8) & 255
    if (p < bytes.length) bytes[p++] = n & 255
  }
  return bytes
}

function isBytes(value: unknown): value is Uint8Array {
  // `instanceof Uint8Array` is not enough: Node's Buffer is a Uint8Array subclass, and
  // a value that crossed a realm boundary fails instanceof entirely.
  return (
    ArrayBuffer.isView(value) &&
    !(value instanceof DataView) &&
    (value as { BYTES_PER_ELEMENT?: number }).BYTES_PER_ELEMENT === 1
  )
}

/** Packs a value for JSON. Byte arrays and dates get a marker; nothing else changes. */
export function encodeWire(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error('That value is nested too deeply to send.')
  if (value === null || typeof value !== 'object') return value
  if (isBytes(value)) {
    const v = value as unknown as Uint8Array
    return { [BIN]: bytesToBase64(new Uint8Array(v.buffer, v.byteOffset, v.byteLength)) }
  }
  if (value instanceof ArrayBuffer) return { [BIN]: bytesToBase64(new Uint8Array(value)) }
  if (value instanceof Date) return { [DATE]: value.toISOString() }
  if (Array.isArray(value)) return value.map((v) => encodeWire(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (v === undefined) continue // JSON drops these anyway; be explicit about it
    out[k] = encodeWire(v, depth + 1)
  }
  return out
}

/** Undoes encodeWire(). */
export function decodeWire(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) throw new Error('That value is nested too deeply to read.')
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => decodeWire(v, depth + 1))
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj)
  if (keys.length === 1 && typeof obj[BIN] === 'string') return base64ToBytes(obj[BIN] as string)
  if (keys.length === 1 && typeof obj[DATE] === 'string') return new Date(obj[DATE] as string)
  const out: Record<string, unknown> = {}
  for (const k of keys) out[k] = decodeWire(obj[k], depth + 1)
  return out
}
