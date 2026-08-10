/**
 * The PURE math behind the dual-deck DJ suite — kept free of WebAudio/DOM so every
 * piece is unit-testable in node (djMath.test.ts). The UI (DualDecks.tsx) is a thin
 * shell over these.
 *
 * 100% client-side, no paid services, no network — free for life by construction.
 */

/**
 * Equal-power crossfade: position 0 = full deck A, 1 = full deck B. cos/sin keeps
 * perceived loudness constant through the middle (a linear fade dips ~3dB at center).
 */
export function equalPowerGains(position: number): { a: number; b: number } {
  const x = Math.min(1, Math.max(0, position))
  return { a: Math.cos((x * Math.PI) / 2), b: Math.sin((x * Math.PI) / 2) }
}

/**
 * Min/max peaks for waveform drawing: buckets the samples and returns one 0..1
 * amplitude per bucket. Cheap enough to run on decode for a whole track.
 */
export function computePeaks(samples: Float32Array, buckets: number): number[] {
  const n = Math.max(1, Math.min(buckets, samples.length))
  const per = Math.floor(samples.length / n) || 1
  const out: number[] = []
  for (let b = 0; b < n; b++) {
    let peak = 0
    const start = b * per
    const end = Math.min(samples.length, start + per)
    for (let i = start; i < end; i++) {
      const v = Math.abs(samples[i])
      if (v > peak) peak = v
    }
    out.push(peak)
  }
  return out
}

/**
 * Energy envelope: mean absolute amplitude per window. The BPM detector works on
 * this (beats = bursts of energy), not on raw samples.
 */
export function energyEnvelope(samples: Float32Array, windowSize: number): Float32Array {
  const windows = Math.floor(samples.length / windowSize)
  const env = new Float32Array(Math.max(0, windows))
  for (let w = 0; w < windows; w++) {
    let sum = 0
    const start = w * windowSize
    for (let i = 0; i < windowSize; i++) sum += Math.abs(samples[start + i])
    env[w] = sum / windowSize
  }
  return env
}

/**
 * Tempo detection via autocorrelation of the energy envelope, searched across the
 * DJ-relevant 60–180 BPM band. Returns null when the track has no discernible pulse
 * (speech, ambience) — the UI shows "—" instead of a fake number.
 */
export function detectBpm(samples: Float32Array, sampleRate: number): number | null {
  if (samples.length < sampleRate * 4) return null // need a few seconds to say anything honest
  const windowSize = 1024
  const env = energyEnvelope(samples, windowSize)
  if (env.length < 64) return null
  // Remove the DC offset so correlation measures rhythm, not loudness.
  let mean = 0
  for (const v of env) mean += v
  mean /= env.length
  const centered = new Float32Array(env.length)
  for (let i = 0; i < env.length; i++) centered[i] = env[i] - mean

  const envRate = sampleRate / windowSize // envelope frames per second
  const minLag = Math.floor((60 / 180) * envRate) // 180 BPM
  const maxLag = Math.ceil((60 / 60) * envRate) // 60 BPM
  let energy0 = 0
  for (const v of centered) energy0 += v * v
  if (energy0 === 0) return null
  const scoreAt = (lag: number): number => {
    let score = 0
    for (let i = 0; i + lag < centered.length; i++) score += centered[i] * centered[i + lag]
    return score
  }
  let bestLag = 0
  let bestScore = 0
  for (let lag = minLag; lag <= Math.min(maxLag, centered.length - 1); lag++) {
    const score = scoreAt(lag)
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  // A pulse must actually correlate — an unstructured track scores near zero.
  if (bestLag === 0 || bestScore < energy0 * 0.05) return null
  // Octave (harmonic) correction: a 120 BPM beat also correlates perfectly at the
  // 60 BPM double-period. Whenever the half-lag correlates comparably, the FASTER
  // tempo is the truth — step down while that holds.
  let lag = bestLag
  while (Math.floor(lag / 2) >= minLag && scoreAt(Math.floor(lag / 2)) >= 0.5 * scoreAt(lag)) {
    lag = Math.floor(lag / 2)
  }
  const bpm = (60 * envRate) / lag
  return Math.round(bpm * 10) / 10
}

/** Clamp a hot-cue / loop time into the track. */
export function clampTime(t: number, durationSec: number): number {
  return Math.min(Math.max(0, t), Math.max(0, durationSec))
}

/** A valid loop needs in < out and at least 50ms of audio between them. */
export function isValidLoop(loopIn: number | null, loopOut: number | null): boolean {
  return loopIn !== null && loopOut !== null && loopOut - loopIn >= 0.05
}
