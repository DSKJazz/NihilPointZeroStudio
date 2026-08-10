/**
 * Two things must hold. First, it must NEVER invent text in a language it cannot verify —
 * publishing an unchecked translation on a channel whose product is credibility is worse
 * than publishing one language. Second, the language codes must be right, because the
 * whole feature is worthless if Roman Urdu is labelled `en` or `ur`.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_TAGS_TOTAL,
  MAX_TAG,
  MAX_TITLE,
  checkLimits,
  detectLanguage,
  languageMix,
  mergeTags,
  pasteBlock,
  planDualLanguage
} from './dualLanguage'

describe('the language codes, which is the whole point', () => {
  it('Roman Urdu is ur-Latn — not en, not ur', () => {
    // Labelled `en`, YouTube shows it to English speakers who cannot read it. Labelled
    // `ur`, YouTube is told it is in a script it is not in. Both cost reach quietly.
    expect(detectLanguage('Mehngai kyun barh rahi hai')).toBe('ur-Latn')
    expect(detectLanguage('Rupya kamzor ho raha hai')).toBe('ur-Latn')
    expect(detectLanguage('Zakhair gir rahe hain')).toBe('ur-Latn')
  })

  it('Urdu script is ur', () => {
    expect(detectLanguage('مہنگائی کیوں بڑھ رہی ہے')).toBe('ur')
  })

  it('plain English is en', () => {
    expect(detectLanguage('Why the rupee is falling')).toBe('en')
    expect(detectLanguage('Reserves drop to 11.2 billion dollars')).toBe('en')
  })

  it('script beats vocabulary — that is what the reader sees first', () => {
    // A line with both is Urdu script to a reader, whatever Latin words it carries.
    expect(detectLanguage('Reserves مہنگائی 11.2 billion')).toBe('ur')
  })

  it('handles empty and junk without guessing wildly', () => {
    expect(detectLanguage('')).toBe('en')
    expect(detectLanguage(undefined as unknown as string)).toBe('en')
    expect(detectLanguage('12345 !!! ???')).toBe('en')
  })
})

describe('it never invents a translation', () => {
  it('reports the missing language instead of producing one', () => {
    const plan = planDualLanguage({
      entries: [{ title: 'Mehngai kyun barh rahi hai', description: 'Reserves gir rahe hain aur rupya kamzor hai.' }]
    })
    expect(plan.localizations).toHaveLength(1)
    expect(plan.localizations[0].language).toBe('ur-Latn')
    expect(plan.missing).toContain('ur')
    expect(plan.missing).toContain('en')
    expect(plan.headline).toMatch(/Not written yet/)
  })

  it("every localization's text came from the input, character for character", () => {
    const title = 'Reserves drop to 11.2 billion'
    const description = 'What it means for import cover.'
    const plan = planDualLanguage({ entries: [{ title, description }] })
    expect(plan.localizations[0].title).toBe(title)
    expect(plan.localizations[0].description).toBe(description)
  })

  it('takes two languages when two were really written', () => {
    const plan = planDualLanguage({
      entries: [
        { title: 'Why the rupee is falling', description: 'The reserves story.' },
        { title: 'Rupya kyun gir raha hai', description: 'Zakhair ki kahani.' }
      ]
    })
    expect(plan.localizations.map((l) => l.language).sort()).toEqual(['en', 'ur-Latn'])
    expect(plan.missing).toEqual(['ur'])
  })

  it('never keeps two entries for the same language — the second would overwrite the first', () => {
    const plan = planDualLanguage({
      entries: [
        { title: 'Why the rupee is falling', description: 'One.' },
        { title: 'Why the reserves are falling', description: 'Two.' }
      ]
    })
    expect(plan.localizations).toHaveLength(1)
  })

  it('says so plainly when nothing has been written', () => {
    expect(planDualLanguage({ entries: [] }).headline).toMatch(/Nothing written yet/)
    expect(planDualLanguage({ entries: [{ title: '', description: '' }] }).localizations).toEqual([])
    expect(() => planDualLanguage({ entries: undefined as never })).not.toThrow()
  })
})

describe('the default language is the one with the most written', () => {
  it('picks the language a viewer outside both will be shown', () => {
    const plan = planDualLanguage({
      entries: [
        { title: 'Short', description: 'Tiny.' },
        { title: 'Rupya kyun gir raha hai', description: 'A much longer Roman Urdu description here, by far.' }
      ]
    })
    expect(plan.defaultLanguage).toBe('ur-Latn')
  })

  it('falls back to English rather than nothing', () => {
    expect(planDualLanguage({ entries: [] }).defaultLanguage).toBe('en')
  })
})

describe('the limits that truncate silently', () => {
  it('catches a title past 100 characters and says how much to cut', () => {
    const long = 'a'.repeat(120)
    const problems = checkLimits(long, 'fine')
    expect(problems.join(' ')).toMatch(/120 characters/)
    expect(problems.join(' ')).toMatch(/Trim 20/)
  })

  it('notes the phone cut-off, which is not an error but costs clicks', () => {
    expect(checkLimits('a'.repeat(80), 'fine').join(' ')).toMatch(/hidden on a phone/)
    // …and stays quiet about it on a short title.
    expect(checkLimits('Reserves drop 8 percent', 'fine')).toEqual([])
  })

  it('catches a description past 5000', () => {
    expect(checkLimits('fine', 'x'.repeat(5001)).join(' ')).toMatch(/5000/)
  })

  it('catches nothing written at all', () => {
    expect(checkLimits('', '').length).toBe(2)
    expect(checkLimits(undefined as unknown as string, undefined as unknown as string).length).toBe(2)
  })

  it('the limits match what YouTube actually publishes', () => {
    expect(MAX_TITLE).toBe(100)
    expect(MAX_TAGS_TOTAL).toBe(500)
    expect(MAX_TAG).toBe(30)
  })
})

describe('tags in both scripts, inside one budget', () => {
  it('keeps both scripts — the same search in two alphabets', () => {
    const { tags } = mergeTags(['mehngai', 'inflation'], ['مہنگائی'])
    expect(tags).toContain('mehngai')
    expect(tags).toContain('مہنگائی')
    expect(tags).toContain('inflation')
  })

  it('drops nothing silently — everything left out is reported', () => {
    const many = Array.from({ length: 60 }, (_, i) => `tag-number-${i}`)
    const { tags, dropped } = mergeTags(many)
    expect(tags.length + dropped.length).toBe(many.length)
    expect(dropped.length).toBeGreaterThan(0)
  })

  it('stays inside the 500-character budget, counting the separators', () => {
    const many = Array.from({ length: 100 }, (_, i) => `finance-tag-${i}`)
    const { tags } = mergeTags(many)
    expect(tags.join(', ').length).toBeLessThanOrEqual(MAX_TAGS_TOTAL)
  })

  it('drops an over-long single tag rather than letting YouTube reject the set', () => {
    const { tags, dropped } = mergeTags(['fine tag', 'x'.repeat(40)])
    expect(tags).toEqual(['fine tag'])
    expect(dropped).toHaveLength(1)
  })

  it('de-duplicates case-insensitively, keeping the first spelling', () => {
    expect(mergeTags(['Mehngai', 'mehngai', 'MEHNGAI']).tags).toEqual(['Mehngai'])
  })

  it('keeps the earliest tags, because those are the ones that survive', () => {
    const { tags } = mergeTags(['first', ...Array.from({ length: 100 }, (_, i) => `filler-tag-${i}`)])
    expect(tags[0]).toBe('first')
  })

  it('survives junk', () => {
    expect(mergeTags(undefined, [], ['', '  ']).tags).toEqual([])
    expect(() => mergeTags(undefined as never)).not.toThrow()
  })
})

describe('the block the user pastes into YouTube', () => {
  const plan = planDualLanguage({
    entries: [
      { title: 'Why the rupee is falling', description: 'The reserves story.' },
      { title: 'Rupya kyun gir raha hai', description: 'Zakhair ki kahani.' }
    ],
    tags: ['rupee', 'mehngai']
  })

  it("names the exact code to choose in YouTube's dropdown", () => {
    // "Roman Urdu" is not in YouTube's list; "ur-Latn" is what to look for.
    expect(pasteBlock(plan)).toContain('ur-Latn')
    expect(pasteBlock(plan)).toContain('choose "en"')
  })

  it('shows the character count against the limit, so trimming is not a guess', () => {
    expect(pasteBlock(plan)).toMatch(/TITLE \(\d+\/100\)/)
    expect(pasteBlock(plan)).toMatch(/DESCRIPTION \(\d+\/5000\)/)
  })

  it('is empty when there is nothing to paste, not a stub', () => {
    expect(pasteBlock(planDualLanguage({ entries: [] }))).toBe('')
  })
})

describe('how mixed a script is', () => {
  it('measures the share of each language', () => {
    const mix = languageMix('Reserves fell today. Rupya kamzor hai. مہنگائی بڑھ رہی ہے۔')
    expect(mix.en).toBeGreaterThan(0)
    expect(mix['ur-Latn']).toBeGreaterThan(0)
    expect(mix.ur).toBeGreaterThan(0)
    expect(mix.en + mix['ur-Latn'] + mix.ur).toBeCloseTo(1, 3)
  })

  it('never divides by zero', () => {
    const mix = languageMix('')
    expect(Number.isFinite(mix.en)).toBe(true)
    expect(() => languageMix(undefined as unknown as string)).not.toThrow()
  })
})
