import { describe, expect, it } from 'vitest'
import { MIN_ITEMS_WORTH_PROTECTING, NUDGE_INTERVAL_DAYS, nudgeMessage, shouldNudge, type NudgeInputs } from './backupNudge'

const NOW = '2026-08-02T03:00:00.000Z'
const daysAgo = (n: number): string => new Date(Date.parse(NOW) - n * 86_400_000).toISOString()

const base: NudgeInputs = { hasSecondHome: false, workItems: 20, lastNudgedAt: null, nowIso: NOW }

describe('shouldNudge', () => {
  it('warns a user whose work is on one disk and who has never been told', () => {
    // His restore log: "8 missing file(s) brought back". It has already happened once.
    expect(shouldNudge(base)).toBe(true)
  })

  it('says nothing once a second home is set', () => {
    expect(shouldNudge({ ...base, hasSecondHome: true })).toBe(false)
  })

  it('does not warn about an empty studio', () => {
    // Telling someone to protect nothing teaches them the warning is noise, and spends
    // the credibility needed on the day it matters.
    expect(shouldNudge({ ...base, workItems: 0 })).toBe(false)
    expect(shouldNudge({ ...base, workItems: MIN_ITEMS_WORTH_PROTECTING - 1 })).toBe(false)
    expect(shouldNudge({ ...base, workItems: MIN_ITEMS_WORTH_PROTECTING })).toBe(true)
  })

  it('does not nag on every launch', () => {
    // Nagging is how people learn to dismiss things without reading them.
    expect(shouldNudge({ ...base, lastNudgedAt: daysAgo(1) })).toBe(false)
    expect(shouldNudge({ ...base, lastNudgedAt: daysAgo(NUDGE_INTERVAL_DAYS - 1) })).toBe(false)
  })

  it('comes back after the interval, because one notice missed is one notice wasted', () => {
    expect(shouldNudge({ ...base, lastNudgedAt: daysAgo(NUDGE_INTERVAL_DAYS) })).toBe(true)
    expect(shouldNudge({ ...base, lastNudgedAt: daysAgo(60) })).toBe(true)
  })

  it('treats a broken or future timestamp as "just shown", never as "nag now"', () => {
    // A clock problem must not turn into a warning on every single launch.
    // NB an empty string is "never recorded", not a corrupt timestamp — it belongs with
    // null above and correctly nudges.
    expect(shouldNudge({ ...base, lastNudgedAt: '' })).toBe(true)
    for (const bad of ['not a date', 'yesterday']) {
      expect(shouldNudge({ ...base, lastNudgedAt: bad })).toBe(false)
    }
    expect(shouldNudge({ ...base, lastNudgedAt: daysAgo(-5) })).toBe(false)
  })

  it('stays silent rather than guessing when "now" is unreadable', () => {
    expect(shouldNudge({ ...base, nowIso: 'whenever' })).toBe(false)
  })
})

describe('nudgeMessage', () => {
  it('names the real risk, not a vague warning', () => {
    const m = nudgeMessage(20)
    expect(m).toContain('20 videos and scripts')
    expect(m).toMatch(/SAME disk/)
    expect(m).toMatch(/dead drive|lost laptop/)
  })

  it('asks for one action, not a procedure', () => {
    expect(nudgeMessage(20)).toMatch(/Second backup home/)
    expect(nudgeMessage(20)).toMatch(/never think about it again/)
  })
})
