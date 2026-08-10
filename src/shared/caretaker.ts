/**
 * The Caretaker's shape and pure rules — shared so the desktop window, the phone and
 * the preload bridge all speak the same record without touching main-process code
 * (src/preload may never import from src/main; only the remote typecheck catches it).
 *
 * The whole idea lives in src/main/caretaker.ts; this file is the part of it that is
 * pure: the record's shape, the cap that stops it growing forever, and the recommended
 * schedule with its reason (shown verbatim in Settings, per his instruction that the
 * app must state the recommendation AND why).
 */

export interface CaretakerRun {
  at: string
  trigger: 'start' | 'schedule' | 'manual'
  /** 'done' ran fully; 'busy' skipped because a render was in progress. */
  outcome: 'done' | 'busy'
  /** Names of live checks that FAILED (not warnings). */
  problems: string[]
  /** Actions actually taken, in plain English. */
  fixed: string[]
  /** Findings worth knowing that need the user's hand (nothing was changed). */
  notes: string[]
}

export interface CaretakerStatus {
  runs: CaretakerRun[]
  intervalHours: number
  paused: boolean
  nextRunAt: string | null
  recommendedHours: number
  recommendedWhy: string
}

export const RECOMMENDED_HOURS = 6
export const RECOMMENDED_WHY =
  'Checks at every app start (when stale settings actually bite) and every 6 hours while the app is open — ' +
  'often enough that a service dying in the morning is caught the same day, rare enough to cost your machine ' +
  'nothing. It never runs during a render: your work is never put at risk for a diagnostic.'

export const MAX_RUNS_KEPT = 60

/** Newest first, capped so the record cannot grow forever. */
export function appendRun(existing: CaretakerRun[], run: CaretakerRun): CaretakerRun[] {
  return [run, ...existing].slice(0, MAX_RUNS_KEPT)
}
