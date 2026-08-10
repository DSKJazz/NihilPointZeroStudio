/**
 * Forwards the app's progress messages to a phone that is driving the studio.
 *
 * THE PROBLEM
 * Twelve things in the app report progress while they run — script chapters, video
 * rendering, voice downloads, the Producer's reply as it streams. They all do it the
 * same way: `mainWindow.webContents.send(channel, …)`. That call goes to the desktop
 * window and stops there. A phone running the same UI would sit on "working…" until
 * the job finished, which for a 20-minute render looks exactly like a hang.
 *
 * THE FIX
 * Wrap that one method once. Everything it sends still goes to the desktop window
 * exactly as before — the original is called first, unconditionally — and a copy is
 * handed to any phone currently listening. No handler is touched, and with no phone
 * connected the extra work is one empty loop.
 */
import type { WebContents } from 'electron'

type Sink = (channel: string, args: unknown[]) => void

const sinks = new Set<Sink>()

/** Marks a webContents as already wrapped, so a second call is a no-op. */
const PATCHED = Symbol.for('npz.remoteEventsAttached')

export function attachRemoteEvents(contents: WebContents): void {
  const target = contents as unknown as Record<PropertyKey, unknown>
  if (target[PATCHED]) return
  target[PATCHED] = true
  const original = contents.send.bind(contents)
  target.send = (channel: string, ...args: unknown[]): void => {
    // The desktop window comes first and is never affected by anything below.
    original(channel, ...args)
    for (const sink of sinks) {
      try {
        sink(channel, args)
      } catch {
        // A phone that dropped off mid-render must not break the render.
      }
    }
  }
}

/** Returns an unsubscribe function; callers must call it when the phone disconnects. */
export function subscribeRemoteEvents(sink: Sink): () => void {
  sinks.add(sink)
  return () => {
    sinks.delete(sink)
  }
}

/** How many phones are currently watching — shown in the app so it is never a mystery. */
export function remoteListenerCount(): number {
  return sinks.size
}

/** Only used by tests, so one test's subscriptions cannot leak into the next. */
export function _resetForTests(): void {
  sinks.clear()
}
