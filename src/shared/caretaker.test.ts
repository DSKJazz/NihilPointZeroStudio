/**
 * The Caretaker's record must stay bounded and newest-first: it is read on every
 * Settings visit, and a log that grows forever is a slow leak wearing a badge.
 */
import { describe, expect, it } from 'vitest'
import { appendRun, MAX_RUNS_KEPT, type CaretakerRun } from './caretaker'

const run = (at: string): CaretakerRun => ({ at, trigger: 'schedule', outcome: 'done', problems: [], fixed: [], notes: [] })

describe('the caretaker record', () => {
  it('keeps newest first', () => {
    const log = appendRun(appendRun([], run('2026-01-01')), run('2026-01-02'))
    expect(log.map((r) => r.at)).toEqual(['2026-01-02', '2026-01-01'])
  })

  it('caps the record so it cannot grow forever', () => {
    let log: CaretakerRun[] = []
    for (let i = 0; i < MAX_RUNS_KEPT + 25; i++) log = appendRun(log, run(`t${i}`))
    expect(log).toHaveLength(MAX_RUNS_KEPT)
    expect(log[0].at).toBe(`t${MAX_RUNS_KEPT + 24}`)
  })
})
