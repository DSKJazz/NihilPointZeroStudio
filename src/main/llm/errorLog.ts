/**
 * Plain-text, append-only log of every AI failure — the evidence trail.
 *
 * Why this exists: when the free AI brain started failing in July 2026, nothing
 * anywhere recorded WHY. The resilient chain retried silently, the activity log
 * was never touched for free->free retries, and the health check pinged a
 * different endpoint than the one actually breaking. The failure was invisible,
 * so it looked like "the AI just stops responding" with no way to prove otherwise.
 *
 * Deliberately NOT modelled on logActivity(): that rewrites its whole JSON array
 * on every call, which is the wrong shape for high-frequency error logging. This
 * is a real append (appendFileSync) with size-capped rotation.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AiErrorEntry } from '../../shared/types'

export type { AiErrorEntry }

/** Past this size the log rotates to .1 so it can never grow without bound. */
const MAX_BYTES = 512 * 1024
/** Response bodies are truncated — enough to diagnose, not enough to bloat the file. */
const MAX_BODY = 600

function logsDir(): string {
  const dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

export function aiErrorLogPath(): string {
  return join(logsDir(), 'ai-errors.log')
}

function rotateIfBig(file: string): void {
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, `${file}.1`)
  } catch {
    // rotation is best-effort; never let it break the actual logging
  }
}

/** Records one AI failure. Never throws — logging must not create a second failure. */
export function logAiError(entry: AiErrorEntry): void {
  try {
    const file = aiErrorLogPath()
    rotateIfBig(file)
    const parts = [
      entry.at,
      `provider=${entry.provider}`,
      `feature=${entry.feature}`,
      entry.status !== undefined ? `status=${entry.status}` : 'status=-',
      entry.ms !== undefined ? `ms=${entry.ms}` : 'ms=-',
      `msg=${entry.message.replace(/\s+/g, ' ')}`
    ]
    if (entry.body) parts.push(`body=${entry.body.replace(/\s+/g, ' ').slice(0, MAX_BODY)}`)
    appendFileSync(file, `${parts.join(' | ')}\n`, 'utf-8')
  } catch {
    // disk full / permissions — silently give up rather than break the AI call
  }
}

/** Most recent entries first, for the Known Issues panel. */
export function readAiErrors(limit = 100): AiErrorEntry[] {
  try {
    const raw = readFileSync(aiErrorLogPath(), 'utf-8')
    const lines = raw.split('\n').filter((l) => l.trim())
    return lines
      .slice(-limit)
      .reverse()
      .map(parseLine)
      .filter((e): e is AiErrorEntry => e !== null)
  } catch {
    return []
  }
}

function parseLine(line: string): AiErrorEntry | null {
  const parts = line.split(' | ')
  if (parts.length < 6) return null
  const field = (prefix: string): string | undefined => {
    const hit = parts.find((p) => p.startsWith(prefix))
    return hit ? hit.slice(prefix.length) : undefined
  }
  const status = field('status=')
  const ms = field('ms=')
  return {
    at: parts[0],
    provider: field('provider=') ?? '?',
    feature: field('feature=') ?? '?',
    status: status && status !== '-' ? Number(status) : undefined,
    ms: ms && ms !== '-' ? Number(ms) : undefined,
    message: field('msg=') ?? '',
    body: field('body=')
  }
}
