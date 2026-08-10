/**
 * Turns a script/topic into 2-3 music mood-or-genre keywords to search Pixabay with.
 *
 * The AI does this when it can, but it is not allowed to be a hard dependency: the
 * whole point of the free music feature is that it works without a paid key, and the
 * free AI service is exactly the thing that has proved unreliable. So there is a plain
 * keyword-matching fallback that needs no AI at all.
 */

/** Moods the fallback can recognise, each with the words that suggest it. The app is
 * bilingual, so every mood also carries Roman Urdu spellings AND Urdu-script words —
 * a script written in Urdu must land on the same music as its English twin. */
const SIGNALS: { mood: string; words: string[] }[] = [
  {
    mood: 'tense',
    words: [
      'crash', 'crisis', 'risk', 'danger', 'warning', 'loss', 'debt', 'fraud', 'scam', 'collapse', 'default', 'panic',
      // Roman Urdu
      'nuqsan', 'nuqsaan', 'khatra', 'khatray', 'girawat', 'dhoka', 'bohran', 'buhran', 'qarza', 'qarz', 'tabahi',
      // Urdu script
      'نقصان', 'خطرہ', 'گراوٹ', 'دھوکہ', 'بحران', 'قرضہ', 'تباہی'
    ]
  },
  {
    mood: 'uplifting',
    words: [
      'growth', 'profit', 'success', 'win', 'gain', 'rally', 'boom', 'opportunity', 'rise', 'surge',
      'munafa', 'munafe', 'taraqqi', 'kamyabi', 'izafa', 'faida', 'mauqa',
      'منافع', 'ترقی', 'کامیابی', 'اضافہ', 'فائدہ', 'موقع'
    ]
  },
  {
    mood: 'corporate',
    words: [
      'business', 'company', 'market', 'invest', 'stock', 'bank', 'finance', 'economy', 'report', 'earnings',
      'karobar', 'sarmaya', 'sarmayakari', 'mandi', 'maeeshat', 'maishat', 'paisa', 'bank',
      'کاروبار', 'سرمایہ', 'منڈی', 'معیشت', 'پیسہ', 'بینک'
    ]
  },
  {
    mood: 'inspiring',
    words: [
      'future', 'dream', 'journey', 'change', 'build', 'start', 'vision', 'goal',
      'mustaqbil', 'khwab', 'safar', 'tabdeeli', 'manzil',
      'مستقبل', 'خواب', 'سفر', 'تبدیلی', 'منزل'
    ]
  },
  {
    mood: 'documentary',
    words: [
      'history', 'story', 'explain', 'analysis', 'truth', 'behind', 'why', 'how',
      'tareekh', 'kahani', 'wajah', 'tajzia', 'haqeeqat', 'sach',
      'تاریخ', 'کہانی', 'وجہ', 'تجزیہ', 'حقیقت', 'سچ'
    ]
  },
  {
    mood: 'calm',
    words: [
      'guide', 'learn', 'simple', 'basics', 'beginner', 'save', 'plan', 'steady',
      'asaan', 'bachat', 'mansuba', 'seekh', 'seekhna',
      'آسان', 'بچت', 'منصوبہ', 'سیکھ'
    ]
  }
]

/** Always-safe defaults when nothing matches — pleasant under almost any narration. */
const DEFAULT_MOODS = ['calm', 'corporate', 'ambient']

/** Keeps the AI (or a caller) from handing the search a sentence instead of a keyword. */
export function normalizeMoods(raw: string[]): string[] {
  const out: string[] = []
  for (const item of raw) {
    const clean = item
      .toLowerCase()
      .replace(/[^a-z ]/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .join(' ')
    if (clean && clean.length <= 24 && !out.includes(clean)) out.push(clean)
    if (out.length === 3) break
  }
  return out
}

/** Pure, AI-free mood guess from the words in the script. Always returns 2-3 keywords.
 * Normalization keeps Arabic-script characters — stripping them (the old behavior)
 * made every Urdu-script script fall through to the generic defaults. */
export function moodsFromText(text: string): string[] {
  const hay = ` ${text.toLowerCase().replace(/[^a-z؀-ۿ ]/g, ' ')} `
  const scored = SIGNALS.map((s) => ({
    mood: s.mood,
    score: s.words.reduce((n, w) => n + (hay.includes(` ${w}`) ? 1 : 0), 0)
  }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  const picked = scored.slice(0, 3).map((s) => s.mood)
  // Always hand back at least two keywords so the search has something to widen with.
  for (const d of DEFAULT_MOODS) {
    if (picked.length >= 2) break
    if (!picked.includes(d)) picked.push(d)
  }
  return picked
}

/**
 * Direct category links into the FREE music libraries for the detected moods —
 * the "where do I find more of this exact vibe" routing. Pure + tested; the UI
 * opens these in the system browser (nothing is scraped or automated).
 */
export function freeLibraryLinks(moods: string[]): { name: string; url: string }[] {
  const links: { name: string; url: string }[] = []
  for (const mood of moods.slice(0, 2)) {
    const q = encodeURIComponent(mood)
    links.push({ name: `Pixabay Music: ${mood}`, url: `https://pixabay.com/music/search/${q}/` })
    links.push({ name: `Free Music Archive: ${mood}`, url: `https://freemusicarchive.org/search?quicksearch=${q}` })
  }
  return links
}

/** The built-in synthesizer's moods (shared/types Mood) that each keyword maps to,
 * so "make music" follows the subject too. Unknown keywords land on 'corporate' —
 * the safest bed under financial narration. Pure + tested. */
const SYNTH_MOOD: Record<string, 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic'> = {
  tense: 'tense',
  uplifting: 'uplifting',
  corporate: 'corporate',
  inspiring: 'uplifting',
  documentary: 'cinematic',
  calm: 'calm',
  ambient: 'calm',
  lofi: 'lofi',
  cinematic: 'cinematic'
}

export function synthMoodFromText(text: string): 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic' {
  return SYNTH_MOOD[moodsFromText(text)[0]] ?? 'corporate'
}

export const MOOD_PROMPT_HINT =
  'Reply with ONLY 2-3 comma-separated music mood or genre keywords (one or two words each, ' +
  'e.g. "tense, dramatic" or "uplifting, corporate"). No sentences, no explanation.'

/** Parses whatever the AI replied into clean keywords, falling back to the text guess. */
export function parseMoodReply(reply: string, fallbackText: string): string[] {
  const parts = reply
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const moods = normalizeMoods(parts)
  return moods.length >= 2 ? moods : moodsFromText(fallbackText)
}

/**
 * The music EXAMPLES plan — his ask (2026-08-07): "after it creates it, it gives me
 * multiple examples... I play, I listen... and it would tell me why."
 *
 * Pure so the WHY can be tested: 3 distinct built-in moods, the first ones steered by
 * what the script actually says (via the same keyword signals the DJ uses), the rest
 * padded with safe contrasts so there is always a real choice to listen through. Every
 * candidate carries one plain sentence saying why it is offered — a list of names with
 * no reasons is exactly the kind of half-answer this app is trying to stop giving.
 */
const SYNTH_WHY: Record<'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic', string> = {
  tense: 'Your script talks about pressure — falls, warnings, risk — and this low, urgent bed keeps that edge under the voice.',
  uplifting: 'Your script carries good news and growth, and this brighter bed lifts with it without shouting over the narration.',
  corporate: 'The safe, neutral choice for financial analysis — steady and professional under numbers and explanations.',
  calm: 'A soft, unhurried bed that lets a measured explanation breathe; good when the story is careful rather than dramatic.',
  cinematic: 'A wider, film-style bed that makes a big-picture story feel like a documentary rather than a bulletin.',
  lofi: 'A relaxed, modern texture — works when the video is conversational and you want it to feel casual, not formal.'
}

export interface MusicExamplePlanItem {
  mood: 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic'
  why: string
}

export function musicExamplePlan(scriptText: string): MusicExamplePlanItem[] {
  const detected = moodsFromText(scriptText || '')
  const picked: MusicExamplePlanItem[] = []
  const seen = new Set<string>()
  const add = (mood: MusicExamplePlanItem['mood'], fromScript: boolean): void => {
    if (seen.has(mood) || picked.length >= 3) return
    seen.add(mood)
    picked.push({
      mood,
      why: fromScript ? SYNTH_WHY[mood] : `${SYNTH_WHY[mood]} (Offered as a contrast to compare against.)`
    })
  }
  // What the script's own words point at, first.
  for (const kw of detected) {
    const mood = SYNTH_MOOD[kw]
    if (mood) add(mood, true)
  }
  // Then safe contrasts, so there are always three genuinely different things to hear.
  for (const mood of ['corporate', 'cinematic', 'calm'] as const) add(mood, false)
  return picked
}
