import { describe, expect, it } from 'vitest'
import { humanSize } from './strandedData'

/**
 * The scan/import halves talk to Electron and the real store, so they are proven by
 * the ship gate clicking the actual app. What IS worth pinning here is the size text
 * the user reads: "1.15 GB" must never render as "1234567890 bytes" or "0 MB".
 */
describe('humanSize', () => {
  it('reads naturally at every scale a video folder reaches', () => {
    expect(humanSize(1_234_567_890)).toBe('1.15 GB')
    expect(humanSize(5 * 1024 ** 3)).toBe('5.00 GB')
    expect(humanSize(211 * 1024 ** 2)).toBe('211 MB')
    expect(humanSize(1024 ** 2)).toBe('1 MB')
    expect(humanSize(4096)).toBe('4 KB')
  })

  it('never reports a real file as nothing', () => {
    expect(humanSize(1)).toBe('1 KB')
    expect(humanSize(0)).toBe('0 KB')
  })
})
