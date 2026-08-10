/**
 * THE CARETAKER — the studio looks after itself on a schedule, out loud.
 *
 * HIS INSTRUCTION (2026-08-07): something that "runs as some sort of diagnostic...
 * and if it finds something broken or something that should be fixed, it fixes it...
 * keeps a record, and whenever I go to that specific section I see if it's working,
 * what it's working on, what's its schedule. I should also have the power to change
 * the schedule, but it should also state what's the recommended schedule by you and
 * why... and I should have the power to delete it [the record]."
 *
 * WHAT A PASS DOES, honestly scoped:
 *   1. Runs the same LIVE health checks as Settings → "Run full check" and stores the
 *      verdict (the red Settings badge reads from it).
 *   2. Rescues a dead brain: if the active AI has refused permanently, switch to a
 *      free, local one — the same rescue that already runs at startup, now recurring.
 *   3. Looks for finished videos the app has lost track of, and says so.
 *   4. Writes one plain line to the Activity Log when something was found or fixed.
 * What it can fix is settings, state and stuck services. It cannot rewrite its own
 * code — saying otherwise would be a lie, and this app does not lie about itself.
 *
 * THE SCHEDULE, and why 6 hours is the recommendation: at every app start (when stale
 * state actually bites) and then every 6 hours while the app stays open — often enough
 * that a service dying in the morning is caught the same day, rare enough to cost the
 * CPU nothing. It NEVER runs during a render: the one rule that does not bend is that
 * the user's work is never put at risk, and a diagnostic is never worth a dropped frame.
 * A pass skipped for busyness is recorded as skipped, not silently absent — "I could
 * not tell" is always a distinct, visible outcome here.
 */
import { app } from 'electron'
import { readFileSync, writeFileSync, rmSync, renameSync } from 'fs'
import { join } from 'path'
import { runHealthCheck } from './health'
import { getOllamaStatus } from './llm/ollama'
import { isProviderDead } from './llm/deadProviders'
import { rescueMessage, rescueTarget } from './llm/rescueBrain'
import { scanStranded } from './strandedData'
import {
  getCaretakerSchedule,
  getSettings,
  logActivity,
  setActiveProvider,
  setCaretakerSchedule,
  setLastHealth
} from './store'
import { broadcastAiFallback } from './notify'

import { appendRun, RECOMMENDED_HOURS, RECOMMENDED_WHY, type CaretakerRun, type CaretakerStatus } from '../shared/caretaker'

export type { CaretakerRun, CaretakerStatus }

function logPath(): string {
  return join(app.getPath('userData'), 'caretaker-log.json')
}

export function readCaretakerLog(): CaretakerRun[] {
  try {
    const runs = JSON.parse(readFileSync(logPath(), 'utf-8'))
    return Array.isArray(runs) ? runs : []
  } catch {
    return []
  }
}

function writeCaretakerLog(runs: CaretakerRun[]): void {
  // Atomic, same as every other user-visible record in this app.
  const tmp = `${logPath()}.tmp`
  writeFileSync(tmp, JSON.stringify(runs, null, 2), 'utf-8')
  renameSync(tmp, logPath())
}

/** Only the user clears the record — his rule, same as the Activity Log. */
export function clearCaretakerLog(): void {
  rmSync(logPath(), { force: true })
}

/**
 * One caretaker pass. `busy()` is injected so the render/queue check stays where it
 * lives (main/index.ts) without a circular import.
 */
export async function runCaretakerPass(trigger: CaretakerRun['trigger'], busy: () => boolean): Promise<CaretakerRun> {
  const at = new Date().toISOString()
  if (busy()) {
    const run: CaretakerRun = { at, trigger, outcome: 'busy', problems: [], fixed: [], notes: ['A render was in progress, so nothing was touched. The next scheduled pass will try again.'] }
    writeCaretakerLog(appendRun(readCaretakerLog(), run))
    return run
  }

  const fixed: string[] = []
  const notes: string[] = []
  let problems: string[] = []

  // 1. The live health check — same one as the Settings button, verdict stored so the
  //    red badge stays honest.
  try {
    const report = await runHealthCheck()
    problems = report.checks.filter((c) => c.status === 'fail').map((c) => c.name)
    setLastHealth(problems)
  } catch {
    notes.push('The health check itself could not run — nothing is known about the services this pass.')
  }

  // 2. Dead-brain rescue — recurring, not just at startup. Free/local targets only.
  try {
    const active = getSettings().activeProvider
    if (isProviderDead(active)) {
      const target = rescueTarget({
        activeProvider: active,
        activeIsPermanentlyDead: true,
        ollamaAvailable: (await getOllamaStatus()).connected,
        freeAvailable: active !== 'free'
      })
      if (target) {
        setActiveProvider(target)
        const message = rescueMessage(active, target)
        logActivity('ai', 'Caretaker switched your AI brain', message)
        broadcastAiFallback({ provider: active, detail: message })
        fixed.push(`Moved the AI brain off a dead service (${active} → ${target}).`)
      }
    }
  } catch {
    notes.push('Could not check whether the AI brain needed rescuing.')
  }

  // 3. Finished videos the app has lost track of. Found, not moved: copying files
  //    around is a user decision, and the Settings button that does it is one click.
  try {
    const stranded = await scanStranded()
    if (stranded.videoCount > 0) {
      notes.push(
        `Found ${stranded.videoCount} finished video(s) the app is not showing (${stranded.size}). ` +
          'Settings → "Where your work is kept" has the one-click button that brings them back in.'
      )
    }
  } catch {
    /* a scan that cannot run is not a finding */
  }

  const run: CaretakerRun = { at, trigger, outcome: 'done', problems, fixed, notes }
  writeCaretakerLog(appendRun(readCaretakerLog(), run))

  // One plain line when there is anything to say; silence when all is well would hide
  // the record, but a log line for "everything fine" every 6 hours is noise — the
  // caretaker's own section shows the healthy runs.
  if (problems.length || fixed.length) {
    logActivity(
      'ai',
      `Caretaker: ${problems.length ? `${problems.length} problem(s) found` : 'all services healthy'}${fixed.length ? `, ${fixed.length} thing(s) fixed` : ''}`,
      [...fixed, ...problems.map((p) => `${p} is failing`)].join(' · ') || undefined
    )
  }
  return run
}

let timer: NodeJS.Timeout | null = null

/** When the next scheduled pass fires, or null while paused. */
let nextRunAt: string | null = null

export function caretakerStatus(): CaretakerStatus {
  const { intervalHours, paused } = getCaretakerSchedule()
  return { runs: readCaretakerLog(), intervalHours, paused, nextRunAt, recommendedHours: RECOMMENDED_HOURS, recommendedWhy: RECOMMENDED_WHY }
}

/**
 * (Re)arms the repeating schedule from the saved settings. Called at startup and after
 * every schedule change, so the timer always reflects what Settings shows.
 */
export function scheduleCaretaker(busy: () => boolean): void {
  if (timer) {
    clearTimeout(timer)
    timer = null
  }
  const { intervalHours, paused } = getCaretakerSchedule()
  if (paused) {
    nextRunAt = null
    return
  }
  const ms = Math.max(1, intervalHours) * 60 * 60 * 1000
  nextRunAt = new Date(Date.now() + ms).toISOString()
  timer = setTimeout(() => {
    void runCaretakerPass('schedule', busy).finally(() => scheduleCaretaker(busy))
  }, ms)
  // A timer must never be the reason the app cannot quit.
  timer.unref?.()
}

/** Settings changes come through here so the running timer always matches. */
export function updateCaretakerSchedule(intervalHours: number, paused: boolean, busy: () => boolean): void {
  setCaretakerSchedule(intervalHours, paused)
  logActivity('user', paused ? 'Paused the Caretaker' : `Set the Caretaker schedule to every ${intervalHours} hour(s)`)
  scheduleCaretaker(busy)
}
