/**
 * Five different situations used to produce one identical answer: `[]`.
 *
 * No key. A key but no channel. A key Google refuses. No internet. A channel that
 * genuinely has no videos. Your Channel printed *"No videos could be read — check the
 * YouTube key and channel ID in Settings"* for all five, which is the right advice for
 * one of them, useless for two, and actively wrong for the other two (nothing is broken
 * when the connection dropped, and nothing is broken when the channel is simply new).
 *
 * These tests hold each of the five apart. They also hold the quota discipline in place:
 * reading a channel's own videos goes through `playlistItems` at 1 unit a page, never
 * `search` at 100.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const saved = { key: 'AIzaSyKeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' as string | null, channel: 'UCabcdefghijklmnopqrstuv' }

vi.mock('../store', () => ({
  getYouTubeApiKey: () => saved.key,
  getYouTubeChannelId: () => saved.channel
}))

const { readMyChannel } = await import('./youtube')

let calls: string[] = []

function mockFetch(responder: (url: string) => { status: number; body: unknown } | 'network-error'): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      const r = responder(url)
      if (r === 'network-error') throw new Error('offline')
      return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body } as unknown as Response
    })
  )
}

/** A channel that answers normally, with one upload. */
function healthyChannel(url: string): { status: number; body: unknown } {
  if (url.includes('/channels')) {
    return { status: 200, body: { items: [{ contentDetails: { relatedPlaylists: { uploads: 'UUabc' } } }] } }
  }
  if (url.includes('/playlistItems')) {
    return {
      status: 200,
      body: { items: [{ snippet: { title: 'How to read a balance sheet', publishedAt: '2026-01-02T10:00:00Z', resourceId: { videoId: 'vid1' } } }] }
    }
  }
  return { status: 200, body: { items: [{ id: 'vid1', statistics: { viewCount: '900', likeCount: '30', commentCount: '4' } }] } }
}

beforeEach(() => {
  calls = []
  saved.key = 'AIzaSyKeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
  saved.channel = 'UCabcdefghijklmnopqrstuv'
})

afterEach(() => vi.unstubAllGlobals())

describe('a working read', () => {
  it('returns the videos with no problem attached', async () => {
    mockFetch(healthyChannel)
    const { videos, problem } = await readMyChannel()
    expect(problem).toBeNull()
    expect(videos).toHaveLength(1)
    expect(videos[0]).toMatchObject({ id: 'vid1', views: 900, likes: 30, comments: 4 })
  })

  it('never uses the 100-unit search endpoint to read your own uploads', async () => {
    mockFetch(healthyChannel)
    await readMyChannel()
    expect(calls.some((c) => c.includes('/search'))).toBe(false)
    expect(calls.some((c) => c.includes('/playlistItems'))).toBe(true)
  })
})

describe('the five ways it can come back empty', () => {
  it('1. no key — and does not waste a request finding out', async () => {
    saved.key = null
    mockFetch(healthyChannel)
    const r = await readMyChannel()
    expect(r.problem).toEqual({ kind: 'no-key' })
    expect(calls).toHaveLength(0)
  })

  it('2. a key but no channel id', async () => {
    saved.channel = ''
    mockFetch(healthyChannel)
    expect((await readMyChannel()).problem).toEqual({ kind: 'no-channel' })
  })

  it('2b. a channel id that Google accepts but does not recognise', async () => {
    // 200 with no items: the key is fine, the id points at nothing. Reporting this as a
    // key problem would send the user to redo four correct steps.
    mockFetch((url) => (url.includes('/channels') ? { status: 200, body: { items: [] } } : healthyChannel(url)))
    expect((await readMyChannel()).problem).toEqual({ kind: 'no-channel' })
  })

  it('3. Google refused, and the reason survives all the way out', async () => {
    mockFetch(() => ({ status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }))
    const r = await readMyChannel()
    expect(r.problem?.kind).toBe('refused')
    expect(r.problem?.kind === 'refused' && /allowance/i.test(r.problem.detail)).toBe(true)
  })

  it('4. no internet — reported as unreachable, never as an empty channel', async () => {
    mockFetch(() => 'network-error')
    expect((await readMyChannel()).problem).toEqual({ kind: 'unreachable' })
  })

  it('5. everything works and the channel really is empty', async () => {
    mockFetch((url) =>
      url.includes('/playlistItems') ? { status: 200, body: { items: [] } } : healthyChannel(url)
    )
    expect((await readMyChannel()).problem).toEqual({ kind: 'empty-channel' })
  })

  it('all five are distinguishable — the defect this file exists for', async () => {
    const kinds = new Set<string>()
    saved.key = null
    mockFetch(healthyChannel)
    kinds.add((await readMyChannel()).problem!.kind)

    saved.key = 'AIzaSyKeyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
    saved.channel = ''
    kinds.add((await readMyChannel()).problem!.kind)

    saved.channel = 'UCabcdefghijklmnopqrstuv'
    mockFetch(() => ({ status: 403, body: { error: { errors: [{ reason: 'keyInvalid' }] } } }))
    kinds.add((await readMyChannel()).problem!.kind)

    mockFetch(() => 'network-error')
    kinds.add((await readMyChannel()).problem!.kind)

    mockFetch((url) => (url.includes('/playlistItems') ? { status: 200, body: { items: [] } } : healthyChannel(url)))
    kinds.add((await readMyChannel()).problem!.kind)

    expect(kinds.size).toBe(5)
  })
})

describe('missing view counts are not zero view counts', () => {
  it('reports a failed statistics page instead of recording every video as 0 views', async () => {
    // Swallowed, this fed "which of your titles worked" a batch of false zeros and the
    // analysis would conclude those titles do not work.
    mockFetch((url) =>
      url.includes('/videos?part=statistics') ? { status: 403, body: {} } : healthyChannel(url)
    )
    const r = await readMyChannel()
    expect(r.videos).toHaveLength(1)
    expect(r.problem?.kind).toBe('partial')
    expect(r.problem?.kind === 'partial' && /view counts/i.test(r.problem.detail)).toBe(true)
  })
})

describe('Google breaking is not Google refusing', () => {
  it('reports a 500 as google-error, never as refused', async () => {
    mockFetch(() => ({ status: 500, body: {} }))
    const r = await readMyChannel()
    expect(r.problem?.kind).toBe('google-error')
  })
})

describe('a refusal partway through', () => {
  it('keeps the pages that did come back rather than throwing the read away', async () => {
    let page = 0
    mockFetch((url) => {
      if (url.includes('/channels')) return healthyChannel(url)
      if (url.includes('/playlistItems')) {
        page++
        if (page === 1) {
          return {
            status: 200,
            body: {
              items: [{ snippet: { title: 'One', publishedAt: '2026-01-01T00:00:00Z', resourceId: { videoId: 'v1' } } }],
              nextPageToken: 'p2'
            }
          }
        }
        return { status: 403, body: { error: { errors: [{ reason: 'quotaExceeded' }] } } }
      }
      return { status: 200, body: { items: [{ id: 'v1', statistics: { viewCount: '5' } }] } }
    })
    const r = await readMyChannel()
    // Half an answer beats none — but it is reported AS half an answer. Returning it with
    // problem: null let an incomplete history quietly become "what works on your channel".
    expect(r.videos).toHaveLength(1)
    expect(r.problem?.kind).toBe('partial')
    expect(r.problem?.kind === 'partial' && /partway through/i.test(r.problem.detail)).toBe(true)
  })
})
