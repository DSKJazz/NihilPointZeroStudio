/**
 * The credit check before you publish.
 *
 * WHAT THIS IS NOT
 * It is not a copyright detector. Nothing running on your PC can tell you whether a piece
 * of audio is claimed — that answer lives in YouTube's Content ID database and nowhere
 * else, and any tool that says otherwise is guessing. Pretending to know would be worse
 * than saying nothing, because you would trust it and upload.
 *
 * WHAT IT IS
 * A check of the PAPERWORK for the things the app actually knows about. When you pick
 * music through the app, the app already knows its licence and whether that licence
 * obliges you to credit the artist. Nothing was checking whether that credit actually
 * made it into your description — and a missing credit on a CC-BY track is precisely what
 * turns a free track into a claim. That is a real, expensive, entirely avoidable failure,
 * and it is checkable.
 *
 * AND IT SAYS WHEN IT CANNOT VOUCH
 * Music you dragged in from your own disk has no licence the app can see. It does not
 * guess and it does not stay quiet: it says the provenance is unknown, which is the
 * honest answer and the one that makes you think for two seconds before uploading.
 */

/** Something that went into the video and may need crediting. */
export interface CreditedItem {
  /** What it is, for the user: "Sunset Drive" or "market floor b-roll". */
  title: string
  kind: 'music' | 'footage' | 'image' | 'sound effect'
  /** As the source stated it: 'Pixabay', 'CC0', 'BY', 'BY-SA'. Empty = unknown. */
  license?: string
  /** True when the licence obliges a credit. */
  requiresCredit?: boolean
  artist?: string
  /** Where it came from, when the app fetched it. */
  source?: string
  url?: string
  /** True when the user supplied the file themselves, so the app knows nothing about it. */
  userSupplied?: boolean
}

export type RiskLevel = 'clear' | 'credit-needed' | 'unknown'

export interface ItemVerdict {
  item: CreditedItem
  risk: RiskLevel
  /** The exact credit line this item needs, or '' when none is required. */
  creditLine: string
  /** True when the credit is required AND already present in the description. */
  creditPresent: boolean
  note: string
}

export interface CopyrightReport {
  verdicts: ItemVerdict[]
  /** Items that need a credit which is NOT in the description. The actual claim risk. */
  missingCredits: ItemVerdict[]
  /** Items whose licence the app cannot see at all. */
  unknown: ItemVerdict[]
  /** The credits block to paste, containing only what is genuinely required. */
  creditsBlock: string
  /** False when something needs a credit that is not there yet. */
  ok: boolean
  headline: string
}

/** Licences that need no credit at all. Anything else is treated as needing one. */
const NO_CREDIT_NEEDED = /^(?:pixabay|pexels|cc0|public\s*domain|unsplash|zero)/i

/** Licences that specifically oblige attribution. */
const CREDIT_REQUIRED = /\b(?:by|by-sa|by-nc|by-nd|attribution)\b/i

/**
 * Does this licence oblige a credit?
 *
 * An unrecognised licence is treated as REQUIRING one. The asymmetry is deliberate:
 * crediting something that did not need it costs one line in a description, and failing
 * to credit something that did can cost the video.
 */
export function needsCredit(item: CreditedItem): boolean {
  if (item.requiresCredit !== undefined) return item.requiresCredit
  const l = (item.license ?? '').trim()
  if (!l) return false // no licence at all is 'unknown', handled separately
  if (NO_CREDIT_NEEDED.test(l)) return false
  if (CREDIT_REQUIRED.test(l)) return true
  return true
}

/** The credit line for an item, in the form these licences ask for. */
export function creditLine(item: CreditedItem): string {
  const bits: string[] = [`"${item.title}"`]
  if (item.artist) bits.push(`by ${item.artist}`)
  if (item.license) bits.push(`(${item.license})`)
  if (item.url) bits.push(`— ${item.url}`)
  return bits.join(' ')
}

/**
 * Is this credit already in the description?
 *
 * Matched on the TITLE and, when known, the artist — not on the whole formatted line,
 * because the user will have typed it their own way and a strict match would report every
 * credit they wrote by hand as missing. That would train them to ignore the check.
 */
export function creditIsPresent(item: CreditedItem, description: string): boolean {
  const d = (description ?? '').toLowerCase()
  if (!d) return false
  const title = (item.title ?? '').trim().toLowerCase()
  if (!title) return false
  if (!d.includes(title)) return false
  const artist = (item.artist ?? '').trim().toLowerCase()
  // When the artist is known, the credit must name them — naming only the track is not a
  // credit, and it is the half-done version people actually write.
  return artist ? d.includes(artist) : true
}

export function checkCopyright(items: CreditedItem[], description: string): CopyrightReport {
  const verdicts: ItemVerdict[] = []
  for (const item of items ?? []) {
    if (!item || typeof item.title !== 'string' || !item.title.trim()) continue
    const unknownProvenance = item.userSupplied === true || !(item.license ?? '').trim()
    const required = !unknownProvenance && needsCredit(item)
    const present = required ? creditIsPresent(item, description) : false
    const line = required ? creditLine(item) : ''

    let risk: RiskLevel
    let note: string
    if (unknownProvenance) {
      risk = 'unknown'
      note = item.userSupplied
        ? 'You added this yourself, so the app knows nothing about its licence. Only you know whether you have the right to use it — the app will not guess, and it cannot tell you whether YouTube will claim it.'
        : 'No licence recorded for this, so nothing can be confirmed about it.'
    } else if (required && !present) {
      risk = 'credit-needed'
      note = 'This licence obliges you to credit it, and the credit is not in your description. That is what turns a free track into a claim.'
    } else if (required) {
      risk = 'clear'
      note = 'Credit required, and it is already in your description.'
    } else {
      risk = 'clear'
      note = `${item.license} needs no credit — safe on a monetised video.`
    }
    verdicts.push({ item, risk, creditLine: line, creditPresent: present, note })
  }

  const missingCredits = verdicts.filter((v) => v.risk === 'credit-needed')
  const unknown = verdicts.filter((v) => v.risk === 'unknown')

  // Only what is genuinely required goes in the block. Listing things that need no credit
  // pads the description and makes the real credits easier to skip over.
  const needed = verdicts.filter((v) => v.creditLine)
  const creditsBlock = needed.length ? ['Credits:', ...needed.map((v) => v.creditLine)].join('\n') : ''

  let headline: string
  if (!verdicts.length) headline = 'Nothing to check — no music, footage or images recorded for this video.'
  else if (missingCredits.length) {
    headline =
      `${missingCredits.length} thing${missingCredits.length === 1 ? '' : 's'} need${missingCredits.length === 1 ? 's' : ''} ` +
      `a credit that is not in your description yet. Paste the block below before you publish.`
  } else if (unknown.length) {
    headline =
      `Credits are in order for everything the app knows about. ${unknown.length} item${unknown.length === 1 ? '' : 's'} ` +
      `came from you, so only you can say whether it is cleared — the app cannot check that, and neither can it tell you ` +
      `whether YouTube will claim it.`
  } else {
    headline = `All ${verdicts.length} item${verdicts.length === 1 ? '' : 's'} are cleared and credited where required.`
  }

  return {
    verdicts,
    missingCredits,
    unknown,
    creditsBlock,
    // Unknown provenance does NOT fail the check: the user may well own the file, and
    // blocking them from publishing their own music would be the tool overreaching.
    ok: missingCredits.length === 0,
    headline
  }
}
