/**
 * Checks the things that actually waste an hour, BEFORE the hour is spent.
 *
 * WHAT WAS WRONG
 * `health.ts` tests the network — internet, the free AI service, paid keys, Ollama —
 * and then checks that the models FOLDER exists. That is a real check of the wrong
 * things. None of it touches the render pipeline, so the failures that cost the most
 * are the ones nothing looks for:
 *
 *   - ffmpeg missing or quarantined by antivirus (this has genuinely happened here)
 *   - the work folder read-only, so twenty minutes of rendering has nowhere to land
 *   - no disk space, discovered at the final mux
 *   - a hardware encoder that lists but does not work
 *
 * Every one of those is found by the app today only when it is already rendering. A
 * ninety-second check that runs first is worth an hour that does not get thrown away.
 *
 * WHY IT IS SEPARATE FROM health.ts
 * Two reasons, both from the audit of the existing code:
 *
 *   1. health.ts makes six NETWORK calls including a real POST to the free AI service
 *      and authenticated requests to Anthropic and OpenAI. Running that before every
 *      build would multiply those requests and could trip the very rate limits the
 *      checks warn about. These checks are entirely local and take about a second.
 *
 *   2. health.ts's verdict drives the red dot on the sidebar, and it already has two
 *      writers (the manual run and the weekly one). Adding a third would silently
 *      reset the weekly timer and make that dot appear and vanish for reasons the user
 *      never triggered. So this writes nothing shared. It reports, and the caller
 *      decides.
 */
import { existsSync, mkdirSync, rmSync, statfsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { HealthCheck } from '../shared/types'

/** Below this a long render will run out part-way through. */
export const REFUSE_BELOW_MB = 500

/** Below this it will probably finish, but it is worth saying so first. */
export const WARN_BELOW_MB = 2048

export interface PreflightReport {
  checks: HealthCheck[]
  /** Something that WILL break this job. */
  fatal: HealthCheck[]
  /** Something worth knowing that will probably still work. */
  warnings: HealthCheck[]
  /** Safe to start a long render. */
  ok: boolean
  headline: string
}

/**
 * The fix is folded into `detail` rather than carried in its own field.
 *
 * `HealthCheck` (shared/types.ts) has exactly name/status/detail, and the existing
 * Settings health list renders that. Adding a `fix` field would mean either a second
 * piece of UI to show it — which the audit specifically warned would drift from the
 * first — or a field nothing displays. One field, one renderer, no drift.
 */
function ok(name: string, detail: string): HealthCheck {
  return { name, status: 'ok', detail }
}
function warn(name: string, detail: string, fix?: string): HealthCheck {
  return { name, status: 'warn', detail: fix ? `${detail} ${fix}` : detail }
}
function fail(name: string, detail: string, fix?: string): HealthCheck {
  return { name, status: 'fail', detail: fix ? `${detail} ${fix}` : detail }
}

/** Free megabytes, or null when the platform will not say. */
export function freeDiskMB(dir: string): number | null {
  try {
    const s = statfsSync(dir)
    return Math.floor((Number(s.bsize) * Number(s.bavail)) / (1024 * 1024))
  } catch {
    return null
  }
}

export function checkDiskSpace(dir: string): HealthCheck {
  const free = freeDiskMB(dir)
  if (free === null) return warn('Disk space', 'Could not read the free space on your work drive.')
  const gb = (free / 1024).toFixed(1)
  if (free < REFUSE_BELOW_MB) {
    return fail(
      'Disk space',
      `Only ${gb} GB free. A long render needs more room than that and would stop part-way.`,
      'Free up space, or move your work folder to a bigger drive in Settings.'
    )
  }
  if (free < WARN_BELOW_MB) {
    return warn('Disk space', `${gb} GB free — enough for a short video, tight for a long one.`, 'Free up a few GB before a feature-length build.')
  }
  return ok('Disk space', `${gb} GB free on your work drive.`)
}

/**
 * Can the work folder actually be WRITTEN to?
 *
 * `existsSync` is not this check. A folder on a disconnected drive, a read-only mount,
 * or one a security tool has locked all exist perfectly happily and then refuse the
 * first write — twenty minutes into the render, with nowhere to put the result.
 */
export function checkWorkFolderWritable(dir: string): HealthCheck {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.npz-write-test-${process.pid}`)
    writeFileSync(probe, 'ok')
    rmSync(probe, { force: true })
    return ok('Work folder', 'Your work folder is there and can be written to.')
  } catch (err) {
    return fail(
      'Work folder',
      `Cannot write to your work folder: ${err instanceof Error ? err.message : 'unknown error'}`,
      'Check the drive is connected, and that antivirus is not blocking the folder. Settings shows where it is.'
    )
  }
}

/**
 * Does ffmpeg actually RUN?
 *
 * Not "is the file there" — antivirus quarantine leaves a file in place that refuses to
 * execute, and that has already cost real time on this project. `runVersion` is injected
 * so this is testable without spawning anything.
 */
export async function checkFfmpeg(runVersion: () => Promise<string>): Promise<HealthCheck> {
  try {
    const out = await runVersion()
    const version = /ffmpeg version (\S+)/.exec(out)?.[1]
    if (!version) {
      return warn('Video engine', 'ffmpeg ran but did not report a version.', 'Probably fine. If renders fail, reinstall the app.')
    }
    return ok('Video engine', `ffmpeg ${version} is working.`)
  } catch (err) {
    return fail(
      'Video engine',
      `ffmpeg will not run: ${err instanceof Error ? err.message : 'unknown error'}`,
      'Antivirus has most likely quarantined it. Allow the app folder, then reinstall.'
    )
  }
}

/** Which encoder renders will use — a warning, never a failure, since software always works. */
export async function checkEncoder(detect: () => Promise<string>): Promise<HealthCheck> {
  try {
    const encoder = await detect()
    if (encoder === 'libx264') {
      return warn(
        'Render speed',
        'No graphics-card encoder found, so renders use the processor — several times slower.',
        'Usually a graphics driver that needs updating. Renders still work.'
      )
    }
    return ok('Render speed', `Using your graphics card (${encoder}) — several times faster than the processor.`)
  } catch {
    return warn('Render speed', 'Could not work out which encoder to use; renders will use the processor.')
  }
}

/**
 * The whole local check. Deliberately no network: see the note at the top of the file.
 *
 * Dependencies are injected rather than imported so this is testable without ffmpeg,
 * a GPU, or a real disk — the three things a test machine reliably does not have.
 */
export async function runPreflight(deps: {
  workDir: string
  runFfmpegVersion: () => Promise<string>
  detectEncoder: () => Promise<string>
}): Promise<PreflightReport> {
  const checks: HealthCheck[] = [
    checkWorkFolderWritable(deps.workDir),
    checkDiskSpace(deps.workDir),
    await checkFfmpeg(deps.runFfmpegVersion),
    await checkEncoder(deps.detectEncoder)
  ]
  const fatal = checks.filter((c) => c.status === 'fail')
  const warnings = checks.filter((c) => c.status === 'warn')
  return {
    checks,
    fatal,
    warnings,
    ok: fatal.length === 0,
    headline: describe(fatal, warnings)
  }
}

function describe(fatal: HealthCheck[], warnings: HealthCheck[]): string {
  if (fatal.length) {
    // Name the first problem and its fix. A generic "checks failed" makes the user hunt.
    return `Cannot start: ${fatal[0].detail}`
  }
  if (warnings.length) {
    return `Ready to render, with ${warnings.length} thing${warnings.length === 1 ? '' : 's'} worth knowing: ${warnings
      .map((w) => w.name.toLowerCase())
      .join(', ')}.`
  }
  return 'Everything checks out — safe to start a long render.'
}
