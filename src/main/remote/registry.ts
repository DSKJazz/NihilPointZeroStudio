/**
 * Lets the studio be driven from the phone as if it were the desktop UI.
 *
 * THE IDEA
 * The desktop renderer never talks to the app directly — it goes through exactly one
 * bridge, `window.api`, which forwards everything to a named IPC channel. So if that
 * bridge is re-pointed at the network, the SAME renderer, unchanged, runs in a phone
 * browser and the PC does all the work. Not a mirror, not a cut-down copy: the real
 * app, driven remotely.
 *
 * This module is the PC half. It records every handler as it is registered, so a
 * request arriving over the private link can call the very same function the desktop
 * UI would have called.
 *
 * WHY A WRAPPER RATHER THAN 157 EDITS
 * `ipcMain` gives no way to read back a registered handler, and `registerIpcHandlers`
 * registers 157 of them. Wrapping `ipcMain.handle` for the duration of that one call
 * captures them all without touching a single handler, and the patch is removed again
 * immediately — nothing global stays modified.
 *
 * SECURITY
 * This surface is as powerful as the desktop UI itself, so it is only ever reachable
 * behind the web server's existing token, over the user's own LAN or private VPN.
 * `DENIED_CHANNELS` additionally blocks the few channels that would be dangerous to
 * expose even then. Deletion still behaves exactly as it does on the desktop: the UI
 * confirms first, and nothing here bypasses that.
 */
import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'

type Handler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown

const handlers = new Map<string, Handler>()

/**
 * Channels never exposed to a remote caller.
 *
 * These are not "dangerous" in the desktop app — they are fine there, because the
 * person clicking is sitting at the machine. Remotely they either make no sense or
 * hand too much away, so they are refused rather than quietly half-working.
 */
const DENIED_CHANNELS = new Set<string>([
  // Opens an OS file dialog ON THE PC. From a phone that is an invisible modal the
  // user cannot see or dismiss — it would look like the app had frozen.
  'storyboard:pick-photo',
  'presenter:pick-video',
  'timeline:pick-clips',
  'project:import-pick',
  'data:import-file',
  'chart:price-file',
  'export:text',
  'thumbnail:save',
  'psx:live-excel',
  // Runs the Windows installer and quits the app. From the phone that would kill the
  // very connection the phone is using, with no way to start the PC app again remotely.
  'update:install'
])

export function isRemoteAllowed(channel: string): boolean {
  return handlers.has(channel) && !DENIED_CHANNELS.has(channel)
}

export function remoteChannels(): string[] {
  return [...handlers.keys()].filter((c) => !DENIED_CHANNELS.has(c)).sort()
}

/**
 * Runs `register` with `ipcMain.handle` temporarily wrapped, so every channel it
 * registers is remembered here as well as registered normally.
 */
export function captureHandlers(register: () => void): void {
  // Note `original` is the property value itself, NOT a bound copy: restoring a bound
  // copy would leave `ipcMain.handle` a different function from the one that was there
  // before, and calling this twice would stack a wrapper each time.
  const original = ipcMain.handle
  const patched = (channel: string, listener: Handler): void => {
    handlers.set(channel, listener)
    original.call(ipcMain, channel, listener as Parameters<typeof original>[1])
  }
  ;(ipcMain as unknown as { handle: unknown }).handle = patched
  try {
    register()
  } finally {
    // Always restore, even if registration throws — a permanently patched ipcMain
    // would be a nasty thing to leave behind.
    ;(ipcMain as unknown as { handle: unknown }).handle = original
  }
}

export class RemoteInvokeError extends Error {}

/**
 * Calls a handler on behalf of a remote caller.
 *
 * Handlers expect an IpcMainInvokeEvent and several use `event.sender` — to stream
 * progress, or to parent a dialog. They are given the real main window's webContents,
 * so a remote call behaves exactly like a local one: progress still reaches the
 * desktop UI (and from there the phone, via the event stream), and nothing has to
 * special-case being driven remotely.
 */
export async function invokeRemote(channel: string, args: unknown[]): Promise<unknown> {
  if (!handlers.has(channel)) throw new RemoteInvokeError(`Unknown channel: ${channel}`)
  if (DENIED_CHANNELS.has(channel)) {
    throw new RemoteInvokeError(
      `"${channel}" needs a window on the PC itself, so it cannot be used from the phone. Do that step on the computer.`
    )
  }
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) throw new RemoteInvokeError('The studio window is not open on the PC.')

  const event = { sender: win.webContents, frameId: 0, processId: 0 } as unknown as IpcMainInvokeEvent
  return handlers.get(channel)!(event, ...args)
}

/** Only used by tests, so one test's registrations cannot leak into the next. */
export function _resetForTests(): void {
  handlers.clear()
}
