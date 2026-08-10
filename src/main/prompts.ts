/**
 * Prompt builders.
 *
 * The WORDING now lives in ./promptPack.ts, and the ASSEMBLY in
 * ../shared/promptAssembly.ts. The split exists so the phone app — which is served
 * from a public address — can build prompts WITHOUT the wording being bundled into
 * it: the phone fetches the pack once over the private link and caches it on the
 * handset. See promptPack.ts for the reasoning.
 *
 * Every export below behaves exactly as it always did; prompts.golden.test.ts
 * snapshots all of them and fails on a single changed character.
 */
import type { IdeaGenRequest, ScriptGenRequest, ScriptStyle, TrendTopic, YouTubeSignal } from '../shared/types'
import {
  assembleAdvisorPrompt,
  assembleIdeaPrompt,
  assembleScriptPrompt,
  assembleStyleBlock,
  assembleThumbnailPrompt
} from '../shared/promptAssembly'
import { PROMPT_PACK } from './promptPack'

const NICHE_CONTEXT = PROMPT_PACK.niche
const LANGUAGE_GUIDE = PROMPT_PACK.languageGuide as Record<ScriptGenRequest['languageMix'], string>

function buildStyleBlock(styles?: ScriptStyle[]): string {
  return assembleStyleBlock(PROMPT_PACK, styles)
}

export function buildTrendPrompt(focusArea: string, count: number): string {
  return `${NICHE_CONTEXT}

Task: Based on your general knowledge of recurring and currently unfolding themes in finance and economics (global and Pakistan/South Asia-specific), list ${count} topic clusters that are likely to have strong search and watch interest right now for a YouTube channel in this niche, focused on: "${focusArea || 'general finance & economics'}".

Be explicit that this is reasoned estimation, not live search data. Favor topics with: real financial stakes for ordinary viewers, an news hook or recurring seasonal pattern (budget season, tax season, Fed/SBP rate decisions, Ramadan spending, etc.), and a clear reason someone would click today rather than skip.

Respond ONLY with a JSON array, no prose, no markdown fences, matching this shape:
[{"topic": string, "why": string, "momentum": "rising" | "steady" | "seasonal"}]`
}


/** ~150 spoken words per minute; how many sections to chapter an ultra-long script into. */
export const FEATURE_PLANS: Partial<Record<ScriptGenRequest['length'], { sections: number; wordsPerSection: number }>> = {
  'feature-90': { sections: 12, wordsPerSection: 1150 },
  'feature-180': { sections: 20, wordsPerSection: 1350 }
}

export function isFeatureLength(length: ScriptGenRequest['length']): boolean {
  return length === 'feature-90' || length === 'feature-180'
}

export interface OutlineSection {
  title: string
  focus: string
}

export function buildOutlinePrompt(req: ScriptGenRequest, sectionCount: number): string {
  return `${NICHE_CONTEXT}

Task: Plan the CHAPTER OUTLINE for a feature-length (${req.length === 'feature-180' ? '~180' : '~90'}-minute) YouTube video on this topic. It will be written section by section, so give a strong, non-repetitive arc.

Topic: ${req.topic}
${req.ideaContext ? `Angle: ${req.ideaContext}` : ''}
${req.audienceNote ? `Audience: ${req.audienceNote}` : ''}

Produce exactly ${sectionCount} sequential sections that build on each other — opening hook section, escalating analysis, counterpoints, case studies, and a strong closing section. No two sections should cover the same ground.

Respond ONLY with a JSON array of exactly ${sectionCount} items, no prose, no markdown fences:
[{"title": string (short section title), "focus": string (one sentence: what THIS section uniquely covers)}]`
}

export function buildSectionPrompt(
  req: ScriptGenRequest,
  section: OutlineSection,
  index: number,
  total: number,
  outline: OutlineSection[]
): string {
  const plan = FEATURE_PLANS[req.length]
  const words = plan?.wordsPerSection ?? 1200
  const fullArc = outline.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
  return `${NICHE_CONTEXT}

You are writing ONE section of a feature-length video script, section ${index + 1} of ${total}. Write ONLY this section's spoken narration — do not re-introduce the whole video, do not write an outro unless this is the final section, and do not repeat other sections.

Full chapter arc (for context — do not rewrite these, only write the current one):
${fullArc}

CURRENT SECTION ${index + 1}: "${section.title}"
This section must cover: ${section.focus}

Length: about ${words} words for this section alone.
Language: ${LANGUAGE_GUIDE[req.languageMix]}
${buildStyleBlock(req.styles)}${
    req.verifiedData?.trim()
      ? `\nVERIFIED DATA (treat as ground truth — use ONLY these figures for specific numbers): \n${req.verifiedData.trim()}`
      : '\nDo not invent precise statistics you cannot verify — describe magnitude/direction qualitatively instead.'
  }
${index === 0 ? 'This is the OPENING section: start with a strong [PATTERN INTERRUPT] hook.' : ''}
${index === total - 1 ? 'This is the FINAL section: end with a [TAKEAWAY] and an [URGENT ALPHA] call to action.' : ''}

Write only the spoken narration for this section, no headers, no JSON, no commentary.`
}

export function buildIdeaPrompt(req: IdeaGenRequest, trends: TrendTopic[], ytSignals: YouTubeSignal[] = []): string {
  return assembleIdeaPrompt(PROMPT_PACK, {
    focusArea: req.focusArea,
    audienceNote: req.audienceNote,
    count: req.count,
    trends,
    ytSignals
  })
}

export function buildScriptPrompt(req: ScriptGenRequest): string {
  return assembleScriptPrompt(PROMPT_PACK, req)
}

/**
 * System instruction for the Advisor chat. It's a reasoning partner, not a
 * yes-man: it should critique the user's plan, propose better angles, and be
 * honest about weaknesses — grounded in this channel's finance/economics niche.
 */
export function buildAdvisorSystemPrompt(context?: string): string {
  return assembleAdvisorPrompt(PROMPT_PACK, context)
}

export function buildThumbnailPrompt(topic: string, title: string): string {
  return assembleThumbnailPrompt(PROMPT_PACK, topic, title)
}
