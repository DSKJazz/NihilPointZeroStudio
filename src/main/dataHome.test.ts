import { describe, expect, it } from 'vitest'
import { decideDataHome } from './dataHome'

/**
 * This function decides where the user's entire body of work is read from and written
 * to. The bug it replaces silently moved the app between folders and made ~15 GB of
 * finished videos disappear from the UI, so every branch is pinned here.
 */
const DEFAULT = 'C:\\Users\\x\\AppData\\Roaming\\finscript-studio'
const DESKTOP = 'C:\\Users\\x\\Desktop\\NihilPointZeroStudio\\nihilpointzero-data'
const PORTABLE = 'E:\\stick\\nihilpointzero-data'
const PINNED = 'C:\\Users\\x\\Desktop\\NihilPointZeroStudio\\nihilpointzero-data'

describe('decideDataHome — priority order', () => {
  it('the E2E harness always wins, and is never written down', () => {
    const c = decideDataHome({ e2eDir: 'C:\\tmp\\e2e', pinnedDir: PINNED, pinnedUsable: true, defaultDir: DEFAULT })
    expect(c).toMatchObject({ dir: 'C:\\tmp\\e2e', source: 'e2e', pin: false })
  })

  it('a portable exe uses the data beside it and ignores any pin from this PC', () => {
    const c = decideDataHome({
      portableDir: 'E:\\stick',
      portableCandidate: PORTABLE,
      portableUsable: true,
      pinnedDir: PINNED,
      pinnedUsable: true,
      defaultDir: DEFAULT
    })
    // Travelling with its own work is the whole point of a portable build.
    expect(c).toMatchObject({ dir: PORTABLE, source: 'portable', pin: false })
  })

  it('a portable exe on read-only media with no data falls through to the normal rules', () => {
    const c = decideDataHome({
      portableDir: 'D:\\cd',
      portableCandidate: 'D:\\cd\\nihilpointzero-data',
      portableUsable: false,
      desktopDir: DESKTOP,
      desktopHasData: true,
      defaultDir: DEFAULT
    })
    expect(c).toMatchObject({ dir: DESKTOP, source: 'desktop', pin: true })
  })

  it('an existing pin is obeyed without re-deriving anything', () => {
    const c = decideDataHome({
      pinnedDir: PINNED,
      pinnedUsable: true,
      // Even with the Desktop folder now empty, the pin still decides. This is the
      // whole fix: the surroundings changing must not move the user's work.
      desktopDir: DESKTOP,
      desktopHasData: false,
      defaultDir: DEFAULT
    })
    expect(c).toMatchObject({ dir: PINNED, source: 'pinned', pin: false })
  })
})

describe('decideDataHome — first run writes the decision down', () => {
  it('adopts the Desktop studio when it already holds work, and pins it', () => {
    const c = decideDataHome({ desktopDir: DESKTOP, desktopHasData: true, defaultDir: DEFAULT })
    expect(c).toMatchObject({ dir: DESKTOP, source: 'desktop', pin: true })
  })

  it('uses the per-user folder on a truly fresh machine, and pins that', () => {
    const c = decideDataHome({ desktopDir: DESKTOP, desktopHasData: false, defaultDir: DEFAULT })
    expect(c).toMatchObject({ dir: DEFAULT, source: 'default', pin: true })
  })

  it('copes with a machine that has no Desktop folder at all', () => {
    const c = decideDataHome({ defaultDir: DEFAULT })
    expect(c).toMatchObject({ dir: DEFAULT, source: 'default', pin: true })
  })
})

describe('decideDataHome — an unreachable pinned folder must never look like data loss', () => {
  it('falls back, re-pins, and explains itself in plain English', () => {
    const c = decideDataHome({
      pinnedDir: 'X:\\external\\nihilpointzero-data',
      pinnedUsable: false,
      desktopDir: DESKTOP,
      desktopHasData: true,
      defaultDir: DEFAULT
    })
    expect(c.dir).toBe(DESKTOP)
    expect(c.pin).toBe(true)
    expect(c.notice).toBeTruthy()
    expect(c.notice).toContain('X:\\external\\nihilpointzero-data')
    // It must reassure, not alarm: the work still exists on the missing drive.
    expect(c.notice).toMatch(/nothing has been deleted/i)
    expect(c.notice).toMatch(/plug it back in/i)
  })

  it('still starts (on the always-writable default) when there is nowhere else to go', () => {
    const c = decideDataHome({ pinnedDir: 'X:\\gone', pinnedUsable: false, desktopHasData: false, defaultDir: DEFAULT })
    expect(c).toMatchObject({ dir: DEFAULT, source: 'default', pin: true })
    expect(c.notice).toBeTruthy()
  })
})
