/**
 * The catch this exists for is narrow and real: the app already knew a track required a
 * credit, and nothing checked whether the credit reached the description. That is what
 * turns a free track into a claim.
 *
 * The failure it must never commit is claiming to know something it cannot. It is not a
 * copyright detector — only Content ID is — and it must say so rather than imply safety.
 */
import { describe, expect, it } from 'vitest'
import { checkCopyright, creditIsPresent, creditLine, needsCredit, type CreditedItem } from './copyrightCheck'

const music = (over: Partial<CreditedItem> = {}): CreditedItem => ({
  title: 'Sunset Drive',
  kind: 'music',
  license: 'BY',
  artist: 'Some Artist',
  source: 'Openverse',
  ...over
})

describe('the catch: a required credit that never reached the description', () => {
  it('flags a BY track with no credit in the description', () => {
    const r = checkCopyright([music()], 'A video about the reserves.')
    expect(r.ok).toBe(false)
    expect(r.missingCredits).toHaveLength(1)
    expect(r.missingCredits[0].note).toMatch(/turns a free track into a claim/)
    expect(r.headline).toMatch(/need.? a credit that is not in your description/)
  })

  it('passes once the credit is there, however the user wrote it', () => {
    // A strict match on the formatted line would flag every hand-written credit as
    // missing, which trains the user to ignore the check entirely.
    const r = checkCopyright([music()], 'Music: Sunset Drive by Some Artist, thanks!')
    expect(r.ok).toBe(true)
    expect(r.verdicts[0].creditPresent).toBe(true)
  })

  it('does not accept a half-credit that names the track but not the artist', () => {
    // The commonest way people get this wrong.
    expect(creditIsPresent(music(), 'Music: Sunset Drive')).toBe(false)
    expect(creditIsPresent(music(), 'Music: Sunset Drive by Some Artist')).toBe(true)
  })

  it('gives a credits block containing ONLY what is required', () => {
    const r = checkCopyright([music(), music({ title: 'Free Loop', license: 'Pixabay', artist: undefined })], '')
    expect(r.creditsBlock).toContain('Sunset Drive')
    // Padding the description with credits nobody needs makes the real ones easy to skip.
    expect(r.creditsBlock).not.toContain('Free Loop')
  })
})

describe('licences that need no credit', () => {
  it('knows the keyless, no-attribution ones', () => {
    for (const license of ['Pixabay', 'Pexels', 'CC0', 'public domain', 'Unsplash']) {
      expect(needsCredit(music({ license })), license).toBe(false)
    }
  })

  it('knows the ones that do', () => {
    for (const license of ['BY', 'BY-SA', 'BY-NC', 'BY-ND', 'Attribution']) {
      expect(needsCredit(music({ license })), license).toBe(true)
    }
  })

  it('treats an UNRECOGNISED licence as needing a credit', () => {
    // Asymmetric on purpose: an unnecessary credit costs one line, a missing one can cost
    // the video.
    expect(needsCredit(music({ license: 'SomeNewLicence-2.0' }))).toBe(true)
  })

  it('honours an explicit flag from the source over its own guess', () => {
    expect(needsCredit(music({ license: 'BY', requiresCredit: false }))).toBe(false)
    expect(needsCredit(music({ license: 'Pixabay', requiresCredit: true }))).toBe(true)
  })

  it('says a no-credit licence is safe on a monetised video, which is the real question', () => {
    const r = checkCopyright([music({ license: 'Pixabay' })], '')
    expect(r.verdicts[0].note).toMatch(/needs no credit/)
    expect(r.ok).toBe(true)
  })
})

describe('it never pretends to know what it cannot', () => {
  it('says so plainly for a file the user supplied', () => {
    const r = checkCopyright([music({ userSupplied: true, license: undefined, artist: undefined })], '')
    expect(r.unknown).toHaveLength(1)
    expect(r.unknown[0].note).toMatch(/knows nothing about its licence/)
    // And it is explicit that it cannot answer the question the user actually has.
    expect(r.unknown[0].note).toMatch(/cannot tell you whether YouTube will claim it/)
  })

  it('does NOT block publishing over a file it cannot check', () => {
    // The user may well own it. Blocking them from publishing their own music would be
    // the tool overreaching on a guess.
    const r = checkCopyright([music({ userSupplied: true, license: undefined })], '')
    expect(r.ok).toBe(true)
    expect(r.headline).toMatch(/only you can say/)
  })

  it('treats a missing licence as unknown rather than as clear', () => {
    const r = checkCopyright([music({ license: '' })], '')
    expect(r.verdicts[0].risk).toBe('unknown')
  })

  it('never implies a video is copyright-safe overall', () => {
    const r = checkCopyright([music({ license: 'Pixabay' })], '')
    // "cleared and credited where required" is a claim about paperwork. Anything stronger
    // would be a claim about Content ID, which nothing here can see.
    expect(r.headline).not.toMatch(/no copyright|copyright.free|safe from|will not be claimed/i)
  })
})

describe('the credit line', () => {
  it('names the track, the artist, the licence and the link', () => {
    const line = creditLine(music({ url: 'https://example.com/t' }))
    expect(line).toContain('"Sunset Drive"')
    expect(line).toContain('by Some Artist')
    expect(line).toContain('(BY)')
    expect(line).toContain('https://example.com/t')
  })

  it('leaves out what it does not know rather than writing "undefined"', () => {
    const line = creditLine({ title: 'Track', kind: 'music', license: 'BY' })
    expect(line).not.toMatch(/undefined|null/)
    expect(line).toBe('"Track" (BY)')
  })
})

describe('survives anything', () => {
  it('handles no items, and junk items', () => {
    expect(checkCopyright([], '').headline).toMatch(/Nothing to check/)
    expect(checkCopyright(undefined as never, '').verdicts).toEqual([])
    expect(() => checkCopyright([null as never, { title: '', kind: 'music' }], '')).not.toThrow()
    expect(checkCopyright([{ title: '  ', kind: 'music' }], '').verdicts).toEqual([])
  })

  it('handles an undefined description', () => {
    expect(() => checkCopyright([music()], undefined as never)).not.toThrow()
    expect(checkCopyright([music()], undefined as never).ok).toBe(false)
  })

  it('is case-insensitive about a credit, because people type how they type', () => {
    expect(creditIsPresent(music(), 'MUSIC: SUNSET DRIVE BY SOME ARTIST')).toBe(true)
  })
})
