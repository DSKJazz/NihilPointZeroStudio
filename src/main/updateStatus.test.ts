import { describe, expect, it } from 'vitest'
import { describeUpdateStatus } from './updateStatus'

const tag = (t: string): string => `v0.1.1 · ${t} · abc1234`

describe('describeUpdateStatus', () => {
  it('says so, out loud, when there is nothing to do', () => {
    // The whole point of this module: silence is what a BROKEN check looks like, so
    // being current has to be stated.
    const s = describeUpdateStatus(tag('2026-08-01 19:29'), tag('2026-08-01 19:29'))
    expect(s.state).toBe('current')
    expect(s.message).toMatch(/up to date/i)
  })

  it('treats the same build stamped seconds apart as current', () => {
    // The self-stamp and the ship stamp of one build differ by a few seconds; that must
    // never read as "a newer version exists".
    expect(describeUpdateStatus(tag('2026-08-01 19:29'), tag('2026-08-01 19:30')).state).toBe('current')
  })

  it('reports behind when the published build is genuinely newer', () => {
    const s = describeUpdateStatus(tag('2026-08-01 04:30'), tag('2026-08-01 19:29'))
    expect(s.state).toBe('behind')
    expect(s.message).toMatch(/Get the update/)
  })

  it('reports ahead rather than behind on a machine that just built locally', () => {
    // Showing "behind" here would send the user to download an OLDER copy of their own
    // work, which is worse than saying nothing.
    const s = describeUpdateStatus(tag('2026-08-01 19:29'), tag('2026-08-01 04:30'))
    expect(s.state).toBe('ahead')
    expect(s.message).not.toMatch(/newer version is available/)
  })

  it('never claims "up to date" when the check could not run', () => {
    // The single worst thing this screen could do is report a result it did not obtain.
    for (const published of [null, '', 'no date in here at all']) {
      const s = describeUpdateStatus(tag('2026-08-01 19:29'), published)
      expect(s.state).toBe('unknown')
      expect(s.message).not.toMatch(/up to date/i)
      expect(s.message).toMatch(/try again/i)
    }
  })

  it('is unknown, not current, when the RUNNING tag is unreadable', () => {
    const s = describeUpdateStatus('dev', tag('2026-08-01 19:29'))
    expect(s.state).toBe('unknown')
  })

  it('always passes both tags back, so the screen can show the evidence', () => {
    const s = describeUpdateStatus(tag('2026-08-01 04:30'), tag('2026-08-01 19:29'))
    expect(s.runningTag).toContain('04:30')
    expect(s.publishedTag).toContain('19:29')
  })

  it('exactly at the slack boundary counts as current, not behind', () => {
    // 19:29 -> 19:31 is exactly 2 minutes: not MORE than the slack, so still current.
    expect(describeUpdateStatus(tag('2026-08-01 19:29'), tag('2026-08-01 19:31')).state).toBe('current')
    expect(describeUpdateStatus(tag('2026-08-01 19:29'), tag('2026-08-01 19:32')).state).toBe('behind')
  })
})
