import { describe, expect, it, vi } from 'vitest'
import {
  applyOpenAtLogin,
  AUTO_START_FLAG,
  loginItemConfig,
  shouldAutoInstall,
  shouldFocusOnSecondInstance,
  wasAutoStarted
} from './autoStart'

describe('wasAutoStarted', () => {
  it('recognises the sign-in launch', () => {
    expect(wasAutoStarted(['C:/app.exe', AUTO_START_FLAG])).toBe(true)
  })

  it('is false for a normal double-click', () => {
    expect(wasAutoStarted(['C:/app.exe'])).toBe(false)
  })

  it('is not fooled by a lookalike argument', () => {
    // Substring matching here would make "--auto-started-later" or a file path
    // containing the word turn a user launch into a silent self-update.
    expect(wasAutoStarted(['C:/app.exe', '--auto-started-later'])).toBe(false)
    expect(wasAutoStarted(['C:/my--auto-started/file.mp4'])).toBe(false)
  })

  it('survives junk argv', () => {
    expect(wasAutoStarted([])).toBe(false)
    expect(wasAutoStarted(undefined as unknown as string[])).toBe(false)
  })
})

describe('loginItemConfig', () => {
  it('starts visibly, because that is what was asked for', () => {
    // "The moment I turn my laptop on, studio automatically opens." A hidden start
    // would be the exact opposite.
    expect(loginItemConfig(true).openAsHidden).toBe(false)
  })

  it('always carries the flag, so the app can tell who started it', () => {
    expect(loginItemConfig(true).args).toContain(AUTO_START_FLAG)
    expect(loginItemConfig(false).args).toContain(AUTO_START_FLAG)
  })

  it('passes the on/off through', () => {
    expect(loginItemConfig(true).openAtLogin).toBe(true)
    expect(loginItemConfig(false).openAtLogin).toBe(false)
  })
})

describe('shouldAutoInstall', () => {
  const base = { autoStarted: true, updateAvailable: true, workInProgress: false, underTest: false }

  it('updates silently when Windows started it and nothing is running', () => {
    expect(shouldAutoInstall(base)).toBe(true)
  })

  it('does NOT hijack a launch the user made themselves', () => {
    // They opened it to work. Making them wait through a 210 MB download first is
    // worse than the button.
    expect(shouldAutoInstall({ ...base, autoStarted: false })).toBe(false)
  })

  it('never quits out from under work in progress', () => {
    // The app does not destroy the user's work. An update that kills a running render
    // would do exactly that.
    expect(shouldAutoInstall({ ...base, workInProgress: true })).toBe(false)
  })

  it('does nothing when there is no update', () => {
    expect(shouldAutoInstall({ ...base, updateAvailable: false })).toBe(false)
  })

  it('is disabled under the E2E harness', () => {
    // The harness must never touch the network or replace the binary it is testing.
    expect(shouldAutoInstall({ ...base, underTest: true })).toBe(false)
  })

  it('every blocker wins on its own, in any combination', () => {
    for (const key of ['autoStarted', 'updateAvailable'] as const) {
      expect(shouldAutoInstall({ ...base, [key]: false })).toBe(false)
    }
    for (const key of ['workInProgress', 'underTest'] as const) {
      expect(shouldAutoInstall({ ...base, [key]: true })).toBe(false)
    }
  })
})

describe('shouldFocusOnSecondInstance', () => {
  it('focuses when a person launches the app again', () => {
    expect(shouldFocusOnSecondInstance(['C:/app.exe'])).toBe(true)
  })

  it('stays out of the way when the sign-in entry fires', () => {
    // Otherwise the studio window jumps to the front while the user is typing in
    // something else, for no reason they can see.
    expect(shouldFocusOnSecondInstance(['C:/app.exe', AUTO_START_FLAG])).toBe(false)
  })
})

describe('applyOpenAtLogin', () => {
  it('registers with Windows', () => {
    const setLoginItemSettings = vi.fn()
    expect(applyOpenAtLogin(true, { setLoginItemSettings }, 'win32')).toBe(true)
    expect(setLoginItemSettings).toHaveBeenCalledWith(loginItemConfig(true))
  })

  it('is a no-op off Windows rather than an error', () => {
    const setLoginItemSettings = vi.fn()
    expect(applyOpenAtLogin(true, { setLoginItemSettings }, 'linux')).toBe(false)
    expect(setLoginItemSettings).not.toHaveBeenCalled()
  })

  it('never throws when Windows refuses', () => {
    // A startup entry that cannot be written is a nuisance. Crashing the app on launch
    // because of one is not.
    const setLoginItemSettings = vi.fn(() => {
      throw new Error('access denied')
    })
    expect(applyOpenAtLogin(true, { setLoginItemSettings }, 'win32')).toBe(false)
  })
})
