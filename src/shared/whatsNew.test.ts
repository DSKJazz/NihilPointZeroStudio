/**
 * The failure this must never commit is ADVERTISING A FEATURE THAT IS NOT THERE. A
 * changelog note written before the build ships sends the user hunting for a button that
 * does not exist, which is worse than saying nothing. So the withholding rule is tested
 * first and hardest.
 *
 * The second concern is a project that ships several times a day: "seen" must survive
 * two builds in one afternoon without losing anything.
 */
import { describe, expect, it } from 'vitest'
import {
  CHANGELOG,
  FIRST_RUN_MAX,
  entriesInBuild,
  groupByDay,
  hasUnread,
  tagDay,
  tagStamp,
  whatsNewReport,
  type ChangeEntry
} from './whatsNew'

const entry = (id: string, date: string): ChangeEntry => ({
  id,
  date,
  title: `Title ${id}`,
  detail: `Detail ${id}`,
  where: 'Somewhere'
})

const LOG: ChangeEntry[] = [
  entry('tomorrow', '2026-08-02'),
  entry('today-b', '2026-08-01'),
  entry('today-a', '2026-08-01'),
  entry('yesterday', '2026-07-31'),
  entry('old', '2026-07-01')
]

const BUILD = 'v0.1.1 · 2026-08-01 15:30 · abc1234'

describe('never advertising something this build does not have', () => {
  it('withholds an entry dated AFTER the running build', () => {
    const ids = entriesInBuild(BUILD, LOG).map((e) => e.id)
    expect(ids).not.toContain('tomorrow')
  })

  it('includes entries from the build\'s OWN day', () => {
    // The entry is written in the same commit as the change, so a change that landed
    // this morning is genuinely inside a build stamped this afternoon.
    const ids = entriesInBuild(BUILD, LOG).map((e) => e.id)
    expect(ids).toContain('today-a')
    expect(ids).toContain('today-b')
  })

  it('the withheld entry appears once the build catches up', () => {
    // Withheld, not discarded. This is what makes withholding safe.
    const later = entriesInBuild('v0.1.1 · 2026-08-03 09:00 · def5678', LOG).map((e) => e.id)
    expect(later).toContain('tomorrow')
  })

  it('claims NOTHING when the build tag has no date in it', () => {
    // A guess here is exactly the lie the module exists to prevent.
    expect(entriesInBuild('v0.1.1 · probe', LOG)).toEqual([])
    const r = whatsNewReport({ buildTag: 'garbage', log: LOG })
    expect(r.entries).toEqual([])
    expect(r.headline).toMatch(/[Cc]annot tell which build/)
  })

  it('never marks a withheld entry as read', () => {
    // If it were remembered, the user would never be told about it in the build that
    // finally contains it.
    const r = whatsNewReport({ buildTag: BUILD, log: LOG })
    expect(r.rememberIds).not.toContain('tomorrow')
  })
})

describe('read state, on a project that ships twice a day', () => {
  it('hides what has already been read', () => {
    const r = whatsNewReport({ buildTag: BUILD, seenIds: ['today-a', 'old'], log: LOG })
    const ids = r.entries.map((e) => e.id)
    expect(ids).not.toContain('today-a')
    expect(ids).not.toContain('old')
    expect(ids).toContain('today-b')
  })

  it('a SECOND build on the same day still shows its new entries', () => {
    // This is the case a date-based "last seen build" loses entirely, and the reason
    // read state is keyed on the entry rather than on a timestamp.
    const morning = whatsNewReport({ buildTag: 'v0.1.1 · 2026-08-01 09:00 · aaa', log: LOG })
    const afternoonLog = [...LOG, entry('shipped-after-lunch', '2026-08-01')]
    const afternoon = whatsNewReport({
      buildTag: 'v0.1.1 · 2026-08-01 16:00 · bbb',
      seenIds: morning.rememberIds,
      log: afternoonLog
    })
    expect(afternoon.entries.map((e) => e.id)).toEqual(['shipped-after-lunch'])
  })

  it('says so plainly when there is nothing new', () => {
    const first = whatsNewReport({ buildTag: BUILD, log: LOG })
    const second = whatsNewReport({ buildTag: BUILD, seenIds: first.rememberIds, log: LOG })
    expect(second.entries).toEqual([])
    expect(second.headline).toMatch(/Nothing new/)
  })

  it('ignores a stored id that no longer exists', () => {
    // An entry can be dropped from the changelog without breaking stored state.
    expect(() => whatsNewReport({ buildTag: BUILD, seenIds: ['deleted-long-ago'], log: LOG })).not.toThrow()
    expect(whatsNewReport({ buildTag: BUILD, seenIds: ['deleted-long-ago'], log: LOG }).entries.length).toBe(4)
  })

  it('treats an empty or missing seen list as the first run', () => {
    expect(whatsNewReport({ buildTag: BUILD, log: LOG }).firstRun).toBe(true)
    expect(whatsNewReport({ buildTag: BUILD, seenIds: [], log: LOG }).firstRun).toBe(true)
    expect(whatsNewReport({ buildTag: BUILD, seenIds: ['old'], log: LOG }).firstRun).toBe(false)
  })

  it('caps the first run rather than dumping the whole history at once', () => {
    const r = whatsNewReport({ buildTag: BUILD, log: LOG })
    expect(r.showAtMost).toBe(FIRST_RUN_MAX)
    // But it still REPORTS the true total, so nothing is quietly hidden.
    expect(r.headline).toContain(String(r.entries.length))
  })
})

describe('the sidebar dot', () => {
  it('is on when there is something unread', () => {
    expect(hasUnread(BUILD, [], LOG)).toBe(true)
  })

  it('is off once everything in this build has been read', () => {
    const r = whatsNewReport({ buildTag: BUILD, log: LOG })
    expect(hasUnread(BUILD, r.rememberIds, LOG)).toBe(false)
  })

  it('is off when the build cannot be identified — no dot for a claim we will not make', () => {
    expect(hasUnread('junk', [], LOG)).toBe(false)
  })
})

describe('the real changelog', () => {
  it('has no duplicate ids — read state is keyed on them', () => {
    const ids = CHANGELOG.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every entry has a real date, a title, a detail and a place to find it', () => {
    for (const e of CHANGELOG) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(Number.isNaN(Date.parse(e.date)), e.id).toBe(false)
      expect(e.title.length, e.id).toBeGreaterThan(4)
      expect(e.detail.length, e.id).toBeGreaterThan(20)
      expect(e.where.length, e.id).toBeGreaterThan(3)
    }
  })

  it('is newest first, so the screen reads top-down', () => {
    for (let i = 1; i < CHANGELOG.length; i++) {
      expect(CHANGELOG[i - 1].date >= CHANGELOG[i].date, `${CHANGELOG[i - 1].id} before ${CHANGELOG[i].id}`).toBe(true)
    }
  })

  it('is written in plain English, with no developer words', () => {
    // These docs are read by someone who does not code. A changelog full of "refactor"
    // and "IPC" is the same as no changelog.
    const jargon = /\b(?:refactor|IPC|typecheck|regex|API|async|repo|commit|bugfix|util|param)\b/i
    for (const e of CHANGELOG) {
      expect(jargon.test(`${e.title} ${e.detail}`), `${e.id}: ${e.title}`).toBe(false)
    }
  })

  it('every entry ends in something the user can go and do', () => {
    for (const e of CHANGELOG) {
      expect(e.where, e.id).toMatch(/→|Automatic|automatic|Runs automatically/)
    }
  })
})

describe('build tag reading', () => {
  it('reads the date and time', () => {
    expect(tagStamp('v0.1.1 · 2026-08-01 15:30 · abc')).toBe(Date.parse('2026-08-01T15:30:00'))
    expect(tagDay('v0.1.1 · 2026-08-01 15:30 · abc')).toBe('2026-08-01')
  })

  it('returns null rather than guessing', () => {
    expect(tagStamp('v0.1.1')).toBeNull()
    expect(tagStamp('')).toBeNull()
    expect(tagDay('nope')).toBeNull()
    expect(tagStamp(undefined as unknown as string)).toBeNull()
  })

  it('matches the tag format the build really produces', () => {
    // electron.vite.config.ts: `v${version} · ${yyyy-MM-dd HH:mm}${ · hash}`
    expect(tagDay('v0.1.1 · 2026-08-01 04:30 · 3354ec9')).toBe('2026-08-01')
    // ship.ps1 writes the same stamp without the leading "v" version on some lines.
    expect(tagDay('2026-08-01 04:30 · 3354ec9')).toBe('2026-08-01')
  })
})

describe('grouping for the screen', () => {
  it('groups by day, newest day first', () => {
    const groups = groupByDay(entriesInBuild(BUILD, LOG))
    expect(groups.map((g) => g.date)).toEqual(['2026-08-01', '2026-07-31', '2026-07-01'])
    expect(groups[0].entries.map((e) => e.id)).toEqual(['today-b', 'today-a'])
  })

  it('handles an empty list', () => {
    expect(groupByDay([])).toEqual([])
    expect(() => groupByDay(undefined as unknown as ChangeEntry[])).not.toThrow()
  })
})
