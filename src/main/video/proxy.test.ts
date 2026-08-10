/**
 * The entire safety of proxy editing rests on one property: a timestamp means the same
 * thing in the proxy as in the master. If it does not, cuts land progressively further
 * out as the video goes on — fine at the start, ruined at the end, and invisible until
 * somebody watches the whole thing. So that is what these tests are about.
 */
import { describe, expect, it } from 'vitest'
import {
  DURATION_TOLERANCE_SEC,
  PROXY_LONG_SIDE,
  buildProxyArgs,
  proxyIsTrustworthy,
  proxySize,
  proxyTimeToMaster,
  worthProxying
} from './proxy'

const spec = { sourcePath: 'C:\\v\\master.mp4', outPath: 'C:\\tmp\\proxy.mp4', width: 3840, height: 2160 }

describe('nothing in the command may change the timing', () => {
  it('never sets a frame rate — that is what puts every timestamp out', () => {
    // A 60fps source proxied at 30fps is half a frame out at best, and a different LENGTH
    // at worst, so a cut near the end lands somewhere else entirely.
    const args = buildProxyArgs(spec)
    expect(args).not.toContain('-r')
    expect(args.join(' ')).not.toMatch(/\bfps=/)
  })

  it('never trims, seeks or changes speed', () => {
    const args = buildProxyArgs(spec)
    for (const flag of ['-t', '-ss', '-to', '-shortest']) expect(args, flag).not.toContain(flag)
    expect(args.join(' ')).not.toMatch(/setpts|atempo|asetpts/)
  })

  it('only ever scales the picture', () => {
    const vf = buildProxyArgs(spec)[buildProxyArgs(spec).indexOf('-vf') + 1]
    expect(vf).toMatch(/^scale=\d+:\d+$/)
  })

  it('copies the audio rather than re-encoding it', () => {
    // It is what the user listens to in order to find the cut. Re-encoding is slower AND
    // shifts it slightly.
    const args = buildProxyArgs(spec)
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy')
  })

  it('maps time as the identity, because everything above guarantees it can', () => {
    for (const t of [0, 0.04, 12.5, 252.5, 3600]) expect(proxyTimeToMaster(t)).toBe(t)
  })
})

describe('it refuses a proxy it cannot trust', () => {
  it('accepts one that is the same length', () => {
    const v = proxyIsTrustworthy(252.48, 252.5)
    expect(v.ok).toBe(true)
    expect(v.reason).toMatch(/lands in exactly the same place/)
  })

  it('REFUSES one whose length drifted, and says what it will do instead', () => {
    const v = proxyIsTrustworthy(252.5, 250.1)
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/2\.40s different/)
    expect(v.reason).toMatch(/Editing the original directly instead/)
  })

  it('refuses when either length could not be read, rather than hoping', () => {
    for (const pair of [[NaN, 10], [10, NaN], [0, 10], [10, 0], [-5, 10], [Infinity, 10]] as const) {
      expect(proxyIsTrustworthy(pair[0], pair[1]).ok, String(pair)).toBe(false)
    }
  })

  it('the tolerance is tight enough to matter and loose enough to be usable', () => {
    // Container rounding differs by a frame or two; a real desync is far larger.
    expect(DURATION_TOLERANCE_SEC).toBeLessThanOrEqual(0.2)
    expect(DURATION_TOLERANCE_SEC).toBeGreaterThanOrEqual(0.04)
  })
})

describe('the proxy size', () => {
  it('caps the long side and keeps the shape', () => {
    expect(proxySize(3840, 2160)).toEqual({ width: 640, height: 360 })
    expect(proxySize(2160, 3840)).toEqual({ width: 360, height: 640 })
    expect(proxySize(1440, 1440)).toEqual({ width: 640, height: 640 })
    expect(PROXY_LONG_SIDE).toBe(640)
  })

  it('always returns EVEN dimensions — h264 rejects odd ones', () => {
    for (const [w, h] of [[1920, 1080], [1079, 1919], [3841, 2161], [1234, 567], [3, 7]]) {
      const p = proxySize(w, h)
      expect(p.width % 2, `${w}x${h}`).toBe(0)
      expect(p.height % 2, `${w}x${h}`).toBe(0)
      expect(p.width).toBeGreaterThan(0)
      expect(p.height).toBeGreaterThan(0)
    }
  })

  it('never scales a small video UP — there would be nothing to gain', () => {
    expect(proxySize(320, 240)).toEqual({ width: 320, height: 240 })
  })

  it('survives junk dimensions', () => {
    for (const [w, h] of [[0, 0], [NaN, NaN], [-100, -100], [undefined as never, undefined as never]]) {
      expect(() => proxySize(w, h)).not.toThrow()
      const p = proxySize(w, h)
      expect(Number.isFinite(p.width) && p.width >= 2).toBe(true)
      expect(Number.isFinite(p.height) && p.height >= 2).toBe(true)
    }
  })
})

describe('when it is worth making one at all', () => {
  it('yes for 4K and 1440p, no for 1080p and below', () => {
    expect(worthProxying(3840, 2160)).toBe(true)
    expect(worthProxying(2560, 1440)).toBe(true)
    expect(worthProxying(1920, 1080)).toBe(false)
    expect(worthProxying(1080, 1920)).toBe(false)
    expect(worthProxying(640, 480)).toBe(false)
  })

  it('handles junk without claiming a tiny file needs one', () => {
    expect(worthProxying(0, 0)).toBe(false)
    expect(worthProxying(NaN, NaN)).toBe(false)
    expect(worthProxying(undefined as never, undefined as never)).toBe(false)
  })
})

describe('the rest of the command', () => {
  it('puts keyframes one second apart, or the scrubber snaps far from the click', () => {
    // A seek can only land on a keyframe. A 10-second interval means clicking at 4:12
    // shows you 4:20.
    const args = buildProxyArgs(spec)
    expect(args[args.indexOf('-g') + 1]).toBe('25')
  })

  it('encodes as fast and small as it can — this file is scrubbed, never watched', () => {
    const args = buildProxyArgs(spec)
    expect(args[args.indexOf('-preset') + 1]).toBe('ultrafast')
    expect(Number(args[args.indexOf('-crf') + 1])).toBeGreaterThanOrEqual(28)
  })

  it('overwrites and writes where told, with paths passed through untouched', () => {
    const args = buildProxyArgs({ ...spec, sourcePath: 'C:\\My Videos\\a b.mp4' })
    expect(args[0]).toBe('-y')
    expect(args).toContain('C:\\My Videos\\a b.mp4')
    expect(args[args.length - 1]).toBe(spec.outPath)
  })

  it('never emits NaN into the filter', () => {
    expect(buildProxyArgs({ ...spec, width: NaN, height: NaN }).join(' ')).not.toMatch(/NaN|undefined/)
  })
})
