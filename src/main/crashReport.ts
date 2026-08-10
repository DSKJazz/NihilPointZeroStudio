/**
 * Catching the crashes that currently kill the app without a word.
 *
 * WHAT WAS ALREADY COVERED, AND WHAT WAS NOT
 * A tab that throws is already handled: ErrorBoundary catches it, the tab shows a message,
 * the rest of the studio keeps running, and the failure is written to the Known Issues log.
 * That is the renderer.
 *
 * An unhandled error in the MAIN process is a different thing entirely. There is no
 * boundary to catch it, Electron tears the process down, and the window vanishes — no
 * message, no log line, nothing to show anyone. From the outside the app "just closed".
 * That is the single worst failure mode in the whole application, because it is the only
 * one that leaves no evidence at all, and it is the one that had no handler.
 *
 * WHY IT WRITES TO THE SAME LOG
 * Known Issues is already the place the user has been told to look, and it is deliberately
 * append-only so nothing in the app can erase the evidence. A crash belongs there next to
 * everything else rather than in a second file nobody knows about.
 *
 * WHY IT DOES NOT TRY TO KEEP RUNNING
 * After an unhandled exception the process state is unknown. Carrying on risks writing
 * corrupted data over the user's work, and this app's first rule is that it never damages
 * that. So it records what happened, tells the window if there still is one, and lets the
 * process go. A crash that is logged is recoverable; a crash that silently corrupts a
 * project is not.
 */

import type { AiErrorEntry } from '../shared/types'

/** What a crash needs to be diagnosable a week later, and nothing more. */
export function describeCrash(kind: 'exception' | 'rejection', error: unknown): AiErrorEntry {
  const err = error instanceof Error ? error : undefined
  const message =
    err?.message ??
    (typeof error === 'string' ? error : error === undefined ? 'no error value' : safeStringify(error))
  return {
    at: new Date().toISOString(),
    provider: 'interface',
    feature: kind === 'exception' ? 'the app itself (crash)' : 'the app itself (unfinished background job)',
    // Prefixed so it is obvious in a list of AI failures that this one is different.
    message: `CRASH — ${message}`.slice(0, 500),
    body: [
      err?.stack,
      err?.name && err.name !== 'Error' ? `type: ${err.name}` : undefined,
      // The version and platform, because a crash report without them is a guess.
      `electron: ${process.versions.electron ?? 'unknown'}`,
      `node: ${process.versions.node ?? 'unknown'}`,
      `platform: ${process.platform} ${process.arch}`
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 8000)
  }
}

/** JSON that cannot throw on a circular object — a thrown non-Error is often one. */
function safeStringify(value: unknown): string {
  try {
    const seen = new WeakSet()
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v as object)) return '[circular]'
        seen.add(v as object)
      }
      return v
    }) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * True when this is worth recording at all.
 *
 * A cancelled render is not a crash — the user pressed Stop, and filling Known Issues with
 * their own cancellations would bury the real failures. Same for the EPIPE that arrives
 * when a child process is killed, which is the normal end of a cancelled ffmpeg.
 */
export function isWorthRecording(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/cancelled|canceled|stopped by you|EPIPE|ECONNRESET/i.test(message)) return false
  return true
}

export interface CrashHooks {
  record: (entry: AiErrorEntry) => void
  /** Tell the user, if a window is still alive to tell. */
  notify?: (message: string) => void
  /** Called after recording, so the caller decides whether to exit. */
  onFatal?: (entry: AiErrorEntry) => void
}

/**
 * Installs the handlers. Returns a function that removes them, for tests.
 *
 * An unhandled REJECTION is treated as non-fatal on purpose: a forgotten `await` on a
 * background job should be recorded and investigated, not used as a reason to close the
 * app while the user is working. An unhandled EXCEPTION is fatal, for the reason in the
 * file header.
 */
export function installCrashReporting(hooks: CrashHooks): () => void {
  const onException = (error: Error): void => {
    if (!isWorthRecording(error)) return
    const entry = describeCrash('exception', error)
    try {
      hooks.record(entry)
    } catch {
      /* if even recording fails there is nothing further to try */
    }
    try {
      hooks.notify?.(
        'Something went badly wrong and the studio has to close. It has been written to Settings → Known Issues, so nothing about it is lost. Your work is saved.'
      )
    } catch {
      /* the window may already be gone */
    }
    hooks.onFatal?.(entry)
  }

  const onRejection = (reason: unknown): void => {
    if (!isWorthRecording(reason)) return
    try {
      hooks.record(describeCrash('rejection', reason))
    } catch {
      /* nothing further to try */
    }
  }

  process.on('uncaughtException', onException)
  process.on('unhandledRejection', onRejection)
  return () => {
    process.off('uncaughtException', onException)
    process.off('unhandledRejection', onRejection)
  }
}
