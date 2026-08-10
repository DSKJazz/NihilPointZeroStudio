/**
 * Works through the render queue, one video at a time, surviving failures.
 *
 * The queue rules live in `shared/renderQueue.ts` and are pure and tested. This file is the
 * part that cannot be pure: it reads and writes the queue file, calls the builder, and
 * keeps going.
 *
 * THE ONE THING IT MUST GET RIGHT
 * A failure moves to the next item. That is the whole reason the queue exists — the
 * existing batch loses everything after the item that failed, and a queue you walked away
 * from that stops at the first bad script has cost you the night rather than saved it. So
 * every build is wrapped, the error is written down against that item, and the loop
 * continues. There is no path out of the loop except an empty queue.
 *
 * WHY THE STATE IS WRITTEN TO DISK AFTER EVERY TRANSITION
 * Because the point is surviving the app closing. A queue held in memory and saved at the
 * end is a queue that loses everything to a power cut, which is precisely the two-hour
 * unattended run this is for.
 */

import { listRenderQueue, saveRenderQueue } from './store'
import { finish, nextUp, recoverInterrupted, start, type QueueItem } from '../shared/renderQueue'

export interface RunnerHooks {
  /** Builds one item. Rejecting is expected and handled — it must not be caught inside. */
  build: (item: QueueItem, onProgress: (stage: string) => void) => Promise<{ videoId?: string }>
  /** Called after every change, so the UI can follow along. */
  onChange?: (items: QueueItem[]) => void
  onProgress?: (item: QueueItem, stage: string) => void
}

let running = false

/** True while the runner is working through the queue. */
export function isRunning(): boolean {
  return running
}

/**
 * Picks up anything left mid-render by a crash or a close.
 *
 * Called once at startup, BEFORE the runner starts, so an interrupted item is back in the
 * queue in time to be the next thing picked up.
 */
export function recoverQueueOnStartup(): { recovered: number; items: QueueItem[] } {
  const { items, recovered } = recoverInterrupted(listRenderQueue())
  if (recovered) saveRenderQueue(items)
  return { recovered, items }
}

/**
 * Runs until the queue has nothing left waiting.
 *
 * Safe to call repeatedly — a second call while one is already running returns
 * immediately, so "add to queue" can always call it without checking.
 */
export async function runQueue(hooks: RunnerHooks): Promise<void> {
  if (running) return
  running = true
  try {
    for (;;) {
      const item = nextUp(listRenderQueue())
      if (!item) return

      let items = start(listRenderQueue(), item.id)
      saveRenderQueue(items)
      hooks.onChange?.(items)

      try {
        const result = await hooks.build(item, (stage) => hooks.onProgress?.(item, stage))
        items = finish(listRenderQueue(), item.id, { videoId: result?.videoId })
      } catch (err) {
        // The whole point. One item's failure is recorded against that item and the loop
        // carries on to the next one.
        items = finish(listRenderQueue(), item.id, {
          error: err instanceof Error ? err.message : 'The render failed for a reason it did not give.'
        })
      }
      // Re-read before writing: the user may have cancelled or reordered the rest while
      // this one was rendering, and overwriting the file with a stale copy would undo that.
      saveRenderQueue(items)
      hooks.onChange?.(items)
    }
  } finally {
    running = false
  }
}
