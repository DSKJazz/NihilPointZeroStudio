/**
 * The failure this must never commit is emitting `atempo=3.0`. ffmpeg rejects that at
 * graph-build time, so the symptom is not bad-sounding audio — it is no output file and
 * an error the user cannot read. Every speed the UI offers is therefore checked against
 * the filter's real 0.5–2.0 limit.
 */
import { describe, expect, it } from 'vitest'
import { SPEED_CHOICES } from '../../shared/readAloud'
import { ATEMPO_MAX, ATEMPO_MIN, atempoFactors, atempoFilter, buildSpeedArgs, spedUpSeconds } from './speed'

describe('every factor is inside the range ffmpeg accepts', () => {
  it('holds for every speed the app offers', () => {
    for (const speed of SPEED_CHOICES) {
      for (const f of atempoFactors(speed)) {
        expect(f, `speed ${speed} produced ${f}`).toBeGreaterThanOrEqual(ATEMPO_MIN)
        expect(f, `speed ${speed} produced ${f}`).toBeLessThanOrEqual(ATEMPO_MAX)
      }
    }
  })

  it('holds across the whole usable range, not just the presets', () => {
    for (let s = 0.25; s <= 4.001; s += 0.05) {
      for (const f of atempoFactors(s)) {
        expect(f, `speed ${s.toFixed(2)} produced ${f}`).toBeGreaterThanOrEqual(ATEMPO_MIN)
        expect(f, `speed ${s.toFixed(2)} produced ${f}`).toBeLessThanOrEqual(ATEMPO_MAX)
      }
    }
  })

  it('chains for anything past 2x rather than emitting one illegal filter', () => {
    // The bug this module exists to prevent, stated directly.
    expect(atempoFilter(3)).toBe('atempo=2,atempo=1.5')
    expect(atempoFilter(2.5)).toBe('atempo=2,atempo=1.25')
    expect(atempoFilter(4)).toBe('atempo=2,atempo=2')
    expect(atempoFilter(3)).not.toContain('atempo=3')
  })
})

describe('the factors multiply out to the speed asked for', () => {
  const product = (s: number): number => atempoFactors(s).reduce((n, f) => n * f, 1)

  it('is accurate at every preset', () => {
    for (const speed of SPEED_CHOICES) {
      expect(product(speed), `speed ${speed}`).toBeCloseTo(speed, 2)
    }
  })

  it('is accurate for slowing down too', () => {
    expect(product(0.5)).toBeCloseTo(0.5, 3)
    expect(product(0.25)).toBeCloseTo(0.25, 3)
    expect(product(0.75)).toBeCloseTo(0.75, 3)
  })

  it('keeps the chain as short as it can be — each link costs a resample', () => {
    expect(atempoFactors(2)).toHaveLength(1)
    expect(atempoFactors(3)).toHaveLength(2)
    expect(atempoFactors(4)).toHaveLength(2)
    expect(atempoFactors(1.5)).toHaveLength(1)
  })
})

describe('1x means no filter at all', () => {
  it('emits nothing rather than atempo=1.0', () => {
    // atempo=1.0 still resamples, so it costs a little quality to achieve nothing.
    expect(atempoFactors(1)).toEqual([])
    expect(atempoFilter(1)).toBe('')
    expect(buildSpeedArgs('in.wav', 'out.m4a', 1)).not.toContain('-filter:a')
  })

  it('treats a value indistinguishable from 1 the same way', () => {
    expect(atempoFilter(1.0004)).toBe('')
  })
})

describe('refusing to produce something broken from bad input', () => {
  it('returns no filter for nonsense rather than an illegal one', () => {
    for (const bad of [0, -1, NaN, Infinity, undefined as unknown as number, null as unknown as number]) {
      expect(atempoFactors(bad), String(bad)).toEqual([])
    }
  })

  it('clamps absurd speeds into the intelligible range instead of chaining forever', () => {
    const f = atempoFactors(50)
    expect(f.length).toBeLessThanOrEqual(2)
    expect(f.reduce((n, x) => n * x, 1)).toBeCloseTo(4, 2)
  })

  it('emits numbers ffmpeg can parse, not floating-point noise', () => {
    for (let s = 0.25; s <= 4.001; s += 0.017) {
      for (const f of atempoFactors(s)) {
        expect(String(f), `speed ${s}`).not.toMatch(/e[+-]/i)
        expect(String(f).replace('.', '').length, `speed ${s} -> ${f}`).toBeLessThanOrEqual(5)
      }
    }
  })
})

describe('the ffmpeg command', () => {
  it('overwrites, drops video, and writes a small throwaway file', () => {
    const args = buildSpeedArgs('C:\\in.wav', 'C:\\out.m4a', 2)
    expect(args[0]).toBe('-y')
    expect(args).toContain('-vn')
    expect(args).toContain('-filter:a')
    expect(args[args.indexOf('-filter:a') + 1]).toBe('atempo=2')
    expect(args).toContain('96k')
    // This file is listened to once and deleted; mono keeps it small.
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
    expect(args[args.length - 1]).toBe('C:\\out.m4a')
  })

  it('puts the input path straight through — paths with spaces are an argv job', () => {
    const args = buildSpeedArgs('C:\\My Videos\\a b.wav', 'out.m4a', 2)
    expect(args).toContain('C:\\My Videos\\a b.wav')
  })

  it('the filter comes after the input, where an output option belongs', () => {
    const args = buildSpeedArgs('in.wav', 'out.m4a', 2)
    expect(args.indexOf('-filter:a')).toBeGreaterThan(args.indexOf('in.wav'))
  })
})

describe('predicting how long the listen will take', () => {
  it('halves at 2x', () => {
    expect(spedUpSeconds(600, 2)).toBeCloseTo(300, 1)
  })

  it('uses the ACTUAL chained factors, not the requested speed', () => {
    // If rounding in the chain made the real speed 2.99 instead of 3, the time shown
    // must reflect what the file will really be.
    expect(spedUpSeconds(600, 3)).toBeCloseTo(200, 0)
  })

  it('is unchanged at 1x and for junk', () => {
    expect(spedUpSeconds(600, 1)).toBe(600)
    expect(spedUpSeconds(600, 0)).toBe(600)
    expect(spedUpSeconds(600, NaN)).toBe(600)
  })
})
