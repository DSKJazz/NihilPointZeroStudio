/**
 * "Am I up to date?" — answered out loud, on demand.
 *
 * WHY THIS EXISTS
 * The update banner only ever appears when the app is BEHIND. When it is current the app
 * says nothing at all — and "nothing at all" is exactly what a broken check looks like
 * too. So a user who has just updated cannot tell success from failure, and the only
 * honest thing they can conclude is that it might be broken. That is not a documentation
 * problem, it is a missing signal, and this module is the signal.
 *
 * It reports four states, and each one names a different thing the user might do:
 *   'current'    — nothing to do, and it says so plainly with when it checked.
 *   'behind'     — an update exists; the button is right there.
 *   'unknown'    — the check could not run (offline, rate-limited). NOT reported as
 *                  "up to date", because saying "you're fine" when you did not look is
 *                  the single worst thing this screen could do.
 *   'ahead'      — the running build is NEWER than the published one. Happens on the
 *                  development PC right after a local build, and it is worth naming
 *                  rather than showing as "behind" and sending someone to download an
 *                  older copy of their own work.
 *
 * Pure and tested; the caller supplies the two build tags.
 */
import { tagDate } from './updateCheck'

export type UpdateState = 'current' | 'behind' | 'ahead' | 'unknown'

export interface UpdateStatus {
  state: UpdateState
  /** The build actually running (the same string as the sidebar badge). */
  runningTag: string
  /** The build on the download page, when it could be read. */
  publishedTag: string | null
  /** One line, plain English, safe to show as-is. */
  message: string
}

/** Same 2-minute slack as isNewer: the self-stamp and the ship stamp of the SAME build
 * can differ by a few seconds, and that must never read as a difference. */
const SLACK_MS = 2 * 60_000

export function describeUpdateStatus(runningTag: string, publishedTag: string | null): UpdateStatus {
  const running = tagDate(runningTag)
  const published = publishedTag ? tagDate(publishedTag) : null

  if (published === null || running === null) {
    return {
      state: 'unknown',
      runningTag,
      publishedTag: publishedTag ?? null,
      // Deliberately not "you are up to date". Never claim a result that was not obtained.
      message: 'Could not read the latest published version from GitHub right now. Try again in a minute.'
    }
  }

  const diff = published - running
  if (diff > SLACK_MS) {
    return {
      state: 'behind',
      runningTag,
      publishedTag,
      message: 'A newer version is available. Press "Get the update" and the app does the rest.'
    }
  }
  if (diff < -SLACK_MS) {
    return {
      state: 'ahead',
      runningTag,
      publishedTag,
      message: 'You are running a build that is newer than the published one — nothing to do.'
    }
  }
  return {
    state: 'current',
    runningTag,
    publishedTag,
    message: 'You are up to date. This is the newest version there is.'
  }
}
