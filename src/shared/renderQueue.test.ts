/**
 * The rule that shapes this module is that nothing is ever dropped, so that is what the
 * tests are mostly about: a failure must cost exactly one item, a crash mid-render must not
 * lose the rest of the night's work, and no operation may quietly remove something the user
 * did not remove.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_ATTEMPTS,
  cancel,
  clearFinished,
  current,
  finish,
  nextUp,
  recoverInterrupted,
  reorder,
  retry,
  start,
  summarise,
  waiting,
  type QueueItem,
  type QueueState
} from './renderQueue'

let clock = 0
const item = (id: string, state: QueueState = 'waiting', over: Partial<QueueItem> = {}): QueueItem => ({
  id,
  title: `Video ${id}`,
  state,
  addedAt: `2026-08-01T10:0${clock++ % 10}:00.000Z`,
  request: { topic: id },
  ...over
})

describe('one at a time, in order', () => {
  it('starts the first waiting item', () => {
    const q = [item('a'), item('b'), item('c')]
    expect(nextUp(q)?.id).toBe('a')
  })

  it('starts NOTHING while something is already rendering', () => {
    // Two renders at once is slower than one after the other, not faster — they fight over
    // the same CPU, the same encoder and the same disk.
    const q = [item('a', 'rendering'), item('b')]
    expect(nextUp(q)).toBeNull()
    expect(current(q)?.id).toBe('a')
  })

  it('moves on once the current one finishes', () => {
    let q = [item('a'), item('b')]
    q = start(q, 'a')
    expect(nextUp(q)).toBeNull()
    q = finish(q, 'a', { videoId: 'vid-a' })
    expect(nextUp(q)?.id).toBe('b')
  })

  it('has nothing to start when everything is finished', () => {
    const q = [item('a', 'done'), item('b', 'failed'), item('c', 'cancelled')]
    expect(nextUp(q)).toBeNull()
  })
})

describe('a failure costs exactly one item', () => {
  it('does not touch anything else in the queue', () => {
    // The bug this exists to prevent: batch dies at item three and loses four to ten,
    // after working perfectly for two hours.
    let q = [item('a'), item('b'), item('c'), item('d')]
    q = start(q, 'a')
    q = finish(q, 'a', { error: 'ffmpeg fell over' })
    expect(q.find((i) => i.id === 'a')!.state).toBe('failed')
    expect(waiting(q).map((i) => i.id)).toEqual(['b', 'c', 'd'])
    expect(nextUp(q)?.id).toBe('b')
  })

  it('keeps the failure visible with its reason', () => {
    let q = [item('a')]
    q = start(q, 'a')
    q = finish(q, 'a', { error: 'the script had no words in it' })
    const failed = q.find((i) => i.id === 'a')!
    expect(failed.error).toBe('the script had no words in it')
    expect(failed.finishedAt).toBeTruthy()
  })

  it('can be tried again, with a fair go rather than a used-up attempt count', () => {
    let q = [item('a')]
    q = finish(start(q, 'a'), 'a', { error: 'x' })
    q = retry(q, 'a')
    const again = q.find((i) => i.id === 'a')!
    expect(again.state).toBe('waiting')
    expect(again.attempts).toBe(0)
    expect(again.error).toBeUndefined()
  })

  it('will not retry something that is done — that would rebuild over a good video', () => {
    const q = retry([item('a', 'done', { videoId: 'v' })], 'a')
    expect(q[0].state).toBe('done')
  })
})

describe('surviving the app closing mid-render', () => {
  it('puts an interrupted render back in the queue rather than failing it', () => {
    // The user did nothing wrong; the render just did not finish. A queue you walked away
    // from should pick itself back up.
    const { items, recovered } = recoverInterrupted([item('a', 'rendering', { attempts: 1 }), item('b')])
    expect(recovered).toBe(1)
    expect(items[0].state).toBe('waiting')
    expect(items[0].startedAt).toBeUndefined()
    expect(nextUp(items)?.id).toBe('a')
  })

  it('keeps the attempt count, so something that crashes the app cannot do it forever', () => {
    const { items } = recoverInterrupted([item('a', 'rendering', { attempts: 1 })])
    expect(items[0].attempts).toBe(1)
  })

  it('gives up after the second crash, and says what to do about it', () => {
    const { items } = recoverInterrupted([item('a', 'rendering', { attempts: MAX_ATTEMPTS })])
    expect(items[0].state).toBe('failed')
    expect(items[0].error).toMatch(/crashing the render/)
    expect(items[0].error).toMatch(/on its own/)
  })

  it('leaves everything that was not mid-render completely alone', () => {
    const before = [item('a', 'done'), item('b', 'waiting'), item('c', 'failed'), item('d', 'cancelled')]
    const { items, recovered } = recoverInterrupted(before)
    expect(recovered).toBe(0)
    expect(items).toEqual(before)
  })

  it('never loses an item while recovering', () => {
    const before = [item('a', 'rendering'), item('b'), item('c', 'done')]
    expect(recoverInterrupted(before).items).toHaveLength(3)
  })
})

describe('nothing is ever dropped', () => {
  it('cancelling keeps the item, marked cancelled', () => {
    const q = cancel([item('a'), item('b')], 'a')
    expect(q).toHaveLength(2)
    expect(q[0].state).toBe('cancelled')
  })

  it('cancelling the one rendering records the intent, and the caller stops ffmpeg', () => {
    const q = cancel([item('a', 'rendering')], 'a')
    expect(q[0].state).toBe('cancelled')
  })

  it('cancelling something already done changes nothing', () => {
    const q = cancel([item('a', 'done', { videoId: 'v' })], 'a')
    expect(q[0].state).toBe('done')
    expect(q[0].videoId).toBe('v')
  })

  it('clearing removes ONLY finished work, never waiting or rendering', () => {
    const q = clearFinished([item('a', 'done'), item('b', 'waiting'), item('c', 'rendering'), item('d', 'failed')])
    expect(q.map((i) => i.id).sort()).toEqual(['b', 'c'])
  })

  it('every operation on an unknown id is a no-op, not a loss', () => {
    const q = [item('a'), item('b')]
    for (const op of [start, cancel, retry] as const) {
      expect(op(q, 'nope')).toHaveLength(2)
    }
    expect(finish(q, 'nope', { error: 'x' })).toHaveLength(2)
    expect(reorder(q, 'nope', 1)).toHaveLength(2)
  })
})

describe('reordering what is still waiting', () => {
  it('moves a waiting item up and down', () => {
    const q = [item('a'), item('b'), item('c')]
    expect(waiting(reorder(q, 'c', -1)).map((i) => i.id)).toEqual(['a', 'c', 'b'])
    expect(waiting(reorder(q, 'a', 1)).map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('does nothing at the ends', () => {
    const q = [item('a'), item('b')]
    expect(waiting(reorder(q, 'a', -1)).map((i) => i.id)).toEqual(['a', 'b'])
    expect(waiting(reorder(q, 'b', 1)).map((i) => i.id)).toEqual(['a', 'b'])
  })

  it('will not reorder the one already rendering', () => {
    // Moving it would change what "next" means halfway through.
    const q = [item('a', 'rendering'), item('b'), item('c')]
    expect(reorder(q, 'a', 1).map((i) => i.id)).toEqual(['a', 'b', 'c'])
  })

  it('reorders among the waiting ones only, ignoring finished items in between', () => {
    const q = [item('a', 'done'), item('b'), item('c', 'failed'), item('d')]
    expect(waiting(reorder(q, 'd', -1)).map((i) => i.id)).toEqual(['d', 'b'])
  })
})

describe('what the user is told', () => {
  it('names what is rendering and how many follow', () => {
    const s = summarise([item('a', 'rendering'), item('b'), item('c')])
    expect(s.headline).toMatch(/Rendering "Video a", then 2 more/)
  })

  it('says "the last one" rather than "then 0 more"', () => {
    expect(summarise([item('a', 'rendering')]).headline).toMatch(/the last one/)
  })

  it('says failures are still there and can be tried again', () => {
    const s = summarise([item('a', 'done'), item('b', 'failed')])
    expect(s.headline).toMatch(/still here with their reasons/)
    expect(s.failed).toBe(1)
  })

  it('invites the user to walk away when the queue is empty', () => {
    expect(summarise([]).headline).toMatch(/walk away/)
  })

  it('counts every state', () => {
    const s = summarise([
      item('a', 'waiting'),
      item('b', 'rendering'),
      item('c', 'done'),
      item('d', 'failed'),
      item('e', 'cancelled')
    ])
    expect([s.waiting, s.rendering, s.done, s.failed, s.cancelled]).toEqual([1, 1, 1, 1, 1])
  })
})

describe('survives junk', () => {
  it('handles undefined and nulls throughout', () => {
    for (const fn of [waiting, current, nextUp, clearFinished, summarise] as const) {
      expect(() => fn(undefined as never)).not.toThrow()
      expect(() => fn([null as never, undefined as never])).not.toThrow()
    }
    expect(() => recoverInterrupted(undefined as never)).not.toThrow()
    expect(() => start(undefined as never, 'a')).not.toThrow()
    expect(() => reorder([null as never], 'a', 1)).not.toThrow()
  })

  it('a queue of only junk summarises as empty rather than crashing', () => {
    expect(summarise([null as never, undefined as never]).headline).toMatch(/Nothing in the queue/)
  })
})
