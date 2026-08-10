/**
 * Prompt ASSEMBLY — the structure, with none of the wording.
 *
 * The studio's prompt text is its most valuable asset, and the phone app is served
 * from a public address, so the text cannot be bundled into it. But the phone still
 * needs to build prompts when the PC is switched off.
 *
 * The split that makes both true:
 *   • the WORDING lives in a `PromptPack` — data, held on the PC (src/main/promptPack.ts),
 *     handed to the phone once over the private link and cached on the handset;
 *   • the ASSEMBLY lives here — which blocks go in what order, and when an optional
 *     block is included at all. It contains no sentences of its own, so it is safe to
 *     ship publicly.
 *
 * `src/main/prompts.ts` binds the two together and keeps its original exports, so the
 * desktop app is unchanged. A golden snapshot test (prompts.golden.test.ts) proves the
 * output of every builder is byte-identical to before this split existed.
 */

/** Every piece of wording the assembly needs. Filled in by the PC's prompt pack. */
export interface PromptPack {
  /** Bumped when the shape changes, so a stale cached pack on a phone is spotted. */
  version: number
  niche: string
  styleGuide: Record<string, string>
  languageGuide: Record<string, string>
  lengthGuide: Record<string, string>
  /** Templates using {{token}} placeholders — see each builder for the tokens it fills. */
  templates: {
    styleBlockHeader: string
    idea: string
    ideaTrendHeader: string
    ideaNoTrends: string
    ideaYouTubeHeader: string
    ideaYouTubeFooter: string
    audienceNoteLabel: string
    script: string
    scriptIdeaContextLabel: string
    scriptAudienceLabel: string
    scriptNewsBlock: string
    scriptVerifiedBlock: string
    scriptNoVerifiedBlock: string
    advisor: string
    advisorContextBlock: string
    thumbnail: string
  }
}

/** Replaces every {{token}} with its value. Unknown tokens are left visible, not silently blanked. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole
  )
}

/** Joins the selected style directives, or nothing at all when none are chosen. */
export function assembleStyleBlock(pack: PromptPack, styles?: string[]): string {
  if (!styles || !styles.length) return ''
  const directives = styles.map((s) => `- ${pack.styleGuide[s] ?? s}`).join('\n')
  return `\n${pack.templates.styleBlockHeader}\n${directives}\n`
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K views`
  return `${n} views`
}

export interface IdeaParams {
  focusArea: string
  audienceNote?: string
  count: number
  trends: { topic: string; why: string; momentum: string }[]
  ytSignals: { title: string; channelTitle: string; viewCount: number; publishedAt: string }[]
}

export function assembleIdeaPrompt(pack: PromptPack, p: IdeaParams): string {
  const trendBlock = p.trends.length
    ? `${pack.templates.ideaTrendHeader}\n${p.trends.map((t) => `- ${t.topic} (${t.momentum}): ${t.why}`).join('\n')}`
    : pack.templates.ideaNoTrends

  const ytBlock = p.ytSignals.length
    ? `\n${pack.templates.ideaYouTubeHeader}\n${p.ytSignals
        .map(
          (s) => `- "${s.title}" — ${s.channelTitle} — ${formatViews(s.viewCount)} — published ${s.publishedAt.slice(0, 10)}`
        )
        .join('\n')}\n${pack.templates.ideaYouTubeFooter}`
    : ''

  return fill(pack.templates.idea, {
    niche: pack.niche,
    count: p.count,
    focusArea: p.focusArea,
    audienceLine: p.audienceNote ? `${pack.templates.audienceNoteLabel}${p.audienceNote}` : '',
    trendBlock,
    ytBlock
  })
}

export interface ScriptParams {
  topic: string
  ideaContext?: string
  audienceNote?: string
  length: string
  languageMix: string
  styles?: string[]
  verifiedData?: string
  recentNewsContext?: string
}

export function assembleScriptPrompt(pack: PromptPack, p: ScriptParams): string {
  return fill(pack.templates.script, {
    niche: pack.niche,
    topic: p.topic,
    ideaContextLine: p.ideaContext ? `${pack.templates.scriptIdeaContextLabel}${p.ideaContext}` : '',
    audienceLine: p.audienceNote ? `${pack.templates.scriptAudienceLabel}${p.audienceNote}` : '',
    newsBlock: p.recentNewsContext?.trim()
      ? fill(pack.templates.scriptNewsBlock, { news: p.recentNewsContext.trim() })
      : '',
    lengthGuide: pack.lengthGuide[p.length] ?? '',
    languageGuide: pack.languageGuide[p.languageMix] ?? '',
    styleBlock: assembleStyleBlock(pack, p.styles),
    verifiedBlock: p.verifiedData?.trim()
      ? fill(pack.templates.scriptVerifiedBlock, { verified: p.verifiedData.trim() })
      : pack.templates.scriptNoVerifiedBlock
  })
}

export function assembleAdvisorPrompt(pack: PromptPack, context?: string): string {
  return fill(pack.templates.advisor, {
    niche: pack.niche,
    contextBlock: context?.trim() ? fill(pack.templates.advisorContextBlock, { context: context.trim() }) : ''
  })
}

export function assembleThumbnailPrompt(pack: PromptPack, topic: string, title: string): string {
  return fill(pack.templates.thumbnail, { niche: pack.niche, topic, title: title || topic })
}
