/**
 * The wire format is the one thing both ends of the phone link depend on absolutely:
 * if it is even slightly wrong, dictation sends noise and the failure surfaces
 * somewhere else entirely. So these tests check the bytes, not the shape.
 */
import { describe, expect, it } from 'vitest'
import { base64ToBytes, bytesToBase64, decodeWire, encodeWire } from './wire'

describe('base64', () => {
  it('matches Node Buffer exactly, including every padding case', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'fooba', 'foobar', 'any carnal pleasure.']) {
      const bytes = new Uint8Array(Buffer.from(text, 'utf8'))
      expect(bytesToBase64(bytes), text).toBe(Buffer.from(text, 'utf8').toString('base64'))
    }
  })

  it('survives every byte value 0-255, which is where naive btoa() breaks', () => {
    const all = new Uint8Array(256)
    for (let i = 0; i < 256; i++) all[i] = i
    const encoded = bytesToBase64(all)
    expect(encoded).toBe(Buffer.from(all).toString('base64'))
    expect([...base64ToBytes(encoded)]).toEqual([...all])
  })

  it('round-trips a realistic audio-sized payload', () => {
    const bytes = new Uint8Array(200_003)
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 255
    const back = base64ToBytes(bytesToBase64(bytes))
    expect(back.length).toBe(bytes.length)
    expect(back[0]).toBe(bytes[0])
    expect(back[bytes.length - 1]).toBe(bytes[bytes.length - 1])
    expect(Buffer.from(back).equals(Buffer.from(bytes))).toBe(true)
  })
})

describe('encode/decode', () => {
  it('leaves ordinary JSON values completely alone', () => {
    const value = { a: 1, b: 'two', c: [true, null, 4.5], d: { e: 'f' } }
    expect(encodeWire(value)).toEqual(value)
    expect(decodeWire(encodeWire(value))).toEqual(value)
  })

  it('carries a Uint8Array through JSON unharmed', () => {
    const audio = new Uint8Array([255, 0, 128, 64, 1])
    const json = JSON.stringify(encodeWire({ clip: audio }))
    const back = decodeWire(JSON.parse(json)) as { clip: Uint8Array }
    expect(back.clip).toBeInstanceOf(Uint8Array)
    expect([...back.clip]).toEqual([255, 0, 128, 64, 1])
  })

  it('carries a Node Buffer too — main-process handlers return those', () => {
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(Buffer.from([1, 2, 3]))))) as Uint8Array
    expect([...back]).toEqual([1, 2, 3])
  })

  it('respects a Buffer that is a view onto part of a bigger allocation', () => {
    // Buffer.slice() shares memory; encoding the whole underlying pool instead of the
    // slice would silently send the wrong (and much larger) bytes.
    const pool = Buffer.from([9, 9, 1, 2, 3, 9, 9])
    const slice = pool.subarray(2, 5)
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(slice)))) as Uint8Array
    expect([...back]).toEqual([1, 2, 3])
  })

  it('keeps a Date a Date', () => {
    const when = new Date('2026-07-21T10:30:00.000Z')
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire({ when })))) as { when: Date }
    expect(back.when).toBeInstanceOf(Date)
    expect(back.when.toISOString()).toBe('2026-07-21T10:30:00.000Z')
  })

  it('handles arrays of byte arrays and nesting', () => {
    const value = { scenes: [{ img: new Uint8Array([1]) }, { img: new Uint8Array([2, 3]) }] }
    const back = decodeWire(JSON.parse(JSON.stringify(encodeWire(value)))) as typeof value
    expect([...back.scenes[1].img]).toEqual([2, 3])
  })

  it('drops undefined properties rather than emitting null', () => {
    expect(encodeWire({ a: 1, b: undefined })).toEqual({ a: 1 })
  })

  it('refuses a cyclic value instead of hanging forever', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => encodeWire(a)).toThrow(/nested too deeply/)
  })

  it('leaves an object that merely looks like a marker alone', () => {
    // Two keys, so it is not a marker — and must survive unchanged.
    const value = { __npzBin: 'abc', other: 1 }
    expect(decodeWire(encodeWire(value))).toEqual(value)
  })
})
