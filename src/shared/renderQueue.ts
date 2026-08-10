/**
 * A render queue you can walk away from.
 *
 * WHAT ALREADY EXISTED, AND WHY IT IS NOT THIS
 * Batch already takes a list of topics and works through them. It is one call that runs to
 * the end, and that is fine for ten minutes. It is not fine for the thing people actually
 * want, which is to line up an evening's work and leave — because:
 *
 *   - it lives only in memory, so closing the app loses everything not yet built, and a
 *     twenty-minute render means an evening's queue is hours of exposure;
 *   - you cannot add to it while it runs, so a new idea means waiting for the whole batch;
 *   - and one failure at item three loses items four to ten. That is the worst of the
 *     three: the app was working perfectly for two hours and then threw away the rest of
 *     the night's work because one script had a bad character in it.
 *
 * So this is a queue that is WRITTEN DOWN, can be added to at any time, and where a failure
 * costs exactly one item.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE
 * Nothing is ever dropped. Not on failure, not on cancel, not on an app crash halfway
 * through. An item leaves the queue only when the user removes it, and a finished or failed
 * item stays visible with its reason. This app's first rule is that it does not lose the
 * user's work, and a queue that silently forgets a job is a queue that loses work.
 */

export type QueueState = 'waiting' | 'rendering' | 'done' | 'failed' | 'cancelled'

export interface QueueItem {
  id: string
  /** What the user will recognise it by. */
  title: string
  state: QueueState
  /** ISO time it was added, so the order is defensible after a restart. */
  addedAt: string
  startedAt?: string
  finishedAt?: string
  /** Set on 'done' — the video it produced. */
  videoId?: string
  /** Set on 'failed' — why, in the words the user should see. */
  error?: string
  /** How many times it has been tried. */
  attempts?: number
  /** Whatever the build needs. Opaque here on purpose: the queue does not care. */
  request: unknown
}

/** How many attempts an item gets before it is left alone. */
export const MAX_ATTEMPTS = 2

/** Items still to do, in the order they will be done. */
export function waiting(items: QueueItem[]): QueueItem[] {
  return (items ?? []).filter((i) => i && i.state === 'waiting')
}

/** The one currently rendering, if any. Never more than one — see nextUp. */
export function current(items: QueueItem[]): QueueItem | null {
  return (items ?? []).find((i) => i && i.state === 'rendering') ?? null
}

/**
 * The next item to start, or null.
 *
 * Returns null while something is already rendering. Two renders at once is slower than
 * one after the other, not faster — they fight over the same CPU, the same GPU encoder and
 * the same disk — and it makes the progress reporting meaningless.
 */
export function nextUp(items: QueueItem[]): QueueItem | null {
  if (current(items)) return null
  return waiting(items)[0] ?? null
}

/**
 * Repairs the queue after the app was closed or crashed mid-render.
 *
 * An item left as 'rendering' when nothing is running was interrupted. It goes back to
 * 'waiting' rather than to 'failed': the user did not do anything wrong, the render simply
 * did not finish, and a queue you walked away from should pick itself back up. Its attempt
 * count is kept, so something that crashes the app twice does not do it forever.
 */
export function recoverInterrupted(items: QueueItem[]): { items: QueueItem[]; recovered: number } {
  let recovered = 0
  const out = (items ?? []).filter(Boolean).map((i) => {
    if (i.state !== 'rendering') return i
    recovered++
    const attempts = (i.attempts ?? 1)
    return attempts >= MAX_ATTEMPTS
      ? {
          ...i,
          state: 'failed' as QueueState,
          finishedAt: new Date().toISOString(),
          error:
            'The app closed twice while this one was rendering, so it has been left alone rather than tried again. Something in it is probably crashing the render — try it on its own to see the reason.'
        }
      : { ...i, state: 'waiting' as QueueState, startedAt: undefined, attempts }
  })
  return { items: out, recovered }
}

/** Marks an item as started. */
export function start(items: QueueItem[], id: string): QueueItem[] {
  return (items ?? []).map((i) =>
    i && i.id === id && i.state === 'waiting'
      ? { ...i, state: 'rendering' as QueueState, startedAt: new Date().toISOString(), attempts: (i.attempts ?? 0) + 1 }
      : i
  )
}

/** Marks an item finished. A failure NEVER touches any other item. */
export function finish(
  items: QueueItem[],
  id: string,
  result: { videoId?: string; error?: string }
): QueueItem[] {
  return (items ?? []).map((i) => {
    if (!i || i.id !== id) return i
    const finishedAt = new Date().toISOString()
    return result.error
      ? { ...i, state: 'failed' as QueueState, error: result.error, finishedAt }
      : { ...i, state: 'done' as QueueState, videoId: result.videoId, finishedAt }
  })
}

/**
 * Cancels an item.
 *
 * A waiting item simply becomes 'cancelled'. The one RENDERING is marked cancelled too, but
 * stopping the actual ffmpeg is the caller's job — the queue records intent, it does not
 * kill processes.
 */
export function cancel(items: QueueItem[], id: string): QueueItem[] {
  return (items ?? []).map((i) =>
    i && i.id === id && (i.state === 'waiting' || i.state === 'rendering')
      ? { ...i, state: 'cancelled' as QueueState, finishedAt: new Date().toISOString() }
      : i
  )
}

/** Puts a failed or cancelled item back in the queue, attempts reset so it gets a fair go. */
export function retry(items: QueueItem[], id: string): QueueItem[] {
  return (items ?? []).map((i) =>
    i && i.id === id && (i.state === 'failed' || i.state === 'cancelled')
      ? { ...i, state: 'waiting' as QueueState, error: undefined, attempts: 0, startedAt: undefined, finishedAt: undefined }
      : i
  )
}

/**
 * Moves a WAITING item up or down.
 *
 * Only among the waiting ones: reordering around the item already rendering would change
 * what "next" means halfway through, and the finished ones are a record, not a plan.
 */
export function reorder(items: QueueItem[], id: string, direction: -1 | 1): QueueItem[] {
  const list = (items ?? []).filter(Boolean)
  const waitingIds = waiting(list).map((i) => i.id)
  const at = waitingIds.indexOf(id)
  if (at < 0) return list
  const to = at + direction
  if (to < 0 || to >= waitingIds.length) return list
  const swapWith = waitingIds[to]
  const a = list.findIndex((i) => i.id === id)
  const b = list.findIndex((i) => i.id === swapWith)
  const out = [...list]
  ;[out[a], out[b]] = [out[b], out[a]]
  return out
}

/** Removes finished, failed and cancelled items. Never touches waiting or rendering. */
export function clearFinished(items: QueueItem[]): QueueItem[] {
  return (items ?? []).filter((i) => i && (i.state === 'waiting' || i.state === 'rendering'))
}

export interface QueueSummary {
  waiting: number
  rendering: number
  done: number
  failed: number
  cancelled: number
  headline: string
}

export function summarise(items: QueueItem[]): QueueSummary {
  const list = (items ?? []).filter(Boolean)
  const count = (s: QueueState): number => list.filter((i) => i.state === s).length
  const w = count('waiting')
  const r = count('rendering')
  const d = count('done')
  const f = count('failed')
  const c = count('cancelled')

  let headline: string
  if (!list.length) headline = 'Nothing in the queue. Add a video and you can walk away.'
  else if (r) {
    const now = current(list)!
    headline = `Rendering "${now.title}"${w ? `, then ${w} more` : ' — the last one'}.`
  } else if (w) headline = `${w} waiting. They will start one after another.`
  else if (f) {
    headline = `All finished — ${d} built, ${f} failed. The failures are still here with their reasons, and can be tried again.`
  } else if (d) headline = `All ${d} built. Nothing left waiting.`
  else headline = `${c} cancelled, nothing waiting.`

  return { waiting: w, rendering: r, done: d, failed: f, cancelled: c, headline }
}
