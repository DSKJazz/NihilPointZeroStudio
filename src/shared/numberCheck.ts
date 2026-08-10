/**
 * Checks every number in a script against the data actually imported.
 *
 * WHAT THIS IS FOR
 * `factFlags.ts` already points at claims that NEED a source. This answers the next
 * question, which is the one that matters before you press record: of the numbers in
 * this script, which are backed by the data on this machine, and which did I type from
 * memory? On a finance channel one wrong figure is not a typo — it is the credibility
 * of the whole channel, published.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * It does not decide whether a number is TRUE. It reports whether the number appears in
 * data the user imported, and says so in those words. A number can be unbacked and
 * perfectly correct — the point is to make the author look at it, not to overrule them.
 *
 * Pure and deterministic. No AI: the same script gives the same answer every time, and
 * it can never hallucinate a match.
 */

export interface KnownFigure {
  /** Where it came from, in words the user recognises: "KSE-100 close, 2026-07-31". */
  label: string
  value: number
  /** Optional unit hint, only used to sharpen the explanation. */
  unit?: string
}

export type NumberVerdict = 'backed' | 'rounded' | 'unbacked' | 'ordinary'

export interface CheckedNumber {
  /** Exactly as written in the script. */
  raw: string
  value: number
  /** Character offset in the script, so the UI can jump to it. */
  index: number
  /** A little of the sentence around it. */
  excerpt: string
  verdict: NumberVerdict
  /** The imported figure it matched, when it matched one. */
  matched?: KnownFigure
  /** Plain-English note for the writer. */
  note: string
}

/**
 * Numbers small enough to be ordinary language rather than data — "three reasons",
 * "the top 5", "2 minutes". Flagging those buries the two figures that matter under
 * forty that don't, and a checker nobody reads protects nobody.
 */
const ORDINARY_MAX = 12

/** Years are dates, not measurements; they are checked elsewhere (factFlags). */
function looksLikeYear(value: number, raw: string): boolean {
  return !raw.includes('.') && Number.isInteger(value) && value >= 1900 && value <= 2199
}

/** Reads a written number, handling thousands separators and Urdu/English scales. */
export function parseNumber(raw: string): number {
  return Number(raw.replace(/,/g, ''))
}

const NUMBER = /\d[\d,]*(?:\.\d+)?/g

function excerptAround(text: string, index: number, length: number, pad = 45): string {
  const start = Math.max(0, index - pad)
  const end = Math.min(text.length, index + length + pad)
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ').trim()}${end < text.length ? '…' : ''}`
}

/**
 * True when `a` is `b` rounded — the honest, common case. A script saying "279.4" when
 * the data says 279.42 is not an error, and calling it one would train the user to
 * ignore this tool. Matched to the precision the SCRIPT used, which is the whole trick:
 * the author's own rounding decides the tolerance.
 */
export function isRoundingOf(written: string, actual: number): boolean {
  const dot = written.indexOf('.')
  const decimals = dot === -1 ? 0 : written.length - dot - 1
  const factor = 10 ** decimals
  return Math.round(actual * factor) / factor === parseNumber(written)
}

/** Same magnitude in different units — 11.2 billion vs 11_200_000_000. */
function scaledMatch(value: number, actual: number): boolean {
  for (const scale of [1e3, 1e5, 1e6, 1e7, 1e9]) {
    if (Math.abs(value * scale - actual) < Math.max(1, actual * 1e-9)) return true
    if (Math.abs(value / scale - actual) < Math.max(1e-9, Math.abs(actual) * 1e-9)) return true
  }
  return false
}

export interface CheckOptions {
  /** Numbers at or below this are treated as ordinary language, not data. */
  ordinaryMax?: number
  /** Skip year-like integers (they are date claims, handled by factFlags). */
  skipYears?: boolean
}

export function checkNumbers(
  script: string,
  known: KnownFigure[],
  options: CheckOptions = {}
): CheckedNumber[] {
  const ordinaryMax = options.ordinaryMax ?? ORDINARY_MAX
  const skipYears = options.skipYears !== false
  const text = script ?? ''
  const out: CheckedNumber[] = []

  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0]
    const index = m.index ?? 0
    const value = parseNumber(raw)
    if (!Number.isFinite(value)) continue

    const base: Omit<CheckedNumber, 'verdict' | 'note' | 'matched'> = {
      raw,
      value,
      index,
      excerpt: excerptAround(text, index, raw.length)
    }

    if (skipYears && looksLikeYear(value, raw)) {
      out.push({ ...base, verdict: 'ordinary', note: 'Looks like a year, not a measurement.' })
      continue
    }
    if (value <= ordinaryMax && Number.isInteger(value) && !raw.includes(',')) {
      out.push({ ...base, verdict: 'ordinary', note: 'Small round number — everyday language, not data.' })
      continue
    }

    const exact = known.find((k) => k.value === value)
    if (exact) {
      out.push({ ...base, verdict: 'backed', matched: exact, note: `Matches ${exact.label} exactly.` })
      continue
    }
    const rounded = known.find((k) => isRoundingOf(raw, k.value) || scaledMatch(value, k.value))
    if (rounded) {
      out.push({
        ...base,
        verdict: 'rounded',
        matched: rounded,
        note: `Matches ${rounded.label} (${rounded.value}${rounded.unit ? ` ${rounded.unit}` : ''}), rounded as you wrote it.`
      })
      continue
    }
    out.push({
      ...base,
      verdict: 'unbacked',
      note: 'Not in any data you imported. Check it against a named, dated source before recording.'
    })
  }
  return out
}

export interface CheckSummary {
  total: number
  backed: number
  rounded: number
  unbacked: number
  /** True when nothing needs the author's attention. */
  clean: boolean
  /** One line for the UI. */
  headline: string
}

export function summarise(checked: CheckedNumber[]): CheckSummary {
  const counted = checked.filter((c) => c.verdict !== 'ordinary')
  const backed = counted.filter((c) => c.verdict === 'backed').length
  const rounded = counted.filter((c) => c.verdict === 'rounded').length
  const unbacked = counted.filter((c) => c.verdict === 'unbacked').length
  const total = counted.length
  const clean = unbacked === 0
  let headline: string
  if (!total) headline = 'No figures in this script to check.'
  else if (clean) headline = `All ${total} figure${total === 1 ? '' : 's'} match data you imported.`
  else
    headline =
      `${unbacked} of ${total} figure${total === 1 ? '' : 's'} ` +
      `${unbacked === 1 ? 'is' : 'are'} not in any data you imported — check ${unbacked === 1 ? 'it' : 'them'} before recording.`
  return { total, backed, rounded, unbacked, clean, headline }
}

/**
 * Collects the figures out of whatever the user has imported, so the checker has
 * something to check against. Kept loose on purpose: it accepts the shapes the app
 * already produces rather than demanding a new one.
 */
export function figuresFromSeries(
  name: string,
  bars: { date?: string; close?: number; open?: number; high?: number; low?: number; volume?: number }[]
): KnownFigure[] {
  const out: KnownFigure[] = []
  for (const b of bars ?? []) {
    const when = b.date ? `, ${b.date}` : ''
    for (const [field, value] of [
      ['close', b.close],
      ['open', b.open],
      ['high', b.high],
      ['low', b.low],
      ['volume', b.volume]
    ] as const) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        out.push({ label: `${name} ${field}${when}`, value })
      }
    }
  }
  return out
}
