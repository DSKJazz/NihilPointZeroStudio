/**
 * Editing against a small stand-in, so scrubbing a 4K video stops being painful.
 *
 * THE PROBLEM
 * The Timeline editor plays the real file. A 4K clip is decoded by the browser on every
 * seek, and on an ordinary laptop that means the picture lags a second behind the scrubber
 * — so trimming to an exact word becomes guesswork, and the user ends up rendering to find
 * out whether the cut landed. A 4K file is also often 20x the pixels of what anyone needs
 * in order to decide WHERE to cut.
 *
 * THE ANSWER, AND THE ONE RULE THAT MAKES IT SAFE
 * Edit against a small copy, then apply the cuts to the full-quality original. That only
 * works if a timestamp means the same thing in both files. So the proxy is built to be
 * frame-for-frame time-identical to its source:
 *
 *   - the SAME frame rate. A 60fps source proxied at 30fps puts every timestamp in the
 *     editor half a frame out at best, and at worst the proxy is a different LENGTH, so a
 *     cut near the end lands somewhere else entirely.
 *   - the SAME duration, and it is CHECKED afterwards rather than assumed. A proxy whose
 *     length differs from its source is refused, because silently editing against it would
 *     put every cut progressively further out as the video goes on — the kind of error
 *     that looks fine at the start of a video and ruins the end.
 *   - no trimming, no speed change, no frame dropping. Only the picture gets smaller.
 *
 * With that guaranteed, mapping is the identity function: a cut at 4:12.5 in the proxy is
 * a cut at 4:12.5 in the master. That is worth far more than any cleverer mapping, because
 * there is nothing to get wrong.
 */

/** Long side of the proxy. Enough to see what you are cutting, small enough to scrub. */
export const PROXY_LONG_SIDE = 640

/**
 * Only bigger than 1080p. Below that there is nothing to gain and something to lose.
 *
 * 1080p already scrubs acceptably on an ordinary laptop, and making a proxy is not free —
 * it is a full pass over the file, minutes on a long video. Generating one that buys
 * nothing would make the editor feel SLOWER, which is the opposite of the point. 1440p and
 * 4K are where the seek lag becomes guesswork.
 */
export const PROXY_WORTH_IT_ABOVE = 1920

export interface ProxySpec {
  sourcePath: string
  outPath: string
  /** The source's real dimensions, so the proxy keeps its shape. */
  width: number
  height: number
}

/** Is a proxy worth making for this file? */
export function worthProxying(width: number, height: number): boolean {
  return Math.max(width || 0, height || 0) > PROXY_WORTH_IT_ABOVE
}

/** The proxy's dimensions: same shape, long side capped, both even (h264 requires it). */
export function proxySize(width: number, height: number): { width: number; height: number } {
  const w = Math.max(2, Math.round(width) || 2)
  const h = Math.max(2, Math.round(height) || 2)
  const long = Math.max(w, h)
  const scale = long > PROXY_LONG_SIDE ? PROXY_LONG_SIDE / long : 1
  const even = (n: number): number => Math.max(2, Math.round((n * scale) / 2) * 2)
  return { width: even(w), height: even(h) }
}

/**
 * ffmpeg arguments for the proxy.
 *
 * Deliberately absent: `-r`, `-t`, `-ss`, `setpts`, `fps`. Every one of them would change
 * the relationship between a timestamp in the proxy and the same timestamp in the master,
 * which is the single thing this file exists to preserve. Only `scale` is applied.
 *
 * The audio is copied rather than re-encoded — it is what the user listens to in order to
 * find the cut, and re-encoding it would be slower AND slightly shift it.
 */
export function buildProxyArgs(spec: ProxySpec): string[] {
  const { width, height } = proxySize(spec.width, spec.height)
  return [
    '-y',
    '-i',
    spec.sourcePath,
    '-vf',
    `scale=${width}:${height}`,
    '-c:v',
    'libx264',
    // ultrafast + a high CRF: this file is scrubbed and deleted, never watched properly.
    '-preset',
    'ultrafast',
    '-crf',
    '30',
    '-pix_fmt',
    'yuv420p',
    // Frequent keyframes are the whole point — a seek can only land on one, so a 10-second
    // keyframe interval means the scrubber snaps ten seconds away from where you clicked.
    // One per second makes it feel instant, at a size cost that does not matter here.
    '-g',
    '25',
    '-c:a',
    'copy',
    '-movflags',
    '+faststart',
    spec.outPath
  ]
}

/** How far apart two durations may be and still count as the same length. */
export const DURATION_TOLERANCE_SEC = 0.1

/**
 * Is this proxy safe to edit against?
 *
 * Checked, not assumed. A proxy whose length differs from its source would put every cut
 * progressively further out as the video goes on — fine at the start, ruined at the end,
 * and invisible until someone watches the whole thing.
 */
export function proxyIsTrustworthy(
  sourceSeconds: number,
  proxySeconds: number,
  tolerance = DURATION_TOLERANCE_SEC
): { ok: boolean; reason: string } {
  if (!Number.isFinite(sourceSeconds) || !Number.isFinite(proxySeconds) || sourceSeconds <= 0 || proxySeconds <= 0) {
    return { ok: false, reason: 'Could not read the length of one of the files, so the stand-in cannot be trusted.' }
  }
  const drift = Math.abs(sourceSeconds - proxySeconds)
  if (drift > tolerance) {
    return {
      ok: false,
      reason: `The stand-in came out ${drift.toFixed(2)}s different in length from the original, so a cut made against it would not land in the same place. Editing the original directly instead.`
    }
  }
  return { ok: true, reason: 'The stand-in is the same length as the original, so any cut you make lands in exactly the same place.' }
}

/**
 * A time in the proxy, as a time in the master.
 *
 * The identity function, and that is the point rather than a shortcoming. Everything above
 * exists so that this needs no arithmetic: no scaling factor to get backwards, no rounding
 * to accumulate, nothing to be subtly wrong in the last minute of a long video. It is a
 * named function anyway, so that if the proxy ever stops being time-identical there is one
 * obvious place that has to change.
 */
export function proxyTimeToMaster(proxySeconds: number): number {
  return proxySeconds
}
