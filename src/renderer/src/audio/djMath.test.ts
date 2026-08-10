import { describe, expect, it } from 'vitest'
import { clampTime, computePeaks, detectBpm, energyEnvelope, equalPowerGains, isValidLoop } from './djMath'

/** Synthesizes a click track: short bursts at the given BPM over `seconds`. */
function clickTrack(bpm: number, seconds: number, sampleRate = 44100): Float32Array {
  const out = new Float32Array(Math.floor(seconds * sampleRate))
  const beatEvery = (60 / bpm) * sampleRate
  const clickLen = Math.floor(sampleRate * 0.02)
  for (let beat = 0; beat * beatEvery < out.length; beat++) {
    const start = Math.floor(beat * beatEvery)
    for (let i = 0; i < clickLen && start + i < out.length; i++) {
      out[start + i] = Math.sin((i / clickLen) * Math.PI) // soft 20ms burst
    }
  }
  return out
}

describe('equalPowerGains (crossfader)', () => {
  it('full A at 0, full B at 1, and equal power in the middle', () => {
    expect(equalPowerGains(0)).toEqual({ a: 1, b: 0 })
    expect(equalPowerGains(1).a).toBeCloseTo(0, 6)
    expect(equalPowerGains(1).b).toBeCloseTo(1, 6)
    const mid = equalPowerGains(0.5)
    expect(mid.a).toBeCloseTo(mid.b, 6)
    expect(mid.a * mid.a + mid.b * mid.b).toBeCloseTo(1, 6) // constant power
  })

  it('clamps out-of-range positions instead of misbehaving', () => {
    expect(equalPowerGains(-3)).toEqual({ a: 1, b: 0 })
    expect(equalPowerGains(42).b).toBeCloseTo(1, 6)
  })
})

describe('computePeaks (waveform)', () => {
  it('returns one 0..1 peak per bucket', () => {
    const s = new Float32Array(1000).map((_, i) => (i < 500 ? 0.2 : -0.9))
    const peaks = computePeaks(s, 10)
    expect(peaks).toHaveLength(10)
    expect(Math.max(...peaks)).toBeCloseTo(0.9, 5)
    expect(peaks[0]).toBeCloseTo(0.2, 5)
  })
})

describe('energyEnvelope', () => {
  it('is loud where the audio is loud and silent where it is silent', () => {
    const s = new Float32Array(4096)
    for (let i = 0; i < 1024; i++) s[i] = 0.8 // one loud opening window
    const env = energyEnvelope(s, 1024)
    expect(env).toHaveLength(4)
    expect(env[0]).toBeCloseTo(0.8, 5)
    expect(env[3]).toBe(0)
  })
})

describe('detectBpm', () => {
  it('finds 120 BPM in a 120 BPM click track', () => {
    const bpm = detectBpm(clickTrack(120, 12), 44100)
    expect(bpm).not.toBeNull()
    expect(Math.abs((bpm as number) - 120)).toBeLessThanOrEqual(3)
  })

  it('finds 95 BPM in a 95 BPM click track', () => {
    const bpm = detectBpm(clickTrack(95, 12), 44100)
    expect(bpm).not.toBeNull()
    expect(Math.abs((bpm as number) - 95)).toBeLessThanOrEqual(3)
  })

  it('returns null for silence and for too-short clips (never a fake number)', () => {
    expect(detectBpm(new Float32Array(44100 * 12), 44100)).toBeNull()
    expect(detectBpm(clickTrack(120, 1), 44100)).toBeNull()
  })
})

describe('loop + cue helpers', () => {
  it('clamps cue times into the track', () => {
    expect(clampTime(-5, 100)).toBe(0)
    expect(clampTime(500, 100)).toBe(100)
    expect(clampTime(42, 100)).toBe(42)
  })

  it('accepts only forward loops with real width', () => {
    expect(isValidLoop(10, 14)).toBe(true)
    expect(isValidLoop(14, 10)).toBe(false)
    expect(isValidLoop(10, 10.01)).toBe(false)
    expect(isValidLoop(null, 10)).toBe(false)
  })
})
