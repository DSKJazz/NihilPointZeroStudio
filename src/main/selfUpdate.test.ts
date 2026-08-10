import { describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  alreadyDownloaded,
  downloadInstaller,
  expectedSha256,
  fetchLatestRelease,
  freshUpdateDir,
  INSTALLER_ASSET,
  percent,
  pickInstaller,
  runSelfUpdate,
  updateDir,
  verifyDownload
} from './selfUpdate'

const good = {
  name: INSTALLER_ASSET,
  size: 217_688_427,
  state: 'uploaded',
  digest: 'sha256:56c0b8508977e009954e0b456aca16e569e93f7fff521d7c6411a47208f848aa',
  browser_download_url: 'https://github.com/DSKJazz/NihilPointZeroStudio/releases/download/latest/NIHILPOINTZERO-OS-setup.exe'
}

describe('pickInstaller', () => {
  it('finds the installer among the other release files', () => {
    const res = pickInstaller([{ name: 'HOW-TO-USE.txt', size: 100 }, good])
    expect('asset' in res && res.asset.name).toBe(INSTALLER_ASSET)
  })

  it('matches the name case-insensitively', () => {
    const res = pickInstaller([{ ...good, name: 'nihilpointzero-os-SETUP.exe' }])
    expect('asset' in res).toBe(true)
  })

  it('does NOT confuse the portable exe for the installer', () => {
    const res = pickInstaller([{ ...good, name: 'NIHILPOINTZERO-OS-portable.exe' }])
    expect('error' in res).toBe(true)
  })

  it('refuses an asset that is still uploading', () => {
    // The real failure this prevents: GitHub lists an asset the moment upload starts,
    // and downloading it yields a truncated installer.
    const res = pickInstaller([{ ...good, state: 'starter' }])
    expect('error' in res && res.error).toMatch(/still being uploaded/)
  })

  it('refuses a suspiciously small installer', () => {
    const res = pickInstaller([{ ...good, size: 12 }])
    expect('error' in res).toBe(true)
  })

  it('refuses a non-https download link', () => {
    const res = pickInstaller([{ ...good, browser_download_url: 'http://example.com/x.exe' }])
    expect('error' in res && res.error).toMatch(/looks wrong/)
  })

  it('handles a release with no assets at all', () => {
    expect('error' in pickInstaller([])).toBe(true)
    expect('error' in pickInstaller(null)).toBe(true)
    expect('error' in pickInstaller(undefined)).toBe(true)
    expect('error' in pickInstaller('nope')).toBe(true)
  })

  it('survives junk entries beside the real one', () => {
    const res = pickInstaller([null, 3, 'x', { name: null }, good])
    expect('asset' in res).toBe(true)
  })
})

describe('expectedSha256', () => {
  it('reads the hex out of a sha256 digest', () => {
    expect(expectedSha256('sha256:' + 'a'.repeat(64))).toBe('a'.repeat(64))
  })

  it('lowercases so comparison is not case-sensitive', () => {
    expect(expectedSha256('sha256:' + 'AB'.repeat(32))).toBe('ab'.repeat(32))
  })

  it('returns null for a digest that is not sha256', () => {
    // Must be null, NOT a pass: a future algorithm should mean "unverified", never
    // "verified".
    expect(expectedSha256('sha512:' + 'a'.repeat(128))).toBeNull()
  })

  it('returns null for a wrong-length or absent digest', () => {
    expect(expectedSha256('sha256:abc')).toBeNull()
    expect(expectedSha256(null)).toBeNull()
    expect(expectedSha256(undefined)).toBeNull()
    expect(expectedSha256(123)).toBeNull()
  })
})

describe('verifyDownload', () => {
  const sha = 'b'.repeat(64)

  it('passes when size and hash both match', () => {
    expect(verifyDownload({ size: 10, sha256: sha }, { size: 10, sha256: sha })).toEqual({ ok: true })
  })

  it('fails on a short download', () => {
    const r = verifyDownload({ size: 9, sha256: sha }, { size: 10, sha256: sha })
    expect(r.ok).toBe(false)
  })

  it('fails on a hash mismatch even when the size is right', () => {
    const r = verifyDownload({ size: 10, sha256: 'c'.repeat(64) }, { size: 10, sha256: sha })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.error).toMatch(/checksum/)
  })

  it('passes on size alone when GitHub gave no hash', () => {
    expect(verifyDownload({ size: 10, sha256: 'anything' }, { size: 10, sha256: null })).toEqual({ ok: true })
  })
})

describe('percent', () => {
  it('reports whole percents', () => {
    expect(percent(0, 200)).toBe(0)
    expect(percent(100, 200)).toBe(50)
    expect(percent(200, 200)).toBe(100)
  })

  it('never exceeds 100 when content-length under-reports', () => {
    expect(percent(300, 200)).toBe(100)
  })

  it('is 0 rather than NaN/Infinity when the size is unknown', () => {
    expect(percent(50, 0)).toBe(0)
    expect(percent(50, NaN)).toBe(0)
    expect(percent(50, -1)).toBe(0)
  })
})

describe('updateDir / freshUpdateDir', () => {
  it('always works inside its own subfolder, never the temp root', () => {
    // The app must never delete the user's work; keeping this one level down means the
    // clean below cannot reach anything it did not create.
    expect(updateDir('/tmp')).toBe(join('/tmp', 'nihilpointzero-update'))
  })

  it('empties an existing folder and leaves it usable', () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-up-'))
    const dir = freshUpdateDir(root)
    writeFileSync(join(dir, 'stale.exe'), 'old')
    const again = freshUpdateDir(root)
    expect(again).toBe(dir)
    expect(alreadyDownloaded(join(dir, 'stale.exe'), 3)).toBe(false)
  })
})

describe('alreadyDownloaded', () => {
  it('is true only for a file of exactly the expected size', () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-up-'))
    const f = join(root, 'setup.exe')
    writeFileSync(f, 'abcde')
    expect(alreadyDownloaded(f, 5)).toBe(true)
    expect(alreadyDownloaded(f, 6)).toBe(false)
    expect(alreadyDownloaded(join(root, 'missing.exe'), 5)).toBe(false)
  })
})

/** A Response whose body streams `chunks`, so the download path can be exercised
 * without a network. */
function streamResponse(chunks: Uint8Array[], total?: number): Response {
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const ch of chunks) c.enqueue(ch)
      c.close()
    }
  })
  const len = total ?? chunks.reduce((n, c) => n + c.length, 0)
  return new Response(body, { status: 200, headers: { 'content-length': String(len) } })
}

describe('downloadInstaller', () => {
  it('writes every byte and hashes what it wrote', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-dl-'))
    const dest = join(root, 'setup.exe')
    const chunks = [Buffer.from('hello '), Buffer.from('world')].map((b) => new Uint8Array(b))
    const res = await downloadInstaller('https://x/y.exe', dest, () => {}, async () => streamResponse(chunks))
    expect(readFileSync(dest, 'utf8')).toBe('hello world')
    expect(res.size).toBe(11)
    // sha256("hello world")
    expect(res.sha256).toBe('b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
  })

  it('reports progress only when the whole percent changes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-dl-'))
    const dest = join(root, 'setup.exe')
    // 200 one-byte chunks over a 200-byte total => 100 distinct percents (1..100),
    // not 200 messages.
    const chunks = Array.from({ length: 200 }, () => new Uint8Array([65]))
    const seen: number[] = []
    await downloadInstaller('https://x/y.exe', dest, (p) => seen.push(p), async () => streamResponse(chunks))
    expect(seen).toEqual([...new Set(seen)])
    expect(seen.at(-1)).toBe(100)
    expect(seen.length).toBeLessThanOrEqual(101)
  })

  it('throws a plain-English error on a failed request', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-dl-'))
    await expect(
      downloadInstaller('https://x/y.exe', join(root, 'a.exe'), () => {}, async () => new Response(null, { status: 404 }))
    ).rejects.toThrow(/404/)
  })

  it('produces a hash that catches a corrupted body', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-dl-'))
    const dest = join(root, 'setup.exe')
    const res = await downloadInstaller('https://x/y.exe', dest, () => {}, async () =>
      streamResponse([new Uint8Array(Buffer.from('hello worlD'))])
    )
    const verdict = verifyDownload(res, {
      size: 11,
      sha256: 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    })
    expect(verdict.ok).toBe(false)
  })
})

describe('runSelfUpdate — the stillSafeToQuit gate', () => {
  /** A deps bundle whose installer is "already downloaded", so the network is not needed. */
  function depsFor(root: string, extra: Partial<Parameters<typeof runSelfUpdate>[0]> = {}) {
    const dir = freshUpdateDir(root)
    const dest = join(dir, INSTALLER_ASSET)
    writeFileSync(dest, Buffer.alloc(2_000_000))
    const launched: string[] = []
    let quit = 0
    return {
      dest,
      launched,
      quits: () => quit,
      deps: {
        tempRoot: root,
        freeMB: () => 99_999,
        launch: (p: string) => launched.push(p),
        quit: () => {
          quit++
        },
        ...extra
      }
    }
  }

  /** The release the fake fetch below returns: matches the pre-placed 2 MB file. */
  const asset = { ...good, size: 2_000_000, digest: null }

  it('installs when nothing is in progress', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-gate-'))
    const t = depsFor(root, { stillSafeToQuit: () => true })
    vi.stubGlobal('fetch', async () => Response.json({ assets: [asset] }))
    try {
      const res = await runSelfUpdate(t.deps)
      expect(res.ok).toBe(true)
      expect(t.launched).toEqual([t.dest])
      expect(t.quits()).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does NOT quit when work started during the download', async () => {
    // The bug this exists for: the decision to update is made before a multi-minute
    // download, and by the time it finishes the user has begun a render. Quitting then
    // destroys work that did not exist when the choice was made.
    const root = mkdtempSync(join(tmpdir(), 'npz-gate-'))
    const t = depsFor(root, { stillSafeToQuit: () => false })
    vi.stubGlobal('fetch', async () => Response.json({ assets: [asset] }))
    try {
      const res = await runSelfUpdate(t.deps)
      expect(res.ok).toBe(false)
      expect(res.ok === false && res.deferred).toBe(true)
      expect(t.launched).toEqual([])
      expect(t.quits()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('keeps the downloaded installer when it defers, so the retry is instant', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-gate-'))
    const t = depsFor(root, { stillSafeToQuit: () => false })
    vi.stubGlobal('fetch', async () => Response.json({ assets: [asset] }))
    try {
      await runSelfUpdate(t.deps)
      expect(alreadyDownloaded(t.dest, 2_000_000)).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('installs with no gate supplied (the button path)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-gate-'))
    const t = depsFor(root)
    vi.stubGlobal('fetch', async () => Response.json({ assets: [asset] }))
    try {
      expect((await runSelfUpdate(t.deps)).ok).toBe(true)
      expect(t.quits()).toBe(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports the reason and never launches when the release has no installer', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-gate-'))
    const t = depsFor(root)
    vi.stubGlobal('fetch', async () => Response.json({ assets: [] }))
    try {
      const res = await runSelfUpdate(t.deps)
      expect(res.ok).toBe(false)
      expect(t.launched).toEqual([])
      expect(t.quits()).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('refuses on low disk rather than half-downloading', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-low-'))
    // No pre-placed file, so it must decide whether to download.
    freshUpdateDir(root)
    vi.stubGlobal('fetch', async () => Response.json({ assets: [asset] }))
    try {
      const res = await runSelfUpdate({
        tempRoot: root,
        freeMB: () => 50,
        launch: () => expect.unreachable('must not launch'),
        quit: () => expect.unreachable('must not quit')
      })
      expect(res.ok).toBe(false)
      expect(res.ok === false && res.error).toMatch(/not enough free space/)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('fetchLatestRelease', () => {
  it('returns the assets on success', async () => {
    const r = await fetchLatestRelease(async () => Response.json({ assets: [good], body: 'Build v0.1.1' }))
    expect(r.ok && Array.isArray(r.assets)).toBe(true)
  })

  it('turns an HTTP error into plain English rather than throwing', async () => {
    const r = await fetchLatestRelease(async () => new Response(null, { status: 503 }))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/503/)
  })

  it('turns being offline into plain English rather than throwing', async () => {
    const r = await fetchLatestRelease(async () => {
      throw new Error('getaddrinfo ENOTFOUND api.github.com')
    })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/internet/)
  })
})
