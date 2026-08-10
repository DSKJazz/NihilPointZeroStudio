import { describe, expect, it } from 'vitest'
import { estimateReadingSeconds } from './silentTrack'

describe('estimateReadingSeconds', () => {
  it('never returns zero, so a silent video still has a length', () => {
    expect(estimateReadingSeconds('')).toBeGreaterThan(0)
  })

  it('scales with the amount of script', () => {
    const short = estimateReadingSeconds(Array(50).fill('word').join(' '))
    const long = estimateReadingSeconds(Array(500).fill('word').join(' '))
    expect(long).toBeGreaterThan(short)
  })

  it('reads 150 words in about a minute', () => {
    const secs = estimateReadingSeconds(Array(150).fill('word').join(' '))
    expect(secs).toBeGreaterThanOrEqual(55)
    expect(secs).toBeLessThanOrEqual(65)
  })

  // Stage directions are for the renderer, not the narrator — counting them would
  // stretch the video past where the user's own recording ends.
  it('ignores bracketed stage directions', () => {
    const withDirections = `[wide shot of the city] ${Array(150).fill('word').join(' ')} [fade out]`
    expect(estimateReadingSeconds(withDirections)).toBe(estimateReadingSeconds(Array(150).fill('word').join(' ')))
  })

  it('caps absurdly long scripts rather than making an hours-long silent file', () => {
    expect(estimateReadingSeconds(Array(1_000_000).fill('word').join(' '))).toBeLessThanOrEqual(3600)
  })
})
