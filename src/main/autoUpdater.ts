import { app } from 'electron'
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

    // Require at runtime so bundlers (Rollup/Vite) don't try to statically resolve
    // this native/platform-sensitive dependency during the build. If it fails at
    // runtime, log and bail out gracefully.
    let autoUpdater: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-require-imports
      autoUpdater = require('electron-updater').autoUpdater
    } catch (err) {
      try {
        logActivity('ai', 'Auto-updater not available at runtime', (err && (err as Error).message) || String(err))
      } catch (ignore) {
        void 0
      }
      return
    }

    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true

    autoUpdater.logger = undefined

    autoUpdater.on('error', (err: any) => {
      try {
        logActivity('ai', 'Auto-updater error', (err && (err as Error).message) || String(err))
      } catch (logErr) {
        void 0
      }
    })

    autoUpdater.on('update-available', (info: any) => {
      try {
        logActivity('ai', 'Auto-updater found a newer version', info?.version || JSON.stringify(info))
      } catch (e) {
        void 0
      }
    })

    autoUpdater.on('update-downloaded', (info: any) => {
      try {
        logActivity('ai', 'Auto-updater downloaded an update ready to install', info?.version || JSON.stringify(info))
      } catch (e) {
        void 0
      }
    })

    // Startup check + periodic checks
    const FOUR_HOURS_MS = 4 * 60 * 60 * 1000

    // Immediately check on init (non-blocking)
    void autoUpdater.checkForUpdates().catch((e: any) => {
      try {
        logActivity('ai', 'Auto-updater check failed on init', (e && (e as Error).message) || String(e))
      } catch (e2) {
        void 0
      }
    })

    setInterval(() => {
      void autoUpdater.checkForUpdates().catch((e: any) => {
        try {
          logActivity('ai', 'Auto-updater periodic check failed', (e && (e as Error).message) || String(e))
        } catch (e2) {
          void 0
        }
      })
    }, FOUR_HOURS_MS)
  } catch (err) {
    try {
      logActivity('ai', 'Failed to initialize auto-updater', (err && (err as Error).message) || String(err))
    } catch (e) {
      void 0
    }
  }
}
