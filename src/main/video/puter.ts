/**
 * FREE-CLOUD real-video engine: Google Veo (and friends) through Puter.js.
 *
 * Why Puter: it is the only route to real text-to-video generation today that needs
 * NO developer API key — verified live 2026-07-30. (Pollinations' video models all
 * cost paid "Pollen" credits and anonymous calls return HTTP 401; the old free
 * pure-cloud video APIs are gone.) Puter's catch, stated honestly everywhere in the
 * UI: the USER signs into a free Puter account once (a sign-in window pops up on the
 * first build), and generation draws on that account's small free monthly allowance.
 * When the allowance runs out or the service is down, every failure falls back to
 * the photo slideshow per scene — the build never breaks.
 *
 * Integration shape: puter.js is a browser SDK, so it runs in a hidden BrowserWindow
 * ("harness") owned by the main process. We drive it with executeJavaScript and get
 * the finished clip back as base64. The harness uses a persistent session partition
 * so the Puter sign-in survives app restarts. The pure, unit-tested pieces (the
 * injected script + error classifier) live in ./puterScript.ts.
 */
import { app, BrowserWindow } from 'electron'
import { writeFileSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { getAiVideoConfig } from '../store'
import { buildHarnessScript, clampSceneCap, classifyPuterError, DEFAULT_PUTER_MODEL } from './puterScript'

const PUTER_SDK_URL = 'https://js.puter.com/v2/'
/** Per-clip generation ceiling. Veo clips legitimately take minutes. */
const CLIP_TIMEOUT_MS = 10 * 60_000

export function puterModel(): string {
  return getAiVideoConfig().freeCloudModel?.trim() || DEFAULT_PUTER_MODEL
}

/** How many scenes get real motion per build (the rest use AI stills). */
export function puterSceneCap(): number {
  return clampSceneCap(getAiVideoConfig().freeCloudSceneCap)
}

/**
 * True when the Puter SDK is reachable right now. This is a network reachability
 * check only — whether the user is signed in / has allowance left is only knowable
 * at generation time, and those failures fall back per scene.
 */
export async function detectPuter(): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(PUTER_SDK_URL, { method: 'GET', signal: AbortSignal.timeout(6_000) })
    if (res.ok) return { ok: true, detail: 'Service reachable — free Puter sign-in happens on the first build.' }
    return { ok: false, detail: `Puter answered HTTP ${res.status} — builds will fall back to the slideshow.` }
  } catch {
    return { ok: false, detail: 'Puter is unreachable (offline?) — builds will fall back to the slideshow.' }
  }
}

/** Minimal page that loads the SDK. Everything else is driven via executeJavaScript. */
const HARNESS_HTML =
  'data:text/html;charset=utf-8,' +
  encodeURIComponent(
    `<!doctype html><html><head><meta charset="utf-8"><title>NIHILPOINTZERO free video</title>` +
      `<script src="${PUTER_SDK_URL}"></script></head><body></body></html>`
  )

let harness: BrowserWindow | null = null
let harnessPromise: Promise<BrowserWindow> | null = null
/** The harness plus any sign-in popups it opened — the windows that must never keep
 * the app alive on their own (see the browser-window-closed watcher below). */
const puterWindows = new Set<BrowserWindow>()
let lifecycleHooked = false

/** True for URLs the sign-in popup is allowed to open (Puter's own pages only). */
export function isAllowedPuterPopup(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'puter.com' || u.hostname.endsWith('.puter.com'))
  } catch {
    return false
  }
}

const watched = new WeakSet<BrowserWindow>()

/** When the last REAL (non-Puter) window closes, tear the harness down. */
function watchWindow(w: BrowserWindow): void {
  if (watched.has(w)) return
  watched.add(w)
  w.on('closed', () => {
    puterWindows.delete(w)
    const others = BrowserWindow.getAllWindows().filter((x) => !x.isDestroyed() && x !== w && !puterWindows.has(x))
    if (!others.length) closePuterHarness()
  })
}

function hookLifecycle(): void {
  if (lifecycleHooked) return
  lifecycleHooked = true
  app.on('before-quit', () => closePuterHarness())
  // The hidden harness must never turn the app into a zombie: main/index.ts quits on
  // 'window-all-closed', which cannot fire while the harness exists. Watch every
  // window (current and future) so closing the last real one releases the harness
  // and lets the normal quit path proceed.
  app.on('browser-window-created', (_e, w) => watchWindow(w))
  for (const w of BrowserWindow.getAllWindows()) watchWindow(w)
}

async function createHarness(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 480,
    height: 640,
    webPreferences: {
      // The Puter session should persist; note the harness page itself is a data: URL
      // (opaque origin), so the SDK may still ask the user to sign in again after an
      // app restart — the UI copy says so honestly.
      partition: 'persist:puter',
      nodeIntegration: false,
      contextIsolation: true
    }
  })
  puterWindows.add(win)
  // The SDK opens its sign-in as a popup — allow Puter's own pages ONLY, and surface
  // the window so the user can act. Anything else a (compromised) remote script might
  // try to open is denied.
  win.webContents.setWindowOpenHandler(({ url }) => (isAllowedPuterPopup(url) ? { action: 'allow' } : { action: 'deny' }))
  win.webContents.on('did-create-window', (child) => {
    puterWindows.add(child)
    child.show()
    child.focus()
  })
  await win.loadURL(HARNESS_HTML)
  // Give the remote SDK a moment to evaluate; generation calls re-check it anyway.
  await new Promise((r) => setTimeout(r, 500))
  return win
}

async function getHarness(): Promise<BrowserWindow> {
  hookLifecycle()
  if (harness && !harness.isDestroyed()) return harness
  // Single-flight: two concurrent builds must share one harness, not leak a second.
  if (!harnessPromise) {
    harnessPromise = createHarness()
      .then((win) => {
        harness = win
        return win
      })
      .finally(() => {
        harnessPromise = null
      })
  }
  return harnessPromise
}

/** Closes the harness (used on Stop so an in-flight generation doesn't linger). */
export function closePuterHarness(): void {
  for (const w of puterWindows) {
    if (!w.isDestroyed()) w.destroy()
  }
  puterWindows.clear()
  harness = null
}

/**
 * Generates ONE real motion clip for a scene prompt and returns a local MP4 path.
 * Throws with a classified plain-English reason on any failure — the caller decides
 * the fallback (per-scene slideshow still).
 */
export async function generatePuterClip(opts: {
  prompt: string
  signal?: AbortSignal
  onStatus?: (s: string) => void
}): Promise<string> {
  if (opts.signal?.aborted) throw new Error('stopped')
  const win = await getHarness()
  opts.onStatus?.('Asking the free cloud for real video… (a Puter sign-in window may appear the first time)')

  const run = win.webContents.executeJavaScript(buildHarnessScript(opts.prompt, puterModel()), true) as Promise<{
    ok: boolean
    b64?: string
    error?: string
  }>
  const result = await new Promise<{ ok: boolean; b64?: string; error?: string }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), CLIP_TIMEOUT_MS)
    const onAbort = (): void => {
      clearTimeout(timer)
      closePuterHarness() // kills the in-flight generation with the window
      reject(new Error('stopped'))
    }
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    run.then(
      (v) => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        resolve(v)
      },
      (e) => {
        clearTimeout(timer)
        opts.signal?.removeEventListener('abort', onAbort)
        reject(e instanceof Error ? e : new Error(String(e)))
      }
    )
  })

  if (!result.ok || !result.b64) throw new Error(classifyPuterError(result.error || 'empty response'))
  const out = join(mkdtempSync(join(tmpdir(), 'ai-puter-')), 'clip.mp4')
  writeFileSync(out, Buffer.from(result.b64, 'base64'))
  return out
}
