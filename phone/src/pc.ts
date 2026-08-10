/**
 * Talking to the studio on the PC.
 *
 * Everything that needs the studio's PROMPT WORDING goes through here. The phone app
 * is hosted publicly, so anything bundled into it is readable by anyone — and the
 * prompts are the most valuable part of the studio. So the phone now sends plain
 * parameters ("focus area", "topic", "length") and the PC, which is private, owns the
 * wording and sends back only the finished text.
 *
 * Reachable from home Wi-Fi, or from anywhere over a private VPN (Tailscale) — the
 * link the studio shows already carries its own access key.
 */
import { getPcLink } from './store'

export class PcUnreachableError extends Error {}
export class PcNotConfiguredError extends Error {}

/** How long to wait. A feature-length script legitimately takes minutes on the PC. */
const TIMEOUT_MS = 5 * 60_000

interface PcTarget {
  origin: string
  token: string
}

function target(): PcTarget {
  const raw = getPcLink().trim()
  if (!raw) {
    throw new PcNotConfiguredError(
      'Connect your PC first: in the studio go to Settings → Phone access, then scan the code or paste the link into this app\'s Settings.'
    )
  }
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new PcNotConfiguredError('That PC link does not look like a web address. Copy it again from the studio.')
  }
  const token = url.searchParams.get('t')
  if (!token) throw new PcNotConfiguredError('That PC link is missing its key — copy the whole link from the studio.')
  return { origin: url.origin, token }
}

/** True when a PC link has been saved, so the UI can grey out what needs it. */
export function pcConfigured(): boolean {
  try {
    target()
    return true
  } catch {
    return false
  }
}

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const { origin, token } = target()
  let res: Response
  try {
    res = await fetch(`${origin}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Token': token, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    throw new PcUnreachableError(
      timedOut
        ? 'Your PC took too long to answer. Is the studio still open?'
        : 'Could not reach your PC. Check it is switched on, the studio is open, and phone access is turned on.'
    )
  }
  if (res.status === 401) {
    throw new PcUnreachableError('Your PC refused the key. Turn phone access off and on, then copy the new link.')
  }
  if (res.status === 429) {
    throw new PcUnreachableError('Your PC is rate-limiting requests. Wait a minute and try again.')
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new PcUnreachableError(body.error || `Your PC answered ${res.status}.`)
  }
  return (await res.json()) as T
}

function post<T>(path: string, body: unknown): Promise<T> {
  return call<T>(path, { method: 'POST', body: JSON.stringify(body) })
}

/** A quick round-trip, for the "test my PC connection" button. */
export async function ping(): Promise<{ ok: true; libraryItems: number }> {
  const items = await call<unknown[]>('/api/library', { method: 'GET' })
  return { ok: true, libraryItems: Array.isArray(items) ? items.length : 0 }
}

export interface PcIdea {
  title: string
  hook: string
  angle: string
  viewPotentialScore: number
  viewPotentialReason: string
  competitionLevel: 'low' | 'medium' | 'high'
  contentPillars: string[]
  suggestedLength: string
}

export function generateIdeas(body: { focusArea: string; audienceNote?: string; count: number }): Promise<PcIdea[]> {
  return post<PcIdea[]>('/api/ideas', body)
}

export function generateScript(body: {
  topic: string
  length: string
  languageMix: string
  styles?: string[]
}): Promise<{ title: string; body: string; estimatedWordCount?: number; estimatedDurationMinutes?: number }> {
  return post('/api/script', body)
}

export function generateThumbnail(body: { topic: string; title: string }): Promise<{ brief: string }> {
  return post('/api/thumbnail', body)
}

export function directStoryboard(body: {
  mode: 'auto' | 'guided'
  title: string
  brief: string
  totalSeconds?: number
  language?: string
  width: number
  height: number
}): Promise<unknown> {
  return post('/api/storyboard', body)
}

export function sceneImage(body: {
  style: string
  visual: string
  title: string
  width: number
  height: number
  seed: number
}): Promise<{ url: string }> {
  return post('/api/scene-image', body)
}

export interface PcStyle {
  id: string
  label: string
  family: string
}

export function listStyles(): Promise<PcStyle[]> {
  return call<PcStyle[]>('/api/styles', { method: 'GET' })
}

export function pushProject(json: string): Promise<{ scenes: number; needMedia: number; warnings?: string[] }> {
  return call('/api/project', { method: 'POST', body: json })
}

/**
 * The Advisor streams, so it can't use the JSON helper. Falls back to reporting a
 * clear error rather than a half-written answer.
 */
export async function advisorStream(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onDelta: (chunk: string) => void
): Promise<string> {
  const { origin, token } = target()
  let res: Response
  try {
    res = await fetch(`${origin}/api/advisor`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch {
    throw new PcUnreachableError('Could not reach your PC. Check the studio is open and phone access is on.')
  }
  if (!res.ok) throw new PcUnreachableError(`Your PC answered ${res.status}.`)

  const reader = res.body?.getReader()
  if (!reader) {
    const text = await res.text()
    onDelta(text)
    return text
  }
  const decoder = new TextDecoder()
  let full = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    full += chunk
    onDelta(chunk)
  }
  return full
}
