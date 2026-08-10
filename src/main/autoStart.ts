/**
 * Turn the laptop on, and the studio is open and already current.
 *
 * THE TWO PROBLEMS THIS SOLVES, WHICH ARE REALLY ONE
 *
 * 1. "I should not have to open it." Nothing can launch an app that is not running —
 *    but Windows can, at sign-in. That is what `openAtLogin` is: the app is registered
 *    with Windows so it starts with the desktop.
 *
 * 2. "It was closed while you upgraded it, so how does it become new?" It cannot, while
 *    it is closed — no code of ours is running. What it CAN do is be new by the time the
 *    user looks at it, and (1) is what makes that possible: the app is opened by Windows,
 *    at a moment when nobody is waiting for it and no work is in progress. That is the
 *    one safe moment to spend three minutes downloading and installing an update.
 *
 * So the rule is: **when Windows started us, update silently and completely. When the
 * user started us, they want to work — show the notice and let them choose.**
 *
 * WHY NOT A BACKGROUND SERVICE OR AN HOURLY SCHEDULED TASK
 * Both were considered and rejected. A resident updater is a second thing to install,
 * keep signed, and debug when it silently stops. An hourly task is worse than it sounds:
 * this installer relaunches the app when it finishes, so an hourly task means the studio
 * window appearing on its own at some random moment in the afternoon. Tying it to sign-in
 * makes that relaunch exactly the behaviour the user asked for instead of a surprise.
 *
 * The argv flag below is how the app knows which of the two it is. Everything here is
 * pure except `applyOpenAtLogin`, which is the single call into Electron.
 */

/** Passed by the Windows sign-in entry so the app can tell "Windows opened me" from
 * "the user opened me". Anyone can type it on a command line, and that is fine — the
 * worst it does is make the app update itself. */
export const AUTO_START_FLAG = '--auto-started'

/** True when this launch came from the Windows sign-in entry rather than a person. */
export function wasAutoStarted(argv: readonly string[]): boolean {
  return Array.isArray(argv) && argv.includes(AUTO_START_FLAG)
}

/**
 * The exact settings handed to Electron's login-item API.
 *
 * `openAsHidden` is deliberately false: the user's words were "the moment I turn my
 * laptop on, studio automatically opens". A hidden start would be the opposite of that.
 *
 * The flag is passed as an argument rather than baked into a shortcut so the app can
 * always tell the two kinds of launch apart, however it was started.
 */
export function loginItemConfig(enabled: boolean): {
  openAtLogin: boolean
  openAsHidden: boolean
  args: string[]
} {
  return { openAtLogin: enabled, openAsHidden: false, args: [AUTO_START_FLAG] }
}

export interface AutoUpdateInputs {
  /** Windows started us at sign-in (not the user). */
  autoStarted: boolean
  /** The startup check found a newer published build. */
  updateAvailable: boolean
  /** The user has already begun something — a render, a queue run, a recording. */
  workInProgress: boolean
  /** The E2E harness is driving the app; it must never touch the network. */
  underTest: boolean
}

/**
 * Should this launch install the update by itself, with no button?
 *
 * Every condition here is a way of asking the same question: *is anyone waiting on this
 * app right now?* If the user opened it, they are — a forced 210 MB download before they
 * can type is worse than a button. If Windows opened it and nothing has started yet,
 * nobody is, and the update can happen while they are still getting their coffee.
 */
export function shouldAutoInstall(i: AutoUpdateInputs): boolean {
  if (i.underTest) return false
  if (!i.updateAvailable) return false
  if (!i.autoStarted) return false
  // Belt and braces: an auto-started app should have nothing running, but if anything
  // somehow is, quitting under it would destroy work — which this app never does.
  if (i.workInProgress) return false
  return true
}

/**
 * A second copy launched by Windows must not disturb the copy the user is working in.
 *
 * Electron's `second-instance` handler normally restores and focuses the window, which is
 * right when a person double-clicks the icon again — and quite wrong when the sign-in
 * entry fires while the user is mid-sentence in another app. The existing window would
 * jump to the front for no reason they can see.
 */
export function shouldFocusOnSecondInstance(argv: readonly string[]): boolean {
  return !wasAutoStarted(argv)
}

/**
 * Applies the sign-in setting through Electron.
 *
 * Windows only. On other platforms this is a no-op rather than an error: the app is
 * built for Windows, but `npm run dev` on another OS must not fall over here.
 *
 * Never throws. Failing to register a startup entry is a nuisance; crashing the app on
 * launch because of one is not acceptable.
 */
export function applyOpenAtLogin(
  enabled: boolean,
  api: { setLoginItemSettings: (s: ReturnType<typeof loginItemConfig>) => void },
  platform: string = process.platform
): boolean {
  if (platform !== 'win32') return false
  try {
    api.setLoginItemSettings(loginItemConfig(enabled))
    return true
  } catch {
    return false
  }
}
