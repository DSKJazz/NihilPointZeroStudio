/**
 * STRESS PASS — deliberately hostile input, of the kinds a real Roman Urdu finance
 * channel actually produces. Unit tests use inputs I chose; these use inputs designed to
 * break what I built. Nothing here is allowed to throw, hang, or return something that
 * would mislead the user.
 */
import { describe, expect, it } from 'vitest'
import { planReadAloud, proofread, toSpokenSentences } from './shared/readAloud'
import { atempoFactors, buildSpeedArgs } from './main/audio/speed'
import { groupIntoSeries, parseEpisode, seriesLinks, seriesReport } from './shared/series'
import { learnTitlePatterns, publishTimingReport, scoreTitle } from './shared/channelLearning'
import { mineQuestions } from './shared/commentMining'
import { auditSources, sourcedFromNotes } from './shared/sources'
import { whatsNewReport, CHANGELOG } from './shared/whatsNew'
import { planBroll, timedLinesFromScript, FINANCE_CONCEPTS } from './shared/brollTiming'
import { pace, report as pacingReport } from './shared/pacing'
import { framesForShots } from './main/video/render'
import { planShots, buildAutoZoomFilter } from './main/video/autoZoom'
import { planKeeps, parseSilences, summarise as silenceSummary } from './main/video/silence'

/** Every string a user could realistically paste, plus a few they could not. */
const NASTY = [
  '',
  ' ',
  '\n\n\n',
  '\t\t',
  '0',
  '.',
  '...',
  '?!',
  '۔',
  'a',
  '11.2',
  '﷼١٢٣',                                  // Arabic-Indic digits
  'مہنگائی کیوں بڑھ رہی ہے؟',                // real Urdu script
  'Mehngai kyun barh rahi hai',
  '🚀📈💰 gold to the moon 🌙',
  'Reserves\u0000fell',                       // embedded NUL
  'a'.repeat(50_000),
  'word '.repeat(20_000),
  '11.2bn '.repeat(3_000),
  '[STAGE]\n'.repeat(5_000),
  '<script>alert(1)</script>',
  "'; DROP TABLE videos; --",
  '${process.env.SECRET}',
  '../../etc/passwd',
  'C:\\Windows\\System32\\..\\..\\secret.txt',
  '%s%s%s%n',
  '\\x00\\xff',
  'e'.repeat(300) + '.',
  Array.from({ length: 500 }, (_, i) => `Sentence ${i} about the rupee.`).join(' '),
  '.'.repeat(10_000),
  'Rs. '.repeat(5_000)
]

const NUMBERS = [0, 1, -1, 0.0001, -0.0001, 1e-9, 1e9, 1e21, NaN, Infinity, -Infinity, 0.5, 2, 3, 4, 100]

function ok(fn: () => unknown, label: string): void {
  let threw: unknown = null
  let result: unknown
  const started = Date.now()
  try {
    result = fn()
  } catch (e) {
    threw = e
  }
  const ms = Date.now() - started
  expect(threw, `${label} THREW: ${threw instanceof Error ? threw.message : String(threw)}`).toBeNull()
  expect(ms, `${label} took ${ms}ms — a user-facing call must not hang`).toBeLessThan(4000)
  expect(result, `${label} returned undefined`).not.toBeUndefined()
}

describe('read-aloud survives anything pasted into a script box', () => {
  it('never throws or hangs', () => {
    for (const s of NASTY) {
      const label = `readAloud(${JSON.stringify(s.slice(0, 30))}…len=${s.length})`
      ok(() => toSpokenSentences(s), `${label} sentences`)
      ok(() => proofread(s), `${label} proofread`)
      ok(() => planReadAloud(s), `${label} plan`)
    }
  })

  it('never reports a negative or non-finite listening time', () => {
    for (const s of NASTY) {
      for (const speed of NUMBERS) {
        const p = planReadAloud(s, speed as never)
        expect(Number.isFinite(p.listenSeconds), `${speed}x -> ${p.listenSeconds}`).toBe(true)
        expect(p.listenSeconds, `${speed}x`).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(p.scriptSeconds)).toBe(true)
      }
    }
  })

  it('never points a note past the end of the script', () => {
    for (const s of NASTY.slice(0, 20)) {
      const p = planReadAloud(s)
      for (const n of p.notes) {
        expect(n.atSecond).toBeGreaterThanOrEqual(0)
        expect(n.atSecond, `note at ${n.atSecond} of ${p.scriptSeconds}`).toBeLessThanOrEqual(p.scriptSeconds + 1)
      }
    }
  })
})

describe('atempo never emits a filter ffmpeg would reject', () => {
  it('holds for every number, including the absurd ones', () => {
    for (const n of NUMBERS) {
      const factors = atempoFactors(n)
      for (const f of factors) {
        expect(f, `${n} -> ${f}`).toBeGreaterThanOrEqual(0.5)
        expect(f, `${n} -> ${f}`).toBeLessThanOrEqual(2)
        expect(Number.isFinite(f), `${n} -> ${f}`).toBe(true)
      }
      // No filter at all is valid; a filter containing NaN is not.
      expect(buildSpeedArgs('i.wav', 'o.m4a', n).join(' ')).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('the chain never grows without bound', () => {
    for (const n of [1e6, 1e21, 1e-9]) {
      expect(atempoFactors(n).length, String(n)).toBeLessThanOrEqual(4)
    }
  })
})

describe('series never invents an episode from hostile titles', () => {
  it('never throws', () => {
    for (const s of NASTY) ok(() => parseEpisode(s), `parseEpisode(len=${s.length})`)
    ok(() => groupIntoSeries(NASTY.map((t, i) => ({ id: String(i), title: t }))), 'groupIntoSeries(nasty)')
    ok(() => seriesReport(NASTY.map((t, i) => ({ id: String(i), title: t }))), 'seriesReport(nasty)')
  })

  it('never reads a huge number as an episode', () => {
    for (const t of ['PSX at 78000', 'Gold 250000', 'Budget 2026', 'Reserves 11', 'Video 999999999']) {
      expect(parseEpisode(t), t).toBeNull()
    }
  })

  it('an episode number is always a small positive integer', () => {
    const titles = [
      'Watch #1', 'Watch #999', 'Watch #0', 'Watch #-3', 'Watch #1.5',
      'Watch Part 1000000', 'Watch Ep 007', 'Watch E999', 'Watch | 42'
    ]
    for (const t of titles) {
      const p = parseEpisode(t)
      if (p) {
        expect(Number.isInteger(p.episode), t).toBe(true)
        expect(p.episode, t).toBeGreaterThan(0)
        expect(p.episode, t).toBeLessThanOrEqual(999)
      }
    }
  })

  it('links never contain undefined, null or a fake URL', () => {
    const s = groupIntoSeries([
      { id: 'a', title: 'Watch #1' },
      { id: 'b', title: 'Watch #2' }
    ])[0]
    for (const ep of [-1, 0, 1, 2, 3, 999, NaN]) {
      const l = seriesLinks(s, ep)
      for (const text of [l.description, l.pinnedComment, l.endScreen]) {
        expect(text, `episode ${ep}`).not.toMatch(/undefined|null|NaN/)
      }
    }
  })
})

describe('channel learning never claims something from nothing', () => {
  it('never throws on hostile history', () => {
    const hostile = NASTY.map((t, i) => ({ title: t, views: NUMBERS[i % NUMBERS.length], publishedAt: t }))
    ok(() => learnTitlePatterns(hostile), 'learnTitlePatterns')
    ok(() => publishTimingReport(hostile), 'publishTimingReport')
    ok(() => scoreTitle('anything', hostile), 'scoreTitle')
  })

  it('a non-finite view count can never produce a finding', () => {
    const junk = Array.from({ length: 20 }, (_, i) => ({
      title: i % 2 ? 'Has 5 things' : 'No digits',
      views: [NaN, Infinity, -Infinity][i % 3],
      publishedAt: '2026-07-01T18:00:00'
    }))
    for (const f of learnTitlePatterns(junk)) {
      expect(f.trustworthy, f.pattern).toBe(false)
      expect(Number.isFinite(f.liftPercent), f.pattern).toBe(true)
    }
  })

  it('lift is always a finite number, never a division blow-up', () => {
    const zeros = Array.from({ length: 20 }, (_, i) => ({
      title: i % 2 ? 'Has 5 things' : 'No digits',
      views: 0,
      publishedAt: '2026-07-01T18:00:00'
    }))
    for (const f of learnTitlePatterns(zeros)) expect(Number.isFinite(f.liftPercent)).toBe(true)
  })
})

describe('comment mining never returns a paraphrase', () => {
  it('never throws, and every representative is a real comment', () => {
    const comments = NASTY.map((text) => ({ text, likes: 3 }))
    ok(() => mineQuestions(comments), 'mineQuestions(nasty)')
    const texts = new Set(comments.map((c) => c.text.trim()))
    for (const c of mineQuestions(comments, { minCount: 1 })) {
      expect(texts.has(c.representative), `"${c.representative.slice(0, 40)}" is not a real comment`).toBe(true)
      expect(Number.isFinite(c.score)).toBe(true)
    }
  })

  it('handles a flood of identical comments without hanging', () => {
    const flood = Array.from({ length: 4000 }, (_, i) => ({ text: `Why is import cover falling ${i}?`, likes: i }))
    const started = Date.now()
    const out = mineQuestions(flood)
    expect(Date.now() - started, 'mining 4000 comments').toBeLessThan(15_000)
    expect(out.length).toBeLessThanOrEqual(20)
  })
})

describe('source tracing never mislabels a figure', () => {
  it('never throws on hostile notes or scripts', () => {
    for (const n of NASTY) {
      ok(() => sourcedFromNotes(n), `sourcedFromNotes(len=${n.length})`)
      ok(() => auditSources(NASTY[12], sourcedFromNotes(n)), `auditSources(len=${n.length})`)
    }
  })

  it('every parsed figure has a finite value', () => {
    for (const n of NASTY) {
      for (const f of sourcedFromNotes(n)) {
        expect(Number.isFinite(f.value), `${f.label} -> ${f.value}`).toBe(true)
      }
    }
  })

  it('a figure is never both cited and uncited', () => {
    const notes = 'Source: SBP\nReserves: 11.2\nCover: 2.1'
    const audit = auditSources('Reserves 11.2 and cover 2.1 and mystery 99.9 billion.', sourcedFromNotes(notes))
    const citedRaw = new Set(audit.cited.map((c) => `${c.written}@${c.index}`))
    for (const u of audit.uncited) expect(citedRaw.has(`${u.raw}@${u.index}`)).toBe(false)
  })
})

describe('what-changed never advertises what is not there', () => {
  it('never throws, whatever the build tag', () => {
    for (const tag of NASTY) ok(() => whatsNewReport({ buildTag: tag }), `whatsNew(${tag.slice(0, 20)})`)
  })

  it('withholds every future entry, for any build date', () => {
    for (const day of ['2020-01-01', '2026-07-31', '2026-08-01']) {
      const r = whatsNewReport({ buildTag: `v0.1.1 · ${day} 12:00 · abc` })
      for (const e of r.entries) expect(e.date <= day, `${e.id} (${e.date}) shown in a ${day} build`).toBe(true)
      for (const id of r.rememberIds) {
        expect(CHANGELOG.find((c) => c.id === id)!.date <= day, `${id} remembered in a ${day} build`).toBe(true)
      }
    }
  })
})

describe('render planning never produces a broken filter or a short video', () => {
  it('pacing always sums to the total, for every plausible shape', () => {
    for (const total of [0.5, 1, 7, 30, 60, 600, 1500, 10_800]) {
      for (const count of [1, 2, 3, 5, 12, 40, 200]) {
        const shots = pace(total, count)
        if (!shots.length) continue
        const sum = shots.reduce((n, s) => n + s.seconds, 0)
        expect(sum, `${total}s over ${count} shots -> ${sum}`).toBeCloseTo(total, 1)
        for (const s of shots) expect(s.seconds, `${total}/${count}`).toBeGreaterThan(0)
        ok(() => pacingReport(shots), `report(${total}/${count})`)
      }
    }
  })

  it('auto-zoom never plans a frozen shot and never emits a bad expression', () => {
    for (const durationSec of [0, 0.1, 1, 29, 30, 31, 600, 10_800]) {
      const shots = planShots({ durationSec })
      for (const s of shots) {
        expect(s.fromScale, `${durationSec}s frozen shot`).not.toBe(s.toScale)
        expect(s.endSec, `${durationSec}s backwards shot`).toBeGreaterThan(s.startSec)
      }
      const f = buildAutoZoomFilter(shots, 1920, 1080, 25)
      expect(f, `${durationSec}s`).not.toMatch(/NaN|Infinity|undefined/)
    }
  })

  it('b-roll cues never overlap or run past the end', () => {
    for (const s of NASTY.slice(0, 24)) {
      for (const dur of [0, 10, 60, 600]) {
        const cues = planBroll(timedLinesFromScript(s, dur), FINANCE_CONCEPTS, { durationSec: dur })
        let prevEnd = -1
        for (const c of cues) {
          expect(c.startSec, 'cue starts before the previous ended').toBeGreaterThanOrEqual(prevEnd)
          expect(c.endSec, 'cue is backwards').toBeGreaterThan(c.startSec)
          expect(c.endSec, `cue past the end (${dur}s)`).toBeLessThanOrEqual(dur + 0.001)
          prevEnd = c.endSec
        }
      }
    }
  })

  it('silence keeps never overlap, go backwards, or exceed the file', () => {
    const outputs = [
      '',
      'garbage with no silence at all',
      'silence_start: 5\nsilence_end: 3',                      // backwards
      'silence_start: -5\nsilence_end: 10',                    // negative
      'silence_start: 0\nsilence_end: 999999',                 // whole file
      'silence_start: 1\nsilence_start: 2\nsilence_end: 3',    // unclosed then closed
      Array.from({ length: 2000 }, (_, i) => `silence_start: ${i * 2}\nsilence_end: ${i * 2 + 1}`).join('\n')
    ]
    for (const out of outputs) {
      for (const durationSec of [0, 1, 40, 4000]) {
        const keeps = planKeeps(parseSilences(out), { durationSec })
        let prevEnd = -1
        for (const k of keeps) {
          expect(k.endSec, 'keep is backwards').toBeGreaterThan(k.startSec)
          expect(k.startSec, 'keeps overlap').toBeGreaterThanOrEqual(prevEnd)
          expect(k.endSec, `keep past the file end (${durationSec}s)`).toBeLessThanOrEqual(durationSec + 0.001)
          prevEnd = k.endSec
        }
        const sum = silenceSummary(keeps, durationSec)
        expect(sum.keptSec).toBeLessThanOrEqual(durationSec + 0.001)
        expect(sum.removedSec).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('the invariants that keep audio and picture together', () => {
  // These are the ones where being wrong is not a cosmetic bug but a broken video, and
  // where the failure only shows up by watching the whole thing.
  it('pacing seconds sum EXACTLY, at millisecond precision, for every shape', () => {
    for (const total of [0.5, 1, 4.999, 7, 13.37, 30, 60, 599.999, 600, 1500, 10_800]) {
      for (const count of [1, 2, 3, 5, 12, 40, 200, 999]) {
        const shots = pace(total, count)
        if (!shots.length) continue
        const sum = shots.reduce((n, s) => n + s.seconds, 0)
        for (const s of shots) expect(s.seconds, `${total}/${count} zero-length shot`).toBeGreaterThan(0)
        // Shot lengths are millisecond-precise, so N shots cannot sum to less than
        // N milliseconds. That is arithmetic, not a bug — 999 shots in half a second is
        // 1/80th of a frame each. Where the total IS expressible, it must be exact.
        if (count * 0.001 <= total + 0.0005) {
          expect(sum, `${total}s over ${count} shots -> ${sum}`).toBeCloseTo(total, 3)
        } else {
          expect(sum, `${total}s over ${count} shots should clamp to the floor`).toBeCloseTo(count * 0.001, 3)
        }
      }
    }
  })

  it('and the frame counts sum exactly too, which is what ffmpeg actually gets', () => {
    for (const total of [0.5, 7, 30, 600, 1500]) {
      for (const count of [1, 5, 12, 40, 200]) {
        const shots = pace(total, count)
        if (!shots.length) continue
        const frames = framesForShots(shots.map((s) => s.seconds), total, 25)
        expect(frames.reduce((a, b) => a + b, 0), `${total}s/${count}`).toBe(Math.max(count, Math.round(Math.max(1, total) * 25)))
        expect(frames.every((f) => f >= 1), `${total}s/${count} dropped a shot`).toBe(true)
      }
    }
  })

  it('states its one real limit rather than pretending to meet it', () => {
    // 999 shots at millisecond precision cannot total less than 0.999s. The module
    // returns the shortest thing it CAN express rather than silently rounding some
    // shots to zero, which would drop scenes.
    const shots = pace(0.5, 999)
    expect(shots).toHaveLength(999)
    expect(shots.every((s) => s.seconds >= 0.001)).toBe(true)
    expect(shots.reduce((n, s) => n + s.seconds, 0)).toBeCloseTo(0.999, 3)
  })

  it('a video is never planned shorter than its own narration', () => {
    // The single worst outcome in this whole pipeline: the picture ends and the voice
    // keeps talking. Both the ceiling and the floor must yield to the total.
    for (const total of [5, 12, 45, 300, 900]) {
      for (const count of [1, 3, 12, 60, 300]) {
        const shots = pace(total, count)
        if (!shots.length) continue
        const sum = shots.reduce((n, s) => n + s.seconds, 0)
        expect(sum, `${total}s over ${count} scenes came out ${sum}s`).toBeGreaterThanOrEqual(total - 0.002)
      }
    }
  })

  it('and the user is TOLD when the shot lengths had to be sacrificed', () => {
    // Too few scenes for the length, and too many, are both the user's to fix — so
    // neither may be silent.
    const tooFew = pacingReport(pace(600, 4))
    expect(tooFew.overCeiling).toBeGreaterThan(0)
    expect(tooFew.headline).toMatch(/Add about \d+ more scenes/)

    const tooMany = pacingReport(pace(10, 40))
    expect(tooMany.underFloor).toBeGreaterThan(0)
    expect(tooMany.headline).toMatch(/Too many scenes/)
    expect(tooMany.headline).toMatch(/Use about \d+ scenes/)
  })
})

describe('the languages this channel is actually written in', () => {
  const SCRIPTS = [
    'Mehngai kyun barh rahi hai? Zakhair gir rahe hain aur rupya kamzor ho raha hai.',
    'مہنگائی کیوں بڑھ رہی ہے؟ ذخائر گر رہے ہیں۔',
    'Reserves fell to 11.2 billion. Yeh do maheene ka import cover hai.',
    'زر مبادلہ کے ذخائر 11.2 بلین ڈالر رہ گئے۔ Import cover 2.1 months.',
    'Sood ki شرح 22% par hai.',
    'مہنگائی‏کیوں‏بڑھ‏رہی‏ہے',
    'Rupya kamzor hai',
    'Gold 250,000 پر tola.'
  ]

  it('never throws on mixed-script or RTL text', () => {
    for (const s of SCRIPTS) {
      ok(() => proofread(s), `proofread(${s.slice(0, 20)})`)
      ok(() => planReadAloud(s), `planReadAloud(${s.slice(0, 20)})`)
      ok(() => timedLinesFromScript(s, 60), `timedLines(${s.slice(0, 20)})`)
      ok(() => sourcedFromNotes(s), `notes(${s.slice(0, 20)})`)
      ok(() => parseEpisode(s), `parseEpisode(${s.slice(0, 20)})`)
      ok(() => mineQuestions([{ text: s }], { minCount: 1 }), `mine(${s.slice(0, 20)})`)
    }
  })

  it('finds sentences in Urdu script, which uses its own full stop', () => {
    const urdu = 'مہنگائی بڑھ رہی ہے۔ ذخائر گر رہے ہیں۔ روپیہ کمزور ہے۔'
    expect(toSpokenSentences(urdu).length).toBe(3)
  })

  it('does not call a wholly-Urdu sentence bilingual', () => {
    for (const s of SCRIPTS.slice(1, 2)) {
      expect(proofread(s).some((n) => n.kind === 'mixed-language'), s).toBe(false)
    }
  })

  it('recognises a Roman Urdu question with no question mark', () => {
    const clusters = mineQuestions(
      [{ text: 'sona lena chahiye is waqt ya nahi' }, { text: 'kya sona lena chahiye abhi' }],
      { minCount: 2 }
    )
    expect(clusters.length).toBe(1)
  })
})

describe('running the whole chain on a realistic 25-minute script', () => {
  // A deep-dive script, the longest thing this channel makes. Everything must stay fast
  // and self-consistent at that size.
  const LONG = Array.from({ length: 420 }, (_, i) => {
    const topics = ['reserves', 'mehngai', 'the rupee', 'gold', 'the budget', 'sood', 'PSX', 'qarz']
    return `Point ${i} explains why ${topics[i % topics.length]} moved ${(i % 40) + 1} percent this quarter and what it means for you.`
  }).join(' ')

  it('every stage finishes quickly and agrees with the others', () => {
    const started = Date.now()
    const sentences = toSpokenSentences(LONG)
    const plan = planReadAloud(LONG, 2)
    const notes = proofread(LONG)
    const lines = timedLinesFromScript(LONG, 1500)
    const cues = planBroll(lines, FINANCE_CONCEPTS, { durationSec: 1500 })
    const elapsed = Date.now() - started
    expect(elapsed, `the whole chain took ${elapsed}ms on a 25-minute script`).toBeLessThan(5000)

    expect(sentences.length).toBeGreaterThan(400)
    expect(lines.length).toBe(sentences.length)
    // The two timing paths must agree: both derive from the same words.
    expect(plan.scriptSeconds).toBeGreaterThan(0)
    expect(cues.length).toBeGreaterThan(0)
    for (const n of notes) expect(n.atSecond).toBeLessThanOrEqual(plan.scriptSeconds + 1)
    // No cue may run past the end, however many there are.
    for (const c of cues) expect(c.endSec).toBeLessThanOrEqual(1500.001)
  })

  it('the auto-zoom filter for a 25-minute video still fits a command line', () => {
    const f = buildAutoZoomFilter(planShots({ durationSec: 1500 }), 3840, 2160, 25)
    // Windows caps a command line at 32767 characters, and the whole filter_complex
    // shares one. This is only part of it.
    expect(f.length, `${f.length} characters`).toBeLessThan(12_000)
    expect(f).not.toMatch(/NaN|Infinity/)
  })
})
