/**
 * The Expert's INSTANT mode — answers "how do I…?" with no AI at all.
 *
 * Why this exists: the free AI service is unreliable, and when it is down the Expert
 * is useless for exactly the questions that need no intelligence at all ("where do I
 * add music?"). Those answers are already written down in the app manual. This finds
 * them, offline, in milliseconds, and it never invents a button that doesn't exist —
 * every word it returns came from the manual.
 *
 * The hard part is not searching, it is being FORGIVING. Real questions arrive as
 * "how i add musick to vedio" — wrong spelling, missing words, no grammar. So the
 * matching does four things:
 *
 *   1. normalises and strips filler words ("how do i…", "where is the…");
 *   2. stems lightly, so "recording" finds "record";
 *   3. expands everyday words into the app's own vocabulary via a synonym map —
 *      "subtitles" is what the user says, "captions" is what the app calls it;
 *   4. falls back to edit-distance matching, so "telepromter" still finds
 *      "teleprompter".
 *
 * Pure and dependency-free so it runs in the desktop app, the phone app and tests.
 */

export interface GuideSection {
  /** Heading line, used as the answer's title and weighted higher when matching. */
  title: string
  body: string
}

export interface GuideHit {
  section: GuideSection
  score: number
  /** Which of the user's words actually matched — shown so the answer feels accountable. */
  matched: string[]
}

/** Words that carry no meaning in a question and would otherwise match everything. */
const STOPWORDS = new Set([
  'how','do','i','to','the','a','an','is','are','can','my','me','in','on','at','of','for','and','or',
  'it','this','that','with','from','what','where','when','which','why','you','your','please','help',
  'want','need','get','got','does','did','be','am','will','would','should','could','there','here',
  'if','then','so','but','not','no','yes','use','using','make','made','new','set','go','goes'
])

/**
 * Everyday words → the app's own vocabulary. This is what stops the search being
 * "basic and stupid": the user should not have to know the app calls it a "beat".
 */
const SYNONYMS: Record<string, string[]> = {
  subtitle: ['caption'],
  subtitles: ['captions'],
  sub: ['caption'],
  cc: ['caption'],
  song: ['music'],
  songs: ['music'],
  audio: ['music', 'voice', 'sound'],
  sound: ['music', 'audio'],
  narration: ['voice', 'voiceover'],
  voiceover: ['voice', 'narration'],
  speak: ['voice'],
  speech: ['voice'],
  talking: ['voice', 'presenter'],
  prompter: ['teleprompter'],
  teleprompt: ['teleprompter'],
  script: ['writer', 'scriptpad'],
  write: ['writer', 'script'],
  writing: ['writer', 'script'],
  idea: ['ideas', 'trends'],
  thumbnail: ['thumbnail', 'cover'],
  cover: ['thumbnail'],
  clip: ['video', 'footage'],
  footage: ['video', 'clip'],
  film: ['video', 'record'],
  shoot: ['record', 'recorder'],
  camera: ['recorder', 'presenter', 'webcam'],
  webcam: ['camera', 'recorder'],
  screen: ['recorder', 'capture'],
  capture: ['recorder', 'screen'],
  cut: ['trim', 'timeline'],
  cutting: ['trim', 'timeline'],
  edit: ['timeline', 'trim'],
  editing: ['timeline', 'trim'],
  join: ['stitch'],
  merge: ['stitch'],
  combine: ['stitch'],
  scene: ['scenes', 'storyboard', 'beat'],
  shot: ['scene', 'beat', 'storyboard'],
  upload: ['publish', 'youtube', 'export'],
  post: ['publish', 'youtube'],
  save: ['export', 'library'],
  saved: ['library'],
  find: ['library', 'folder'],
  lost: ['library', 'folder', 'stranded'],
  missing: ['library', 'folder', 'stranded'],
  gone: ['library', 'folder', 'stranded'],
  delete: ['trash', 'remove'],
  deleted: ['trash', 'remove'],
  bin: ['trash'],
  phone: ['mobile', 'phone'],
  mobile: ['phone'],
  key: ['settings', 'api'],
  api: ['settings', 'key'],
  ai: ['settings', 'brain', 'provider'],
  broken: ['health', 'error', 'issue'],
  error: ['health', 'issue'],
  slow: ['health', 'issue'],
  chart: ['charts'],
  graph: ['charts'],
  stock: ['psx', 'charts'],
  price: ['psx', 'charts'],
  money: ['psx', 'charts'],
  urdu: ['language', 'urdu'],
  language: ['language', 'urdu']
}

export function normalise(text: string): string {
  return (text ?? '')
    .toLowerCase()
    // Keep letters/digits/spaces only, so punctuation and emoji never block a match.
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Very light stemming — enough for plurals and -ing/-ed, without a stemmer library. */
export function stem(word: string): string {
  if (word.length <= 3) return word
  for (const suffix of ['ing', 'ed', 'es', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) return word.slice(0, -suffix.length)
  }
  return word
}

/** Edit distance, abandoned as soon as it exceeds `max` — that bound keeps it fast. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0
  if (Math.abs(a.length - b.length) > max) return max + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost)
      if (cur[j] < best) best = cur[j]
    }
    if (best > max) return max + 1
    prev = cur
  }
  return prev[b.length]
}

/** The user's question, turned into the set of words worth matching on. */
export function queryTerms(question: string): string[] {
  const words = normalise(question)
    .split(' ')
    .filter((w) => w && !STOPWORDS.has(w))
  const out = new Set<string>()
  for (const w of words) {
    const s = stem(w)
    out.add(s)
    for (const syn of SYNONYMS[w] ?? SYNONYMS[s] ?? []) out.add(stem(syn))
  }
  return [...out]
}

/**
 * Splits the manual into searchable sections, one per paragraph.
 *
 * Paragraphs — not heading-delimited chunks — because that is how this manual is
 * actually written: a topic is a blank-line-separated block that usually opens with
 * its own name in capitals on the SAME line ("WHERE WORK IS KEPT: the folder is…").
 * Chunking by heading lines produced four enormous sections that matched everything
 * and answered nothing.
 */
export function buildGuideIndex(guide: string): GuideSection[] {
  const sections: GuideSection[] = []
  for (const block of (guide ?? '').split(/\r?\n\s*\r?\n/)) {
    const trimmed = block.trim()
    if (trimmed.length < 40) continue

    // The tab-by-tab list is one enormous block of "• TAB — what it does" bullets.
    // Left whole it matches every question and answers none, so each bullet becomes
    // its own section — that is what makes "how do I use the Timeline?" return the
    // Timeline paragraph instead of the entire sidebar.
    const bullets = splitBullets(trimmed)
    if (bullets.length > 1) {
      for (const b of bullets) if (b.length >= 40) sections.push({ title: titleOf(b), body: b })
      continue
    }
    sections.push({ title: titleOf(trimmed), body: trimmed })
  }
  return sections
}

/** Groups a block's lines into bullets, keeping each bullet's continuation lines with it. */
function splitBullets(block: string): string[] {
  const lines = block.split(/\r?\n/)
  const starts = lines.filter((l) => /^\s*•/.test(l)).length
  if (starts < 2) return [block]
  const out: string[] = []
  let cur: string[] = []
  for (const line of lines) {
    if (/^\s*•/.test(line)) {
      if (cur.length) out.push(cur.join('\n').trim())
      cur = [line]
    } else {
      cur.push(line)
    }
  }
  if (cur.length) out.push(cur.join('\n').trim())
  return out.filter(Boolean)
}

/** A short name for a paragraph: its leading capitals phrase, else its opening words. */
function titleOf(body: string): string {
  const firstLine = body.split(/\r?\n/)[0].trim()
  // "WHERE WORK IS KEPT: the folder…" → "WHERE WORK IS KEPT"
  const labelled = /^([^a-z:]{4,70}):/.exec(firstLine)
  if (labelled) return labelled[1].trim()
  // A whole line in capitals is a heading in its own right.
  const letters = firstLine.replace(/[^A-Za-z]/g, '')
  if (letters && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.6 && firstLine.length <= 110) {
    return firstLine.replace(/:$/, '')
  }
  return firstLine.split(' ').slice(0, 8).join(' ')
}

/** Counts how strongly one section answers the question. */
function scoreSection(section: GuideSection, terms: string[]): { score: number; matched: string[] } {
  const titleWords = new Set(normalise(section.title).split(' ').map(stem))
  const bodyWords = new Set(normalise(section.body).split(' ').map(stem))
  let score = 0
  const matched: string[] = []

  for (const term of terms) {
    if (titleWords.has(term)) {
      score += 6 // a heading match is the strongest signal
      matched.push(term)
      continue
    }
    if (bodyWords.has(term)) {
      score += 3
      matched.push(term)
      continue
    }
    // Nothing exact — allow a near-miss, which is what catches typos.
    if (term.length >= 5) {
      let fuzzy = false
      for (const w of titleWords) {
        if (w.length >= 5 && editDistance(term, w) <= 2) {
          score += 4
          fuzzy = true
          break
        }
      }
      if (!fuzzy) {
        for (const w of bodyWords) {
          if (w.length >= 5 && editDistance(term, w) <= 2) {
            score += 2
            fuzzy = true
            break
          }
        }
      }
      if (fuzzy) matched.push(term)
    }
  }
  return { score, matched }
}

/**
 * Finds the manual sections that answer a question. Returns [] when nothing is a
 * plausible match — saying "I don't have that written down" is far better than
 * confidently returning the wrong page.
 */
export function searchGuide(index: GuideSection[], question: string, limit = 3): GuideHit[] {
  const terms = queryTerms(question)
  if (!terms.length) return []
  return index
    .map((section) => {
      const { score, matched } = scoreSection(section, terms)
      return { section, score, matched }
    })
    // One solid word match is enough to be worth showing — a user typing just
    // "timeline" deserves the Timeline paragraph. Precision comes from the ranking
    // and from terms being stripped of filler first, not from a high cut-off: an
    // unrelated question ("capital of France") matches no app vocabulary at all and
    // still returns nothing.
    .filter((h) => h.score >= 3)
    .sort((a, b) => b.score - a.score || a.section.body.length - b.section.body.length)
    .slice(0, limit)
}

/** Suggestions to show when nothing matched, so the panel is never a dead end. */
export const GUIDE_EXAMPLES = [
  'How do I make a video from my script?',
  'Where do I add background music?',
  'How do I record myself with the camera?',
  'How do I use the teleprompter?',
  'Where are my finished videos saved?',
  'How do I turn on subtitles?',
  'How do I use my phone to plan a video?',
  'Why is the AI not answering?'
]
