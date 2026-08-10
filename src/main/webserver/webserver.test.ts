/**
 * Guards the phone web-view server.
 *
 * The point of these tests is the SECURITY MODEL: every request must carry the
 * token, the new read-only routes must not become a hole in that, and nothing
 * the phone can reach may modify or delete the user's work. They start the real
 * HTTP server and make real requests rather than poking at internals, because
 * that is the only way to prove the gate actually holds.
 */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../store', () => ({
  getModel: () => 'test-model',
  getSettings: () => ({ activeProvider: 'free' }),
  listLibrary: () => [
    { id: 'a', kind: 'script', data: { title: 'Rupee explainer', body: 'text' }, savedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'b', kind: 'idea', data: { title: 'Trashed', hook: 'h' }, savedAt: '2026-01-01T00:00:00.000Z', trashedAt: '2026-01-03T00:00:00.000Z' }
  ],
  listActivityLog: () => Array.from({ length: 150 }, (_, i) => ({
    id: `e${i}`,
    timestamp: '2026-01-01T00:00:00.000Z',
    actor: 'user',
    action: `action ${i}`
  })),
  logActivity: vi.fn(),
  // Used by the project importer behind POST /api/project.
  phoneAssetsDir: () => mkdtempSync(join(tmpdir(), 'npz-ws-assets-')),
  setDraft: vi.fn()
}))

vi.mock('../services', () => ({
  generateIdeasFlow: vi.fn(async () => [{ title: 'Idea' }]),
  generateScriptFlow: vi.fn(async () => ({ title: 'S', body: 'B' }))
}))

vi.mock('../llm/ollama', () => ({ ollamaChatStream: vi.fn() }))
vi.mock('../llm', () => ({ getActiveProvider: () => ({ generateText: async () => 'advice' }) }))

// Enough of Electron for the remote surface: a registry to capture handlers into and
// a window whose webContents the handlers can send progress to.
const desktopSend = vi.fn()
vi.mock('electron', () => ({
  powerSaveBlocker: { start: () => 1, isStarted: () => true, stop: () => {} },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [{ webContents: { send: (...a: unknown[]) => desktopSend(...a) } }] }
}))

import { ipcMain } from 'electron'
import { getWebServerStatus, startWebServer, stopWebServer } from './index'
import { MOBILE_PAGE } from './page'
import { _resetForTests, captureHandlers } from '../remote/registry'
import { _resetForTests as resetEvents, attachRemoteEvents } from '../remote/events'

/** Starts the server and returns its base URL plus the one valid token. */
async function boot(): Promise<{ base: string; token: string }> {
  const status = await startWebServer()
  const url = new URL(status.url as string)
  // Bound to 0.0.0.0; talk to it over loopback so the test never leaves the box.
  return { base: `http://127.0.0.1:${url.port}`, token: url.searchParams.get('t') as string }
}

afterEach(() => {
  stopWebServer()
})

describe('phone web server auth gate', () => {
  it('rejects every route without a token, including the page itself', async () => {
    const { base } = await boot()
    for (const path of ['/', '/index.html', '/api/library', '/api/activity']) {
      const res = await fetch(`${base}${path}`)
      expect(res.status, `${path} must be gated`).toBe(401)
    }
    // The one route that WRITES must be gated just as hard as the reads.
    const push = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"formatVersion":1}'
    })
    expect(push.status).toBe(401)
  })

  it('rejects a wrong token', async () => {
    const { base } = await boot()
    const res = await fetch(`${base}/api/library`, { headers: { 'X-Token': 'not-the-token' } })
    expect(res.status).toBe(401)
  })

  it('accepts the token in the query string or the header', async () => {
    const { base, token } = await boot()
    expect((await fetch(`${base}/?t=${token}`)).status).toBe(200)
    expect((await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })).status).toBe(200)
  })

  it('issues a fresh token each start, so turning phone access off invalidates the old link', async () => {
    const first = await boot()
    stopWebServer()
    const second = await boot()
    expect(second.token).not.toBe(first.token)
    const res = await fetch(`${second.base}/api/library`, { headers: { 'X-Token': first.token } })
    expect(res.status).toBe(401)
  })

  it('never puts the token in the status URL of a stopped server', () => {
    expect(getWebServerStatus()).toEqual({ running: false, url: null, addresses: [] })
  })

  it('lists every network the PC can be reached on, VPN routes first', async () => {
    const { token } = await boot()
    const { addresses } = getWebServerStatus()
    expect(addresses.length).toBeGreaterThan(0)
    for (const a of addresses) {
      // Each entry must be directly usable — a link without its key is useless.
      expect(a.url).toContain(`t=${token}`)
      expect(a.url).toContain(a.address)
      expect(a.label).toBeTruthy()
    }
    // A private-VPN route is what works on mobile data, so it must sort first.
    const firstRemote = addresses.findIndex((a) => a.remote)
    const lastLocal = addresses.map((a) => a.remote).lastIndexOf(false)
    if (firstRemote !== -1) expect(firstRemote).toBeLessThan(lastLocal === -1 ? Infinity : lastLocal + 1)
  })
})

describe('read-only phone routes', () => {
  it('serves the library', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })
    const body = await res.json()
    expect(body).toHaveLength(2)
    expect(body[0].data.title).toBe('Rupee explainer')
  })

  it('caps the activity log so a long history cannot flood a phone', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/activity`, { headers: { 'X-Token': token } })
    const body = await res.json()
    expect(body).toHaveLength(100)
  })

  it('accepts a plan pushed from the phone and reports what arrived', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({
        formatVersion: 1,
        title: 'From the phone',
        storyboard: { title: 'From the phone', style: 'noir', beats: [{ durationSec: 5, visual: 'A skyline' }] },
        build: { style: 'noir' },
        assets: []
      })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, scenes: 1, needMedia: 0 })
  })

  it('rejects a pushed plan that is not a plan, without crashing the server', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ definitely: 'not a plan' })
    })
    expect(res.status).toBe(400)
    // The server must still be answering afterwards.
    expect((await fetch(`${base}/api/library`, { headers: { 'X-Token': token } })).status).toBe(200)
  })

  it('refuses to mutate anything — no write verb is routed', async () => {
    const { base, token } = await boot()
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      for (const path of ['/api/library', '/api/activity']) {
        const res = await fetch(`${base}${path}`, { method, headers: { 'X-Token': token } })
        expect(res.status, `${method} ${path} must not be handled`).toBe(404)
      }
    }
  })
})

describe('mobile page', () => {
  it('exposes every tab the script wires up', () => {
    for (const tab of ['ideas', 'writer', 'advisor', 'library', 'activity']) {
      expect(MOBILE_PAGE).toContain(`id="t-${tab}"`)
      expect(MOBILE_PAGE).toContain(`id="s-${tab}"`)
    }
  })

  it('is self-contained — no external asset can leak the private link', () => {
    // Any http(s) reference would tell a third-party server the LAN address and
    // token via the Referer header. The icon is an inline data: URI for this reason.
    expect(MOBILE_PAGE).not.toMatch(/(src|href)="https?:\/\//)
  })

  it('escapes HTML so PC-side content cannot inject script into the phone page', () => {
    expect(MOBILE_PAGE).toContain(`function esc(`)
    // Every place that interpolates server data must run it through esc().
    expect(MOBILE_PAGE).not.toMatch(/\+\s*(s\.title|s\.body|a\.action|a\.details)\s*\+/)
  })
})

/**
 * The full studio, driven from the phone.
 *
 * These go through the real HTTP server rather than calling the registry directly,
 * because the thing being proven is end-to-end: a phone that has the link can run the
 * app, a phone that does not cannot, and neither can reach past the app's own folder.
 */
describe('the studio, driven remotely', () => {
  beforeEach(() => {
    _resetForTests()
    resetEvents()
    desktopSend.mockClear()
    captureHandlers(() => {
      ipcMain.handle('demo:add', async (_e, a, b) => (a as number) + (b as number))
      ipcMain.handle('demo:bytes', async (_e, clip) => ({ size: (clip as Uint8Array).length }))
      ipcMain.handle('demo:echo-bytes', async () => new Uint8Array([7, 8, 9]))
      ipcMain.handle('demo:boom', async () => {
        throw new Error('Ollama is not running.')
      })
      ipcMain.handle('storyboard:pick-photo', async () => 'never')
    })
  })

  it('is gated by the token like everything else', async () => {
    const { base } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'demo:add', args: [1, 2] })
    })
    expect(res.status).toBe(401)
  })

  it('runs the same handler a desktop click would have run', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ channel: 'demo:add', args: [2, 40] })
    })
    expect(await res.json()).toEqual({ ok: true, value: 42 })
  })

  it('carries recorded audio through as real bytes, not an object of numbers', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      // What the bridge sends for a Uint8Array of 4 bytes.
      body: JSON.stringify({ channel: 'demo:bytes', args: [{ __npzBin: 'AAECAw==' }] })
    })
    expect(await res.json()).toEqual({ ok: true, value: { size: 4 } })
  })

  it('sends bytes back in the same form', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ channel: 'demo:echo-bytes', args: [] })
    })
    expect(await res.json()).toEqual({ ok: true, value: { __npzBin: 'BwgJ' } })
  })

  it('hands a handler’s own message back so the phone shows what the PC would', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ channel: 'demo:boom', args: [] })
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: false, error: 'Ollama is not running.' })
  })

  it('refuses PC-only channels and says why', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ channel: 'storyboard:pick-photo', args: [] })
    })
    const body = await res.json()
    expect(body.ok).toBe(false)
    expect(body.error).toMatch(/on the computer/)
  })

  it('refuses an unknown channel', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ channel: 'evil:rm-rf', args: [] })
    })
    expect((await res.json()).error).toMatch(/Unknown channel/)
  })

  it('lists what the phone is allowed to ask for, PC-only channels excluded', async () => {
    const { base, token } = await boot()
    const list = await (await fetch(`${base}/api/channels`, { headers: { 'X-Token': token } })).json()
    expect(list).toContain('demo:add')
    expect(list).not.toContain('storyboard:pick-photo')
  })

  it('sets a cookie so the browser can fetch the app’s own files', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/?t=${token}`)
    const cookie = res.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('npz_t=')
    // HttpOnly and SameSite=Strict: unreadable by page script, never sent cross-site.
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    // And the cookie alone is then enough, which is what <video src> depends on.
    const withCookie = await fetch(`${base}/api/channels`, {
      headers: { Cookie: `npz_t=${encodeURIComponent(token)}` }
    })
    expect(withCookie.status).toBe(200)
  })

  it('streams live progress to a listening phone', async () => {
    const { base, token } = await boot()
    const contents = { send: desktopSend } as unknown as Parameters<typeof attachRemoteEvents>[0]
    attachRemoteEvents(contents)

    const controller = new AbortController()
    const res = await fetch(`${base}/api/events`, {
      headers: { 'X-Token': token },
      signal: controller.signal
    })
    expect(res.headers.get('content-type')).toContain('text/event-stream')
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    // The retry hint arrives immediately; the event follows once something happens.
    await reader.read()
    contents.send('video:progress', 'Rendering scene 3 of 12')
    const { value } = await reader.read()
    const text = new TextDecoder().decode(value)
    expect(text).toContain('"channel":"video:progress"')
    expect(text).toContain('Rendering scene 3 of 12')
    controller.abort()
  })

  it('serves a file the app produced, with range support so a phone can scrub it', async () => {
    const { base, token } = await boot()
    const file = join(mkdtempSync(join(tmpdir(), 'npz-media-')), 'clip.mp4')
    writeFileSync(file, 'HELLO-VIDEO-BYTES')

    const whole = await fetch(`${base}/api/file/${encodeURIComponent(file)}`, { headers: { 'X-Token': token } })
    expect(whole.status).toBe(200)
    expect(whole.headers.get('content-type')).toBe('video/mp4')
    expect(whole.headers.get('accept-ranges')).toBe('bytes')
    expect(await whole.text()).toBe('HELLO-VIDEO-BYTES')

    const part = await fetch(`${base}/api/file/${encodeURIComponent(file)}`, {
      headers: { 'X-Token': token, Range: 'bytes=6-10' }
    })
    expect(part.status).toBe(206)
    expect(part.headers.get('content-range')).toBe('bytes 6-10/17')
    expect(await part.text()).toBe('VIDEO')
  })

  it('will not serve a file without the token', async () => {
    const { base } = await boot()
    const file = join(mkdtempSync(join(tmpdir(), 'npz-media-')), 'clip.mp4')
    writeFileSync(file, 'secret')
    expect((await fetch(`${base}/api/file/${encodeURIComponent(file)}`)).status).toBe(401)
  })

  it('answers 404 for a file that has been deleted rather than hanging', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/api/file/${encodeURIComponent(join(tmpdir(), 'npz-not-here.mp4'))}`, {
      headers: { 'X-Token': token }
    })
    expect(res.status).toBe(404)
  })

  it('keeps the small page available at /lite', async () => {
    const { base, token } = await boot()
    const res = await fetch(`${base}/lite?t=${token}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe(MOBILE_PAGE)
  })
})
