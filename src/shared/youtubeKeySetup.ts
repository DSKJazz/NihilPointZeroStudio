/**
 * Getting a free YouTube key, without knowing anything about Google Cloud.
 *
 * WHY THIS FILE EXISTS
 * Three whole features — Your Channel, the comment questions, and the competitor gaps —
 * read nothing at all without a YouTube Data API key, and until now the app's entire
 * help on the subject was one sentence in Settings: *"Get a free key from Google Cloud
 * Console → enable YouTube Data API v3 → create an API key."* For someone who does not
 * code, that is not an instruction, it is a dare. Worse, every one of those features
 * failed SILENTLY when the key was missing or wrong: `fetchMyChannelVideos` returns `[]`
 * on a bad key exactly as it does for a channel with no videos, so a typo and an empty
 * channel looked identical on screen.
 *
 * So this module does two things, and both are pure so they can be tested without a
 * network:
 *
 *   1. `SETUP_STEPS` — the walkthrough, each step carrying the EXACT page it opens, so
 *      nothing has to be found by navigating Google's console.
 *   2. `classifyKeyResponse` / `inspectKeyShape` — turn Google's replies into a plain
 *      sentence and the one action that fixes it.
 *
 * THE THREE-STATE RULE
 * A verdict is `working`, `broken`, or `unknown` — never a boolean. "I could not tell"
 * (no internet, Google itself down) is its own visible answer, because the bug in PR #13
 * happened precisely by letting *could not read* render exactly like *all fine*.
 */

/** What a key check concluded. Never a boolean — see THE THREE-STATE RULE above. */
export type KeyVerdict =
  | { state: 'working'; message: string }
  | { state: 'broken'; title: string; message: string; fix: string; fixUrl?: string }
  | { state: 'unknown'; title: string; message: string }

/** One numbered step of the walkthrough. `url` is opened by a button, never typed out. */
export interface SetupStep {
  n: number
  title: string
  detail: string
  url?: string
  buttonLabel?: string
}

/**
 * The whole walkthrough, in the order the pages have to be visited.
 *
 * The links are deep links on purpose. "Go to the Cloud Console and find Library" is
 * four correct guesses; a button that lands on the YouTube Data API's own enable page
 * is none. The project-picker in each URL is Google's own; it appears automatically for
 * an account with no project yet.
 */
export const SETUP_STEPS: SetupStep[] = [
  {
    n: 1,
    title: 'Sign in with the Google account that owns your channel',
    detail:
      'Any Google account works, but using the one your channel belongs to keeps everything in one place. This is free — Google does not ask for a card for this.',
    url: 'https://console.cloud.google.com/',
    buttonLabel: 'Open Google Cloud'
  },
  {
    n: 2,
    title: 'Make a project (or pick the one you already have)',
    detail:
      'A "project" is just a folder for the key. Click NEW PROJECT, call it anything — "My Studio" is fine — and click CREATE. It takes about ten seconds.',
    url: 'https://console.cloud.google.com/projectcreate',
    buttonLabel: 'Open the new-project page'
  },
  {
    n: 3,
    title: 'Switch on the YouTube Data API v3',
    detail:
      'This button opens that one page directly. Make sure your project is shown at the top, then click ENABLE. This is the step people miss, and it is the reason a brand-new key can look broken.',
    url: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com',
    buttonLabel: 'Open the enable page'
  },
  {
    n: 4,
    title: 'Create the key and copy it',
    detail:
      'Click + CREATE CREDENTIALS at the top, choose API key, and Google shows you a key starting with AIza. Copy it. You do NOT need to click "Restrict key" — and if you do restrict it, the app will tell you below.',
    url: 'https://console.cloud.google.com/apis/credentials',
    buttonLabel: 'Open the credentials page'
  },
  {
    n: 5,
    title: 'Paste it below and press Check',
    detail:
      'The app tries one real request with it and tells you in plain English whether it works — and if it does not, exactly which of the steps above to go back to.'
  }
]

/** Where a broken key usually gets fixed, so a verdict can hand over a button. */
export const ENABLE_API_URL = 'https://console.cloud.google.com/apis/library/youtube.googleapis.com'
export const CREDENTIALS_URL = 'https://console.cloud.google.com/apis/credentials'
export const QUOTA_URL = 'https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas'

/**
 * Tidy up whatever actually landed in the box.
 *
 * A key gets copied out of a console, an email, a note app or a screenshot-retype, so it
 * arrives wrapped in quotes, prefixed with `key=`, carrying a newline, or split by a
 * stray space. All of those are the right key typed by a person, and none of them should
 * be reported as invalid.
 */
export function cleanPastedKey(raw: string): string {
  // Punctuation first, THEN the prefix. The other order could not see the prefix in
  // `"key": "AIza…"` — copied straight out of a config file — because the leading quote
  // blocked the match, and what survived was `key:AIza…`, rejected with the factually
  // wrong message "a Google key always starts with AIza, and this does not".
  return (raw ?? '')
    .replace(/[\s"'`<>{},]/g, '')
    .replace(/^(?:api[_-]?key|key)[:=]/i, '')
    .trim()
}

/**
 * Catch the wrong-thing-pasted cases before spending a request on them.
 *
 * Every one of these has actually happened to somebody: the OAuth client id is the item
 * directly above the API key on the same console page, the client secret sits next to
 * it, and anyone who has set up an AI key before reaches for an `sk-` string out of
 * habit. Naming the mistake is far more use than "invalid key".
 */
export function inspectKeyShape(key: string): { ok: boolean; problem?: string; fix?: string } {
  if (!key) return { ok: false, problem: 'Nothing was pasted yet.', fix: 'Copy the key from step 4 and paste it here.' }
  if (key.endsWith('.apps.googleusercontent.com')) {
    return {
      ok: false,
      problem: 'That is an OAuth client ID, not an API key.',
      fix: 'On the credentials page, look under "API keys" — not "OAuth 2.0 Client IDs". The one you want starts with AIza.'
    }
  }
  if (key.startsWith('GOCSPX-')) {
    return {
      ok: false,
      problem: 'That is a client secret, not an API key.',
      fix: 'Go back to the credentials page and copy the row listed under "API keys" instead. It starts with AIza.'
    }
  }
  if (/^sk-/.test(key)) {
    return {
      ok: false,
      problem: 'That looks like an OpenAI key, not a Google one.',
      fix: 'A YouTube key comes from Google Cloud and starts with AIza.'
    }
  }
  if (!key.startsWith('AIza')) {
    return {
      ok: false,
      problem: 'A Google API key always starts with AIza, and this does not.',
      fix: 'Check you copied the whole thing from the API keys section of the credentials page.'
    }
  }
  if (key.length < 35 || key.length > 45 || !/^[A-Za-z0-9_-]+$/.test(key)) {
    return {
      ok: false,
      problem: 'That key looks cut off or has extra characters in it.',
      fix: 'A Google key is one unbroken run of about 39 letters, digits, dashes and underscores. Copy it again with the little copy button next to it.'
    }
  }
  return { ok: true }
}

/**
 * Every machine-readable reason in the reply, joined — not just the first one.
 *
 * WHY ALL OF THEM. Google sends a restricted key back as
 *
 *   errors: [{ reason: 'forbidden' }]            <- useless, and it comes FIRST
 *   status: 'PERMISSION_DENIED'                  <- also what a disabled service says
 *   details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }]   <- the only useful one
 *
 * Reading only `errors[0].reason` therefore saw "forbidden" and gave up, and the
 * restricted-key branch below could never fire at all. Reading only `status` cannot
 * tell a restricted key from a switched-off service, because both say PERMISSION_DENIED.
 * The specific reason is the one in `details`, so all three are gathered and the
 * branches below are ordered specific-first.
 */
function reasonOf(body: unknown): string {
  const err = (body as {
    error?: { errors?: { reason?: string }[]; status?: string; details?: { reason?: string }[] }
  })?.error
  if (!err) return ''
  return [...(err.errors ?? []).map((e) => e?.reason), ...(err.details ?? []).map((d) => d?.reason), err.status]
    .filter((r): r is string => typeof r === 'string' && r.length > 0)
    .join(' ')
}

function messageOf(body: unknown): string {
  const m = (body as { error?: { message?: string } })?.error?.message
  return typeof m === 'string' ? m : ''
}

/**
 * Turn one HTTP reply into a sentence the user can act on.
 *
 * The mapping matters more than it looks. Google answers "the API is switched off" with
 * HTTP 403 and a 300-word message containing a console URL — indistinguishable, to
 * someone reading it cold, from "your key is wrong". They are opposite problems with
 * opposite fixes, and sending someone to make a second key when the first one was fine
 * wastes an afternoon.
 */
export function classifyKeyResponse(status: number, body: unknown): KeyVerdict {
  if (status >= 200 && status < 300) {
    return { state: 'working', message: 'This key works. Your channel features are switched on.' }
  }

  const reason = reasonOf(body)
  const detail = messageOf(body)

  // ORDER MATTERS BELOW, and it is not cosmetic. A restricted key and a switched-off
  // service BOTH come back as 403 PERMISSION_DENIED; only the specific reason in
  // `details` tells them apart, and they have opposite fixes. So every branch that keys
  // on a specific reason runs before the generic ones, and PERMISSION_DENIED on its own
  // is treated as "refused, cause unstated" rather than as evidence of anything.

  if (status === 429 || /quotaExceeded|dailyLimitExceeded|rateLimitExceeded|RESOURCE_EXHAUSTED/i.test(reason)) {
    return {
      state: 'broken',
      title: "Today's free allowance is used up",
      message:
        'The key itself is fine. The 10,000 free daily requests for this project have all been spent, and Google resets them at midnight Pacific time (about 12 noon in Pakistan).',
      fix: 'Nothing to fix — try again after the reset. Reading your own channel normally costs about four of the ten thousand, so if this happened straight away the project is probably shared with something else.',
      fixUrl: QUOTA_URL
    }
  }

  if (/ipRefererBlocked|API_KEY_HTTP_REFERRER_BLOCKED|API_KEY_IP_ADDRESS_BLOCKED|API_KEY_ANDROID_APP_BLOCKED|API_KEY_IOS_APP_BLOCKED|API_KEY_API_CALL_NOT_VALID|API_KEY_SERVICE_BLOCKED/i.test(reason)) {
    return {
      state: 'broken',
      title: 'This key is locked to something else',
      message:
        'The key exists and the service is on, but it has a restriction on it — either to certain websites or apps, or to a list of services that does not include YouTube.',
      fix: 'Open the credentials page, click your key, and set Application restrictions to "None". If you set API restrictions, add "YouTube Data API v3" to the list. Save, wait a minute, then Check again.',
      fixUrl: CREDENTIALS_URL
    }
  }

  if (/SERVICE_DISABLED|accessNotConfigured/i.test(reason) || /has not been used in project|is disabled/i.test(detail)) {
    return {
      state: 'broken',
      title: 'The key is fine — the YouTube service is switched off',
      message:
        'Google made the key, but the YouTube service has not been enabled on that project yet. This is the most common one, and it is a single click to fix.',
      fix: 'Open the enable page, check your project name is at the top, and click ENABLE. Then come back and press Check again. It can take a minute to take effect.',
      fixUrl: ENABLE_API_URL
    }
  }

  if (/API_KEY_INVALID|keyInvalid|badRequest|INVALID_ARGUMENT/i.test(reason) || /API key not valid/i.test(detail)) {
    return {
      state: 'broken',
      title: 'Google does not recognise this key',
      message: 'The key was rejected outright, which almost always means a character went missing while copying it.',
      fix: 'Go back to the credentials page and copy the key again with the copy button beside it, rather than selecting the text by hand.',
      fixUrl: CREDENTIALS_URL
    }
  }

  if (status === 401 || status === 403) {
    return {
      state: 'broken',
      title: 'Google refused the key',
      message: detail || 'The request was refused, without saying which of the usual reasons applies.',
      fix: 'Work back through steps 3 and 4: the service must be enabled on the same project the key belongs to.',
      fixUrl: ENABLE_API_URL
    }
  }

  if (status >= 500) {
    return {
      state: 'unknown',
      title: 'Could not tell — the problem is at Google’s end',
      message: `Google answered with an error of its own (${status}). That says nothing about your key. Try Check again in a few minutes.`
    }
  }

  return {
    state: 'unknown',
    title: 'Could not tell',
    message: `The check came back with an unexpected reply (${status}). Nothing has been changed. Try again in a moment.`
  }
}

/** No network at all: distinct from a bad key, and never rendered as success. */
export function offlineVerdict(): KeyVerdict {
  return {
    state: 'unknown',
    title: 'Could not tell — no internet',
    message:
      'The check could not reach Google at all, so nothing is known about the key either way. It has not been saved as good or bad. Reconnect and press Check again.'
  }
}

/**
 * What the channel lookup found, or why it could not say.
 *
 * Lives here rather than beside the fetching code because the preload bridge has to
 * name this type, and `src/preload` may never import from `src/main` — the remote
 * typecheck (browser types, no Node) enforces that, and a violation only shows up when
 * the phone bundle is built.
 *
 * `certain` is the three-state rule again in miniature: a failure that could not reach
 * Google is not evidence the channel does not exist.
 */
export type ChannelResolution =
  | {
      ok: true
      channelId: string
      title: string
      videoCount?: number
      subscribers?: number
      /**
       * True when this came from a SEARCH rather than an exact handle/id lookup — i.e.
       * it is the channel that best matched some words, not the channel that was asked
       * for. A guess and an exact match must not arrive in the same shape: one can be
       * saved silently, the other has to be confirmed, or a typo quietly points the whole
       * app at a stranger's channel and every "what works on your channel" answer after
       * that is about somebody else.
       */
      viaSearch?: boolean
    }
  | { ok: false; problem: string; fix: string; certain: boolean }

/**
 * NO CHANNEL AVATAR HERE, DELIBERATELY. The obvious way to show "is this the right
 * channel?" is the channel's picture, and it does not work: the app's own
 * Content-Security-Policy is `img-src 'self' data: file:`, so a Google-hosted avatar is
 * blocked and renders as a broken-image icon at the exact moment the user is being asked
 * to confirm. Widening the CSP for a decoration is the wrong trade — the channel NAME
 * and its video count are what a person can actually check anyway.
 */

/**
 * Why a read of the user's own channel came back with nothing.
 *
 * THE BUG THIS EXISTS TO KILL. `fetchMyChannelVideos` returned `[]` for five completely
 * different situations — no key, no channel id, a key Google refused, no internet, and a
 * channel that genuinely has no videos — and the page printed the same sentence for all
 * of them. Four of those are fixable in under a minute by the user and the fifth is not a
 * fault at all, but the app could not tell them apart, so it told the truth about none of
 * them. `null` means the read worked.
 */
export type ChannelReadProblem =
  | { kind: 'no-key' }
  | { kind: 'no-channel' }
  | { kind: 'refused'; detail: string }
  | { kind: 'unreachable' }
  | { kind: 'empty-channel' }
  /** Google answered with an error of its own (5xx, or something unrecognised). Not a refusal. */
  | { kind: 'google-error'; detail: string }
  /** Some pages were read and then the read stopped. Real data, but not all of it. */
  | { kind: 'partial'; detail: string }

/** The sentence to print, and whether the walkthrough is the answer to it. */
export interface ProblemNotice {
  tone: 'setup' | 'error' | 'unknown' | 'info'
  title: string
  message: string
  /** True when Settings → Connect YouTube is what fixes this. */
  offerSetup: boolean
}

/** One problem → one plain sentence and one action. Pure, so it is tested, not guessed at. */
export function describeChannelProblem(problem: ChannelReadProblem): ProblemNotice {
  switch (problem.kind) {
    case 'no-key':
      return {
        tone: 'setup',
        title: 'This needs a free YouTube key, and there isn’t one yet',
        message:
          'Your channel, the questions from your comments and the competitor gaps all read your channel through Google’s free service. It takes about three minutes to switch on, costs nothing, and Google never asks for a card.',
        offerSetup: true
      }
    case 'no-channel':
      return {
        tone: 'setup',
        title: 'The app doesn’t know which channel is yours',
        // Deliberately does NOT say "your key works". On this path the key was never
        // tested — the read stopped before contacting Google at all — and claiming a
        // pass for something unexamined is the same mistake in a smaller costume.
        message:
          'Type your @name into “Find my channel” in Settings and it fills in the rest. Nothing here can run until it knows which channel to read. The same screen will check your key while you are there.',
        offerSetup: true
      }
    case 'refused':
      return {
        tone: 'error',
        title: 'Google refused the request',
        message: `${problem.detail} Settings → Connect YouTube → Check the saved key will say exactly which step fixes it.`,
        offerSetup: true
      }
    case 'unreachable':
      return {
        tone: 'unknown',
        title: 'Could not reach YouTube',
        message:
          'Nothing was read, and nothing is known about your channel either way — this is not a claim that you have no videos. Check the internet connection and try again.',
        offerSetup: false
      }
    case 'empty-channel':
      return {
        tone: 'info',
        title: 'Read your channel fine — there are no videos on it yet',
        message:
          'Everything is set up correctly. These features work out what has succeeded on this channel before, so they need some published videos to read.',
        offerSetup: false
      }
    case 'google-error':
      // NOT 'refused'. A 500 from Google says nothing whatsoever about the key, and
      // painting it red next to "Google refused the request" would send the user off to
      // re-do four correct steps because a Google server hiccuped.
      return {
        tone: 'unknown',
        title: 'Could not tell — the problem is at Google’s end',
        message: `${problem.detail} Nothing is known about your channel either way. Nothing needs fixing here; try again in a few minutes.`,
        offerSetup: false
      }
    case 'partial':
      return {
        tone: 'unknown',
        title: 'Only part of your channel could be read',
        message: `${problem.detail} What is shown below is real, but it is not everything, so treat the counts as a floor rather than a total.`,
        offerSetup: false
      }
  }
}

/** What the user typed into the channel box, and which lookup that implies. */
export type ChannelInput =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'username'; value: string }
  | { kind: 'search'; value: string }
  /** A link to a VIDEO, not a channel — worth naming, because searching for it costs 100 units and finds nothing. */
  | { kind: 'video'; value: string }
  | { kind: 'empty'; value: '' }

/**
 * Work out what the user pasted into the channel box.
 *
 * The old box demanded a `UCxxxxxxxx` id, which is not written anywhere a normal person
 * looks — YouTube shows you `@yourname` everywhere and hides the id in Advanced settings.
 * So accept every form the channel is actually displayed as: the browser URL, the
 * handle with or without the @, a legacy /user/ link, or the id itself.
 */
export function normalizeChannelInput(raw: string): ChannelInput {
  const text = (raw ?? '').trim().replace(/^["'<]|[">']$/g, '')
  if (!text) return { kind: 'empty', value: '' }

  // A link to a video is the single likeliest wrong paste — it is what is in the address
  // bar most of the time. Caught before the URL parse below, which would otherwise read
  // "watch" as a channel name and spend 100 quota units searching for it.
  const videoUrl = text.match(/(?:youtube\.com\/(?:watch\?|shorts\/|live\/)|youtu\.be\/)/i)
  if (videoUrl) return { kind: 'video', value: text }

  // The (channel|c|user) group MUST be followed by a slash. Unanchored, the "c" branch
  // matched the first letter of a bare custom URL — youtube.com/cricketwala parsed as
  // kind "c" with the name "ricketwala", and the app then searched for a channel that
  // does not exist. Requiring the slash makes the group match a whole path segment or
  // nothing at all.
  const urlMatch = text.match(/(?:youtube\.com|youtu\.be)\/(?:(channel|c|user)\/)?(@?[\w.-]+)/i)
  if (urlMatch) {
    const [, kind, rawName] = urlMatch
    const name = rawName.replace(/\/$/, '')
    if (kind?.toLowerCase() === 'channel' && /^UC[\w-]{20,}$/.test(name)) return { kind: 'id', value: name }
    if (kind?.toLowerCase() === 'user') return { kind: 'username', value: name.replace(/^@/, '') }
    if (name.startsWith('@')) return { kind: 'handle', value: name }
    // /c/Name — a vanity URL, which the API only resolves through search.
    if (kind?.toLowerCase() === 'c') return { kind: 'search', value: name }
    // youtube.com/name with no /channel|/c|/user in front of it. YouTube itself now
    // redirects that form to the handle, so try the 1-unit handle lookup first; the
    // resolver falls through to forUsername and then to the 100-unit search anyway if
    // it misses. Going straight to search would spend 100 units on the common case.
    return { kind: 'handle', value: `@${name}` }
  }

  if (/^UC[\w-]{20,}$/.test(text)) return { kind: 'id', value: text }
  if (text.startsWith('@')) return { kind: 'handle', value: text }
  if (/^[\w.-]{3,30}$/.test(text)) return { kind: 'handle', value: `@${text}` }
  return { kind: 'search', value: text }
}
