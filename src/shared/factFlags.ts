/**
 * FACT-CHECK FLAG PASS — pure, offline, deterministic. This channel's whole premise
 * is forensic, data-backed analysis, so every script can be swept for claims that
 * need a source BEFORE recording: figures, percentages, dates, superlatives, and
 * vague attributions. Bilingual (English + Roman Urdu), no AI involved — the same
 * scan gives the same flags every time, and it can never invent a "fact" itself.
 *
 * This does NOT verify anything — it points at what a careful editor must verify.
 * Unit-tested in factFlags.test.ts.
 */

export interface FactFlag {
  /** The matched text with a little surrounding context. */
  excerpt: string
  /** What kind of claim tripped the flag. */
  kind: 'figure' | 'percentage' | 'date' | 'superlative' | 'attribution'
  /** Plain-English advice for the writer. */
  advice: string
}

const RULES: { kind: FactFlag['kind']; advice: string; pattern: RegExp }[] = [
  {
    kind: 'percentage',
    advice: 'Confirm this percentage against the actual source and name it in the script.',
    pattern: /\d+(?:[.,]\d+)?\s?(?:%|percent|fisad|feesad|فیصد)/giu
  },
  {
    kind: 'figure',
    advice: 'A concrete figure — pin it to a dated, named source (SBP, PSX, PBS…).',
    pattern:
      /(?:PKR|Rs\.?|₨|\$|USD)\s?\d[\d,.]*|\d[\d,.]*\s?(?:billion|million|trillion|crore|lakh|arab|kharab|karor|ارب|کروڑ|لاکھ)/giu
  },
  {
    kind: 'date',
    advice: 'Check the year/date — a wrong one silently breaks the whole argument.',
    pattern: /\b(?:19|20)\d{2}\b/g
  },
  {
    kind: 'superlative',
    advice: 'Superlatives ("highest ever", "first time") need a verifiable record behind them.',
    pattern:
      /\b(?:highest|lowest|biggest|largest|worst|best)(?:\s+\w+){0,2}\s+(?:ever|in history|on record)\b|\b(?:first|last)\s+time\b|\brecord\s+(?:high|low)\b|\bnever\s+(?:before|seen)\b|sab\s?se\s+(?:bara|zyada|kam|buri|behtar)|تاریخ\s+میں\s+پہلی\s+بار/giu
  },
  {
    kind: 'attribution',
    advice: 'Vague attribution — name WHO said it, or cut the claim.',
    pattern:
      /\b(?:experts?\s+(?:say|believe|warn)|analysts?\s+(?:say|predict|expect)|reports?\s+suggest|sources?\s+(?:say|claim)|studies\s+show|it\s+is\s+said)\b|mahireen\s+(?:kehte|ka\s+kehna)|ماہرین\s+(?:کہتے|کا\s+کہنا)/giu
  }
]

const CONTEXT = 32
const MAX_FLAGS = 60

/** Sweeps a script and returns every claim a careful editor must verify, in order. */
export function flagUnverifiedClaims(text: string): FactFlag[] {
  const flags: FactFlag[] = []
  const seen = new Set<string>()
  for (const rule of RULES) {
    rule.pattern.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.pattern.exec(text)) !== null && flags.length < MAX_FLAGS) {
      const start = Math.max(0, m.index - CONTEXT)
      const end = Math.min(text.length, m.index + m[0].length + CONTEXT)
      const excerpt =
        (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '')
      const key = `${rule.kind}:${m[0].toLowerCase()}`
      if (seen.has(key)) continue
      seen.add(key)
      flags.push({ excerpt, kind: rule.kind, advice: rule.advice })
      if (rule.pattern.lastIndex === m.index) rule.pattern.lastIndex++ // zero-width safety
    }
  }
  // Keep the reading order stable: sort by where the excerpt appears in the text.
  return flags.sort((a, b) => text.indexOf(a.excerpt.replace(/^…/, '').slice(0, 12)) - text.indexOf(b.excerpt.replace(/^…/, '').slice(0, 12)))
}
