/**
 * Upload metadata in BOTH languages this channel is watched in.
 *
 * WHY THIS IS WORTH DOING
 * YouTube lets one video carry a title and description per language, and shows each
 * viewer the one matching their own interface. A Pakistani viewer with an Urdu phone and
 * a viewer in London with an English one can be shown the same video described in the
 * language they actually read. On a channel written half in Roman Urdu that is not a
 * nicety — it is the difference between a title that lands and one that is skipped.
 *
 * THE DETAIL EVERYONE GETS WRONG
 * Roman Urdu is not English, and it is not `ur` either. `ur` means Urdu written in the
 * Urdu script. Roman Urdu — Urdu written in Latin letters — is **`ur-Latn`**, and tagging
 * it as `en` tells YouTube to show it to English speakers who cannot read it, while
 * tagging it as `ur` tells YouTube it is in a script it is not in. Both are quietly
 * wrong, and both cost reach.
 *
 * WHAT THIS FILE WILL NOT DO
 * It will not translate. Producing an Urdu-script title by machine-mangling a Roman Urdu
 * one, or inventing an English "equivalent", would publish text nobody checked in a
 * language the tool cannot verify — on a channel whose credibility is the product. It
 * detects what has been written, labels it correctly, builds the structure, and says
 * plainly which language is still MISSING so it can be written or asked for.
 *
 * THE LIMITS ARE REAL AND THEY TRUNCATE SILENTLY
 * A title over 100 characters, a description over 5000, or tags over 500 characters in
 * total do not error — YouTube simply cuts them, usually mid-word, and the first anyone
 * knows is a title ending in "…". Every one of those is checked here.
 */

/** YouTube's actual published limits. Exceeding them truncates silently. */
export const MAX_TITLE = 100
export const MAX_DESCRIPTION = 5000
/** Total characters across ALL tags, including the commas YouTube counts. */
export const MAX_TAGS_TOTAL = 500
/** A single tag longer than this is rejected outright. */
export const MAX_TAG = 30

/**
 * BCP-47 codes YouTube accepts for this channel's two-and-a-half languages.
 *
 * `ur-Latn` is the one that matters and the one that gets left out.
 */
export type UploadLanguage = 'en' | 'ur' | 'ur-Latn'

export const LANGUAGE_NAMES: Record<UploadLanguage, string> = {
  en: 'English',
  ur: 'Urdu (Urdu script)',
  'ur-Latn': 'Roman Urdu (Urdu in English letters)'
}

/**
 * Urdu is written in the Arabic script, so the Unicode script property says it exactly.
 *
 * Written as a property escape rather than as a hand-built character range: the range form
 * needs literal Arabic characters in the source, and one of the ones I first used was an
 * invisible formatting character — flagged by lint, and impossible to see when reading the
 * file. This form is also correct for Arabic and Persian text, which is what you want.
 */
const URDU_SCRIPT = /\p{Script=Arabic}/u

/** Roman Urdu words that do not exist in English, so their presence is decisive. */
const ROMAN_URDU_WORDS =
  /\b(?:hai|hain|nahi|nahin|kyun|kaise|kya|mehngai|zakhair|rupya|rupaya|qarz|sood|bazaar|fisad|haqiqat|nuqsan|faida|matlab|samjhaye|dekhein|barh|raha|rahi|chahiye|karor|arab|lakh|aur|magar|lekin|abhi|aaj|sona|hoga|hogi|karna|karta|karti)\b/i

/**
 * Which language a piece of text is actually in.
 *
 * Script wins over vocabulary: any Urdu-script character means `ur`, whatever else is in
 * there, because that is what the reader's eye meets first. Latin text carrying Roman
 * Urdu vocabulary is `ur-Latn`. Everything else is `en`.
 */
export function detectLanguage(text: string): UploadLanguage {
  const t = text ?? ''
  if (URDU_SCRIPT.test(t)) return 'ur'
  if (ROMAN_URDU_WORDS.test(t)) return 'ur-Latn'
  return 'en'
}

/** How mixed a script is, as a share of its lines — for choosing the DEFAULT language. */
export function languageMix(text: string): Record<UploadLanguage, number> {
  const lines = (text ?? '')
    .split(/[\n.!?۔]+/)
    .map((l) => l.trim())
    .filter(Boolean)
  const counts: Record<UploadLanguage, number> = { en: 0, ur: 0, 'ur-Latn': 0 }
  for (const line of lines) counts[detectLanguage(line)]++
  const total = lines.length || 1
  return {
    en: counts.en / total,
    ur: counts.ur / total,
    'ur-Latn': counts['ur-Latn'] / total
  }
}

export interface LocalizedMeta {
  language: UploadLanguage
  title: string
  description: string
  /** Problems that would truncate or be rejected, in plain English. */
  problems: string[]
}

export interface DualLanguagePlan {
  /** The language the video is primarily in — what YouTube should treat as default. */
  defaultLanguage: UploadLanguage
  /** What has actually been written, one per language. */
  localizations: LocalizedMeta[]
  /** Languages with no text yet — never invented, only reported. */
  missing: UploadLanguage[]
  /** Tags, merged across scripts and trimmed to fit. */
  tags: string[]
  /** Tags dropped to stay inside the limit, so nothing disappears silently. */
  droppedTags: string[]
  headline: string
}

/** The problems that would silently truncate this text once uploaded. */
export function checkLimits(title: string, description: string): string[] {
  const problems: string[] = []
  const t = (title ?? '').trim()
  const d = (description ?? '').trim()
  if (!t) problems.push('No title.')
  else if (t.length > MAX_TITLE) {
    problems.push(
      `Title is ${t.length} characters — YouTube cuts it at ${MAX_TITLE}, usually mid-word. Trim ${t.length - MAX_TITLE}.`
    )
  } else if (t.length > 70) {
    // Not a limit, a fact: the tail is hidden on a phone, which is where most watching
    // happens. Reported as a note, not a problem to fix.
    problems.push(`Title is ${t.length} characters — everything past about 70 is hidden on a phone.`)
  }
  if (!d) problems.push('No description.')
  else if (d.length > MAX_DESCRIPTION) {
    problems.push(`Description is ${d.length} characters — YouTube cuts it at ${MAX_DESCRIPTION}.`)
  }
  return problems
}

/**
 * Merges tags from every language and trims to YouTube's total budget.
 *
 * Both scripts are kept on purpose: someone searching "مہنگائی" and someone searching
 * "mehngai" are looking for the same video, and only one of them finds it if only one
 * script is tagged. Order is preserved because the earliest tags are the ones that
 * survive when the budget runs out.
 */
export function mergeTags(...groups: (string[] | undefined)[]): { tags: string[]; dropped: string[] } {
  const seen = new Set<string>()
  const tags: string[] = []
  const dropped: string[] = []
  let used = 0
  for (const group of groups) {
    for (const raw of group ?? []) {
      const tag = (raw ?? '').trim().replace(/\s+/g, ' ')
      if (!tag) continue
      const key = tag.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      if (tag.length > MAX_TAG) {
        dropped.push(tag)
        continue
      }
      // The separator is ", " — TWO characters, not one. Counting one let the set run to
      // 532 characters against a 500 budget, which YouTube truncates without a word.
      // Multi-word tags also get quoted, so those cost two more. Deliberately
      // conservative: being under budget wastes a few characters, being over loses tags
      // silently, and silence is the failure this whole module exists to prevent.
      const quoteCost = /\s/.test(tag) ? 2 : 0
      const cost = tag.length + quoteCost + (tags.length ? 2 : 0)
      if (used + cost > MAX_TAGS_TOTAL) {
        dropped.push(tag)
        continue
      }
      used += cost
      tags.push(tag)
    }
  }
  return { tags, dropped }
}

/**
 * Builds the upload plan from whatever has been written so far.
 *
 * `entries` is what exists — usually one language. The plan labels it correctly, checks
 * the limits, and names what is still missing.
 */
export function planDualLanguage(input: {
  entries: { title: string; description: string; language?: UploadLanguage }[]
  tags?: string[]
  /** Extra tags in the other script, when the user has them. */
  otherScriptTags?: string[]
}): DualLanguagePlan {
  const localizations: LocalizedMeta[] = []
  for (const e of input.entries ?? []) {
    const title = (e.title ?? '').trim()
    const description = (e.description ?? '').trim()
    if (!title && !description) continue
    const language = e.language ?? detectLanguage(`${title}\n${description}`)
    // One entry per language: a second entry for the same language would overwrite the
    // first on upload, silently.
    const existing = localizations.find((l) => l.language === language)
    if (existing) continue
    localizations.push({ language, title, description, problems: checkLimits(title, description) })
  }

  const present = new Set(localizations.map((l) => l.language))
  const ALL: UploadLanguage[] = ['en', 'ur-Latn', 'ur']
  const missing = ALL.filter((l) => !present.has(l))

  // The default is the language with the most text, because that is what a viewer whose
  // language is not covered will be shown.
  const defaultLanguage =
    [...localizations].sort((a, b) => b.description.length + b.title.length - (a.description.length + a.title.length))[0]
      ?.language ?? 'en'

  const { tags, dropped } = mergeTags(input.tags, input.otherScriptTags)

  let headline: string
  if (!localizations.length) headline = 'Nothing written yet — a title and description in one language is enough to start.'
  else {
    const have = localizations.map((l) => LANGUAGE_NAMES[l.language]).join(' and ')
    const problems = localizations.reduce((n, l) => n + l.problems.length, 0)
    headline =
      `Ready to upload in ${have}.` +
      (missing.length ? ` Not written yet: ${missing.map((m) => LANGUAGE_NAMES[m]).join(', ')}.` : '') +
      (problems ? ` ${problems} thing${problems === 1 ? '' : 's'} would be cut or rejected — see below.` : '')
  }

  return { defaultLanguage, localizations, missing, tags, droppedTags: dropped, headline }
}

/**
 * The plan as text the user can paste into YouTube Studio by hand.
 *
 * Written for pasting rather than for reading: YouTube Studio wants one language at a
 * time, and the code beside each block is what has to be selected in its dropdown.
 */
export function pasteBlock(plan: DualLanguagePlan): string {
  if (!plan.localizations.length) return ''
  const parts: string[] = [
    `Set the video's language to: ${plan.defaultLanguage} (${LANGUAGE_NAMES[plan.defaultLanguage]})`,
    ''
  ]
  for (const l of plan.localizations) {
    parts.push(
      `--- ${LANGUAGE_NAMES[l.language]} · choose "${l.language}" in YouTube's language list ---`,
      `TITLE (${l.title.length}/${MAX_TITLE}):`,
      l.title,
      '',
      `DESCRIPTION (${l.description.length}/${MAX_DESCRIPTION}):`,
      l.description,
      ''
    )
  }
  if (plan.tags.length) {
    parts.push(`TAGS (${plan.tags.join(', ').length}/${MAX_TAGS_TOTAL} characters):`, plan.tags.join(', '), '')
  }
  if (plan.droppedTags.length) {
    parts.push(`Left out, no room: ${plan.droppedTags.join(', ')}`, '')
  }
  return parts.join('\n').trim()
}
