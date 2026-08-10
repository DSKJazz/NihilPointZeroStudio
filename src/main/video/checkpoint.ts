/**
 * Resuming a render that failed, instead of starting from nothing.
 *
 * THE COST THIS REMOVES
 * A twenty-minute render that dies at minute eighteen currently throws away all
 * eighteen. The scratch folder is a random temp directory deleted in a `finally`, so
 * everything expensive goes with it — and the two expensive things are exactly the ones
 * that were already finished:
 *
 *   - the NARRATION. Piper reading a twenty-five-minute script is minutes of CPU, and it
 *     is the very first thing a build does. It is complete before anything that commonly
 *     fails has even started.
 *   - the AI SCENE ASSETS. Generated images and clips are network round-trips, sometimes
 *     one per scene, sometimes on a free tier with an allowance. Regenerating them is not
 *     just slow, it can be genuinely unavailable.
 *
 * THE FAILURE THIS MUST NEVER COMMIT
 * Reusing narration that belongs to a DIFFERENT script. That produces a video whose audio
 * does not match its own words — and nothing about the file looks wrong, so it is found by
 * watching it, or by a viewer. It is far worse than losing eighteen minutes.
 *
 * So the folder is NAMED after a fingerprint of the inputs that produced its contents. A
 * changed script, a changed voice, a changed language means a different fingerprint, which
 * means a different folder, which means the old narration is not even visible to it. The
 * safety does not depend on remembering to check — it is structural.
 *
 * WHY IT IS KEPT ONLY ON FAILURE
 * A successful render has no use for it, and leaving them behind would quietly fill the
 * disk with hundreds of megabytes of narration nobody will listen to again. Kept on
 * failure, deleted on success, and swept after a week in case a failure was never retried.
 */

import { createHash } from 'crypto'
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'fs'
import { join } from 'path'

/** Bumped when the shape of what is stored changes, so old folders are never reused. */
export const CHECKPOINT_VERSION = 1

/** After this long, a leftover checkpoint is swept whether it was retried or not. */
export const KEEP_DAYS = 7

/**
 * Everything that decides what the reusable artifacts CONTAIN.
 *
 * Deliberately narrow. Resolution, template and colour do not appear, because none of
 * them changes the narration or the scene images — including them would throw away a
 * perfectly good narration because the user switched from 1080p to 4K, which is exactly
 * the case where resuming is most valuable.
 */
export interface CheckpointInputs {
  title: string
  body: string
  narrationVoice?: string
  winVoiceId?: string
  /** The look engine, because it decides whether scene assets are generated at all. */
  engine?: string
  style?: string
}

/**
 * A stable fingerprint of the inputs.
 *
 * SHA-256 of the fields, length-prefixed. Length prefixes matter: without them
 * `{title:'ab', body:'c'}` and `{title:'a', body:'bc'}` join to the same string and would
 * share a checkpoint, so one script could inherit the other's narration.
 */
export function renderKey(inputs: CheckpointInputs): string {
  const parts = [
    String(CHECKPOINT_VERSION),
    inputs?.title ?? '',
    inputs?.body ?? '',
    inputs?.narrationVoice ?? '',
    inputs?.winVoiceId ?? '',
    inputs?.engine ?? '',
    inputs?.style ?? ''
  ]
  const canonical = parts.map((p) => `${p.length}:${p}`).join('|')
  return createHash('sha256').update(canonical, 'utf8').digest('hex').slice(0, 16)
}

/** Where a render's reusable pieces live. One folder per fingerprint. */
export function checkpointDir(root: string, key: string): string {
  return join(root, `npz-resume-${key}`)
}

export interface Checkpoint {
  dir: string
  key: string
  /** Files inside it that a fresh attempt can skip re-making. */
  narrationPath: string
  /** True when this folder already existed, i.e. a previous attempt got somewhere. */
  resumed: boolean
}

/**
 * Opens the checkpoint for these inputs, creating it if new.
 *
 * `resumed` is what the caller reports to the user. Being told "picking up where it left
 * off" is the difference between trusting the app after a failure and assuming it is
 * silently redoing everything anyway.
 */
export function openCheckpoint(root: string, inputs: CheckpointInputs): Checkpoint {
  const key = renderKey(inputs)
  const dir = checkpointDir(root, key)
  const resumed = existsSync(dir)
  if (!resumed) mkdirSync(dir, { recursive: true })
  return { dir, key, narrationPath: join(dir, 'narration.wav'), resumed }
}

/**
 * Is this artifact worth reusing?
 *
 * A zero-length file is a half-written one from the moment the process died, and reusing
 * it would produce a silent video — a failure that looks like success. Size is the cheap
 * check that catches it.
 */
export function isReusable(path: string, minBytes = 1024): boolean {
  try {
    return existsSync(path) && statSync(path).size >= minBytes
  } catch {
    return false
  }
}

/** Deletes the checkpoint. Called on SUCCESS — there is nothing left to resume. */
export function discardCheckpoint(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // A locked file here costs some disk and nothing else. Never fail a finished render
    // over cleanup.
  }
}

/** How old a directory is, in days. Infinity when it cannot be read. */
export function ageInDays(path: string, now = Date.now()): number {
  try {
    return (now - statSync(path).mtimeMs) / 86_400_000
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

/**
 * Removes checkpoints nobody came back for.
 *
 * Only ones matching the naming pattern, and only inside the given root — a sweep that
 * could reach anything else would be one bad argument away from deleting a user's videos.
 */
export function sweepOldCheckpoints(root: string, keepDays = KEEP_DAYS, now = Date.now()): number {
  let removed = 0
  try {
    for (const name of readdirSync(root)) {
      if (!/^npz-resume-[0-9a-f]{8,64}$/.test(name)) continue
      const dir = join(root, name)
      if (ageInDays(dir, now) <= keepDays) continue
      discardCheckpoint(dir)
      removed++
    }
  } catch {
    // No root yet, or unreadable. Nothing to sweep.
  }
  return removed
}
