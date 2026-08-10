import { describe, it, expect } from 'vitest'
import { chunkForPiper } from './piper'

/**
 * Piper synthesizes stdin one LINE at a time and overwrites --output_file per line, so a
 * multi-paragraph script previously left only the LAST line's audio in the WAV. chunkForPiper
 * normalises to single-line chunks that are later concatenated, so the whole script is spoken.
 */
describe('chunkForPiper', () => {
  it('produces single-line chunks (no embedded newlines)', () => {
    const text = 'First paragraph sentence one. Sentence two.\n\nSecond paragraph here.\nThird line.'
    const chunks = chunkForPiper(text)
    expect(chunks.length).toBeGreaterThan(0)
    for (const c of chunks) expect(c).not.toMatch(/[\r\n]/)
  })

  it('keeps chunks within the size budget (plus one trailing sentence)', () => {
    const sentence = 'This is a moderately long narration sentence that adds up. '
    const text = sentence.repeat(60) // ~3400 chars
    const chunks = chunkForPiper(text, 600)
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(600 + sentence.length)
  })

  it('preserves the full content across chunks (nothing dropped)', () => {
    const text = 'Alpha one two three. Bravo four five six. Charlie seven eight nine. Delta ten.'
    const rejoined = chunkForPiper(text, 30).join(' ')
    for (const word of ['Alpha', 'Bravo', 'Charlie', 'Delta', 'ten']) {
      expect(rejoined).toContain(word)
    }
  })

  it('returns [] for empty/whitespace text', () => {
    expect(chunkForPiper('   \n  ')).toEqual([])
  })

  it('handles a single short line without splitting', () => {
    expect(chunkForPiper('Just one short line.')).toEqual(['Just one short line.'])
  })

  // Regression: the old any-'.' splitter re-joined "45.3" as "45. 3", so a finance
  // narration read decimal prices out wrong. Decimals must survive chunking intact.
  it('never splits decimal numbers', () => {
    const text = 'LUCK closed at 45.3 rupees. HUBC moved 2.75 percent today. ENGRO hit 310.5 again.'
    const rejoined = chunkForPiper(text, 40).join(' ')
    expect(rejoined).toContain('45.3')
    expect(rejoined).toContain('2.75')
    expect(rejoined).toContain('310.5')
    expect(rejoined).not.toMatch(/\d\.\s+\d/)
  })

  it('still splits normal sentences at punctuation-plus-space', () => {
    const chunks = chunkForPiper('One sentence here. Two sentence here. Three sentence here.', 25)
    expect(chunks.length).toBeGreaterThan(1)
  })
})
