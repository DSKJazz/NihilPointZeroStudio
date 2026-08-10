import { describe, expect, it } from 'vitest'
import {
  buildPollinationsVideoUrl,
  classifyPollinationsError,
  DEFAULT_POLLINATIONS_VIDEO_MODEL
} from './pollinationsVideo'

describe('buildPollinationsVideoUrl', () => {
  it('URL-encodes the prompt and fills every parameter', () => {
    const url = buildPollinationsVideoUrl({
      prompt: 'کراچی rain, "close-up" & mist',
      model: 'wan-fast',
      width: 1280,
      height: 736,
      seed: 3,
      seconds: 5
    })
    expect(url.startsWith('https://gen.pollinations.ai/video/')).toBe(true)
    expect(url).toContain(encodeURIComponent('کراچی rain, "close-up" & mist'))
    expect(url).toContain('model=wan-fast')
    expect(url).toContain('width=1280')
    expect(url).toContain('height=736')
    expect(url).toContain('seed=3')
    expect(url).toContain('duration=5')
    // The raw ampersand from the prompt must never leak into the query string.
    expect(url).not.toContain('& mist')
  })

  it('defaults the model and clamps duration to the API contract (1..120)', () => {
    const short = buildPollinationsVideoUrl({ prompt: 'p', width: 640, height: 640, seed: 1, seconds: 0.2 })
    expect(short).toContain(`model=${DEFAULT_POLLINATIONS_VIDEO_MODEL}`)
    expect(short).toContain('duration=1')
    const long = buildPollinationsVideoUrl({ prompt: 'p', width: 640, height: 640, seed: 1, seconds: 999 })
    expect(long).toContain('duration=120')
  })
})

describe('classifyPollinationsError', () => {
  it('explains the out-of-Pollen 402 in plain English, pointing at Quests', () => {
    const v = classifyPollinationsError(402)
    expect(v).toContain('Pollen is used up')
    expect(v).toContain('Quests tab')
  })

  it('points a 401 at Settings', () => {
    expect(classifyPollinationsError(401)).toContain('Settings → AI Video')
  })

  it('covers rate limits, permissions and server errors', () => {
    expect(classifyPollinationsError(429)).toContain('rate-limiting')
    expect(classifyPollinationsError(403)).toContain('not allowed')
    expect(classifyPollinationsError(503)).toContain('their end')
  })

  it('passes unknown statuses through with a body excerpt', () => {
    const v = classifyPollinationsError(418, 'im a teapot')
    expect(v).toContain('418')
    expect(v).toContain('im a teapot')
  })
})
