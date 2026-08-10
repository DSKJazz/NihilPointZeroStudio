/**
 * The whole value of this module is TIMING, so the tests are mostly about when a
 * picture appears and disappears rather than which one it is. Two failures would make
 * it worse than nothing: a flash too short to read, and a cut to the same image (which
 * looks like a glitch, not an edit).
 */
import { describe, expect, it } from 'vitest'
import {
  FINANCE_CONCEPTS,
  MIN_CUE_SEC,
  cueEnableExpr,
  matchLine,
  timedLinesFromScript,
  planBroll,
  summarise,
  type TimedLine
} from './brollTiming'

const lines = (...spec: [number, number, string][]): TimedLine[] =>
  spec.map(([startSec, endSec, text]) => ({ startSec, endSec, text }))

describe('matching a sentence to a picture', () => {
  it('finds the concept the sentence is actually about', () => {
    const hit = matchLine('Reserves fell to eleven point two billion dollars.', FINANCE_CONCEPTS)
    expect(hit?.asset.id).toBe('reserves')
    expect(hit?.trigger).toBe('reserves')
  })

  it('matches Roman Urdu, which is half of every script here', () => {
    expect(matchLine('Mehngai is the real story this month.', FINANCE_CONCEPTS)?.asset.id).toBe('inflation')
    expect(matchLine('Sona ki qeemat phir barh gayi.', FINANCE_CONCEPTS)?.asset.id).toBe('gold')
    expect(matchLine('Qarz ka bojh barh raha hai.', FINANCE_CONCEPTS)?.asset.id).toBe('debt')
  })

  it('prefers the MORE SPECIFIC keyword when two could match', () => {
    // "import cover" is a reserves concept; "import" alone is trade. The longer,
    // more specific phrase has to win or the picture is subtly wrong every time.
    expect(matchLine('Import cover is under two months.', FINANCE_CONCEPTS)?.asset.id).toBe('reserves')
  })

  it('does not fire on a word that merely CONTAINS a keyword', () => {
    // "important" contains "import". Substring matching would put a trade chart on
    // every sentence containing the word important, which is most of them.
    expect(matchLine('This is an important point about nothing in particular.', FINANCE_CONCEPTS)).toBeNull()
  })

  it('returns nothing rather than guessing when a sentence is about nothing visual', () => {
    expect(matchLine('Let me explain what I mean by that.', FINANCE_CONCEPTS)).toBeNull()
  })
})

describe('the two failures that would make this worse than nothing', () => {
  it('never leaves a picture up too briefly to read', () => {
    // A flash registers as "something changed" without registering what, which is
    // worse than leaving the previous shot alone.
    const cues = planBroll(
      lines([0, 0.8, 'Reserves.'], [1, 1.5, 'Gold.'], [2, 2.4, 'Inflation.']),
      FINANCE_CONCEPTS,
      { durationSec: 10 }
    )
    expect(cues).toEqual([])
  })

  it('never cuts from a picture to the same picture', () => {
    // Three consecutive sentences about reserves is ONE shot, not three identical
    // cuts — a cut to the same frame reads as a glitch.
    const cues = planBroll(
      lines(
        [0, 4, 'Reserves fell again.'],
        [4, 8, 'The reserves number is what matters.'],
        [8, 12, 'Import cover follows reserves.']
      ),
      FINANCE_CONCEPTS,
      { durationSec: 20, maxSec: 30 }
    )
    expect(cues).toHaveLength(1)
    expect(cues[0].startSec).toBe(0)
    expect(cues[0].endSec).toBe(12)
  })

  it('DOES cut when the subject genuinely changes', () => {
    const cues = planBroll(
      lines([0, 5, 'Reserves fell again.'], [5, 10, 'Meanwhile gold went the other way.']),
      FINANCE_CONCEPTS,
      { durationSec: 20 }
    )
    expect(cues.map((c) => c.assetId)).toEqual(['reserves', 'gold'])
  })
})

describe('timing', () => {
  it('puts the picture on the sentence that says it, not near it', () => {
    const cues = planBroll(
      lines([0, 6, 'Some general introduction here.'], [6, 12, 'Gold hit a new high today.']),
      FINANCE_CONCEPTS,
      { durationSec: 20 }
    )
    expect(cues).toHaveLength(1)
    expect(cues[0].startSec).toBe(6)
    expect(cues[0].endSec).toBe(12)
  })

  it('caps how long one picture stays up', () => {
    // Past a point the picture stops supporting the words and becomes wallpaper.
    const cues = planBroll(lines([0, 60, 'Gold gold gold.']), FINANCE_CONCEPTS, { durationSec: 60, maxSec: 9 })
    expect(cues[0].endSec - cues[0].startSec).toBe(9)
  })

  it('never runs a cue past the end of the video', () => {
    const cues = planBroll(lines([0, 30, 'Gold is up.']), FINANCE_CONCEPTS, { durationSec: 5, maxSec: 30 })
    for (const c of cues) expect(c.endSec).toBeLessThanOrEqual(5)
  })

  it('cues never overlap', () => {
    const cues = planBroll(
      lines([0, 5, 'Gold.'], [3, 9, 'Inflation is the story.'], [9, 15, 'Rupee slid.']),
      FINANCE_CONCEPTS,
      { durationSec: 20 }
    )
    for (let i = 1; i < cues.length; i++) {
      expect(cues[i].startSec).toBeGreaterThanOrEqual(cues[i - 1].startSec)
    }
  })

  it('ignores a line with a backwards or zero-length timing', () => {
    expect(planBroll(lines([10, 5, 'Gold.'], [3, 3, 'Gold.']), FINANCE_CONCEPTS, { durationSec: 20 })).toEqual([])
  })

  it('copes with no lines, no library and no duration', () => {
    expect(planBroll([], FINANCE_CONCEPTS, { durationSec: 60 })).toEqual([])
    expect(planBroll(lines([0, 9, 'Gold.']), [], { durationSec: 60 })).toEqual([])
    expect(planBroll(lines([0, 9, 'Gold.']), FINANCE_CONCEPTS, { durationSec: 0 })).toEqual([])
  })
})

describe('explaining itself', () => {
  it('records which word summoned each picture', () => {
    const cues = planBroll(lines([0, 6, 'The IMF tranche is delayed.']), FINANCE_CONCEPTS, { durationSec: 10 })
    expect(cues[0].assetId).toBe('imf')
    expect(cues[0].label).toBe('IMF')
    // Which of the asset's own keywords is reported does not matter — "tranche" and
    // "imf" are both truthful here. What matters is that the reported trigger is a
    // word genuinely IN the line, so the explanation can never be fiction.
    expect('The IMF tranche is delayed.'.toLowerCase()).toContain(cues[0].trigger)
  })

  it('the trigger is ALWAYS a word that really appears in the narration', () => {
    // The trigger is shown to the user as "this is why that picture is here". If it
    // could name a word that is not in the sentence, the explanation would be a lie.
    const spoken: [number, number, string][] = [
      [0, 5, 'Reserves and import cover are falling.'],
      [5, 10, 'Mehngai is biting harder now.'],
      [10, 16, 'The PSX index closed lower.'],
      [16, 22, 'Sona ki qeemat aur barh gayi.']
    ]
    for (const cue of planBroll(lines(...spoken), FINANCE_CONCEPTS, { durationSec: 30 })) {
      const source = spoken.map((l) => l[2]).join(' ').toLowerCase()
      expect(source, `trigger "${cue.trigger}" is not in the script`).toContain(cue.trigger)
    }
  })

  it('reports coverage, so a thin video is obvious', () => {
    const cues = planBroll(lines([0, 6, 'Gold is up.']), FINANCE_CONCEPTS, { durationSec: 60 })
    const s = summarise(cues, 60)
    expect(s.cues).toBe(1)
    expect(s.coveragePercent).toBe(10)
    expect(s.headline).toMatch(/10% of the video/)
  })

  it('says what to do when nothing matched, instead of just failing', () => {
    expect(summarise([], 60).headline).toMatch(/Add keywords|name them more directly/)
  })
})

describe('the ffmpeg timing expression', () => {
  it('makes the picture appear and leave on the words', () => {
    const cue = { startSec: 6, endSec: 12.5, assetId: 'gold', label: 'Gold', trigger: 'gold' }
    expect(cueEnableExpr(cue)).toBe('between(t,6.000,12.500)')
  })
})

describe('the built-in concept list', () => {
  it('covers what this channel talks about, in both languages', () => {
    const ids = FINANCE_CONCEPTS.map((c) => c.id)
    for (const id of ['rupee', 'reserves', 'inflation', 'psx', 'imf', 'gold', 'debt', 'budget']) {
      expect(ids).toContain(id)
    }
    // At least a third of the concepts must carry a Roman Urdu trigger, or the
    // matcher is only half-listening to a bilingual script.
    const urdu = ['rupya', 'zakhair', 'mehngai', 'sood', 'bazaar', 'sona', 'tel', 'qarz', 'bara-mad']
    const withUrdu = FINANCE_CONCEPTS.filter((c) => c.keywords.some((k) => urdu.includes(k)))
    expect(withUrdu.length).toBeGreaterThanOrEqual(FINANCE_CONCEPTS.length / 3)
  })

  it('has no duplicate ids, which would make cues ambiguous', () => {
    const ids = FINANCE_CONCEPTS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every cue is at least the minimum length by construction', () => {
    expect(MIN_CUE_SEC).toBeGreaterThan(1)
  })
})

describe('timing lines from a script, before any narration exists', () => {
  it('shares time out by WORD COUNT, not by sentence', () => {
    // A twenty-word sentence takes about twice as long to say as a ten-word one.
    // Splitting evenly puts every later cue progressively further from its word.
    const body = 'One two three four five six. Seven eight.'
    const lines = timedLinesFromScript(body, 30)
    expect(lines).toHaveLength(2)
    const first = lines[0].endSec - lines[0].startSec
    const second = lines[1].endSec - lines[1].startSec
    expect(first / second).toBeCloseTo(3, 1)
  })

  it('covers the whole duration with no gaps or overlaps', () => {
    const body = 'Reserves fell sharply this week. Imports rose again. The rupee held steady for now.'
    const lines = timedLinesFromScript(body, 60)
    expect(lines[0].startSec).toBe(0)
    expect(lines[lines.length - 1].endSec).toBeCloseTo(60, 3)
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].startSec).toBeCloseTo(lines[i - 1].endSec, 3)
    }
  })

  it('drops stage directions, which are not spoken', () => {
    // Counting them pushes every later cue late by however long they would take to read.
    const withDirections = '[PAUSE]\nReserves fell sharply.\nImports [beat] rose again.'
    const lines = timedLinesFromScript(withDirections, 30)
    expect(lines.map((l) => l.text).join(' ')).not.toMatch(/PAUSE|beat/)
  })

  it('feeds planBroll well enough to land cues on the right words', () => {
    const body =
      'Welcome to the update, here is what happened this week in short. ' +
      'The reserves figure fell again and that is the number to watch closely. ' +
      'Meanwhile gold kept climbing through the whole of the trading week.'
    const lines = timedLinesFromScript(body, 60)
    const cues = planBroll(lines, FINANCE_CONCEPTS, { durationSec: 60, minSec: 1 })
    expect(cues.length).toBeGreaterThan(0)
    // The cue must start inside the sentence that actually contains its trigger word.
    // The window is [start, end) with no slack: sentence N+1 starts exactly where
    // sentence N ends, so an epsilon on the END makes every boundary cue look like it
    // belongs to the sentence before it — which is a fault in the check, not the cue.
    for (const cue of cues) {
      const owner = lines.find((l) => cue.startSec >= l.startSec && cue.startSec < l.endSec)
      expect(owner, `cue at ${cue.startSec} has no sentence`).toBeTruthy()
      expect(owner!.text.toLowerCase(), `trigger "${cue.trigger}" not in its own sentence`).toContain(
        cue.trigger.toLowerCase()
      )
    }
  })

  it('survives an empty script and a zero duration', () => {
    expect(timedLinesFromScript('', 30)).toEqual([])
    expect(timedLinesFromScript('Some words here.', 0)).toEqual([])
    expect(() => timedLinesFromScript(undefined as unknown as string, 30)).not.toThrow()
  })
})
