/**
 * Assembles a real-footage background video from free stock clips matched to a
 * script. For each on-screen section it picks a relevant clip (searched by the
 * section's keyword, with the video title as a fallback), scales/crops it to fill the
 * frame, loops/trims it to the section's duration, and concatenates the segments into
 * one bg.mp4 — which the renderer then overlays the title/cards/waveform onto.
 *
 * Returns the bg.mp4 path, or throws if no footage could be fetched at all (offline /
 * bad key / no results) so the caller falls back to the animated visualizer.
 */
import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { runFfmpeg } from './ffmpeg'
import { chooseEncoderForJob, runEncodeWithFallback } from './encoder'
import { extractCards, type Layout } from './render'
import { downloadStockClip, sanitizeKeyword, searchStockVideos, type StockClip } from '../data/stockFootage'
import { FINANCE_CONCEPTS, planBroll, timedLinesFromScript } from '../../shared/brollTiming'

export interface StockBackgroundOptions {
  title: string
  body: string
  layout: Layout
  durationSec: number
  apiKey: string
  onProgress?: (stage: string) => void
}

/**
 * One stretch of background footage: what to search for, and how long it is on screen.
 *
 * Equal-length sections were the old plan, and they put a picture of gold on screen while
 * the narration was three sentences past gold. The cue list from brollTiming knows which
 * concept is being SPOKEN ABOUT and when, so the segment boundaries follow the words.
 */
export interface StockSegment {
  query: string
  seconds: number
  /** The word in the narration that chose this, or null for a gap filler. */
  trigger: string | null
}

/**
 * The segment plan for a script.
 *
 * Any stretch with no matching concept becomes a filler segment on the section keyword,
 * so the screen is never empty — a gap with nothing on it is worse than a generic clip.
 * Segments are emitted in time order and sum to the full duration.
 */
export function planStockSegments(title: string, body: string, durationSec: number): StockSegment[] {
  const total = Math.max(0, durationSec)
  if (!total) return []
  const cues = planBroll(timedLinesFromScript(body, total), FINANCE_CONCEPTS, { durationSec: total })
  const fallback = stockQueries(title, body)
  const fillerAt = (i: number): string => fallback[i % Math.max(1, fallback.length)] ?? sanitizeKeyword(title) ?? 'finance'

  const out: StockSegment[] = []
  let at = 0
  let filler = 0
  for (const cue of cues) {
    if (cue.startSec > at + 0.05) {
      out.push({ query: fillerAt(filler++), seconds: cue.startSec - at, trigger: null })
      at = cue.startSec
    }
    const seconds = Math.max(0, Math.min(cue.endSec, total) - at)
    if (seconds > 0.05) {
      // The cue's own label is the search term: "gold bullion" finds gold footage where
      // the raw trigger word "sona" would find nothing on an English stock library.
      out.push({ query: sanitizeKeyword(cue.label) || fillerAt(filler), seconds, trigger: cue.trigger })
      at += seconds
    }
  }
  if (total - at > 0.05) out.push({ query: fillerAt(filler), seconds: total - at, trigger: null })
  return out
}

/** Builds the queries to search: each section keyword, then the title as a fallback. */
export function stockQueries(title: string, body: string): string[] {
  const cards = extractCards(body, title).map(sanitizeKeyword).filter(Boolean)
  const titleKw = sanitizeKeyword(title)
  const queries = [...cards]
  if (titleKw) queries.push(titleKw)
  // De-dup while keeping order.
  return [...new Set(queries)]
}

export async function buildStockBackground(opts: StockBackgroundOptions): Promise<string> {
  const { title, body, layout, durationSec, apiKey, onProgress } = opts
  // Segments follow the WORDS now, not an equal split. A stretch with no matching
  // concept still gets a section-keyword clip, so the screen is never empty.
  const plan = planStockSegments(title, body, durationSec)
  const nSections = Math.max(1, plan.length)
  const scratch = mkdtempSync(join(tmpdir(), 'stockbg-'))

  onProgress?.('Finding matching stock footage…')
  // Build a pool of clips from the section keywords + title, de-duplicated by id.
  // The query is kept alongside each clip: a segment wants footage found for ITS OWN
  // search term, not whatever happens to sit at that index in the pool.
  const pool: { clip: StockClip; query: string }[] = []
  const seen = new Set<string>()
  // Search the segment queries first — those are the ones the narration actually asks
  // for — then the section keywords as backup.
  for (const q of [...new Set([...plan.map((p) => p.query), ...stockQueries(title, body)])]) {
    if (pool.length >= nSections + 2) break
    const clips = await searchStockVideos(q, apiKey, layout.w, 4)
    for (const c of clips) {
      if (!seen.has(c.id)) {
        seen.add(c.id)
        pool.push({ clip: c, query: q })
      }
    }
  }
  if (!pool.length) throw new Error('No stock footage found (offline, bad key, or no matches).')

  // Same safe encoder choice as the main render (8K → CPU), with a runtime fallback.
  const encoder = await chooseEncoderForJob(layout.w, layout.h, durationSec / nSections)

  // Download + build one segment per section, cycling the pool.
  const segPaths: string[] = []
  for (let i = 0; i < nSections; i++) {
    const seg_ = plan[i]
    const secDur = seg_?.seconds ?? durationSec / nSections
    // Prefer a clip that came back for THIS segment's own query; fall back to the pool.
    const clip = (pool.find((c) => c.query === seg_?.query) ?? pool[i % pool.length]).clip
    onProgress?.(
      seg_?.trigger
        ? `Preparing footage ${i + 1}/${nSections} — "${seg_.trigger}"…`
        : `Preparing footage ${i + 1}/${nSections}…`
    )
    const raw = join(scratch, `clip${i}.mp4`)
    try {
      await downloadStockClip(clip.url, raw)
    } catch {
      // Skip a bad download; if we end up with zero segments we throw below.
      continue
    }
    const seg = join(scratch, `seg${i}.mp4`)
    await runEncodeWithFallback(
      encoder,
      (encArgs) => [
        '-y', '-stream_loop', '-1', '-i', raw, '-t', secDur.toFixed(3), '-an',
        '-vf', `scale=${layout.w}:${layout.h}:force_original_aspect_ratio=increase,crop=${layout.w}:${layout.h},setsar=1,fps=25`,
        ...encArgs, '-r', '25', seg
      ],
      { onNotice: onProgress }
    )
    segPaths.push(seg)
  }
  if (!segPaths.length) throw new Error('Could not prepare any stock footage segments.')

  // Concatenate the segments into the final background.
  const listPath = join(scratch, 'list.txt')
  writeFileSync(listPath, segPaths.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'), 'utf-8')
  const bgPath = join(scratch, 'bg.mp4')
  await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', bgPath])
  return bgPath
}
