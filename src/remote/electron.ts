/**
 * A stand-in for Electron's `electron` module that works in an ordinary browser.
 *
 * WHY
 * The studio's UI never talks to the app directly. Every single thing it does goes
 * through one file — `src/preload/index.ts` — which builds `window.api` out of 157
 * `ipcRenderer.invoke` calls and 12 event subscriptions. That is the only door.
 *
 * So to run the REAL studio on a phone, nothing about the UI has to change and nothing
 * has to be re-implemented. The preload is bundled for the browser with `electron`
 * pointed at this file instead, and the same door now opens onto the network. The
 * phone shows the actual app; the PC does the actual work.
 *
 * This is why it is not a mirror or a cut-down copy: there is no second version of
 * anything. There is one UI, one set of handlers, and this 100-line adapter between.
 *
 * SECURITY
 * Every request carries the web server's token — the same secret that already protects
 * the phone page — and the whole thing only listens on the user's own network or their
 * private VPN. Nothing here weakens the desktop app: it is a client, and the PC decides
 * what it is allowed to ask for.
 */
import { decodeWire, encodeWire } from '../shared/wire'

/*
 * The signatures below deliberately mirror Electron's own, `any` and all. The preload
 * is written against the real types — `invoke` there resolves to whatever the caller
 * declares — so anything stricter here would make 157 correct lines fail to compile
 * for no benefit. tsconfig.remote.json points `electron` at this file precisely so
 * that mismatch would be caught; matching Electron is the fix, not narrowing.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Listener = (event: any, ...args: any[]) => void

/**
 * The token is put on the page by the PC when it serves the HTML. Falling back to the
 * query string covers the very first load, before the cookie is set.
 */
function readToken(): string {
  const injected = (globalThis as Record<string, unknown>).__NPZ_TOKEN__
  if (typeof injected === 'string' && injected) return injected
  try {
    return new URL(window.location.href).searchParams.get('t') ?? ''
  } catch {
    return ''
  }
}

const token = readToken()

/** Rejects with the PC's own message, so failures read the same as they do on the desktop. */
async function invoke(channel: string, ...args: any[]): Promise<any> {
  const res = await fetch('/api/invoke', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': token },
    body: JSON.stringify({ channel, args: encodeWire(args) })
  })
  let payload: { ok?: boolean; value?: unknown; error?: string }
  try {
    payload = (await res.json()) as typeof payload
  } catch {
    throw new Error(
      res.status === 401
        ? 'This link has expired. Open the current link from the app on your PC.'
        : `The PC could not be reached (${res.status}).`
    )
  }
  if (!res.ok || payload.ok === false) throw new Error(payload.error || `Request failed (${res.status}).`)
  return decodeWire(payload.value)
}

// ── Progress and streaming events ────────────────────────────────────────────────
// Twelve places in the app push updates while something long is running: script
// chapters, video render progress, the Producer's stream. On the desktop those arrive
// as IPC messages. Here one Server-Sent-Events connection carries all of them, opened
// lazily so a phone that never subscribes never holds a connection open.

const listeners = new Map<string, Set<Listener>>()
let stream: EventSource | null = null

function openStream(): void {
  if (stream) return
  try {
    // EventSource cannot set headers, so the token travels in the query string here —
    // the same secret already in the link the user tapped to get to this page.
    stream = new EventSource(`/api/events?t=${encodeURIComponent(token)}`)
  } catch {
    // No EventSource (very old browser): invoke still works, only live progress is
    // missing. The UI already copes with a job that reports nothing until it finishes.
    return
  }
  stream.onmessage = (ev: MessageEvent): void => {
    let msg: { channel?: string; args?: unknown }
    try {
      msg = JSON.parse(ev.data as string)
    } catch {
      return
    }
    if (!msg.channel) return
    const args = (decodeWire(msg.args) as unknown[]) ?? []
    // The first argument of an Electron event listener is the event object itself;
    // the preload's listeners all ignore it, but the shape must still match.
    for (const fn of listeners.get(msg.channel) ?? []) {
      try {
        fn({}, ...args)
      } catch {
        /* one broken listener must not stop the others */
      }
    }
  }
  // EventSource reconnects by itself; nothing to do here beyond not crashing.
  stream.onerror = (): void => {}
}

function on(channel: string, listener: Listener): void {
  const set = listeners.get(channel) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(channel, set)
  openStream()
}

function removeListener(channel: string, listener: Listener): void {
  listeners.get(channel)?.delete(listener)
}

export const ipcRenderer = { invoke, on, removeListener, off: removeListener, send: invoke }

export const contextBridge = {
  /** In Electron this crosses an isolation boundary; in a browser tab it is just a global. */
  exposeInMainWorld(key: string, value: unknown): void {
    ;(globalThis as Record<string, unknown>)[key] = value
  }
}
