import { app } from 'electron'
import { autoUpdater, UpdateInfo } from 'electron-updater'
import { logActivity } from './store'

/**
 * Initialize the electron-updater autoUpdater for packaged installs.
 * - Checks on startup and every FOUR_HOURS_MS.
 * - Downloads updates automatically and installs on quit.
 * - Logs important events via the existing activity logger so failures are visible.
 */
export function initializeElectronUpdater(): void {
  try {
    // Only enable for packaged apps on Windows (NSIS installed). Portable users get
    // the existing selfUpdate flow which intentionally leaves the final replace to the user.
    if (!app.isPackaged || process.platform !== 'win32') return

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.logger = undefined

    autoUpdater.on('error', (err) => {
      try {
        logActivity('ai', 'Auto-updater error', (err && (err as Error).message) || String(err))
      } catch {
        // never throw
      }
    })

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      try {
        logActivity('ai', 'Auto-updater found a newer version', info.version || JSON.stringify(info))
      } catch {}
    })

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      try {
        logActivity('ai', 'Auto-updater downloaded an update ready to install', info.version || JSON.stringify(info))
      } catch {}
    })

    // Startup check + periodic checks
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

    // Immediately check on init (non-blocking)
    void autoUpdater.checkForUpdates().catch((e) => {
      try {
        logActivity('ai', 'Auto-updater check failed on init', (e && (e as Error).message) || String(e))
      } catch {}
    })

    setInterval(() => {
      void autoUpdater.checkForUpdates().catch((e) => {
        try {
          logActivity('ai', 'Auto-updater periodic check failed', (e && (e as Error).message) || String(e))
        } catch {}
      })
    }, FOUR_HOURS_MS)
  } catch (err) {
    try {
      logActivity('ai', 'Failed to initialize auto-updater', (err && (err as Error).message) || String(err))
    } catch {}
  }
}
