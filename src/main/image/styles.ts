/**
 * The visual-style catalogue for AI-generated scene images.
 *
 * Previously there was one "cinematic", one "cartoon" and one "anime" prompt, so every
 * video in a family came out looking the same. These are distinct enough to actually
 * choose between — different eras, palettes and rendering traditions, not adjectives
 * sprinkled on one base prompt.
 */

export type StyleFamily = 'cinematic' | 'cartoon' | 'anime' | 'other'

export interface StyleSpec {
  id: string
  label: string
  family: StyleFamily
  /** Appended to the image prompt as the "Style:" clause. */
  prompt: string
}

export const STYLE_CATALOGUE: StyleSpec[] = [
  // --- Cinematic ---
  {
    id: 'cinematic',
    label: 'Cinematic — modern film',
    family: 'cinematic',
    prompt: 'cinematic photorealistic film still, 35mm, natural rich colour, shallow depth of field, sharp focus'
  },
  {
    id: 'noir',
    label: 'Cinematic — film noir',
    family: 'cinematic',
    prompt: 'high-contrast black and white film noir still, hard shadows, venetian blind light, 1940s detective mood'
  },
  {
    id: 'blockbuster',
    label: 'Cinematic — blockbuster',
    family: 'cinematic',
    prompt: 'epic blockbuster movie still, teal and orange grade, dramatic rim lighting, wide anamorphic lens, lens flare'
  },
  {
    id: 'vintage-film',
    label: 'Cinematic — vintage 70s',
    family: 'cinematic',
    prompt: 'warm 1970s film photograph, kodachrome palette, soft grain, gentle halation, nostalgic'
  },
  {
    id: 'documentary',
    label: 'Cinematic — documentary',
    family: 'cinematic',
    prompt: 'candid documentary photograph, available light, natural unposed composition, photojournalism, realistic'
  },

  // --- Cartoon ---
  {
    id: 'cartoon',
    label: 'Cartoon — bold flat',
    family: 'cartoon',
    prompt: 'vibrant flat cartoon illustration, bold clean outlines, saturated colour blocks, simple shapes'
  },
  {
    id: 'cartoon-3d',
    label: 'Cartoon — 3D animated film',
    family: 'cartoon',
    prompt: 'polished 3D animated feature film still, soft global illumination, rounded friendly character design, glossy'
  },
  {
    id: 'comic',
    label: 'Cartoon — comic book',
    family: 'cartoon',
    prompt: 'comic book panel art, heavy ink linework, halftone dot shading, dynamic action pose, bold primary colours'
  },
  {
    id: 'watercolour',
    label: 'Cartoon — watercolour storybook',
    family: 'cartoon',
    prompt: 'hand-painted watercolour storybook illustration, soft washes, visible paper texture, gentle pastel palette'
  },

  // --- Anime ---
  {
    id: 'anime',
    label: 'Anime — modern key visual',
    family: 'anime',
    prompt: 'modern anime key visual, crisp cel shading, expressive eyes, detailed background art, studio quality'
  },
  {
    id: 'anime-90s',
    label: 'Anime — retro 90s',
    family: 'anime',
    prompt: 'retro 1990s anime cel, hand-painted background, muted film-stock colour, visible cel texture, nostalgic'
  },
  {
    id: 'anime-pastoral',
    label: 'Anime — painterly pastoral',
    family: 'anime',
    prompt: 'painterly anime landscape, lush hand-painted scenery, warm sunlight, drifting clouds, wholesome gentle mood'
  },
  {
    id: 'anime-dark',
    label: 'Anime — dark seinen',
    family: 'anime',
    prompt: 'dark seinen anime still, heavy shadow, desaturated palette, gritty detailed linework, tense atmosphere'
  },

  // --- Other looks ---
  { id: 'neon', label: 'Neon cyberpunk', family: 'other', prompt: 'neon cyberpunk, luminous magenta and cyan glow, rain-slick reflections, futuristic city' },
  { id: 'minimal', label: 'Minimal / clean', family: 'other', prompt: 'minimalist composition, generous negative space, soft muted palette, calm and uncluttered' },
  { id: 'infographic', label: 'Infographic / explainer', family: 'other', prompt: 'clean flat vector infographic illustration, simple iconography, clear diagram-like composition, corporate palette' }
]

const BY_ID = new Map(STYLE_CATALOGUE.map((s) => [s.id, s]))

/** Looks up a style, falling back to modern cinematic for unknown/legacy ids. */
export function styleById(id: string | undefined): StyleSpec {
  return (id && BY_ID.get(id)) || BY_ID.get('cinematic')!
}

export function stylesByFamily(family: StyleFamily): StyleSpec[] {
  return STYLE_CATALOGUE.filter((s) => s.family === family)
}

/**
 * Builds a clean image prompt for a scene: the visual style + the scene text + the
 * video's topic, steering away from on-screen text (the renderer adds titles itself).
 *
 * Lives HERE rather than in ./index because this module has no imports at all, so the
 * phone app can bundle it and preview a scene with the byte-identical prompt the PC
 * will render from. ./index re-exports it, so every existing caller is unchanged.
 */
/**
 * Does this scene actually ask for a human being in frame?
 *
 * Why it matters: the free image model, given any abstract finance prompt, defaults to
 * inventing a person — almost always a woman, often inappropriately dressed — because
 * that is what its training data over-represents. A whole institutional-analysis video
 * came out "ninety percent women" for scripts that never mentioned a person at all. So
 * unless the scene TEXT names one, the prompt now forbids people outright, and the image
 * has to be about the things the scene describes: markets, charts, buildings, documents.
 */
export function sceneWantsPerson(scene: string): boolean {
  return /\b(man|men|woman|women|person|people|face|portrait|worker|farmer|trader|investor|banker|analyst|presenter|anchor|host|crowd|family|child|children|boy|girl|couple|businessman|businesswoman|official|minister|ceo|chairman|speaker|customer|shopkeeper|vendor|labou?rer|employee|human|figure|character|silhouette of a)\b/i.test(
    scene
  )
}

export function sceneImagePrompt(style: string, scene: string, title: string): string {
  // LEAD with the user's own visual concept so the image matches their bracketed direction
  // (its subject, mood AND colours) instead of being overridden by a fixed dark "dramatic"
  // style string — that override was why images looked mismatched and washed-out/dark.
  const styleText = styleById(style).prompt
  const subject = [scene, title].filter(Boolean).join('. ')
  // Two guards, chosen by what the scene asks for:
  //  - no person mentioned → people are BANNED, so the model cannot fall back to its
  //    favourite subject instead of the one requested;
  //  - a person IS mentioned → they are professionally, modestly dressed, in a setting
  //    that matches the scene. This is a finance channel; wardrobe is never the topic.
  const peopleClause = sceneWantsPerson(subject)
    ? 'Any people shown are fully and modestly dressed in professional attire appropriate to the setting.'
    : 'No people, no faces, no human figures — the image is about the places, objects, charts, documents and city described.'
  return `${subject}. Style: ${styleText}. ${peopleClause} Accurate rich colour, high detail, professional, no text, no watermark, no letters, no captions, no subtitles.`
}

/** The image endpoint both the desktop renderer and the phone preview call. */
export const IMAGE_ENDPOINT = 'https://image.pollinations.ai/prompt/'

/**
 * The exact URL the free image service is asked for. Shared so a phone preview and the
 * desktop render resolve to the SAME picture: with the same prompt, model and seed,
 * Pollinations returns the same image.
 */
export function sceneImageUrl(
  prompt: string,
  opts: { width: number; height: number; seed?: number; model?: string }
): string {
  const params = new URLSearchParams({
    width: String(opts.width),
    height: String(opts.height),
    nologo: 'true',
    // The service's own strict content filter. It was never being sent, which is how
    // undressed strangers ended up inside an institutional finance video. Belt (this)
    // and braces (the people clause in sceneImagePrompt) — neither alone is reliable.
    safe: 'true',
    model: opts.model || 'flux',
    referrer: 'nihilpointzero-studio'
  })
  if (opts.seed !== undefined) params.set('seed', String(opts.seed))
  return `${IMAGE_ENDPOINT}${encodeURIComponent(prompt.slice(0, 1500))}?${params.toString()}`
}
