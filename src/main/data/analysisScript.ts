/**
 * ONE prompt builder for turning verified, in-app-computed figures into a spoken narration
 * script — shared by the technical (PSX price), financial (fundamentals), and flow
 * (NCCPL FIPI/LIPI) tools. The model only writes PROSE around numbers WE computed; it is
 * told explicitly not to invent or alter figures, so the math stays trustworthy.
 *
 * The user drives it: `instruction` (what/how) and `language` (e.g. "Roman Urdu", "Urdu",
 * "English") are injected so the same tool answers however the user asks.
 */
export type AnalysisKind = 'technical' | 'financial' | 'flow'

export interface ScriptDirectives {
  /** The user's own request: what to focus on / how to frame it. */
  instruction?: string
  /** Target language for the narration, e.g. "Roman Urdu", "Urdu", "English". */
  language?: string
  /** Delivery style, e.g. "documentary", "punchy", "explainer". */
  style?: string
  /** Desired spoken runtime in seconds. */
  targetSeconds?: number
}

const KIND_BRIEF: Record<AnalysisKind, string> = {
  technical: 'a technical read (price action, moving averages, RSI momentum, volume)',
  financial: 'a fundamentals read (valuation, earnings, growth, margins)',
  flow: 'an institutional money-flow read (foreign FIPI vs local LIPI net buying/selling)'
}

export function buildAnalysisScriptPrompt(params: {
  kind: AnalysisKind
  /** What is being analysed, e.g. "LUCK on the PSX" or "NCCPL FIPI/LIPI flows". */
  subject: string
  /** The already-computed, verified figures (a plain-text summary). */
  figures: string
  directives?: ScriptDirectives
}): string {
  const { kind, subject, figures, directives } = params
  const style = directives?.style?.trim() || 'documentary'
  const language = directives?.language?.trim()
  const instruction = directives?.instruction?.trim()
  const targetSeconds = directives?.targetSeconds && directives.targetSeconds > 0 ? Math.round(directives.targetSeconds) : undefined

  const parts: string[] = [
    `You are a Pakistani financial markets narrator writing a ${style}-style video narration script about ${subject} — ${KIND_BRIEF[kind]}.`,
    `Use ONLY the verified figures below. Do NOT invent, alter, or add any number (no made-up price targets). Give balanced reasoning, not financial advice.`
  ]
  if (language) parts.push(`Write the ENTIRE narration in ${language}.`)
  if (instruction) parts.push(`Follow the user's specific request as closely as possible: "${instruction}".`)
  if (targetSeconds) {
    const targetWords = Math.round((targetSeconds / 60) * 150)
    parts.push(`Write a complete narration for approximately ${targetSeconds} seconds, at least ${targetWords} spoken words. Do not compress the analysis into a short summary; develop the context, evidence, implications, counterpoints, and conclusion.`)
  }
  parts.push(`Structure the script with short [SECTION] tags on their own lines so it can drive a video.`)
  parts.push(`\nVERIFIED FIGURES:\n${figures}\n`)
  return parts.join(' ').replace(' \n', '\n')
}
