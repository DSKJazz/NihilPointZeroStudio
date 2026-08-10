import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { isNewer, tagDate } from './updateCheck'

/**
 * THE BUG THIS FILE EXISTS FOR
 *
 * The app finds the newest published version by matching /Build (v[^\n*]+)/ against the
 * GitHub release notes. ship.ps1 writes that line. The CI workflow — added later — wrote
 * "Built automatically from main on <stamp>" instead, with no "Build v..." anywhere. So
 * the check found nothing, concluded there was no update, and said nothing. Every release
 * published from a cloud session was invisible to every installed app, and the only
 * symptom was an update notice that never appeared.
 *
 * Nothing failed. No test broke, no build went red, no error was logged. Two files simply
 * stopped agreeing, and the app's response to "I could not read it" was identical to its
 * response to "you are up to date".
 *
 * These tests read the actual publishers and assert they still produce something the
 * actual parser can read. It is the only kind of test that could have caught it, because
 * the defect lived in the gap between the two.
 */

/** The exact regex from main/updateCheck.ts. Duplicated on purpose: if that one changes,
 * these tests must be revisited deliberately rather than silently following along. */
const PUBLISHED_TAG = /Build (v[^\n*]+)/

const root = resolve(__dirname, '../..')
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8')

describe('the CI workflow publishes notes the app can read', () => {
  const wf = read('.github/workflows/windows-build.yml')

  it('writes a "Build <tag>" line into the release notes', () => {
    expect(wf).toMatch(/Build \$NPZ_BUILD_TAG/)
  })

  it('decides the build tag explicitly instead of letting the exe self-stamp', () => {
    // If the notes quote one time and the exe bakes in another, the app can update and
    // still believe it is behind — an update loop.
    expect(wf).toMatch(/NPZ_BUILD_TAG=v\$VER/)
    expect(wf).toMatch(/\$GITHUB_ENV/)
  })

  it('builds the tag in the format tagDate can parse', () => {
    expect(wf).toMatch(/\+%Y-%m-%d %H:%M/)
  })

  it('puts nothing containing an asterisk after the Build line', () => {
    // The capture is [^\n*]+, so a '*' after the tag truncates it.
    const notes = wf.slice(wf.indexOf('Build $NPZ_BUILD_TAG'))
    const sameLine = notes.split('\n')[0]
    expect(sameLine.replace('Build $NPZ_BUILD_TAG', '')).not.toContain('*')
  })
})

describe('ship.ps1 still publishes notes the app can read', () => {
  it('writes a "Build <tag>" line too', () => {
    // The Windows path was never broken, but it is the other publisher of the same field
    // and would break the same way.
    expect(read('scripts/ship.ps1')).toMatch(/Build \$buildTag/)
  })
})

describe('a rendered example of each format', () => {
  const tag = 'v0.1.1 · 2026-08-01 19:29 · c6669e0'

  it('parses the CI notes and compares correctly against an older build', () => {
    const body = [
      'Built automatically from main (commit c6669e0).',
      '',
      '- **NIHILPOINTZERO-OS-setup.exe** — installs the app (recommended).',
      '',
      `Build ${tag}`
    ].join('\n')
    const found = PUBLISHED_TAG.exec(body)?.[1]?.trim()
    expect(found).toBe(tag)
    expect(tagDate(found!)).not.toBeNull()
    expect(isNewer('v0.1.1 · 2026-08-01 04:30 · 3354ec9', found!)).toBe(true)
  })

  it('parses the ship.ps1 notes', () => {
    const found = PUBLISHED_TAG.exec(`**This is always the newest version.** Build ${tag}`)?.[1]?.trim()
    expect(found).toBe(tag)
  })

  it('the SAME build is not reported as newer than itself', () => {
    // This is what the user sees after updating: it must settle, not keep nagging.
    expect(isNewer(tag, tag)).toBe(false)
  })

  it('demonstrates the exact failure that shipped: the old notes parse to nothing', () => {
    const oldBody = 'Built automatically from main on 2026-08-01 19:29 UTC (commit c6669e0).'
    expect(PUBLISHED_TAG.exec(oldBody)).toBeNull()
  })
})

/**
 * THE SHIP GUARD — added after a real incident.
 *
 * The teleprompter was committed at 04:13 and the studio shipped at 04:30, and the
 * shipped app did not contain it: 18 tabs where the code had 20. The ship had been run
 * from a tree that did not include the commit. Nothing failed — the tests passed because
 * they were testing the tree being built, the exe was valid, and the badge was honest.
 * The only symptom was the user asking where the teleprompter had gone.
 */
describe('ship.ps1 refuses to build from a tree that is behind main', () => {
  const ship = read('scripts/ship.ps1')

  it('fetches origin/main before deciding', () => {
    expect(ship).toMatch(/git fetch origin main/)
  })

  it('counts what main has that this tree does not', () => {
    // HEAD..origin/main is the correct direction: commits reachable from origin/main but
    // NOT from HEAD. The reverse would pass happily while missing finished work.
    expect(ship).toMatch(/rev-list --count HEAD\.\.origin\/main/)
  })

  it('throws rather than warning, so a build cannot proceed anyway', () => {
    expect(ship).toMatch(/throw 'Behind origin\/main/)
  })

  it('names the fix in the message', () => {
    expect(ship).toMatch(/git pull origin main/)
  })

  it('runs BEFORE the build step, not after', () => {
    expect(ship.indexOf('Behind origin/main')).toBeLessThan(ship.indexOf('dist:win'))
  })

  it('does not block shipping when GitHub simply cannot be reached', () => {
    // Being offline is not the same as being behind, and must not stop a legitimate ship.
    expect(ship).toMatch(/could not reach GitHub/)
  })
})
