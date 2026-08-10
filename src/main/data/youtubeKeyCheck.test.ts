/**
 * The request side: what gets called, how much it costs, and what a failure is allowed
 * to conclude.
 *
 * Two things are pinned here that are easy to break later and expensive when broken.
 *
 * COST. Verifying a key uses `i18nLanguages` (1 quota unit of 10,000/day) and channel
 * lookups go through `channels` (1 unit) before ever touching `search` (100 units). If a
 * refactor quietly starts verifying keys with a search call, a user checking their setup
 * a few times could spend a fifth of the day's allowance and then be told, wrongly, that
 * their allowance was exhausted.
 *
 * HONESTY. A dead network must produce "could not tell", never a verdict about the key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const savedKey = { value: 'AIzaSyRealSavedKeyxxxxxxxxxxxxxxxxxxxxxx' as string | null }
const savedChannel = { value: '' }

vi.mock('../store', () => ({
  getYouTubeApiKey: () => savedKey.value,
  getYouTubeChannelId: () => savedChannel.value
}))

const { resolveYouTubeChannel, verifySavedYouTubeKey, verifyYouTubeKey } = await import('./youtubeKeyCheck')

/** Every URL the code asked for, in order, so cost can be asserted. */
let calls: string[] = []

function mockFetch(responder: (url: string) => { status: number; body: unknown } | 'network-error'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const r = responder(url)
      if (r === 'network-error') throw new Error('getaddrinfo ENOTFOUND')
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
    })
  )
}

beforeEach(() => {
  calls = []
  savedKey.value = 'AIzaSyRealSavedKeyxxxxxxxxxxxxxxxxxxxxxx'
  savedChannel.value = ''
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('verifying a key', () => {
  it('spends exactly one cheap request, and sends the key in a header not the URL', async () => {
    mockFetch(() => ({ status: 200, body: { items: [] } }))
    const v = await verifyYouTubeKey('AIzaSyGoodKeyxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(v.state).toBe('working')
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('/i18nLanguages')
    // 100-unit endpoint; must never be how a key gets checked.
    expect(calls[0]).not.toContain('/search')
    // A key in a query string ends up in proxy logs.
    expect(calls[0]).not.toContain('AIza')
  })

  it('names an obviously-wrong paste WITHOUT spending a request', async () => {
    mockFetch(() => ({ status: 200, body: {} }))
    const v = await verifyYouTubeKey('123-abc.apps.googleusercontent.com')
    expect(v.state).toBe('broken')
    expect(v.state === 'broken' && /OAuth client ID/i.test(v.title)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('cleans up a key pasted with quotes and a newline instead of rejecting it', async () => {
    mockFetch(() => ({ status: 200, body: {} }))
    expect((await verifyYouTubeKey('  "AIzaSyGoodKeyxxxxxxxxxxxxxxxxxxxxxxxxx"\n')).state).toBe('working')
    expect(calls).toHaveLength(1)
  })

  it('says "could not tell" when the network is dead — never a verdict on the key', async () => {
    mockFetch(() => 'network-error')
    const v = await verifyYouTubeKey('AIzaSyGoodKeyxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(v.state).toBe('unknown')
    expect(v.state === 'unknown' && /no internet/i.test(v.title)).toBe(true)
  })

  it('re-checks the saved key when nothing is pasted, and says so plainly when there is none', async () => {
    mockFetch(() => ({ status: 200, body: {} }))
    expect((await verifySavedYouTubeKey()).state).toBe('working')

    savedKey.value = null
    const v = await verifySavedYouTubeKey()
    expect(v.state).toBe('broken')
    expect(v.state === 'broken' && /No YouTube key is saved/i.test(v.title)).toBe(true)
  })
})

describe('finding the channel', () => {
  const channelBody = {
    items: [
      {
        id: 'UCabcdefghijklmnopqrstuv',
        snippet: { title: 'NihilPointZero', thumbnails: { default: { url: 'https://img/x.jpg' } } },
        statistics: { videoCount: '42', subscriberCount: '1300' }
      }
    ]
  }

  it('resolves an @handle with one 1-unit call and hands back the NAME to confirm by eye', async () => {
    mockFetch(() => ({ status: 200, body: channelBody }))
    const r = await resolveYouTubeChannel('@NihilPointZero')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.channelId).toBe('UCabcdefghijklmnopqrstuv')
    expect(r.title).toBe('NihilPointZero')
    expect(r.videoCount).toBe(42)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('forHandle')
    expect(calls[0]).not.toContain('/search')
  })

  it('tries the cheap lookups first and only then the 100-unit search', async () => {
    mockFetch((url) => (url.includes('/search') ? { status: 200, body: { items: [{ id: { channelId: 'UCsearchfoundxxxxxxxxxxx' }, snippet: { title: 'Found By Search' } }] } } : { status: 200, body: { items: [] } }))
    const r = await resolveYouTubeChannel('@ghost')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.title).toBe('Found By Search')
    // handle → username → search, in that order.
    expect(calls[0]).toContain('forHandle')
    expect(calls[1]).toContain('forUsername')
    expect(calls[2]).toContain('/search')
  })

  it('takes a pasted browser address, not just an id', async () => {
    mockFetch(() => ({ status: 200, body: channelBody }))
    const r = await resolveYouTubeChannel('https://www.youtube.com/@NihilPointZero')
    expect(r.ok && r.channelId).toBe('UCabcdefghijklmnopqrstuv')
  })

  it('marks a network failure as NOT certain, so it never reads as "no such channel"', async () => {
    mockFetch(() => 'network-error')
    const r = await resolveYouTubeChannel('@anyone')
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.certain).toBe(false)
  })

  it('passes a refusal straight through with the fix, rather than saying the channel is missing', async () => {
    mockFetch(() => ({ status: 403, body: { error: { errors: [{ reason: 'accessNotConfigured' }] } } }))
    const r = await resolveYouTubeChannel('@NihilPointZero')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problem).toMatch(/service is switched off/i)
    expect(r.certain).toBe(true)
  })

  it('refuses to look anything up without a key, and does not pretend otherwise', async () => {
    savedKey.value = null
    mockFetch(() => ({ status: 200, body: channelBody }))
    const r = await resolveYouTubeChannel('@NihilPointZero')
    expect(r.ok).toBe(false)
    expect(r.ok === false && /no working YouTube key/i.test(r.problem)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('never says "no such channel" when the SEARCH itself was refused', async () => {
    // Search is the 100-unit call, so it is the likeliest one to be the request that
    // exhausts the day's allowance. Reading the body without the status turned that into
    // "no channel was found with that name", stated as certain, about the user's own channel.
    mockFetch((url) =>
      url.includes('/search')
        ? { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }
        : { status: 200, body: { items: [] } }
    )
    const r = await resolveYouTubeChannel('@ghost')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.problem).not.toMatch(/No channel was found/i)
    expect(r.problem).toMatch(/allowance/i)
  })

  it('refuses a pasted VIDEO link without spending 100 units searching for "watch"', async () => {
    mockFetch(() => ({ status: 200, body: channelBody }))
    const r = await resolveYouTubeChannel('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(r.ok).toBe(false)
    expect(r.ok === false && /link to a video/i.test(r.problem)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('refuses an API KEY pasted into the channel box, before it can reach a URL', async () => {
    // The search query goes in the URL. A key mis-pasted here would be logged by every
    // proxy between the PC and Google — the one thing the rest of this file prevents.
    mockFetch(() => ({ status: 200, body: channelBody }))
    const r = await resolveYouTubeChannel('AIzaSyGoodKeyxxxxxxxxxxxxxxxxxxxxxxxxx')
    expect(r.ok).toBe(false)
    expect(r.ok === false && /looks like your API key/i.test(r.problem)).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('does not spend 100 units searching after an exact ID came back "no such channel"', async () => {
    mockFetch(() => ({ status: 200, body: { items: [] } }))
    const r = await resolveYouTubeChannel('UCabcdefghijklmnopqrstuv')
    expect(r.ok).toBe(false)
    expect(r.ok === false && /no channel with that ID/i.test(r.problem)).toBe(true)
    expect(calls.some((c) => c.includes('/search'))).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('says nothing was typed rather than searching for an empty string', async () => {
    mockFetch(() => ({ status: 200, body: {} }))
    const r = await resolveYouTubeChannel('   ')
    expect(r.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
