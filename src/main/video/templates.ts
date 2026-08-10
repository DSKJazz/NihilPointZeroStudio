/**
 * Graphics v2 — "template" looks. A template is a finishing treatment layered on top of
 * the composed video: colour-grade, vignette, film grain, letterbox bars, plus an
 * animated (fade-in) title. This turns the flat preset look into something that reads as
 * professionally graded. All pure ffmpeg — free/offline. Builders are pure + unit-tested.
 */
export type VideoTemplate = 'clean' | 'news' | 'cinematic' | 'bold'
export const VIDEO_TEMPLATES: VideoTemplate[] = ['clean', 'news', 'cinematic', 'bold']

export interface TemplateConfig {
  /** eq() grade, or null for none. */
  contrast?: number
  saturation?: number
  gamma?: number
  vignette: boolean
  /** 0 = none; higher = more film grain. */
  grain: number
  /** cinematic black bars top/bottom. */
  letterbox: boolean
  /** fade/scale the title in. */
  animateTitle: boolean
  /** true = section labels shown as a sliding lower-third bar; false = kinetic centered cards. */
  lowerThird: boolean
  /** accent colour (0xRRGGBB) for the lower-third bar. */
  accent: string
}

export const TEMPLATES: Record<VideoTemplate, TemplateConfig> = {
  clean: { vignette: false, grain: 0, letterbox: false, animateTitle: true, lowerThird: false, accent: '0xE8B923' },
  news: { contrast: 1.05, saturation: 1.12, gamma: 1.0, vignette: false, grain: 0, letterbox: false, animateTitle: true, lowerThird: true, accent: '0xE8B923' },
  cinematic: { contrast: 1.08, saturation: 1.04, gamma: 0.96, vignette: true, grain: 8, letterbox: true, animateTitle: true, lowerThird: false, accent: '0xF5E9C8' },
  bold: { contrast: 1.14, saturation: 1.28, gamma: 0.98, vignette: false, grain: 4, letterbox: false, animateTitle: true, lowerThird: false, accent: '0xFF5DA2' }
}

export function templateFor(t: VideoTemplate = 'clean'): TemplateConfig {
  return TEMPLATES[t] ?? TEMPLATES.clean
}

/**
 * The finishing filter chain for a template applied to one video label, e.g.
 * `[v3]<finishing>[vfinal]`. Returns null when the template adds nothing (clean).
 * `w`/`h` are the frame size (for letterbox bar height). Pure + unit-tested.
 */
/**
 * The finishing FILTERS for a template, with no labels attached.
 *
 * Split out from finishingChain so a plain `-vf` caller — the scene preview — applies the
 * identical look rather than an approximation of it. A preview built from its own copy of
 * these numbers would eventually disagree with the render, and a preview you cannot trust
 * is worse than none: you stop looking at it and go back to rendering blind.
 */
export function finishingFilters(cfg: TemplateConfig, w: number, h: number): string[] {
  const parts: string[] = []
  if (cfg.contrast != null || cfg.saturation != null || cfg.gamma != null) {
    parts.push(`eq=contrast=${cfg.contrast ?? 1}:saturation=${cfg.saturation ?? 1}:gamma=${cfg.gamma ?? 1}`)
  }
  if (cfg.vignette) parts.push('vignette=PI/5')
  if (cfg.grain > 0) parts.push(`noise=alls=${Math.round(cfg.grain)}:allf=t`)
  if (cfg.letterbox) {
    const bar = Math.round(h * 0.11)
    parts.push(`drawbox=x=0:y=0:w=${w}:h=${bar}:color=black@1:t=fill`)
    parts.push(`drawbox=x=0:y=${h - bar}:w=${w}:h=${bar}:color=black@1:t=fill`)
  }
  return parts
}

export function finishingChain(cfg: TemplateConfig, inLabel: string, outLabel: string, w: number, h: number): string | null {
  const parts = finishingFilters(cfg, w, h)
  if (!parts.length) return null
  return `[${inLabel}]${parts.join(',')}[${outLabel}]`
}

/** A drawtext `alpha=` expression that fades the title in over `dur` seconds. Pure. */
export function titleAlphaExpr(dur = 0.8): string {
  return `if(lt(t,${dur}),t/${dur},1)`
}
