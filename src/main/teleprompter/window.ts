/**
 * The teleprompter's own window.
 *
 * It is a SEPARATE always-on-top window rather than a tab, for one reason: when you
 * are screen-recording, the prompter must not end up in the recording. Two defences,
 * and they stack:
 *
 *  1. Being its own window means a capture of a different window/screen simply does
 *     not contain it.
 *  2. `setContentProtection(true)` asks the OS to exclude the window from screen
 *     capture entirely — on Windows and macOS it comes out blank/absent even if you
 *     capture the very display it is sitting on. This is the same mechanism banking
 *     apps use. It is best-effort: on Linux, and on some older Windows capture paths,
 *     the OS may ignore it, so the UI never PROMISES invisibility — it says what it
 *     asked for and tells the user to check their preview.
 *
 * Closing the studio closes this too; it can never be orphaned on screen.
 */
import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'

let win: BrowserWindow | null = null
/** Remembered so a re-open keeps the user's last choice. */
let contentProtected = true

export interface TeleprompterWindowState {
  open: boolean
  /** Whether the window has asked the OS to hide it from screen capture. */
  hiddenFromCapture: boolean
}

export function teleprompterState(): TeleprompterWindowState {
  return { open: !!win && !win.isDestroyed(), hiddenFromCapture: contentProtected }
}

/**
 * Applies (or lifts) capture protection. Wrapped because the call is a no-op on some
 * platforms and must never take the window down with it.
 */
function applyProtection(target: BrowserWindow, on: boolean): void {
  try {
    target.setContentProtection(on)
  } catch {
    /* platform doesn't support it — the separate-window defence still applies */
  }
}

export function openTeleprompter(opts?: { hiddenFromCapture?: boolean }): TeleprompterWindowState {
  if (opts?.hiddenFromCapture !== undefined) contentProtected = opts.hiddenFromCapture

  if (win && !win.isDestroyed()) {
    applyProtection(win, contentProtected)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return teleprompterState()
  }

  win = new BrowserWindow({
    width: 900,
    height: 560,
    minWidth: 380,
    minHeight: 240,
    show: false,
    title: 'NIHILPOINTZERO — Teleprompter',
    backgroundColor: '#000000',
    // Sits over whatever you are recording or presenting from.
    alwaysOnTop: true,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  // 'screen-saver' keeps it above full-screen apps too, which a plain alwaysOnTop
  // does not on Windows.
  try {
    win.setAlwaysOnTop(true, 'screen-saver')
  } catch {
    /* best effort */
  }
  applyProtection(win, contentProtected)

  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => {
    win = null
  })
  // External links must never navigate this window away from the prompter.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Same renderer bundle, routed straight to the prompter. Mirrors how the main
  // window is loaded in main/index.ts.
  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/teleprompter`)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/teleprompter' })
  }

  return teleprompterState()
}

export function closeTeleprompter(): TeleprompterWindowState {
  if (win && !win.isDestroyed()) win.close()
  win = null
  return teleprompterState()
}

export function setTeleprompterProtection(on: boolean): TeleprompterWindowState {
  contentProtected = on
  if (win && !win.isDestroyed()) applyProtection(win, on)
  return teleprompterState()
}
