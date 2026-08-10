/**
 * A citation that points at the wrong row is worse than no citation, because it looks
 * authoritative and fails under exactly the scrutiny it invited. So the row numbers,
 * the deduplication and the "no source" list are all asserted hard.
 */
import { describe, expect, it } from 'vitest'
import { auditSources, screenCredit, sourcedFromNotes, sourcedFromRows, sourcesList, type SourcedFigure } from './sources'

const SOURCES: SourcedFigure[] = [
  {
    label: 'USD/PKR close',
    value: 279.42,
    file: 'psx-eod-2026-07.csv',
    row: 84,
    publisher: 'State Bank of Pakistan',
    asOf: '2026-07-30',
    url: 'https://sbp.test/rates'
  },
  {
    label: 'Reserves',
    value: 11_200_000_000,
    file: 'sbp-reserves.csv',
    row: 12,
    publisher: 'State Bank of Pakistan',
    asOf: '2026-07-25'
  },
  { label: 'KSE-100 close', value: 78_431.55, file: 'psx-eod-2026-07.csv', row: 84, publisher: 'PSX', asOf: '2026-07-30' }
]

describe('pairing a figure with where it came from', () => {
  it('finds the file and the row for an exact figure', () => {
    const a = auditSources('The rupee closed at 279.42 on Thursday.', SOURCES)
    expect(a.cited).toHaveLength(1)
    expect(a.cited[0].source.file).toBe('psx-eod-2026-07.csv')
    expect(a.cited[0].source.row).toBe(84)
    expect(a.cited[0].exact).toBe(true)
  })

  it('accepts the author’s own rounding and still cites it', () => {
    const a = auditSources('The rupee closed at 279.4.', SOURCES)
    expect(a.cited).toHaveLength(1)
    expect(a.cited[0].exact).toBe(false)
    expect(a.cited[0].source.row).toBe(84)
  })

  it('matches a figure written at a different scale', () => {
    const a = auditSources('Reserves stand at 11.2 billion dollars.', SOURCES)
    expect(a.cited[0].source.file).toBe('sbp-reserves.csv')
  })

  it('says where in the script the figure is, so the UI can jump to it', () => {
    const script = 'Some preamble first. Then the rate hit 279.42 exactly.'
    const a = auditSources(script, SOURCES)
    const c = a.cited[0]
    expect(script.slice(c.index, c.index + c.written.length)).toBe('279.42')
  })
})

describe('the figures with NO source — the ones that cause trouble', () => {
  it('lists them separately rather than burying them', () => {
    const a = auditSources('Reserves were 9.8 billion, and the rate was 279.42.', SOURCES)
    expect(a.cited).toHaveLength(1)
    expect(a.uncited).toHaveLength(1)
    expect(a.uncited[0].raw).toBe('9.8')
    expect(a.fullyTraceable).toBe(false)
  })

  it('says plainly that a comment will ask about them', () => {
    expect(auditSources('It was 91.3 last month.', SOURCES).headline).toMatch(/no source|comment will ask/)
  })

  it('confirms when everything IS traceable, so the win is visible', () => {
    const a = auditSources('Closed at 279.42, index at 78,431.55.', SOURCES)
    expect(a.fullyTraceable).toBe(true)
    expect(a.headline).toMatch(/Every one of the 2 figures traces/)
  })

  it('does not count ordinary language as an unsourced claim', () => {
    // "3 reasons" and "2 minutes" are not figures. Flagging them would bury the two
    // that matter under forty that do not.
    const a = auditSources('Here are 3 reasons, in 2 minutes, back in 2008.', SOURCES)
    expect(a.cited).toHaveLength(0)
    expect(a.uncited).toHaveLength(0)
    expect(a.headline).toMatch(/No figures/)
  })
})

describe('the sources list for the description', () => {
  it('lists publisher, file and as-of date', () => {
    const list = sourcesList(auditSources('Rate 279.42.', SOURCES))
    expect(list).toContain('Sources:')
    expect(list).toContain('State Bank of Pakistan')
    expect(list).toContain('psx-eod-2026-07.csv')
    expect(list).toContain('as of 2026-07-30')
  })

  it('DEDUPLICATES — the same file eight times reads as careless, not rigorous', () => {
    // Both the rupee close and the index close come from psx-eod-2026-07.csv, but with
    // different publishers, so they are legitimately two entries. Two figures from the
    // SAME source must collapse to one line.
    const a = auditSources('Rate 279.42, and again 279.42, and 279.4 too.', SOURCES)
    expect(a.cited.length).toBeGreaterThan(1)
    const lines = sourcesList(a).split('\n').filter((l) => l.startsWith('•'))
    expect(lines).toHaveLength(1)
  })

  it('includes a link when there is one, and omits it cleanly when not', () => {
    expect(sourcesList(auditSources('Rate 279.42.', SOURCES))).toContain('https://sbp.test/rates')
    // Reserves has no url — its line must not end in a dangling colon.
    const reservesOnly = sourcesList(auditSources('Reserves 11.2 billion.', SOURCES))
    expect(reservesOnly).not.toMatch(/:\s*$/)
    expect(reservesOnly).toContain('sbp-reserves.csv')
  })

  it('is empty when nothing is cited, rather than an empty heading', () => {
    // A description containing "Sources:" and nothing under it is worse than no
    // heading at all — it advertises rigour and then shows none.
    expect(sourcesList(auditSources('It was 91.3.', SOURCES))).toBe('')
  })

  it('accepts a custom heading, for Urdu or a different house style', () => {
    expect(sourcesList(auditSources('Rate 279.42.', SOURCES), { heading: 'Hawale' })).toContain('Hawale:')
  })
})

describe('the on-screen credit', () => {
  it('is short enough to read on a phone without covering the chart', () => {
    const credit = screenCredit(SOURCES[0])
    expect(credit).toBe('State Bank of Pakistan, 2026-07-30')
    expect(credit.length).toBeLessThanOrEqual(48)
  })

  it('truncates a long one at a character limit rather than overflowing', () => {
    const long: SourcedFigure = { label: 'x', value: 1, publisher: 'A'.repeat(80), asOf: '2026-01-01' }
    const credit = screenCredit(long, 20)
    expect(credit).toHaveLength(20)
    expect(credit.endsWith('…')).toBe(true)
  })

  it('falls back to the filename when there is no publisher', () => {
    expect(screenCredit({ label: 'x', value: 1, file: 'my-data.csv' })).toBe('my-data.csv')
  })
})

describe('turning imported rows into sourced figures', () => {
  const rows = [
    { date: '2026-07-29', close: 78_100.2, volume: 400_000_000 },
    { date: '2026-07-30', close: 78_431.55, volume: 412_000_000 }
  ]

  it('carries the file and the row through', () => {
    const figures = sourcedFromRows('psx.csv', rows, { publisher: 'PSX' })
    const hit = figures.find((f) => f.value === 78_431.55)!
    expect(hit.file).toBe('psx.csv')
    expect(hit.publisher).toBe('PSX')
    expect(hit.asOf).toBe('2026-07-30')
  })

  it('accounts for the header row — an off-by-one sends you to the wrong line', () => {
    // Row 1 of a spreadsheet is the header, so the first data row is row 2. Getting
    // this wrong is worse than omitting the row number, because it looks precise.
    const figures = sourcedFromRows('psx.csv', rows)
    expect(figures.find((f) => f.value === 78_100.2)!.row).toBe(2)
    expect(figures.find((f) => f.value === 78_431.55)!.row).toBe(3)
  })

  it('skips missing fields rather than inventing zeroes', () => {
    // A zero that was never in the data would "source" a wrong figure.
    expect(sourcedFromRows('x.csv', [{ date: 'd', close: undefined, volume: 5 }])).toHaveLength(1)
    expect(sourcedFromRows('x.csv', [])).toEqual([])
  })

  it('feeds straight into the audit, end to end', () => {
    const figures = sourcedFromRows('psx.csv', rows, { publisher: 'PSX', url: 'https://psx.test' })
    const a = auditSources('The index closed at 78,431.55 on Thursday.', figures)
    expect(a.fullyTraceable).toBe(true)
    expect(a.cited[0].source.row).toBe(3)
    expect(sourcesList(a)).toContain('https://psx.test')
  })
})

describe('it never invents a citation', () => {
  it('produces nothing at all with no sources loaded', () => {
    const a = auditSources('The rate was 279.42 exactly.', [])
    expect(a.cited).toEqual([])
    expect(a.uncited).toHaveLength(1)
    expect(sourcesList(a)).toBe('')
  })

  it('every cited figure’s value really is the source’s value', () => {
    const a = auditSources('Rate 279.4, reserves 11.2 billion, index 78,431.55.', SOURCES)
    for (const c of a.cited) {
      const known = SOURCES.find((s) => s.label === c.source.label)
      expect(known?.value).toBe(c.source.value)
    }
  })

  it('copes with an empty script', () => {
    expect(auditSources('', SOURCES).headline).toMatch(/No figures/)
  })
})

describe('reading the figures out of pasted notes', () => {
  const NOTES = [
    'Source: State Bank of Pakistan | https://sbp.org.pk/ecodata',
    'Reserves, 2026-07-31: 11.2 billion',
    'Import cover: 2.1 months',
    '',
    'just a note to myself with no number relevance',
    'Source: PSX',
    'KSE-100 close: 78,412'
  ].join('\n')

  it('reads label and value from each line', () => {
    const figs = sourcedFromNotes(NOTES)
    expect(figs.map((f) => f.value)).toEqual([11.2, 2.1, 78412])
    expect(figs[0].label).toBe('Reserves, 2026-07-31')
  })

  it('applies a Source: line to every figure BELOW it', () => {
    const figs = sourcedFromNotes(NOTES)
    expect(figs[0].publisher).toBe('State Bank of Pakistan')
    expect(figs[0].url).toBe('https://sbp.org.pk/ecodata')
    // …and the second Source: line takes over from there.
    expect(figs[2].publisher).toBe('PSX')
  })

  it('takes the LAST number on the line, because labels contain numbers too', () => {
    // "KSE-100 close: 78,412" must be 78412, not 100.
    expect(sourcedFromNotes('KSE-100 close: 78,412')[0].value).toBe(78412)
  })

  it('does NOT rescale "11.2 billion" — the script says 11.2 too', () => {
    // Turning it into 11200000000 here would make it fail to match the figure the
    // viewer actually sees on screen, which is the whole point of the check.
    const f = sourcedFromNotes('Reserves: 11.2 billion')[0]
    expect(f.value).toBe(11.2)
  })

  it('picks up the as-of date when the line carries one', () => {
    expect(sourcedFromNotes('Reserves, 2026-07-31: 11.2')[0].asOf).toBe('2026-07-31')
  })

  it('skips lines with no number instead of refusing the whole field', () => {
    // It is free text the user writes for themselves. Erroring on their own notes is
    // how a check gets switched off.
    expect(sourcedFromNotes('remember to mention the auction\nRate: 22').map((f) => f.value)).toEqual([22])
  })

  it('records the line number, so a figure can be found again', () => {
    expect(sourcedFromNotes('a: 1\nb: 2')[1].row).toBe(2)
  })

  it('survives junk', () => {
    expect(sourcedFromNotes('')).toEqual([])
    expect(() => sourcedFromNotes(undefined as unknown as string)).not.toThrow()
  })

  it('feeds auditSources end to end — a mistyped figure is caught', () => {
    const figs = sourcedFromNotes('Source: SBP\nReserves: 11.2')
    // The script says 11.7. The user looked up 11.2 and typed it wrong.
    const audit = auditSources('Reserves stand at 11.7 billion dollars today.', figs)
    expect(audit.fullyTraceable).toBe(false)
    expect(audit.uncited.some((u) => u.raw.includes('11.7'))).toBe(true)
  })

  it('and passes a figure that really does match', () => {
    const figs = sourcedFromNotes('Source: SBP\nReserves: 11.2')
    const audit = auditSources('Reserves stand at 11.2 billion dollars today.', figs)
    expect(audit.cited.some((c) => c.written.includes('11.2'))).toBe(true)
    expect(audit.cited[0].source.publisher).toBe('SBP')
  })
})
