import { app, BrowserWindow, shell } from 'electron'
import { checkForUpdate } from './updateCheck'
import { runAutoBackupIfDue } from './autoBackup'
import { runCaretakerPass, scheduleCaretaker } from './caretaker'
import { scanStranded } from './strandedData'
import { decideDataHome, holdsUserWork, isUsableDir, readPin, writePin } from './dataHome'
import {
  getLastBackupNudgeAt,
  getSecondBackupDir,
  getSettings,
  getStartWithWindows,
  listLibrary,
  listVideos,
  logActivity,
  setActiveProvider,
  setLastBackupNudgeAt
} from './store'
import { join } from 'path'
import { registerIpcHandlers, selfUpdateEnv, setCaretakerBusyCheck } from './ipc'
import { applyOpenAtLogin, shouldAutoInstall, shouldFocusOnSecondInstance, wasAutoStarted } from './autoStart'
import { runSelfUpdate } from './selfUpdate'
import { rescueMessage, rescueTarget } from './llm/rescueBrain'
import { nudgeMessage, shouldNudge } from './backupNudge'
import { isProviderDead } from './llm/deadProviders'
import { getOllamaStatus } from './llm/ollama'
import { broadcastAiFallback } from './notify'
import { getAvailableUpdate } from './updateCheck'
import { isRunning as isQueueRunning } from './renderQueueRunner'
import { isRenderSessionOpen } from './video/ffmpeg'
import { captureHandlers } from './remote/registry'
import { attachRemoteEvents } from './remote/events'
import { installCrashReporting } from './crashReport'
import { recoverQueueOnStartup } from './renderQueueRunner'
import { logAiError } from './llm/errorLog'
import { dialog } from 'electron'

// E2E harness (scripts/e2e-smoke.mjs, the ship gate): a fully ISOLATED data home so
// the click-through suite can NEVER touch real user data — it outranks every other
// rule below. It also silences the update check and auto-backup (network/disk noise
// a test run must not produce).
const e2eUserData = process.env.NPZ_E2E_USERDATA

/**
 * Is the app in the middle of doing something for the user?
 *
 * Consulted before any automatic self-update. Restarting the app under a running render
 * would destroy work in progress, and the one rule this app does not bend is that it does
 * not destroy the user's work — so a busy app is never auto-updated, however overdue.
 */
function isBusy(): boolean {
  try {
    return isQueueRunning() || isRenderSessionOpen()
  } catch {
    // Cannot tell => assume busy. The safe answer is the one that does nothing.
    return true
  }
}

// WHERE THE USER'S WORK LIVES. Decided ONCE and written down (see main/dataHome.ts) —
// the app no longer re-derives this on every launch, which is what used to move it to
// a different folder and make every earlier video vanish from the UI.
let dataHomeNotice: string | undefined
{
  const defaultDir = join(app.getPath('appData'), app.getName())
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const portableCandidate = portableDir ? join(portableDir, 'nihilpointzero-data') : undefined
  let desktopDir: string | undefined
  try {
    desktopDir = join(app.getPath('desktop'), 'NihilPointZeroStudio', 'nihilpointzero-data')
  } catch {
    /* no Desktop on this machine — the default folder still works */
  }
  const pinnedDir = e2eUserData || portableDir ? null : readPin(defaultDir)
  const choice = decideDataHome({
    e2eDir: e2eUserData,
    portableDir,
    portableCandidate,
    // Usable when writable OR already holding work (a read-only CD still must not
    // strand data that is already sitting there).
    portableUsable: portableCandidate
      ? isUsableDir(portableCandidate) || holdsUserWork(portableCandidate)
      : false,
    pinnedDir,
    pinnedUsable: pinnedDir ? isUsableDir(pinnedDir) : false,
    desktopDir,
    desktopHasData: desktopDir ? holdsUserWork(desktopDir) : false,
    defaultDir
  })
  if (choice.dir !== defaultDir) app.setPath('userData', choice.dir)
  if (choice.pin) writePin(defaultDir, choice.dir)
  dataHomeNotice = choice.notice
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'NIHILPOINTZERO-OS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Set explicitly (not left to Electron's defaults) so the security posture can't
      // silently change across framework upgrades. The renderer only ever loads our own
      // local files, and the preload uses ONLY contextBridge + ipcRenderer (both fully
      // sandbox-compatible), so the Chromium sandbox stays ON as defence in depth.
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Lets a phone running the studio see the same live progress the desktop sees.
  // Everything still reaches this window first and unchanged; see remote/events.ts.
  attachRemoteEvents(mainWindow.webContents)

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Prevent a second copy from launching against the same user-data dir (which
// otherwise produces cache-lock errors); focus the existing window instead.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    // Focus is right when a PERSON launches the app again. It is wrong when the Windows
    // sign-in entry fires while they are typing in something else — the studio window
    // would jump to the front for no reason they can see.
    if (!shouldFocusOnSecondInstance(argv)) return
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  // BEFORE anything else can throw. A tab crash is already caught by ErrorBoundary; an
  // unhandled error in THIS process had no handler at all — Electron tears the process
  // down and the window simply vanishes, leaving nothing to show anyone. That is the only
  // failure in the app that left no evidence.
  installCrashReporting({
    record: (entry) => logAiError(entry),
    notify: (message) => {
      // showErrorBox works with no window, which is the case that matters most — a crash
      // during startup, before there is anything to put a message inside.
      try {
        dialog.showErrorBox('NIHILPOINTZERO-OS has to close', message)
      } catch {
        /* nothing left to show it with */
      }
    },
    onFatal: () => {
      // The process state is unknown after this, and carrying on risks writing corrupted
      // data over the user's work. Recorded, told, and let go.
      app.exit(1)
    }
  })

  // Pick up anything the last session left half-rendered. Before the window exists, so an
  // interrupted item is already back in the queue by the time anything can look at it.
  try {
    const { recovered } = recoverQueueOnStartup()
    if (recovered) {
      logActivity('ai', `Put ${recovered} interrupted render${recovered === 1 ? '' : 's'} back in the queue`)
    }
  } catch {
    // A queue that cannot be read must never stop the app from starting.
  }

  app.whenReady().then(() => {
    // Registers exactly as before, and additionally remembers each handler so the same
    // function can be called from the phone. See remote/registry.ts for why it is
    // wrapped here rather than edited into all 157 registrations.
    captureHandlers(registerIpcHandlers)
    createWindow()

    // Register (or un-register) the Windows sign-in entry on every launch, so the saved
    // preference and what Windows actually believes cannot drift apart — a reinstall or a
    // moved exe would otherwise leave a startup entry pointing at nothing.
    if (!e2eUserData) {
      try {
        applyOpenAtLogin(getStartWithWindows(), app)
      } catch {
        // A startup entry that cannot be written is a nuisance, not a reason to fail
        // the launch.
      }
    }

    /**
     * RESCUE A DEAD BRAIN. The hosted free service began demanding payment (HTTP 402) and
     * every install pointed at it — the shipped default — was left refusing every request,
     * 50 failures deep, with no sign that the thing it was configured to use had stopped
     * existing. Changing the default only helps NEW installs; an existing one keeps its
     * saved setting forever. So the switch happens here, on the machine, without the user
     * visiting a screen he has said he will never open.
     *
     * Only ever towards a free, local brain — never a paid one, and never silently.
     */
    if (!e2eUserData) {
      setTimeout(() => {
        void (async () => {
          try {
            const active = getSettings().activeProvider
            if (!isProviderDead(active)) return
            const target = rescueTarget({
              activeProvider: active,
              activeIsPermanentlyDead: true,
              ollamaAvailable: (await getOllamaStatus()).connected,
              // Only relevant as a target when it is not the thing that just died.
              freeAvailable: active !== 'free'
            })
            if (!target) return
            setActiveProvider(target)
            const message = rescueMessage(active, target)
            logActivity('ai', 'Switched your AI brain automatically', message)
            broadcastAiFallback({ provider: active, detail: message })
          } catch {
            // A rescue that cannot run must never take the app down with it.
          }
        })()
      }, 12_000)
    }

    // Quiet, delayed check for a newer shipped build (silent when offline/failing),
    // and the weekly copy-only backup — both skipped under the E2E harness, which
    // must not touch the network or write anything outside its isolated data home.
    if (!e2eUserData) {
      setTimeout(() => {
        void (async () => {
          await checkForUpdate()
          // WINDOWS OPENED US, SO NOBODY IS WAITING: this is the one moment when the app
          // can spend three minutes replacing itself without costing anyone anything, and
          // it is what makes "turn the laptop on and it is already current" true. When the
          // USER opened it they want to work, so they get the notice and the choice
          // instead. See autoStart.ts for the full reasoning.
          if (
            shouldAutoInstall({
              autoStarted: wasAutoStarted(process.argv),
              updateAvailable: !!getAvailableUpdate(),
              workInProgress: isBusy(),
              underTest: !!e2eUserData
            })
          ) {
            // stillSafeToQuit, not just the check above: the download takes minutes, and
            // the user may have sat down and started a render in the meantime. If so the
            // verified installer simply stays on disk and the banner's button becomes
            // instant, because there is nothing left to fetch.
            const res = await runSelfUpdate({ ...selfUpdateEnv(), stillSafeToQuit: () => !isBusy() })
            if (!res.ok) {
              // Silent to the user but never silent in the log: an auto-update that has
              // been quietly failing for weeks is how a laptop ends up three builds
              // behind while everything else is current.
              try {
                logActivity(
                  'ai',
                  res.deferred ? 'The update is downloaded and waiting' : 'The automatic update at sign-in did not run',
                  res.error
                )
              } catch {
                /* logging must never block startup */
              }
            }
          }
        })()
      }, 8000)

      /**
       * ONE DISK IS NOT A BACKUP. His work exists in one place and his own restore log
       * already reads "8 missing file(s) brought back". Settings has said "not set -
       * recommended" for weeks, unread, because he does not open Settings. So it comes to
       * him instead — see backupNudge.ts for why fortnightly and why not on an empty
       * studio.
       */
      setTimeout(() => {
        try {
          const nowIso = new Date().toISOString()
          const workItems = listVideos().length + listLibrary().length
          if (!shouldNudge({
            hasSecondHome: !!getSecondBackupDir(),
            workItems,
            lastNudgedAt: getLastBackupNudgeAt(),
            nowIso
          })) return
          setLastBackupNudgeAt(nowIso)
          logActivity('ai', 'Your work is only on this laptop', nudgeMessage(workItems))
        } catch {
          // A reminder that cannot be worked out is never worth failing a launch for.
        }
      }, 45_000)

      // Weekly copy-only backup of the user's work (at most once every 7 days).
      // Delayed well past first paint so it never competes with app startup.
      setTimeout(() => {
        void runAutoBackupIfDue()
      }, 30_000)

      // The recorded work folder could not be reached this launch (drive unplugged,
      // folder renamed). Never let that pass silently — it looks exactly like "all my
      // work is gone" from the user's side.
      if (dataHomeNotice) {
        try {
          logActivity('ai', 'Your usual work folder could not be reached', dataHomeNotice)
        } catch {
          /* logging must never block startup */
        }
      }

      // Work stranded in a data folder the app is NOT using is invisible in the UI —
      // that really happened (1.15 GB of finished videos). Say so in the Activity Log
      // so it is discoverable without opening Settings. Quiet when there is nothing.
      setTimeout(() => {
        void (async () => {
        try {
          const s = await scanStranded()
          if (s.videoCount > 0) {
            logActivity(
              'ai',
              `Found ${s.videoCount} finished video(s) (${s.size}) that Video Studio isn't showing`,
              `They are NOT lost. Open Settings → "Where your work is kept" and press "Show these in Video Studio".` +
                `${s.inPlace ? ` ${s.inPlace} are already in your work folder (the list just lost track of them).` : ''}` +
                `${s.dir ? ` ${s.elsewhere} are in a folder the app no longer uses: ${s.dir}` : ''}`
            )
          }
        } catch {
          /* a failed look must never bother the user */
        }
        })()
      }, 45_000)

      // THE CARETAKER replaced the old weekly quiet health check: same live checks,
      // plus the dead-brain rescue and the lost-videos scan, on a schedule the user can
      // see and change (Settings → Caretaker), with every pass recorded. First pass 90s
      // after start so launch stays instant; then every N hours (default 6) while open.
      setCaretakerBusyCheck(isBusy)
      setTimeout(() => {
        void runCaretakerPass('start', isBusy).catch(() => {
          /* a failed self-check must never bother the user */
        })
      }, 90_000)
      scheduleCaretaker(isBusy)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
