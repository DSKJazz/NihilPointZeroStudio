import { describe, expect, it } from 'vitest'
import {
  approvalKeyFor,
  approve,
  block,
  canPublish,
  checkBrief,
  duePieces,
  markReady,
  missingForReview,
  planDay,
  reject,
  shortSummary,
  splitSeconds,
  type AutopilotBrief,
  type BuiltPiece
} from './autopilot'

const brief: AutopilotBrief = {
  minutesPerDay: 24,
  longsPerDay: 2,
  shortsPerDay: 4,
  longHours: [9, 19],
  shortHours: [8, 12, 16, 21],
  review: 'summary',
  platforms: ['youtube', 'tiktok']
}

describe('checkBrief', () => {
  it('accepts the brief the user actually asked for', () => {
    // "morning, evening, twice a day, and at least four shorts"
    expect(checkBrief(brief)).toEqual([])
  })

  it('refuses instead of quietly making half of what was asked', () => {
    // Silently trimming is worse than refusing: nobody is watching the render, so this
    // is the only moment the user can be told it does not fit.
    const p = checkBrief({ ...brief, minutesPerDay: 5 })
    expect(p.length).toBe(1)
    expect(p[0].message).toMatch(/does not leave enough/)
  })

  it('refuses a day longer than a day can render', () => {
    expect(checkBrief({ ...brief, minutesPerDay: 600 })[0].message).toMatch(/more than this can render/)
  })

  it('notices when there are fewer posting times than pieces', () => {
    expect(checkBrief({ ...brief, shortHours: [8, 12] })[0].message).toMatch(/4 shorts a day but gave 2 times/)
  })

  it('rejects an hour that is not an hour', () => {
    expect(checkBrief({ ...brief, longHours: [9, 26] }).some((p) => p.field === 'hours')).toBe(true)
  })

  it('needs somewhere to post to', () => {
    expect(checkBrief({ ...brief, platforms: [] }).some((p) => p.field === 'platforms')).toBe(true)
  })

  it('needs a number of minutes', () => {
    for (const m of [0, -3, NaN]) {
      expect(checkBrief({ ...brief, minutesPerDay: m }).some((p) => p.field === 'minutesPerDay')).toBe(true)
    }
  })
})

describe('splitSeconds', () => {
  it('sums to exactly the total, losing nothing to rounding', () => {
    for (const [total, parts] of [
      [1000, 3],
      [7, 4],
      [1, 5],
      [3600, 7]
    ]) {
      const out = splitSeconds(total, parts)
      expect(out).toHaveLength(parts)
      expect(out.reduce((a, b) => a + b, 0)).toBe(total)
    }
  })

  it('spreads the remainder rather than dumping it on one piece', () => {
    expect(splitSeconds(10, 4)).toEqual([3, 3, 2, 2])
  })

  it('is empty for no parts', () => {
    expect(splitSeconds(100, 0)).toEqual([])
  })
})

describe('planDay', () => {
  const day = planDay(brief, '2026-08-02T00:00:00.000Z', 'd1')

  it('plans exactly what was asked for', () => {
    expect(day.filter((p) => p.kind === 'long')).toHaveLength(2)
    expect(day.filter((p) => p.kind === 'short')).toHaveLength(4)
  })

  it('spends the whole daily budget and not a second more', () => {
    expect(day.reduce((n, p) => n + p.targetSeconds, 0)).toBe(24 * 60)
  })

  it('caps shorts at a minute', () => {
    expect(day.filter((p) => p.kind === 'short').every((p) => p.targetSeconds === 60)).toBe(true)
  })

  it('returns them in the order they will be worked on', () => {
    const times = day.map((p) => p.publishAt)
    expect(times).toEqual([...times].sort())
  })

  it('starts everything as planned, never as approved', () => {
    expect(day.every((p) => p.state === 'planned')).toBe(true)
  })

  it('plans nothing at all from a brief that does not add up', () => {
    expect(planDay({ ...brief, minutesPerDay: 2 }, '2026-08-02T00:00:00.000Z', 'd1')).toEqual([])
  })

  it('plans nothing from an unreadable date rather than inventing one', () => {
    expect(planDay(brief, 'sometime tuesday', 'd1')).toEqual([])
  })
})

/** A piece with everything a viewer would see, ready to be offered for approval. */
function built(over: Partial<BuiltPiece> = {}): BuiltPiece {
  return {
    id: 'p1',
    kind: 'long',
    targetSeconds: 600,
    publishAt: '2026-08-02T09:00:00.000Z',
    state: 'building',
    review: 'summary',
    platforms: ['youtube'],
    videoPath: 'C:/v/1.mp4',
    title: 'Reserves fell again',
    description: 'What it means for your savings.',
    tags: ['psx', 'reserves'],
    thumbnailPath: 'C:/v/1.jpg',
    transcript: 'Aaj hum baat karenge reserves ki.',
    ...over
  }
}

describe('the approval gate', () => {
  it('refuses to publish anything that has not been approved', () => {
    // The one promise that must never fail.
    const p = markReady(built())
    expect(p.state).toBe('ready')
    expect(canPublish(p).ok).toBe(false)
  })

  it('publishes only after an explicit yes', () => {
    const ready = markReady(built())
    const ok = approve(ready, approvalKeyFor(ready), '2026-08-02T08:00:00.000Z')
    expect(ok.state).toBe('approved')
    expect(canPublish(ok).ok).toBe(true)
  })

  it('LOSES approval when the video, title or thumbnail changes afterwards', () => {
    // The thing they said yes to is not the thing that would be posted.
    const ready = markReady(built())
    const ok = approve(ready, approvalKeyFor(ready), '2026-08-02T08:00:00.000Z')
    for (const edit of [
      { title: 'Something else entirely' },
      { videoPath: 'C:/v/2.mp4' },
      { thumbnailPath: 'C:/v/2.jpg' },
      { description: 'Rewritten.' },
      { tags: ['different'] },
      { platforms: ['youtube', 'tiktok'] }
    ]) {
      const edited = { ...ok, ...edit }
      const verdict = canPublish(edited)
      expect(verdict.ok, JSON.stringify(edit)).toBe(false)
      expect(verdict.ok === false && verdict.reason).toMatch(/changed after you approved/)
    }
  })

  it('cannot be approved from a stale screen showing an older version', () => {
    const ready = markReady(built())
    const stale = approvalKeyFor({ ...ready, title: 'The title that used to be here' })
    expect(approve(ready, stale, '2026-08-02T08:00:00.000Z').state).toBe('ready')
  })

  it('cannot be approved before it is ready', () => {
    const b = built({ state: 'building' })
    expect(approve(b, approvalKeyFor(b), '2026-08-02T08:00:00.000Z').state).toBe('building')
  })

  it('never publishes something the user said no to', () => {
    const ready = markReady(built())
    const no = reject(approve(ready, approvalKeyFor(ready), '2026-08-02T08:00:00.000Z'))
    expect(no.state).toBe('rejected')
    expect(canPublish(no).ok).toBe(false)
  })

  it('never publishes something a check blocked, and says which check', () => {
    const stopped = block(markReady(built()), 'The music track has no licence on file.')
    const verdict = canPublish(stopped)
    expect(verdict.ok).toBe(false)
    expect(verdict.ok === false && verdict.reason).toMatch(/no licence/)
  })

  it('refuses a state it does not recognise, rather than assuming the best', () => {
    // What a file written by a future version looks like.
    const weird = { ...built(), state: 'quantum' as unknown as BuiltPiece['state'], approvedKey: 'x' }
    expect(canPublish(weird).ok).toBe(false)
  })

  it('refuses when there is no record of what was approved', () => {
    const forged = { ...built(), state: 'approved' as const }
    expect(canPublish(forged).ok).toBe(false)
  })

  it('does not skip the gate for "just post it"', () => {
    // "Just post it" is the user's ANSWER to the question, not a reason to stop asking:
    // the record still has to show they said yes.
    const ready = markReady(built({ review: 'just-post' }))
    expect(ready.state).toBe('ready')
    expect(canPublish(ready).ok).toBe(false)
  })
})

describe('what a piece needs before the user is even asked', () => {
  it('lists everything missing, in plain words', () => {
    expect(missingForReview(built({ videoPath: undefined, tags: [] }))).toEqual(['the finished video', 'tags'])
  })

  it('always requires a transcript, even for "just post"', () => {
    // The user must always be ABLE to read what they are publishing, whether or not they
    // choose to on the day.
    expect(missingForReview(built({ review: 'just-post', transcript: undefined }))).toContain('a transcript')
  })

  it('does not demand a thumbnail for a short', () => {
    expect(missingForReview(built({ kind: 'short', thumbnailPath: undefined }))).not.toContain('a thumbnail')
  })

  it('marks an incomplete piece failed rather than offering it', () => {
    expect(markReady(built({ title: undefined })).state).toBe('failed')
  })
})

describe('duePieces', () => {
  const readyApproved = (id: string, at: string): BuiltPiece => {
    const r = markReady(built({ id, publishAt: at }))
    return approve(r, approvalKeyFor(r), '2026-08-02T00:00:00.000Z')
  }

  it('returns only what is due AND allowed, oldest first', () => {
    const list = [
      readyApproved('b', '2026-08-02T09:00:00.000Z'),
      readyApproved('a', '2026-08-02T08:00:00.000Z'),
      readyApproved('later', '2026-08-02T19:00:00.000Z'),
      markReady(built({ id: 'unapproved', publishAt: '2026-08-02T07:00:00.000Z' }))
    ]
    expect(duePieces(list, '2026-08-02T10:00:00.000Z').map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('is empty rather than throwing on an empty plan', () => {
    expect(duePieces([], '2026-08-02T10:00:00.000Z')).toEqual([])
  })
})

describe('shortSummary', () => {
  it('says what it is in one line, for the user who chose "summary"', () => {
    const s = shortSummary(built({ transcript: 'one two three' }))
    expect(s).toContain('Video')
    expect(s).toContain('10 minutes')
    expect(s).toContain('Reserves fell again')
    expect(s).toContain('3 words')
    expect(s).toContain('youtube')
  })

  it('describes a short in seconds, not minutes', () => {
    expect(shortSummary(built({ kind: 'short', targetSeconds: 45 }))).toContain('45 seconds')
  })

  it('does not fall over on a piece with nothing filled in', () => {
    expect(() => shortSummary(built({ title: undefined, transcript: undefined }))).not.toThrow()
  })
})
