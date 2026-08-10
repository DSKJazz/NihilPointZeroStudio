import { BrowserWindow } from 'electron'
import { IPC } from '../shared/ipc-channels'

/** What the renderer's warning banner needs to know about an AI downgrade. */
export interface AiFallbackNotice {
  /** The provider that failed ('anthropic' | 'openai' | 'ollama'). */
  provider: string
  /** The underlying error (e.g. the 401 body) — shown as small print. */
  detail: string
}

/**
 * Tell every open window that the chosen AI failed and the free AI answered.
 * Companion to the activity-log entry: the log is the durable record, this is
 * the in-your-face banner so a downgrade is never silent (a silent downgrade
 * just looks like "the AI got dumb" — see the 2026-07 invalid-key incident).
 */
export function broadcastAiFallback(notice: AiFallbackNotice): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC.aiFallback, notice)
    }
  }
}
