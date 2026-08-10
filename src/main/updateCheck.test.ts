import { describe, expect, it } from 'vitest'
import { buildTagFromRelease, diskIsNewerThanRunning, isNewer, tagDate } from './updateCheck'

describe('tagDate', () => {
  it('parses the timestamp out of a build tag', () => {
    expect(tagDate('v0.1.1 · 2026-07-29 20:47 · f114d53')).toBe(Date.parse('2026-07-29T20:47:00'))
  })
  it('returns null when no timestamp is present', () => {
    expect(tagDate('v0.1.1')).toBeNull()
    expect(tagDate('')).toBeNull()
    expect(tagDate('garbage')).toBeNull()
  })
})

describe('buildTagFromRelease', () => {
  it('uses the Build line when present', () => {
    expect(buildTagFromRelease({ body: 'Build v0.1.1 · 2026-09-01 10:00 · abc' })).toBe('Build v0.1.1 · 2026-09-01 10:00 · abc'.match(/Build (v[^\n*]+)/)![1])
  })

  it('falls back to the published_at timestamp when the release notes lack a build line', () => {
    const tag = buildTagFromRelease({ body: '', tag_name: 'v0.2.0', published_at: '2026-09-01T10:00:00Z' })
    expect(tag).toContain('v0.2.0')
    expect(tag).toContain('published')
    expect(tag).toMatch(/^v0\.2\.0 · 2026-09-01 \d{2}:\d{2} · published$/)
    expect(tagDate(tag!)).not.toBeNull()
  })

  it('returns null when neither a build line nor published_at/created_at are available', () => {
    expect(buildTagFromRelease({ body: '', tag_name: 'v0.2.0' })).toBeNull()
    expect(buildTagFromRelease({ body: '', published_at: '2026-09-01T10:00:00Z' })).toBeNull()
  })

  it('falls back to created_at when published_at is unavailable', () => {
    const tag = buildTagFromRelease({ body: '', tag_name: 'v0.2.1', published_at: null, created_at: '2026-09-01T11:15:00Z' })
    expect(tag).toContain('v0.2.1')
    expect(tag).toContain('published')
    expect(tag).toMatch(/^v0\.2\.1 · 2026-09-01 \d{2}:\d{2} · published$/)
    expect(tagDate(tag!)).not.toBeNull()
  })
})

describe('isNewer', () => {
  const local = 'v0.1.1 · 2026-07-29 20:47 · f114d53'
  it('true when the remote build is meaningfully newer', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 21:30 · abc1234')).toBe(true)
    expect(isNewer(local, 'v0.1.2 · 2026-08-01 09:00 · abc1234')).toBe(true)
  })
  it('false for the same build even when stamps differ by seconds-to-minutes', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 20:47 · f114d53')).toBe(false)
    // ship stamp vs self-stamp of the SAME build can drift a minute or two
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 20:49 · f114d53')).toBe(false)
  })
  it('false when the remote is older', () => {
    expect(isNewer(local, 'v0.1.1 · 2026-07-29 18:50 · ae3dc40')).toBe(false)
  })
  it('false when either tag is unparseable (never nag on bad data)', () => {
    expect(isNewer('junk', 'v0.1.1 · 2026-07-29 21:30 · abc1234')).toBe(false)
    expect(isNewer(local, 'junk')).toBe(false)
  })
})

describe('diskIsNewerThanRunning (drives the one-click "restart to update")', () => {
  const running = 'v0.1.1 · 2026-07-31 09:13 · 359ec86'
  const runningAt = tagDate(running) as number

  it('true when the on-disk code archive postdates the running build (ship swapped it in place)', () => {
    expect(diskIsNewerThanRunning(runningAt + 10 * 60_000, running)).toBe(true)
  })

  it('false within the same-build stamp-jitter window', () => {
    expect(diskIsNewerThanRunning(runningAt + 60_000, running)).toBe(false)
  })

  it('false when disk is older, mtime is garbage, or the running tag has no date', () => {
    expect(diskIsNewerThanRunning(runningAt - 60_000, running)).toBe(false)
    expect(diskIsNewerThanRunning(NaN, running)).toBe(false)
    expect(diskIsNewerThanRunning(runningAt + 10 * 60_000, 'v0.1.1 · probe')).toBe(false)
  })
})
