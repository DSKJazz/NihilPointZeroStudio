/**
 * These tests are mostly about the difference between two sentences.
 *
 * "Google does not recognise this key" and "the key is fine, the service is switched
 * off" arrive as the same HTTP 403 with a wall of text, and they have opposite fixes.
 * Sending someone who has a perfectly good key back to make another one is exactly the
 * dead end this whole walkthrough exists to remove, so the mapping is pinned here
 * against the real reply shapes Google sends.
 *
 * The other half is the three-state rule: nothing may report `working` unless Google
 * actually said yes. An unreadable answer is `unknown`, out loud.
 */
import { describe, expect, it } from 'vitest'
import {
  ENABLE_API_URL,
  SETUP_STEPS,
  classifyKeyResponse,
  cleanPastedKey,
  describeChannelProblem,
  inspectKeyShape,
  normalizeChannelInput,
  offlineVerdict,
  type ChannelReadProblem
} from './youtubeKeySetup'

/** A well-formed key, shaped like the real thing (AIza + 35 more). */
const GOOD = `AIza${'Sy'.padEnd(35, 'x')}`

describe('the walkthrough itself', () => {
  it('numbers its steps 1..n with no gaps, so "go back to step 3" means something', () => {
    expect(SETUP_STEPS.map((s) => s.n)).toEqual(SETUP_STEPS.map((_, i) => i + 1))
  })

  it('gives every step that names a page a real https link to open', () => {
    for (const step of SETUP_STEPS) {
      if (step.url) {
        expect(step.url.startsWith('https://')).toBe(true)
        expect(step.buttonLabel && step.buttonLabel.length > 0).toBe(true)
      }
    }
  })

  it('links straight to the enable page rather than the console front door', () => {
    // The step people miss. If this ever degrades to console.cloud.google.com the
    // walkthrough is back to "find it yourself".
    expect(SETUP_STEPS.some((s) => s.url === ENABLE_API_URL)).toBe(true)
  })
})

describe('cleaning up whatever was pasted', () => {
  it('survives quotes, newlines, stray spaces and a key= prefix', () => {
    for (const raw of [` "${GOOD}" `, `key=${GOOD}`, `API_KEY: ${GOOD}`, `${GOOD}\n`, `<${GOOD}>`]) {
      expect(cleanPastedKey(raw)).toBe(GOOD)
    }
  })

  it('handles a key copied straight out of a config file', () => {
    // Stripping the prefix before the quotes could not see it here, and the user got the
    // message "a Google key always starts with AIza, and this does not" — about a key
    // that did.
    expect(cleanPastedKey(`"key": "${GOOD}",`)).toBe(GOOD)
    expect(cleanPastedKey(`{ "apiKey": "${GOOD}" }`)).toBe(GOOD)
  })

  it('does not invent a key out of nothing', () => {
    expect(cleanPastedKey('')).toBe('')
    expect(cleanPastedKey('   ')).toBe('')
  })
})

describe('naming the wrong-thing-pasted mistakes', () => {
  it('accepts a well-formed key', () => {
    expect(inspectKeyShape(GOOD).ok).toBe(true)
  })

  it('recognises the OAuth client id sitting one row above it on the same page', () => {
    const v = inspectKeyShape('123456789-abcdefg.apps.googleusercontent.com')
    expect(v.ok).toBe(false)
    expect(v.problem).toMatch(/OAuth client ID/i)
  })

  it('recognises a client secret and an OpenAI key', () => {
    expect(inspectKeyShape('GOCSPX-abcdefghijklmnop').problem).toMatch(/client secret/i)
    expect(inspectKeyShape('sk-proj-abcdefghijklmnopqrstuvwx').problem).toMatch(/OpenAI/i)
  })

  it('says "cut off" rather than "invalid" for a half-copied key', () => {
    expect(inspectKeyShape('AIzaSyShort').problem).toMatch(/cut off/i)
  })

  it('never claims a shape problem for a key it should be checking against Google', () => {
    // A shape check that rejects real keys is worse than no shape check: it stops the
    // user before the one test that would have told the truth.
    expect(inspectKeyShape('AIzaSyB1_2-3456789012345678901234567890').ok).toBe(true)
  })
})

describe('reading Google’s answer', () => {
  it('calls a 200 working', () => {
    expect(classifyKeyResponse(200, { items: [] }).state).toBe('working')
  })

  it('separates "service switched off" from "bad key" — the whole point of this file', () => {
    const disabled = classifyKeyResponse(403, {
      error: {
        code: 403,
        message:
          'YouTube Data API v3 has not been used in project 12345 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/youtube.googleapis.com/overview?project=12345 then retry.',
        errors: [{ reason: 'accessNotConfigured' }],
        status: 'PERMISSION_DENIED'
      }
    })
    expect(disabled.state).toBe('broken')
    if (disabled.state !== 'broken') return
    expect(disabled.title).toMatch(/key is fine/i)
    expect(disabled.fixUrl).toBe(ENABLE_API_URL)

    const bad = classifyKeyResponse(400, {
      error: {
        code: 400,
        message: 'API key not valid. Please pass a valid API key.',
        errors: [{ reason: 'badRequest' }],
        status: 'INVALID_ARGUMENT'
      }
    })
    expect(bad.state).toBe('broken')
    if (bad.state !== 'broken') return
    expect(bad.title).toMatch(/does not recognise/i)
    // The two must never give the same advice.
    expect(bad.fix).not.toBe(disabled.fix)
  })

  it('recognises a restricted key', () => {
    const v = classifyKeyResponse(403, { error: { errors: [{ reason: 'ipRefererBlocked' }] } })
    expect(v.state === 'broken' && /locked to something else/i.test(v.title)).toBe(true)
  })

  it('finds the real reason when Google buries it under a useless one — this was a live bug', () => {
    // Google's ACTUAL body for a referrer-restricted key. `errors[0].reason` is
    // "forbidden", which says nothing, and it comes first; `status` is PERMISSION_DENIED,
    // which a switched-off service also sends. The only useful reason is in `details`.
    // Reading just the first reason meant this branch could never fire, and the user was
    // sent to re-enable a service that was already on.
    const restricted = classifyKeyResponse(403, {
      error: {
        code: 403,
        message: 'Requests from referer <empty> are blocked.',
        errors: [{ message: 'Requests from referer <empty> are blocked.', domain: 'global', reason: 'forbidden' }],
        status: 'PERMISSION_DENIED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }]
      }
    })
    expect(restricted.state).toBe('broken')
    if (restricted.state !== 'broken') return
    expect(restricted.title).toMatch(/locked to something else/i)
    expect(restricted.fix).toMatch(/Application restrictions/i)
  })

  it('does not let PERMISSION_DENIED alone masquerade as a switched-off service', () => {
    // Both a restricted key and a disabled service send PERMISSION_DENIED, so on its own
    // it is evidence of nothing. A wrong guess here sends the user to redo a correct step.
    const bare = classifyKeyResponse(403, { error: { status: 'PERMISSION_DENIED', message: 'The caller does not have permission' } })
    expect(bare.state).toBe('broken')
    if (bare.state !== 'broken') return
    expect(bare.title).toMatch(/refused/i)
    expect(bare.title).not.toMatch(/switched off/i)
  })

  it('still recognises a switched-off service from its own real body', () => {
    const disabled = classifyKeyResponse(403, {
      error: {
        code: 403,
        message: 'YouTube Data API v3 has not been used in project 12345 before or it is disabled.',
        errors: [{ message: 'YouTube Data API v3 has not been used in project 12345 before or it is disabled.', domain: 'usageLimits', reason: 'accessNotConfigured' }],
        status: 'PERMISSION_DENIED',
        details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'SERVICE_DISABLED' }]
      }
    })
    expect(disabled.state === 'broken' && /switched off/i.test(disabled.title)).toBe(true)
  })

  it('picks quota over everything else, since a spent allowance also arrives as 403', () => {
    const quota = classifyKeyResponse(403, {
      error: {
        errors: [{ domain: 'youtube.quota', reason: 'quotaExceeded', message: 'The request cannot be completed because you have exceeded your quota.' }],
        status: 'RESOURCE_EXHAUSTED'
      }
    })
    expect(quota.state === 'broken' && /allowance/i.test(quota.title)).toBe(true)
  })

  it('treats a spent daily allowance as "nothing to fix", not as a broken key', () => {
    const v = classifyKeyResponse(403, { error: { errors: [{ reason: 'quotaExceeded' }] } })
    expect(v.state).toBe('broken')
    if (v.state !== 'broken') return
    expect(v.title).toMatch(/allowance/i)
    expect(v.fix).toMatch(/nothing to fix/i)
    expect(classifyKeyResponse(429, {}).state).toBe('broken')
  })

  it('says "could not tell" when Google itself is broken — never "working", never "bad key"', () => {
    for (const status of [500, 502, 503]) {
      const v = classifyKeyResponse(status, {})
      expect(v.state).toBe('unknown')
      expect(v.state === 'unknown' && /could not tell/i.test(v.title)).toBe(true)
    }
    expect(classifyKeyResponse(418, {}).state).toBe('unknown')
    expect(offlineVerdict().state).toBe('unknown')
  })

  it('never returns working for any failure status', () => {
    for (const status of [400, 401, 403, 404, 429, 500, 503]) {
      expect(classifyKeyResponse(status, {}).state).not.toBe('working')
    }
  })
})

describe('explaining an empty channel read', () => {
  const ALL: ChannelReadProblem[] = [
    { kind: 'no-key' },
    { kind: 'no-channel' },
    { kind: 'refused', detail: 'Google refused the key.' },
    { kind: 'unreachable' },
    { kind: 'empty-channel' }
  ]

  it('separates "Google itself broke" from "Google refused you"', () => {
    // A 500 from Google says nothing about the key. Collapsing it into 'refused' painted
    // it red next to "Google refused the request", which would send someone off to redo
    // four correct steps because a Google server hiccuped.
    const g = describeChannelProblem({ kind: 'google-error', detail: 'Could not tell — the problem is at Google’s end.' })
    expect(g.tone).toBe('unknown')
    expect(g.offerSetup).toBe(false)
    expect(describeChannelProblem({ kind: 'refused', detail: 'x' }).tone).toBe('error')
  })

  it('reports a half-read channel as half-read, not as a clean read', () => {
    const p = describeChannelProblem({ kind: 'partial', detail: 'Read 50 of your videos and then it stopped.' })
    expect(p.tone).toBe('unknown')
    expect(p.message).toMatch(/floor rather than a total/i)
  })

  it('does not claim the key works on the no-channel path, where it was never tested', () => {
    // readMyChannel returns no-channel BEFORE contacting Google at all, so "the key works"
    // was a pass awarded to something unexamined.
    const n = describeChannelProblem({ kind: 'no-channel' })
    expect(n.title).not.toMatch(/key works/i)
  })

  it('says something DIFFERENT for each of the five — the whole point', () => {
    // These five all produced the identical sentence before, and four of the five were
    // being described wrongly by it.
    const titles = ALL.map((p) => describeChannelProblem(p).title)
    expect(new Set(titles).size).toBe(ALL.length)
  })

  it('offers the walkthrough only where the walkthrough is the fix', () => {
    expect(describeChannelProblem({ kind: 'no-key' }).offerSetup).toBe(true)
    expect(describeChannelProblem({ kind: 'no-channel' }).offerSetup).toBe(true)
    // Neither of these is fixed in Settings, and offering it there would be a wild goose chase.
    expect(describeChannelProblem({ kind: 'unreachable' }).offerSetup).toBe(false)
    expect(describeChannelProblem({ kind: 'empty-channel' }).offerSetup).toBe(false)
  })

  it('never blames the user for a network failure, and never calls it an empty channel', () => {
    const n = describeChannelProblem({ kind: 'unreachable' })
    expect(n.tone).toBe('unknown')
    expect(n.message).toMatch(/not a claim that you have no videos/i)
  })

  it('treats a genuinely empty channel as working, not broken', () => {
    const n = describeChannelProblem({ kind: 'empty-channel' })
    expect(n.tone).toBe('info')
    expect(n.title).toMatch(/fine/i)
  })

  it('carries Google’s own reason through when it refused', () => {
    expect(describeChannelProblem({ kind: 'refused', detail: 'The key is locked to something else.' }).message).toMatch(
      /locked to something else/
    )
  })
})

describe('what the user pastes for their channel', () => {
  const ID = 'UCabcdefghijklmnopqrstuv'

  it('takes the id itself', () => {
    expect(normalizeChannelInput(ID)).toEqual({ kind: 'id', value: ID })
    expect(normalizeChannelInput(`https://www.youtube.com/channel/${ID}`)).toEqual({ kind: 'id', value: ID })
  })

  it('takes the @handle, which is the only form YouTube actually shows them', () => {
    expect(normalizeChannelInput('@NihilPointZero')).toEqual({ kind: 'handle', value: '@NihilPointZero' })
    expect(normalizeChannelInput('https://youtube.com/@NihilPointZero')).toEqual({
      kind: 'handle',
      value: '@NihilPointZero'
    })
    // Typed without the @, because the @ is punctuation nobody thinks of as part of a name.
    expect(normalizeChannelInput('NihilPointZero')).toEqual({ kind: 'handle', value: '@NihilPointZero' })
  })

  it('does not bite the first letter off a bare custom URL', () => {
    // youtube.com/cricketwala used to parse as kind "c" plus the name "ricketwala",
    // because the optional (channel|c|user) group was not anchored to a path segment.
    expect(normalizeChannelInput('https://www.youtube.com/cricketwala')).toEqual({
      kind: 'handle',
      value: '@cricketwala'
    })
    expect(normalizeChannelInput('youtube.com/userfriendlyfinance')).toEqual({
      kind: 'handle',
      value: '@userfriendlyfinance'
    })
  })

  it('takes the legacy /user/ and /c/ links', () => {
    expect(normalizeChannelInput('https://www.youtube.com/user/oldname')).toEqual({ kind: 'username', value: 'oldname' })
    expect(normalizeChannelInput('https://www.youtube.com/c/Vanity Name'.replace(' ', ''))).toEqual({
      kind: 'search',
      value: 'VanityName'
    })
  })

  it('says empty rather than guessing', () => {
    expect(normalizeChannelInput('  ').kind).toBe('empty')
  })

  it('spots a VIDEO link, which is what is in the address bar most of the time', () => {
    // Left unhandled, "youtube.com/watch?v=..." parses as a channel called "watch" and
    // costs 100 quota units to search for, then finds somebody else's channel.
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/abc123',
      'https://www.youtube.com/live/abc123'
    ]) {
      expect(normalizeChannelInput(url).kind).toBe('video')
    }
  })

  it('falls back to a search for anything with spaces in it', () => {
    expect(normalizeChannelInput('My Finance Channel')).toEqual({ kind: 'search', value: 'My Finance Channel' })
  })
})
