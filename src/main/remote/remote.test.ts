/**
 * The PC half of "the same studio, on the phone".
 *
 * What matters here is that driving the app remotely is EXACTLY as safe as driving it
 * from the desktop and no safer: the same handlers, refusals where a remote call makes
 * no sense, and — the thing worth being paranoid about — no way to read a file outside
 * the app's own build folder through the static route.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fakeWebContents = { send: vi.fn() }
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [{ webContents: fakeWebContents }] }
}))

import { ipcMain } from 'electron'
import {
  RemoteInvokeError,
  _resetForTests,
  captureHandlers,
  invokeRemote,
  isRemoteAllowed,
  remoteChannels
} from './registry'
import { _resetForTests as resetEvents, attachRemoteEvents, remoteListenerCount, subscribeRemoteEvents } from './events'
import { injectBridge, mimeFor, resolveStatic } from './site'
import { parseRange } from './files'

beforeEach(() => {
  _resetForTests()
  resetEvents()
  fakeWebContents.send.mockClear()
  ;(ipcMain.handle as ReturnType<typeof vi.fn>).mockClear()
})

describe('capturing the app’s handlers', () => {
  it('registers them normally AND remembers them, then unpatches itself', () => {
    const before = ipcMain.handle
    captureHandlers(() => {
      ipcMain.handle('demo:add', async (_e, a, b) => (a as number) + (b as number))
    })
    // Still registered with Electron exactly as before — the desktop is unaffected.
    expect(ipcMain.handle).toHaveBeenCalledWith('demo:add', expect.any(Function))
    // And the patch is gone.
    expect(ipcMain.handle).toBe(before)
    expect(remoteChannels()).toEqual(['demo:add'])
  })

  it('restores ipcMain even when registration throws halfway', () => {
    const before = ipcMain.handle
    expect(() =>
      captureHandlers(() => {
        ipcMain.handle('demo:ok', async () => 1)
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(ipcMain.handle).toBe(before)
  })

  it('runs the very same function a desktop click would have run', async () => {
    captureHandlers(() => {
      ipcMain.handle('demo:add', async (_e, a, b) => (a as number) + (b as number))
    })
    await expect(invokeRemote('demo:add', [2, 3])).resolves.toBe(5)
  })

  it('gives handlers a real sender, so progress still reaches the desktop window', async () => {
    captureHandlers(() => {
      ipcMain.handle('demo:progress', async (e) => {
        e.sender.send('demo:tick', 'half way')
        return 'done'
      })
    })
    await expect(invokeRemote('demo:progress', [])).resolves.toBe('done')
    expect(fakeWebContents.send).toHaveBeenCalledWith('demo:tick', 'half way')
  })

  it('refuses a channel that was never registered', async () => {
    await expect(invokeRemote('demo:nope', [])).rejects.toBeInstanceOf(RemoteInvokeError)
  })

  it('refuses PC-only channels with an explanation, not a silent failure', async () => {
    captureHandlers(() => {
      ipcMain.handle('storyboard:pick-photo', async () => 'never')
    })
    expect(isRemoteAllowed('storyboard:pick-photo')).toBe(false)
    expect(remoteChannels()).not.toContain('storyboard:pick-photo')
    await expect(invokeRemote('storyboard:pick-photo', [])).rejects.toThrow(/on the computer/)
  })

  it('blocks every channel that opens a dialog on the PC', () => {
    const dialogs = [
      'storyboard:pick-photo',
      'presenter:pick-video',
      'timeline:pick-clips',
      'project:import-pick',
      'data:import-file',
      'chart:price-file',
      'export:text',
      'thumbnail:save',
      'psx:live-excel'
    ]
    captureHandlers(() => {
      for (const c of dialogs) ipcMain.handle(c, async () => 'never')
    })
    for (const c of dialogs) expect(isRemoteAllowed(c), c).toBe(false)
    expect(remoteChannels()).toEqual([])
  })

  it('lets a handler’s own error message through unchanged', async () => {
    captureHandlers(() => {
      ipcMain.handle('demo:fail', async () => {
        throw new Error('No API key is set.')
      })
    })
    await expect(invokeRemote('demo:fail', [])).rejects.toThrow('No API key is set.')
  })
})

describe('progress events', () => {
  it('still reaches the desktop first, and is copied to listening phones', () => {
    // Held separately: after attaching, `contents.send` IS the wrapper, so asserting
    // on it would prove nothing about the desktop still being fed.
    const desktop = vi.fn()
    const contents = { send: desktop } as unknown as Parameters<typeof attachRemoteEvents>[0]
    attachRemoteEvents(contents)
    const seen: [string, unknown[]][] = []
    const off = subscribeRemoteEvents((channel, args) => seen.push([channel, args]))
    contents.send('video:progress', 'Rendering scene 3')
    expect(desktop).toHaveBeenCalledWith('video:progress', 'Rendering scene 3')
    expect(seen).toEqual([['video:progress', ['Rendering scene 3']]])
    off()
    contents.send('video:progress', 'after unsubscribe')
    expect(seen).toHaveLength(1)
  })

  it('never lets a broken phone connection break the render', () => {
    const original = vi.fn()
    const contents = { send: original } as unknown as Parameters<typeof attachRemoteEvents>[0]
    attachRemoteEvents(contents)
    subscribeRemoteEvents(() => {
      throw new Error('phone went away')
    })
    expect(() => contents.send('video:progress', 'still going')).not.toThrow()
    expect(original).toHaveBeenCalledWith('video:progress', 'still going')
  })

  it('does not double-wrap a webContents', () => {
    const original = vi.fn()
    const contents = { send: original } as unknown as Parameters<typeof attachRemoteEvents>[0]
    attachRemoteEvents(contents)
    attachRemoteEvents(contents)
    const seen: string[] = []
    subscribeRemoteEvents((c) => seen.push(c))
    contents.send('x', 1)
    expect(seen).toEqual(['x'])
    expect(original).toHaveBeenCalledTimes(1)
  })

  it('counts who is watching', () => {
    expect(remoteListenerCount()).toBe(0)
    const off = subscribeRemoteEvents(() => {})
    expect(remoteListenerCount()).toBe(1)
    off()
    expect(remoteListenerCount()).toBe(0)
  })
})

describe('serving the studio’s own files', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'npz-site-'))
    mkdirSync(join(dir, 'assets'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html><head><title>t</title></head><body></body></html>')
    writeFileSync(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
    writeFileSync(join(tmpdir(), 'npz-secret-outside.txt'), 'do not serve me')
  })

  it('finds a real file inside the build folder', () => {
    expect(resolveStatic(dir, '/assets/index-abc123.js')).toBe(join(dir, 'assets', 'index-abc123.js'))
  })

  it('refuses to walk out of it', () => {
    for (const attack of [
      '/../npz-secret-outside.txt',
      '/assets/../../npz-secret-outside.txt',
      '/%2e%2e/npz-secret-outside.txt',
      '/....//npz-secret-outside.txt',
      '/assets/%2e%2e%2f%2e%2e%2fnpz-secret-outside.txt'
    ]) {
      expect(resolveStatic(dir, attack), attack).toBeNull()
    }
  })

  it('refuses directories, missing files and null bytes', () => {
    expect(resolveStatic(dir, '/assets')).toBeNull()
    expect(resolveStatic(dir, '/nope.js')).toBeNull()
    expect(resolveStatic(dir, '/index.html\0.png')).toBeNull()
  })

  it('labels the file types a browser is fussy about', () => {
    expect(mimeFor('/a/index-abc.js')).toBe('text/javascript; charset=utf-8')
    expect(mimeFor('/a/style.css')).toBe('text/css; charset=utf-8')
    expect(mimeFor('/a/font.woff2')).toBe('font/woff2')
    expect(mimeFor('/a/clip.mp4')).toBe('video/mp4')
    expect(mimeFor('/a/unknown.zzz')).toBe('application/octet-stream')
  })
})

describe('the injected bridge', () => {
  it('goes in the head, as plain scripts, before the app’s module', () => {
    const html = injectBridge('<html><head><title>t</title></head><body><script type="module" src="./assets/i.js"></script></body></html>', 'TOKEN123')
    expect(html.indexOf('bridge.js')).toBeLessThan(html.indexOf('type="module"'))
    expect(html).toContain('<script src="/bridge.js"></script>')
    // No `type=module` on ours: a module would be deferred until after the app starts.
    expect(html).not.toContain('<script type="module" src="/bridge.js"')
  })

  it('carries the token as valid JSON, quoting and all', () => {
    expect(injectBridge('<head></head>', 'a"b\\c')).toContain('window.__NPZ_TOKEN__="a\\"b\\\\c"')
  })

  it('still injects if there is no head to hook into', () => {
    expect(injectBridge('<body>hi</body>', 'T')).toContain('bridge.js')
  })
})

describe('range requests (what lets a phone scrub a long video)', () => {
  it('reads an ordinary range', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('reads a suffix range', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
    expect(parseRange('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 })
  })

  it('clamps an end past the file rather than failing', () => {
    expect(parseRange('bytes=900-99999', 1000)).toEqual({ start: 900, end: 999 })
  })

  it('rejects nonsense instead of serving the wrong bytes', () => {
    for (const bad of [undefined, '', 'bytes=', 'items=0-1', 'bytes=abc-def', 'bytes=500-100', 'bytes=1000-', 'bytes=-0']) {
      expect(parseRange(bad, 1000), String(bad)).toBeNull()
    }
  })
})
