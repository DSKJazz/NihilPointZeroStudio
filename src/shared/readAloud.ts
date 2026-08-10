/**
 * Proof the script BY EAR, at speed, before you record it.
 *
 * WHY READING SILENTLY IS NOT ENOUGH
 * A script is not read, it is spoken. Silent reading hides exactly the faults that ruin a
 * take: the sentence that cannot be said in one breath, the number that is ambiguous out
 * loud, the word repeated twice in a row that the eye skips over and the ear cannot. Every
 * one of those costs a retake — and on a twelve-minute finance script, a retake at minute
 * nine costs nine minutes.
 *
 * WHY AT SPEED
 * Listening to your own script at normal speed takes as long as the video. Nobody does it
 * twice. At double speed a twelve-minute script is a six-minute job, and speech stays
 * perfectly intelligible up to about 2× when the pitch is preserved — which is what makes
 * this practical rather than theoretical.
 *
 * WHAT THIS FILE IS
 * The listening PLAN and the proofreading checks. Pure, so both the desktop and the phone
 * get the same answer, and so the checks can be tested without generating any audio.
 * Speaking the words is a separate job (the existing offline voice), and turning the
 * result into a faster file is `src/main/audio/speed.ts`.
 *
 * NO AI HERE, ON PURPOSE
 * "Is this sentence hard to say?" looks like a job for a model, and a model would return
 * a fluent opinion that cannot be checked and changes between runs. Breath length, a
 * repeated word and an ambiguous number are all countable. Countable beats plausible when
 * the user is about to act on it.
 */

import { countSpokenWords, DEFAULT_WPM } from './teleprompter'

/** The playback speeds worth offering. 2× is the default: fast enough to be worth doing,
 * slow enough that nothing is missed. */
export const SPEED_CHOICES = [1, 1.25, 1.5, 1.75, 2, 2.5, 3] as const
export type ReadSpeed = (typeof SPEED_CHOICES)[number]

export const DEFAULT_SPEED: ReadSpeed = 2

/**
 * How long a comfortable spoken sentence runs before the speaker needs a breath.
 *
 * Not a style rule — a physical one. Past roughly this many spoken words most people
 * either rush the end of the sentence or take an audible breath in the middle of it, and
 * both are audible in the recording.
 */
export const BREATH_WORDS = 32

/** Past this, the sentence is not "long", it is unsayable and needs splitting. */
export const UNSAYABLE_WORDS = 48

export type ProofKind = 'breath' | 'unsayable' | 'repeat' | 'number' | 'tongue' | 'mixed-language'

export interface ProofNote {
  kind: ProofKind
  /** 0-based index of the sentence in the script. */
  sentence: number
  /** Where in the read-aloud the sentence starts, in seconds at 1×. */
  atSecond: number
  /** The sentence itself, verbatim — so the user can see what is meant. */
  text: string
  /** What is wrong and what to do, in one line of plain English. */
  note: string
}

/** A sentence, with where it falls in the spoken script. */
export interface SpokenSentence {
  index: number
  text: string
  words: number
  /** Start time in seconds at 1× speed. */
  startSec: number
  seconds: number
}

/**
 * Splits into sentences the way they will be SPOKEN.
 *
 * Stage directions in brackets are dropped: they are instructions to the presenter, not
 * words to say, and counting them would inflate every duration estimate. Decimal points
 * and common abbreviations must not split a sentence — "11.2 billion" is one sentence, not
 * two, and getting that wrong would make every number in a finance script look like a
 * fault.
 */
export function toSpokenSentences(script: string, wpm: number = DEFAULT_WPM): SpokenSentence[] {
  const spoken = (script ?? '')
    .split('\n')
    .filter((line) => !/^\s*\[[^\]]*\]\s*$/.test(line))
    .join(' ')
    // Strip inline stage directions too, e.g. "…and that [pause] is the problem."
    .replace(/\[[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const parts: string[] = []
  let buf = ''
  for (let i = 0; i < spoken.length; i++) {
    const ch = spoken[i]
    buf += ch
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '۔') continue
    const next = spoken[i + 1]
    // A digit either side of a dot is a decimal, not a full stop: "11.2 billion".
    if (ch === '.' && /\d/.test(spoken[i - 1] ?? '') && /\d/.test(next ?? '')) continue
    // "Rs." / "vs." / "No." — a capital letter word ending in a dot mid-sentence.
    if (ch === '.' && next === ' ' && /\b(?:Rs|vs|No|Mr|Dr|Sr|Jr|St|approx|etc|eg|ie)\.$/i.test(buf)) continue
    if (next && !/[\s"'”’)]/.test(next)) continue
    parts.push(buf.trim())
    buf = ''
  }
  if (buf.trim()) parts.push(buf.trim())

  const perWord = 60 / Math.max(1, wpm)
  let at = 0
  return parts
    .filter((t) => countSpokenWords(t) > 0)
    .map((text, index) => {
      const words = countSpokenWords(text)
      const seconds = words * perWord
      const s: SpokenSentence = { index, text, words, startSec: at, seconds }
      at += seconds
      return s
    })
}

/**
 * Roman Urdu CONTENT words — unmistakable. One of these in an otherwise English sentence
 * is real evidence of code-switching.
 *
 * Note what is deliberately absent: `the`. It is a Roman Urdu word ("tha/thi/the", was)
 * and it is also the most common word in English, so including it flagged plain English
 * sentences like "The State Bank says the drop came from a debt repayment" as bilingual.
 * That is precisely the cry-wolf failure that gets a proofreader switched off. The same
 * goes for `par`.
 */
const ROMAN_URDU_STRONG =
  /\b(?:mehngai|zakhair|rupya|rupaya|qarz|sood|bazaar|fisad|haqiqat|nuqsan|faida|matlab|samjhaye|dekhein|karor|arab|lakh|kyun|kaise|kahan|barh|raha|rahi|chahiye)\b/i

/** Roman Urdu FUNCTION words. Individually weak — two or more is what counts. */
const ROMAN_URDU_WEAK =
  /\b(?:hai|hain|nahi|nahin|aur|ka|ki|ke|ko|se|mein|kya|kab|ye|yeh|wo|woh|bhi|kuch|koi|tha|thi|karna|karta|karti|hoga|hogi|sona|abhi|aaj|lekin|magar|asal|dekho)\b/gi

/** English function words — a sentence with these AND Roman Urdu is code-switching. */
const ENGLISH_FUNCTION = /\b(?:the|and|is|are|was|were|of|to|in|that|this|with|from|because|which|would|will)\b/i

/**
 * Does this sentence switch between the two languages mid-way?
 *
 * Requires real evidence: an unmistakable Urdu content word, or at least TWO distinct
 * Urdu function words. A single weak match is how a whole-language false positive gets
 * in, and one false positive per paragraph is enough to make the user stop reading the
 * flags at all.
 */
export function isMixedLanguage(sentence: string): boolean {
  const text = sentence ?? ''
  if (!ENGLISH_FUNCTION.test(text)) return false
  if (ROMAN_URDU_STRONG.test(text)) return true
  const weak = new Set((text.toLowerCase().match(ROMAN_URDU_WEAK) ?? []).map((w) => w.trim()))
  return weak.size >= 2
}

/**
 * Numbers written in a form that is ambiguous or awkward the moment it is spoken.
 *
 * This is the single most common fault in a finance script: "PKR 11.2bn" reads fine and
 * cannot be said. The check is deliberately narrow — it fires on shorthand and on bare
 * long digit strings, not on ordinary figures, because a check that fires on every number
 * in a finance script is a check the user turns off.
 */
export function awkwardNumbers(sentence: string): string[] {
  const found: string[] = []
  // Shorthand suffixes: 11.2bn, 250k, 3trn, 45m.
  for (const m of sentence.matchAll(/\b\d[\d.,]*\s?(?:bn|trn|tn|mn|m|k|b)\b/gi)) found.push(m[0].trim())
  // Bare digit strings of 5+ digits with no separators — nobody can read 250000 aloud
  // at a glance.
  for (const m of sentence.matchAll(/\b\d{5,}\b/g)) found.push(m[0])
  // Ranges and ratios written with symbols: 11-12%, 1:3, 2/3.
  for (const m of sentence.matchAll(/\b\d+\s?[-–:/]\s?\d+\s?%?/g)) found.push(m[0].trim())
  return [...new Set(found)]
}

/** A word said twice in a row — invisible to the eye, obvious to the ear. */
export function repeatedWords(sentence: string): string[] {
  const words = sentence.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []
  const out: string[] = []
  for (let i = 1; i < words.length; i++) {
    if (words[i] === words[i - 1] && words[i].length > 1) out.push(words[i])
  }
  return [...new Set(out)]
}

/**
 * Three or more words in a row starting with the same sound.
 *
 * Deliberately conservative: alliteration is sometimes wanted, so this only fires at
 * three, and it is reported as something to listen for rather than something wrong.
 */
export function tongueTwisters(sentence: string): string[] {
  const words = (sentence.match(/[\p{L}]{3,}/gu) ?? []).map((w) => w.toLowerCase())
  const out: string[] = []
  let run: string[] = []
  for (const w of words) {
    if (run.length && run[run.length - 1][0] === w[0]) run.push(w)
    else run = [w]
    if (run.length >= 3) out.push(run.slice(-3).join(' '))
  }
  return [...new Set(out)]
}

/**
 * Everything to listen for, in the order it will be heard.
 *
 * Ordered by TIME rather than by severity on purpose: the user is listening straight
 * through, and a list ordered by severity makes them hunt backwards and forwards through
 * the audio.
 */
export function proofread(script: string, wpm: number = DEFAULT_WPM): ProofNote[] {
  const notes: ProofNote[] = []
  for (const s of toSpokenSentences(script, wpm)) {
    const base = { sentence: s.index, atSecond: Math.round(s.startSec * 10) / 10, text: s.text }
    if (s.words > UNSAYABLE_WORDS) {
      notes.push({
        ...base,
        kind: 'unsayable',
        note: `${s.words} words in one sentence — that cannot be said in one breath. Split it into two or three.`
      })
    } else if (s.words > BREATH_WORDS) {
      notes.push({
        ...base,
        kind: 'breath',
        note: `${s.words} words — long enough that you will either rush the end or breathe in the middle. Both are audible.`
      })
    }
    const repeats = repeatedWords(s.text)
    if (repeats.length) {
      notes.push({ ...base, kind: 'repeat', note: `"${repeats[0]}" is said twice in a row. The eye skips it; the ear will not.` })
    }
    const numbers = awkwardNumbers(s.text)
    if (numbers.length) {
      notes.push({
        ...base,
        kind: 'number',
        note: `"${numbers[0]}" cannot be read straight off the page. Write it the way you will say it.`
      })
    }
    if (isMixedLanguage(s.text)) {
      notes.push({
        ...base,
        kind: 'mixed-language',
        note: 'This sentence switches between English and Roman Urdu. Fine if deliberate — the offline voice will stumble on it, so listen to this one.'
      })
    }
    const twisters = tongueTwisters(s.text)
    if (twisters.length) {
      notes.push({ ...base, kind: 'tongue', note: `"${twisters[0]}" — three in a row on the same sound. Listen to this one.` })
    }
  }
  return notes.sort((a, b) => a.atSecond - b.atSecond || a.sentence - b.sentence)
}

export interface ReadAloudPlan {
  speed: ReadSpeed
  /** Length of the script spoken at normal speed. */
  scriptSeconds: number
  /** How long the user will actually spend listening. */
  listenSeconds: number
  /** Minutes saved versus listening at 1×, rounded. */
  minutesSaved: number
  sentences: SpokenSentence[]
  notes: ProofNote[]
  /** One line for the top of the screen. */
  headline: string
}

/** Seconds as "6m 12s" / "48s" — how a person would say it. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds))
  const m = Math.floor(total / 60)
  const s = total % 60
  return m ? `${m}m ${s}s` : `${s}s`
}

/**
 * The whole plan: how long this will take, what to listen for, and where each thing is.
 */
export function planReadAloud(script: string, speed: ReadSpeed = DEFAULT_SPEED, wpm: number = DEFAULT_WPM): ReadAloudPlan {
  const sentences = toSpokenSentences(script, wpm)
  const scriptSeconds = sentences.reduce((n, s) => n + s.seconds, 0)
  const rate = speed > 0 ? speed : 1
  const listenSeconds = scriptSeconds / rate
  const notes = proofread(script, wpm)
  const minutesSaved = Math.round((scriptSeconds - listenSeconds) / 60)

  let headline: string
  if (!sentences.length) headline = 'Nothing to read yet — write some script first.'
  else if (!notes.length) {
    headline = `${formatDuration(listenSeconds)} to listen at ${speed}×, and nothing flagged. Listen anyway — the ear catches what a check cannot.`
  } else {
    headline = `${notes.length} thing${notes.length === 1 ? '' : 's'} to listen for, in ${formatDuration(listenSeconds)} at ${speed}×${minutesSaved > 0 ? ` — ${minutesSaved} minute${minutesSaved === 1 ? '' : 's'} quicker than reading it out yourself` : ''}.`
  }

  return { speed, scriptSeconds, listenSeconds, minutesSaved, sentences, notes, headline }
}

/** The note at or before a given moment in the playback — drives "what am I hearing". */
export function noteAtPlaybackSecond(plan: ReadAloudPlan, playbackSecond: number): ProofNote | null {
  const atOriginal = playbackSecond * (plan.speed > 0 ? plan.speed : 1)
  let hit: ProofNote | null = null
  for (const n of plan.notes) {
    if (n.atSecond <= atOriginal) hit = n
    else break
  }
  return hit
}
