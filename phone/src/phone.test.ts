// @vitest-environment jsdom
/**
 * Tests for the standalone phone app.
 *
 * The most important group here is PROMPT CONTAINMENT. The phone app is hosted on a
 * public URL, so anything bundled into it is readable by anyone. The studio's prompt
 * wording — the thing that makes videos sound like this channel — must therefore
 * never appear in it. It did once; these tests exist so it cannot happen again by
 * accident when someone adds a convenient-looking import.
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getKey, getPcLink, getProvider, listSaved, remove, save, setKey, setPcLink, setProvider } from './store'

const PHONE_SRC = join(__dirname)
const DIST_BUNDLE = join(__dirname, '..', 'dist', 'app.js')

/** Distinctive wording from src/main/prompts.ts and src/main/image/styles.ts. */
const SECRET_WORDING = [
  'senior content strategist',
  'code-switched Roman Urdu',
  'institutional-grade',
  'PATTERN INTERRUPT',
  'URGENT ALPHA',
  'EVIDENCE BLOCS',
  'NEVER invent or cite specific numbers',
  'cinematic photorealistic film still',
  'stop-scroll',
  'Authority–Shock–Scarcity',
  // From the storyboard director prompt, which lives in a module the phone DOES
  // import for its validation helpers — tree-shaking must keep dropping the wording.
  'DIRECTOR of a video studio',
  'retention-optimised',
  'vivid scene description'
]

/** Modules that carry prompt wording and must never be imported by the phone. */
const FORBIDDEN_IMPORTS = ['src/main/prompts', 'main/image/styles', 'shared/prompts']

function phoneSourceFiles(): string[] {
  return readdirSync(PHONE_SRC)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => join(PHONE_SRC, f))
}

beforeEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('prompt containment — the studio wording must never ship publicly', () => {
  it('no phone source file imports a prompt-bearing module', () => {
    for (const file of phoneSourceFiles()) {
      const text = readFileSync(file, 'utf-8')
      for (const forbidden of FORBIDDEN_IMPORTS) {
        expect(text.includes(`from '../../${forbidden}'`), `${file} must not import ${forbidden}`).toBe(false)
        expect(text.includes(`import('../../${forbidden}')`), `${file} must not import ${forbidden}`).toBe(false)
      }
    }
  })

  it('no phone source file contains the prompt wording verbatim', () => {
    for (const file of phoneSourceFiles()) {
      const text = readFileSync(file, 'utf-8')
      for (const secret of SECRET_WORDING) {
        expect(text.includes(secret), `${file} must not contain "${secret}"`).toBe(false)
      }
    }
  })

  it('the BUILT bundle is clean too', () => {
    // The bundle is the thing actually published, so it is the real check. It only
    // exists after `npm run build:phone`; skip rather than fail when it is absent.
    if (!existsSync(DIST_BUNDLE)) return
    const bundle = readFileSync(DIST_BUNDLE, 'utf-8')
    for (const secret of SECRET_WORDING) {
      expect(bundle.includes(secret), `phone/dist/app.js must not contain "${secret}"`).toBe(false)
    }
  })

  it('the bundle still contains the harmless things it genuinely needs', () => {
    if (!existsSync(DIST_BUNDLE)) return
    const bundle = readFileSync(DIST_BUNDLE, 'utf-8')
    // Validation and the offline splitter are pure logic with no secret wording, and
    // they are what let the phone build and check a storyboard with the PC switched off.
    expect(bundle).toContain('asset:')
  })
})

describe('phone storage', () => {
  it('defaults to the free AI with no key, so the app works with nothing typed in', () => {
    expect(getProvider()).toBe('free')
    expect(getKey()).toBe('')
  })

  it('remembers the provider and key', () => {
    setProvider('anthropic')
    setKey('  sk-test  ')
    expect(getProvider()).toBe('anthropic')
    expect(getKey()).toBe('sk-test')
  })

  it('falls back to free if the stored provider is nonsense', () => {
    localStorage.setItem('npz.provider', 'not-a-provider')
    expect(getProvider()).toBe('free')
  })

  it('remembers the PC link, trimmed', () => {
    setPcLink('  http://100.90.1.2:5000/?t=abc  ')
    expect(getPcLink()).toBe('http://100.90.1.2:5000/?t=abc')
  })

  it('lists newest first', () => {
    save('idea', 'first', 'a')
    save('script', 'second', 'b')
    expect(listSaved().map((i) => i.title)).toEqual(['second', 'first'])
  })

  it('caps stored items so a phone cannot silently fill up', () => {
    for (let i = 0; i < 205; i++) save('idea', `i${i}`, 'body')
    expect(listSaved()).toHaveLength(200)
    // The cap drops the OLDEST, never the newest.
    expect(listSaved()[0].title).toBe('i204')
  })

  it('deletes only the requested item', () => {
    const keep = save('script', 'keep', 'a')
    const drop = save('script', 'drop', 'b')
    remove(drop.id)
    expect(listSaved().map((i) => i.id)).toEqual([keep.id])
  })

  it('survives storage being unavailable instead of crashing', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      }
    })
    expect(getProvider()).toBe('free')
    expect(listSaved()).toEqual([])
    expect(() => save('idea', 't', 'b')).not.toThrow()
  })

  it('recovers from corrupted stored data', () => {
    localStorage.setItem('npz.saved', 'not json')
    expect(listSaved()).toEqual([])
    localStorage.setItem('npz.saved', '{"not":"an array"}')
    expect(listSaved()).toEqual([])
  })
})

describe('talking to the PC', () => {
  it('says what to do when no PC has been connected yet', { timeout: 20000 }, async () => {
    const { generateIdeas, pcConfigured } = await import('./ai')
    expect(pcConfigured()).toBe(false)
    await expect(generateIdeas({ focusArea: 'x', count: 1 })).rejects.toThrow(/Settings → Phone access/i)
  })

  it('rejects a PC link with no access key rather than failing later', async () => {
    setPcLink('http://192.168.1.5:5000/')
    const { generateIdeas } = await import('./ai')
    await expect(generateIdeas({ focusArea: 'x', count: 1 })).rejects.toThrow(/missing its key/i)
  })

  it('sends only plain parameters and the access key — never a prompt', async () => {
    setPcLink('http://100.90.1.2:5000/?t=secret-key')
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([]), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const { generateIdeas } = await import('./ai')
    await generateIdeas({ focusArea: 'Pakistan inflation', count: 3 })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('http://100.90.1.2:5000/api/ideas')
    expect((init.headers as Record<string, string>)['X-Token']).toBe('secret-key')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({ focusArea: 'Pakistan inflation', count: 3 })
    // Whatever we send, it must never carry prompt wording.
    for (const secret of SECRET_WORDING) expect(init.body as string).not.toContain(secret)
  })

  it('turns an unreachable PC into plain language', async () => {
    setPcLink('http://100.90.1.2:5000/?t=k')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      })
    )
    const { generateIdeas } = await import('./ai')
    await expect(generateIdeas({ focusArea: 'x', count: 1 })).rejects.toThrow(/Could not reach your PC/i)
  })

  it('explains a rejected key instead of showing a status code', async () => {
    setPcLink('http://100.90.1.2:5000/?t=stale')
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const { generateIdeas } = await import('./ai')
    await expect(generateIdeas({ focusArea: 'x', count: 1 })).rejects.toThrow(/refused the key/i)
  })
})
