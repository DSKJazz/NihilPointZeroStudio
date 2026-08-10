/**
 * One-at-a-time lock for agent plan execution started from the floating widgets
 * (🎬 Producer and 🧭 Expert). Both widgets stream progress over the SAME un-scoped
 * 'agent:progress' channel, so two concurrent runs would interleave each other's
 * stage lines into the wrong chat (and race two ffmpeg jobs). The lock keeps widget
 * runs serial; the AI Command tab manages its own run state as before.
 */
let running = false

/** Returns true and takes the lock if no widget run is active; false otherwise. */
export function tryAcquireAgentRun(): boolean {
  if (running) return false
  running = true
  return true
}

export function releaseAgentRun(): void {
  running = false
}
