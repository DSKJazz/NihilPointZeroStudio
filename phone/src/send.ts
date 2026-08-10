/**
 * Getting the finished plan out of the phone and into the studio.
 *
 * Three routes, because the user's situation differs:
 *   • Save file  — a download, then move it however they like (Drive, cable, email).
 *   • Share      — the phone's own share sheet: WhatsApp/Drive/Gmail in one tap.
 *   • Wi-Fi      — straight into the PC when they're at home and the studio is running.
 *
 * The plan is checked against the SAME validator the PC uses before any of these, so
 * the user learns about a problem here rather than after the transfer.
 */
import * as P from './project'
import { getPcLink, setPcLink } from './store'

export interface SendResult {
  ok: boolean
  message: string
  warnings: string[]
}

function blob(): Blob {
  return new Blob([P.projectJson()], { type: 'application/json' })
}

/** Triggers a normal browser download. */
export function saveToPhone(): SendResult {
  const warnings = P.selfCheck()
  const url = URL.createObjectURL(blob())
  const a = document.createElement('a')
  a.href = url
  a.download = P.fileName()
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking immediately can cancel the download on some Android builds.
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
  return { ok: true, message: `Saved as ${P.fileName()} — send it to your PC however you like.`, warnings }
}

/**
 * The phone's share sheet. Tries a real file share first (which is what lands the
 * plan in Drive/WhatsApp intact); falls back to a download when files can't be shared.
 */
export async function shareProject(): Promise<SendResult> {
  const warnings = P.selfCheck()
  const file = new File([blob()], P.fileName(), { type: 'application/json' })
  const nav = navigator as Navigator & { canShare?: (d: { files?: File[] }) => boolean }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: P.fileName() })
      return { ok: true, message: 'Sent.', warnings }
    } catch {
      // Dismissing the share sheet is not a failure worth reporting.
      return { ok: true, message: '', warnings }
    }
  }
  const saved = saveToPhone()
  return { ...saved, message: `${saved.message} (Your browser can't share files directly.)`, warnings }
}

/**
 * Pushes straight into the running studio over the LAN. The user pastes the exact
 * link the PC shows in Settings → "Phone access"; it already contains the private key.
 */
export async function pushToPc(link?: string): Promise<SendResult> {
  const raw = (link ?? getPcLink()).trim()
  if (!raw) {
    return {
      ok: false,
      message: 'First paste your PC link in Settings. Get it from the studio: Settings → Phone access (same Wi-Fi).',
      warnings: []
    }
  }
  let base: URL
  try {
    base = new URL(raw)
  } catch {
    return { ok: false, message: 'That PC link does not look like a web address.', warnings: [] }
  }
  const token = base.searchParams.get('t')
  if (!token) {
    return { ok: false, message: 'That link is missing its private key — copy the whole link from the studio.', warnings: [] }
  }
  setPcLink(raw)

  const warnings = P.selfCheck()
  try {
    const res = await fetch(`${base.origin}/api/project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': token },
      body: P.projectJson(),
      signal: AbortSignal.timeout(60_000)
    })
    if (res.status === 401) {
      return { ok: false, message: 'Your PC refused the key. Turn phone access off and on, then copy the new link.', warnings }
    }
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      return { ok: false, message: body.error || `Your PC answered ${res.status}.`, warnings }
    }
    const body = (await res.json()) as { scenes?: number; needMedia?: number; warnings?: string[] }
    const need = body.needMedia
      ? ` ${body.needMedia} scene${body.needMedia === 1 ? '' : 's'} still need a photo — the studio will ask you.`
      : ''
    return {
      ok: true,
      message: `Sent to your PC. Open the Storyboard tab there — ${body.scenes ?? 0} scenes are waiting.${need}`,
      warnings: [...warnings, ...(body.warnings ?? [])]
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    return {
      ok: false,
      message: timedOut
        ? 'Your PC did not answer in time. Is the studio still open?'
        : 'Could not reach your PC. Check you are both on the same Wi-Fi and phone access is turned on.',
      warnings: []
    }
  }
}

/** Opening a plan file back on the phone (e.g. one shared from another device). */
export async function openProjectFile(file: File): Promise<SendResult> {
  try {
    const warnings = P.loadFromFile(JSON.parse(await file.text()))
    return { ok: true, message: 'Plan opened.', warnings }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'That file could not be opened.', warnings: [] }
  }
}
