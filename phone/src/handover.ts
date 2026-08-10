/**
 * ONE ICON ON THE PHONE, THE REAL STUDIO WHENEVER THAT IS POSSIBLE.
 *
 * THE CONFUSION THIS EXISTS TO END
 * There are two different things a phone can show, and until now the user had to know
 * which was which and type the right address:
 *
 *   1. THIS app — the hosted one at dskjazz.github.io. Standalone, works on mobile data
 *      with the PC switched off, and does the thinking/writing half: ideas, scripts,
 *      advisor, thumbnail briefs. Six tabs.
 *   2. THE REAL STUDIO — every screen the desktop window has, served BY the PC over the
 *      local network. Not a mirror and not a cut-down copy: literally the same files the
 *      Electron window loads, with the PC doing the work.
 *
 * The user asked for (2) and was pointed at (1). Reasonably, they read six tabs against
 * the desktop's eighteen and concluded nothing had been upgraded.
 *
 * WHY (1) CANNOT SIMPLY BECOME (2)
 * Rendering needs ffmpeg, the bundled Whisper speech models, and the user's own video
 * files. None of those exist on a handset, and none of them can. So the full studio on a
 * phone is not a bigger phone app — it is the PC doing the work while the phone shows the
 * screens. That requires the PC switched on with the studio open.
 *
 * WHAT THIS MODULE DOES
 * Removes the choice from the user. Once the PC's link has been saved, opening the icon
 * checks whether the PC is reachable; if it is, it hands straight over to the real studio.
 * If it is not, it stays here and SAYS WHY, rather than silently being the small app and
 * letting the user believe that is all there is. One icon, always the best thing
 * available, and never a mystery about which one you are looking at.
 *
 * Pure decisions here; the redirect itself lives in app.ts.
 */

export type Handover = 'full-studio' | 'stay-here'

export interface HandoverInputs {
  /** The tokenised studio link saved from the PC's Settings screen. '' when never set. */
  pcLink: string
  /** Did a quick probe reach the PC just now? */
  pcReachable: boolean
  /** The user chose "stay in the small app" for this session. */
  preferSmallThisTime: boolean
  /** This page IS the studio being served by the PC — never hand over to ourselves. */
  alreadyOnPc: boolean
}

/**
 * Where should this launch land?
 *
 * `alreadyOnPc` is checked first and is the loop guard: the real studio and this app
 * share no code, but a misconfigured link pointing at the hosted app itself would
 * otherwise bounce forever.
 */
export function decideHandover(i: HandoverInputs): Handover {
  if (i.alreadyOnPc) return 'stay-here'
  if (!i.pcLink.trim()) return 'stay-here'
  if (i.preferSmallThisTime) return 'stay-here'
  if (!i.pcReachable) return 'stay-here'
  return 'full-studio'
}

/**
 * The line under the title, so which app you are in is never a guess.
 *
 * Every branch names a different situation AND what to do about it. "Writing needs your
 * PC" — the old text — described a limitation without ever hinting that the full studio
 * exists, which is precisely how the user came to believe the phone had not been
 * upgraded.
 */
export function statusLine(i: HandoverInputs): string {
  if (i.alreadyOnPc) return 'the full studio, running on your PC'
  if (!i.pcLink.trim()) return 'writing tools · connect your PC for the full studio'
  if (i.preferSmallThisTime) return 'writing tools · tap "Full studio" to switch back'
  if (!i.pcReachable) return 'writing tools · your PC is not reachable right now'
  return 'opening the full studio on your PC…'
}

/**
 * Is this page being served by the PC itself?
 *
 * The hosted copy lives on github.io; anything else running this bundle is the PC serving
 * it. Checking the host rather than a flag means it stays right even if someone opens the
 * PC link on a laptop.
 */
export function isServedByPc(hostname: string): boolean {
  return !/(^|\.)github\.io$/i.test(hostname.trim().toLowerCase())
}

/**
 * A short, absolute http(s) link, or null.
 *
 * Rejects anything that is not http(s) — a saved value that had become `javascript:` or a
 * data URL would otherwise be handed straight to location.replace.
 */
export function safeStudioUrl(link: string): string | null {
  const raw = link.trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return u.toString()
  } catch {
    return null
  }
}
