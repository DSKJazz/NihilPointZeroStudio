/**
 * ONE DISK IS NOT A BACKUP.
 *
 * The user's videos, scripts and settings exist in exactly one place. The weekly backup
 * copies them to another folder on the SAME laptop, which protects against an accidental
 * delete and against nothing else — a dead drive, a stolen bag or a wiped Windows takes
 * the original and the copy together.
 *
 * This is not hypothetical for him. His own restore log reads:
 *
 *     "Restore done — 8 missing file(s) brought back, 117 were already present."
 *
 * Eight files had already gone missing once. The backup saved them that time because the
 * disk was alive. It will not save anything the day the disk is not.
 *
 * Settings has said "not set — recommended" for weeks and he has never seen it, because he
 * does not open Settings — he has said so plainly. So the reminder has to come to him.
 *
 * WHY THIS NAGS ON A SCHEDULE RATHER THAN ONCE
 * A one-time notice is indistinguishable from no notice for someone who was mid-task when
 * it appeared. But nagging every launch is how people learn to dismiss things without
 * reading them, and then it is worthless on the day it matters. Fortnightly is the
 * compromise: frequent enough to land eventually, rare enough to still be read.
 *
 * WHY IT DOES NOT NAG WHEN THERE IS NOTHING TO LOSE
 * A fresh install has no work in it. Telling someone to protect an empty folder teaches
 * them that this warning is noise, which spends the credibility needed later.
 *
 * Pure and tested; the caller supplies the facts and shows the message.
 */

/** How long between reminders. Long enough to stay readable, short enough to land. */
export const NUDGE_INTERVAL_DAYS = 14

/** Below this, there is not yet enough work to be worth warning about. */
export const MIN_ITEMS_WORTH_PROTECTING = 3

export interface NudgeInputs {
  /** A second home on another disk has been chosen. */
  hasSecondHome: boolean
  /** How many finished videos and scripts exist. */
  workItems: number
  /** When this reminder was last shown, ISO, or null for never. */
  lastNudgedAt: string | null
  /** Now, ISO. */
  nowIso: string
}

/**
 * Should the reminder be shown right now?
 *
 * Every branch is a reason NOT to nag. Being wrong in that direction costs nothing; being
 * wrong the other way trains him to ignore the app.
 */
export function shouldNudge(i: NudgeInputs): boolean {
  if (i.hasSecondHome) return false
  if (i.workItems < MIN_ITEMS_WORTH_PROTECTING) return false
  const now = Date.parse(i.nowIso)
  if (!Number.isFinite(now)) return false
  if (!i.lastNudgedAt) return true
  const last = Date.parse(i.lastNudgedAt)
  // An unreadable or future timestamp is treated as "shown just now" — a clock problem
  // must not turn into nagging on every single launch.
  if (!Number.isFinite(last) || last > now) return false
  return now - last >= NUDGE_INTERVAL_DAYS * 86_400_000
}

/**
 * What he is told. Names the real risk, names the number of things at stake, and asks for
 * one action — not a procedure.
 */
export function nudgeMessage(workItems: number): string {
  return [
    `Your ${workItems} videos and scripts exist on this laptop only.`,
    'The weekly backup copies them to another folder on the SAME disk, so it protects you from an accidental delete but not from a dead drive, a lost laptop, or a wiped Windows.',
    'Plug in a USB stick or an external drive and choose it in Settings → Backups → "Second backup home". After that it copies there by itself and you never think about it again.'
  ].join(' ')
}
