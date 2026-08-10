/**
 * Which AI brain powers the app:
 * - 'free'      — a keyless, no-install hosted model (needs internet). The default:
 *                 free for life, nothing to sign up for.
 * - 'ollama'    — a model running locally on this PC (free, offline; needs install).
 * - 'anthropic' — Claude, your key (paid, highest quality).
 * - 'openai'    — OpenAI, your key (paid).
 */
export type LLMProviderId = 'free' | 'anthropic' | 'openai' | 'ollama' | 'gemini'

export interface ProviderSettings {
  activeProvider: LLMProviderId
  freeModel: string
  anthropicModel: string
  openaiModel: string
  ollamaModel: string
  hasAnthropicKey: boolean
  /** Gemini is FREE-keyed (AI Studio) — keyed like YouTube, not billed like Anthropic. */
  hasGeminiKey: boolean
  geminiModel: string
  /**
   * The switchboard: which brains the app is ALLOWED to contact. A brain switched off
   * is never used, not even as a fallback — "off" that still answers is not off.
   */
  providerEnabled: Record<LLMProviderId, boolean>
  hasOpenAIKey: boolean
  hasYouTubeKey: boolean
  /** Optional free AI Horde key for faster photo-to-scene (img2img) generation. */
  hasHordeKey: boolean
  /** Optional free MVSEP token for online music separation (remove music from outside videos). */
  hasMvsepToken: boolean
  /** Optional local Demucs command/path for offline music separation. */
  demucsCmd: string
  /**
   * Optional local face-animation tool for the Presenter GRAFT mode (full-quality
   * "living picture"). A command template with {photo} {video} {audio} {out}
   * placeholders; when unset, the built-in ffmpeg graft is used.
   */
  faceAnimCmd: string
  /** The user's YouTube channel ID, used to deep-link the upload page. */
  youtubeChannelId: string
  /** Which installable Piper voice narrates when narrationVoice is 'piper'. */
  piperVoiceId: string
  /** Open the studio when Windows starts (default on). */
  startWithWindows: boolean
}

export interface YouTubeSignal {
  title: string
  channelTitle: string
  viewCount: number
  publishedAt: string
}

export interface OllamaStatus {
  connected: boolean
  models: string[]
}

export type LanguageMix = 'balanced' | 'mostly-english' | 'mostly-roman-urdu' | 'formal-urdu'

export type ScriptLength = 'short' | 'long' | 'deep-dive' | 'feature-90' | 'feature-180'

export type ScriptStyle =
  | 'standard'
  | 'deep-dive'
  | 'masterclass'
  | 'institutional-framework'
  | 'financial-research'
  | 'technical-charting'
  | 'fundamental-deep-dive'
  | 'infotainment'
  | 'normal'
  | 'hooking'

export interface IdeaGenRequest {
  focusArea: string
  audienceNote?: string
  count: number
}

export interface VideoIdea {
  id: string
  title: string
  hook: string
  angle: string
  viewPotentialScore: number
  viewPotentialReason: string
  competitionLevel: 'low' | 'medium' | 'high'
  contentPillars: string[]
  suggestedLength: ScriptLength
  createdAt: string
}

export interface ScriptGenRequest {
  topic: string
  ideaContext?: string
  length: ScriptLength
  languageMix: LanguageMix
  audienceNote?: string
  verifiedData?: string
  /** User-selected stylistic modes to blend into the output. */
  styles?: ScriptStyle[]
  /** Auto-populated server-side from live news search — not user-editable. */
  recentNewsContext?: string
}

export interface GeneratedScript {
  id: string
  topic: string
  length: ScriptLength
  languageMix: LanguageMix
  title: string
  body: string
  estimatedWordCount: number
  estimatedDurationMinutes: number
  createdAt: string
}

/** A generated picture saved in the Library (scene images, thumbnails). */
export interface SavedImage {
  title: string
  /** Absolute path of the image file on disk. */
  path: string
  /** Where it came from, e.g. "Scene Studio" or "Thumbnail". */
  source: string
}

export interface LibraryEntry {
  id: string
  kind: 'idea' | 'script' | 'image'
  data: VideoIdea | GeneratedScript | SavedImage
  savedAt: string
  /** Set when the user moves the entry to the Trash Can. Only the user can empty the
   *  Trash — nothing in the app deletes library items outright. */
  trashedAt?: string
}

export interface TrendTopic {
  topic: string
  why: string
  momentum: 'rising' | 'steady' | 'seasonal'
}

/** One OHLC price bar for charting. `date` is an ISO date string. */
export interface PriceBar {
  date: string
  open: number
  high: number
  low: number
  close: number
  volume: number | null
}

/** A price series plus indicator overlays (aligned index-for-index with `bars`). */
export interface PriceSeries {
  bars: PriceBar[]
  sma20: (number | null)[]
  sma50: (number | null)[]
  rsi14: (number | null)[]
  /** Non-empty when the file/series could not be read. */
  error?: string
}

export interface FileAnalysis {
  fileName: string
  kind: 'technical' | 'fundamental' | 'flow' | 'document'
  summary: string
}

export interface FileImportResult {
  canceled: boolean
  analysis?: FileAnalysis
  error?: string
}

export interface PsxFetchResult {
  canceled: boolean
  savedPath?: string
  analysis?: FileAnalysis
  error?: string
}

/** Result of analysing LIVE PSX end-of-day data for one symbol (all figures computed in-app). */
export interface PsxLiveAnalysis {
  symbol: string
  points: number
  from: string
  to: string
  latest: number
  latestDate: string
  changePct: number | null
  high52w: number
  low52w: number
  yearChangePct: number | null
  sma20: number | null
  sma50: number | null
  sma200: number | null
  rsi14: number | null
  latestVolume: number
  volumeVs20dAvg: number | null
  trend: string
}

export interface CorrelationResult {
  canceled: boolean
  summary?: string
  error?: string
}

export type VideoResolution = '1080p' | '1440p' | '4k' | '8k'

/** Frame shape: 16:9 (landscape/YouTube), 9:16 (Shorts/Reels/TikTok), 1:1 (square). */
export type VideoAspect = '16:9' | '9:16' | '1:1'
export const VIDEO_ASPECTS: VideoAspect[] = ['16:9', '9:16', '1:1']

/** Graphics v2 finishing template (colour-grade / vignette / grain / letterbox / animated title). */
export type VideoTemplate = 'clean' | 'news' | 'cinematic' | 'bold'
export const VIDEO_TEMPLATES: VideoTemplate[] = ['clean', 'news', 'cinematic', 'bold']

/**
 * Visual style for the free preset renderer and AI scene images. Several distinct looks
 * per family — see main/image/styles.ts for what each one actually asks for.
 */
export type VideoStyle =
  | 'cinematic'
  | 'noir'
  | 'blockbuster'
  | 'vintage-film'
  | 'documentary'
  | 'cartoon'
  | 'cartoon-3d'
  | 'comic'
  | 'watercolour'
  | 'anime'
  | 'anime-90s'
  | 'anime-pastoral'
  | 'anime-dark'
  | 'neon'
  | 'minimal'
  | 'infographic'

export const VIDEO_STYLES: VideoStyle[] = [
  'cinematic',
  'noir',
  'blockbuster',
  'vintage-film',
  'documentary',
  'cartoon',
  'cartoon-3d',
  'comic',
  'watercolour',
  'anime',
  'anime-90s',
  'anime-pastoral',
  'anime-dark',
  'neon',
  'minimal',
  'infographic'
]

/** Human-readable grouping for the style picker. */
export const VIDEO_STYLE_GROUPS: { family: string; styles: { id: VideoStyle; label: string }[] }[] = [
  {
    family: 'Cinematic',
    styles: [
      { id: 'cinematic', label: 'Modern film' },
      { id: 'noir', label: 'Film noir' },
      { id: 'blockbuster', label: 'Blockbuster' },
      { id: 'vintage-film', label: 'Vintage 70s' },
      { id: 'documentary', label: 'Documentary' }
    ]
  },
  {
    family: 'Cartoon',
    styles: [
      { id: 'cartoon', label: 'Bold flat' },
      { id: 'cartoon-3d', label: '3D animated film' },
      { id: 'comic', label: 'Comic book' },
      { id: 'watercolour', label: 'Watercolour storybook' }
    ]
  },
  {
    family: 'Anime',
    styles: [
      { id: 'anime', label: 'Modern key visual' },
      { id: 'anime-90s', label: 'Retro 90s' },
      { id: 'anime-pastoral', label: 'Painterly pastoral' },
      { id: 'anime-dark', label: 'Dark seinen' }
    ]
  },
  {
    family: 'Other',
    styles: [
      { id: 'neon', label: 'Neon cyberpunk' },
      { id: 'minimal', label: 'Minimal / clean' },
      { id: 'infographic', label: 'Infographic / explainer' }
    ]
  }
]

/**
 * Which engine renders the video's look:
 * - 'presets'       — free, offline style renderer (default). Styles text/backgrounds and
 *   your own images; does NOT fabricate AI footage.
 * - 'ai-free'       — FREE online AI visuals: generates a unique AI image per scene (keyless,
 *   no install; needs internet) and animates them — a photo slideshow, not filmed motion.
 *   Falls back to the animated look if offline / the service is busy.
 * - 'ai-free-video' — REAL generated motion per scene from the free cloud (Google Veo via
 *   Puter — no API key; the user signs into a free Puter account once). Every failure
 *   (offline, allowance used up, sign-in declined) falls back per scene to the slideshow,
 *   with the reason reported — the build never breaks.
 * - 'ai-cloud'      — paid cloud AI video footage; you supply an API key.
 * - 'ai-local'      — REAL generated motion on your own NVIDIA GPU through a local ComfyUI
 *   server (LTX and friends). Visible (greyed) even without the GPU so the option is ready
 *   the day the hardware exists; falls back to the slideshow when the server isn't there.
 */
export type LookEngine = 'presets' | 'ai-free' | 'ai-free-video' | 'ai-cloud' | 'ai-local'

/** Optional configuration for the AI-footage engines (stored locally). */
export interface AiVideoConfig {
  /** Cloud engine: your provider API key (decrypted, in memory only — see cloudApiKeyEnc). */
  cloudApiKey?: string
  /** Cloud engine key at rest — encrypted like every other key (store.ts migrates old plain values). */
  cloudApiKeyEnc?: string
  /** Cloud engine: REST endpoint that accepts {prompt, seconds} and returns a video URL. */
  cloudEndpoint?: string
  cloudModel?: string
  /** Local engine: base URL of your local generation server (default depends on localKind). */
  localEndpoint?: string
  /** Local engine kind: a real ComfyUI server (default) or the legacy generic /generate shim. */
  localKind?: 'comfyui' | 'generic'
  /**
   * Path to a ComfyUI workflow file (exported in API format) with {{PROMPT}} {{WIDTH}}
   * {{HEIGHT}} {{FRAMES}} {{SEED}} placeholders. Blank = the built-in LTX starter template.
   */
  comfyWorkflowPath?: string
  /**
   * Which free-cloud route generates real motion:
   * - 'puter' (default): Google Veo via Puter — no key, but needs a Puter account
   *   sign-in (their phone verification rejects some countries' numbers).
   * - 'pollinations': gen.pollinations.ai with a free developer key (GitHub/email,
   *   NO phone) — a small daily Pollen grant renews every day.
   */
  freeCloudProvider?: 'puter' | 'pollinations'
  /** Free-cloud engine: Puter model id (default 'google/veo-3.1-fast'). */
  freeCloudModel?: string
  /** Pollinations route: the pk_/sk_ key (decrypted, in memory only — see pollinationsKeyEnc). */
  pollinationsKey?: string
  /** Pollinations key at rest — encrypted like every other key. */
  pollinationsKeyEnc?: string
  /** Pollinations route: video model (default 'wan-fast' — the cheapest real-motion model). */
  pollinationsModel?: string
  /**
   * Free-cloud engine: at most this many scenes get REAL generated motion per build
   * (default 5) — protects the small free Puter allowance; the rest use AI stills.
   */
  freeCloudSceneCap?: number
}

/** Live status of the AI engines, for the UI badges. */
export interface AiEngineStatus {
  cloudConfigured: boolean
  localDetected: boolean
  /** True when the chosen free-cloud video route is usable right now. */
  freeCloudAvailable: boolean
  /** One-line plain-English detail for the free-cloud pill (why it is/isn't available). */
  freeCloudDetail: string
  /** Which free-cloud route the status describes. */
  freeCloudProvider: 'puter' | 'pollinations'
  /** Which local server kind the status was checked against. */
  localKind: 'comfyui' | 'generic'
  cloudEndpoint?: string
  localEndpoint?: string
}

export interface VideoBuildRequest {
  title: string
  body: string
  /** Output resolution — 1080p (default), 1440p, 4k, or 8k. */
  resolution?: VideoResolution
  /** Frame shape — 16:9 (default), 9:16 (Shorts/Reels), or 1:1 (square). */
  aspect?: VideoAspect
  /** Graphics v2 finishing template (clean/news/cinematic/bold). */
  template?: VideoTemplate
  /**
   * Computer narration voice:
   *  - 'winnatural' — Windows NATURAL voice (best free quality; the only route to the
   *    Urdu Asad/Uzma voices once the Windows Urdu speech pack is installed)
   *  - 'piper'      — bundled offline natural voice
   *  - 'windows'    — legacy robotic System.Speech voice
   *  - 'silent'     — no narration at all, so the user can record their own over it
   */
  narrationVoice?: 'windows' | 'piper' | 'winnatural' | 'silent'
  /** Which Windows natural voice to use (WinRT voice id) when narrationVoice is 'winnatural'. */
  winVoiceId?: string
  /** Absolute path to a background music file (chosen via the pick-music dialog). */
  musicPath?: string
  /** Add a soft transition sound at each section change. */
  soundEffects?: boolean
  /** Look engine (default 'presets'). */
  engine?: LookEngine
  /** Visual style for the preset engine (default 'cinematic'). */
  style?: VideoStyle
  /** Optional user images (absolute paths) shown as a Ken-Burns slideshow background. */
  images?: string[]
  /**
   * Per-image pacing and hand-offs (Scene Studio). When present it WINS over `images`:
   * every shot is shown exactly once, in order, with the user's seconds (scaled to fit
   * the narration length) and the chosen visual transition into each shot.
   */
  imageShots?: ImageShot[]
  /** Use real stock footage (online) matched to the script (needs a saved Pixabay key). */
  useStock?: boolean
  /**
   * Generate subtitles (.srt) and YouTube chapter timestamps after the build.
   * OFF unless explicitly set — a video should never come back with captions or
   * chapters the user did not ask for.
   */
  captionsAndChapters?: boolean
  /**
   * false = a CLEAN build: no title overlay, no section heading cards — nothing drawn
   * over the picture ("clean copy" of an existing video). Default true.
   */
  textOverlays?: boolean
}

/**
 * Finished videos the app cannot currently show — either sitting unlisted in the
 * active work folder, or left behind in a data folder the app stopped using.
 * See main/strandedData.ts.
 */
export interface StrandedReport {
  /** The other data folder holding work, or null when there isn't one. */
  dir: string | null
  /** Videos already in the active folder that the app's list lost track of. */
  inPlace: number
  /** Videos sitting in that other folder. */
  elsewhere: number
  /** inPlace + elsewhere. */
  videoCount: number
  bytes: number
  /** Human-readable size, e.g. "1.15 GB". */
  size: string
}

/** Visual hand-off INTO a slideshow scene (ffmpeg xfade). 'cut' = instant switch. */
export type SceneTransition =
  | 'cut'
  | 'fade'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'circleopen'
  | 'dissolve'
export const SCENE_TRANSITIONS: { value: SceneTransition; label: string }[] = [
  { value: 'cut', label: 'Straight cut' },
  { value: 'fade', label: 'Fade' },
  { value: 'dissolve', label: 'Dissolve' },
  { value: 'slideleft', label: 'Slide from right' },
  { value: 'slideright', label: 'Slide from left' },
  { value: 'slideup', label: 'Slide from below' },
  { value: 'slidedown', label: 'Slide from above' },
  { value: 'circleopen', label: 'Circle open' }
]

/** One slideshow scene with user pacing: the image, how long it stays, how it arrives. */
export interface ImageShot {
  path: string
  /** Desired seconds on screen — treated as a weight, scaled so the total matches the narration. */
  seconds?: number
  /** Visual transition INTO this shot (ignored for the first shot). */
  transition?: SceneTransition
}

export interface VideoJob {
  id: string
  title: string
  path: string
  hasCustomVoice: boolean
  createdAt: string
  /** Saved narration-only audio, so background music can later be removed/replaced
   * exactly (no AI un-mixing). Present for videos built after this feature shipped. */
  narrationPath?: string
  /**
   * The video's own recipe, remembered at build time (videos built after this
   * shipped). It powers per-video features that must know the CONTENT and settings:
   * the AI DJ reads `body` to pick fitting music, and "clean copy" rebuilds the
   * same video without captions/title cards. Older jobs simply lack these.
   */
  body?: string
  resolution?: VideoResolution
  aspect?: VideoAspect
  template?: VideoTemplate
  engine?: LookEngine
  style?: VideoStyle
  /**
   * What went into the video that might need crediting — the music track the app fetched,
   * stock footage, images. Recorded at build time so the pre-publish credit check has
   * something to check: without it the app knew a track needed attribution and had no way
   * to tell WHICH video it went into. Older jobs simply lack it.
   */
  credits?: import('./copyrightCheck').CreditedItem[]
}

/** How a cut is applied: keep only the selected range, or remove it (see main/video/trim.ts). */
export type TrimMode = 'keep' | 'remove'

/** Procedural music moods and SFX kinds the built-in generator can synthesize. */
export type Mood = 'calm' | 'uplifting' | 'tense' | 'lofi' | 'corporate' | 'cinematic'
export type SfxKind = 'whoosh' | 'riser' | 'impact' | 'click' | 'pop' | 'swell' | 'subdrop'
export const MOODS: Mood[] = ['calm', 'uplifting', 'tense', 'lofi', 'corporate', 'cinematic']
export const SFX_KINDS: SfxKind[] = ['whoosh', 'riser', 'impact', 'click', 'pop', 'swell', 'subdrop']

/** Delivery/export formats a finished video can be transcoded to (see main/video/export.ts). */
export type ExportFormat = 'youtube' | 'mp4-h264' | 'mp4-h265' | 'mov' | 'webm-vp9'

export interface ExportFormatInfo {
  id: ExportFormat
  label: string
  /** Container file extension (no dot). */
  ext: string
  /** Short, user-facing note shown in the UI. */
  note: string
}

/** Ordered descriptors for the export dropdown. `youtube` is the recommended default. */
export const EXPORT_FORMATS: ExportFormatInfo[] = [
  { id: 'youtube', label: 'YouTube Optimized (MP4 · H.264)', ext: 'mp4', note: 'Best default for uploading to YouTube.' },
  { id: 'mp4-h264', label: 'MP4 · H.264 (universal)', ext: 'mp4', note: 'Plays almost everywhere.' },
  { id: 'mp4-h265', label: 'MP4 · H.265/HEVC (smaller file)', ext: 'mp4', note: 'Smaller size; needs a modern player.' },
  { id: 'mov', label: 'MOV · H.264 (editors)', ext: 'mov', note: 'Friendly to video editors.' },
  { id: 'webm-vp9', label: 'WebM · VP9 (open/web)', ext: 'webm', note: 'Open codec; great for the web.' }
]

/** Result of importing a script from a user-picked file (.txt/.md/.srt/.pdf). */
export interface ScriptImportResult {
  canceled: boolean
  /** Filename-derived title (no extension). */
  title?: string
  /** Extracted plain-text body ready to narrate. */
  body?: string
  /** Non-empty when the file was picked but text could not be extracted. */
  error?: string
}

/** The persistent free-write scratchpad ("Script Pad"), stored on disk. */
export interface ScriptPad {
  title: string
  body: string
  updatedAt: string
}

/** A no-copyright track found via the online free-music search (Openverse, CC). */
export interface FreeTrack {
  id: string
  title: string
  artist: string
  license: string
  licenseUrl?: string
  landingUrl?: string
  /** Direct audio file for in-app preview / download (absent for some results). */
  audioUrl?: string
  durationSec?: number
}

/** Result of an online music search — degrades gracefully when offline. */
export interface MusicSearchResult {
  tracks: FreeTrack[]
  online: boolean
  error?: string
}

/**
 * A single edit the AI Director can perform, mapping 1:1 to a verified engine op.
 * The AI only decides WHAT (these structured actions); the tested code does the HOW.
 */
export type DirectorAction =
  | { type: 'keep'; startSec: number; endSec: number }
  | { type: 'remove'; startSec: number; endSec: number }
  | { type: 'music'; mood: Mood; atSec: number; gain?: number }
  | { type: 'sfx'; kind: SfxKind; atSec: number; gain?: number }

/** The AI Director's reading of an instruction: either an edit plan or a plain reply. */
export interface DirectorInterpretation {
  kind: 'edit' | 'reply'
  /** Plain-English explanation of what it will do (or the answer, for 'reply'). */
  explanation: string
  /** The ordered edits to apply (empty for 'reply'). */
  actions: DirectorAction[]
}

/** One placed sound on the DJ-station timeline. */
export interface AudioClip {
  id: string
  /** Absolute path to the source audio file. */
  src: string
  label: string
  /** When the clip starts, in seconds from the start of the video. */
  atSec: number
  /** Optional in-point within the source file (use only a segment). */
  startSec?: number
  /** Optional out-point within the source file. */
  endSec?: number
  /** Linear gain multiplier (1 = unchanged). */
  gain: number
  /** Fade in / out lengths in seconds. */
  fadeIn: number
  fadeOut: number
}

/** A named, saved arrangement of placed sounds, mixed over a video's own audio. */
export interface AudioPlan {
  id: string
  name: string
  clips: AudioClip[]
  savedAt: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: string
}

/** Sent to the Advisor: the running conversation plus optional context about what the user is working on. */
export interface AdvisorRequest {
  messages: { role: 'user' | 'assistant'; content: string }[]
  /** Free-text context (current topic / script excerpt / styles) so the advisor can reason about the actual task. */
  context?: string
}

/**
 * The AI Command Panel ("Studio Agent"). The user types a plain-English request and
 * the active AI turns it into an ordered plan of SAFE, validated steps that the
 * already-tested engine executes end-to-end. As with the AI Director, the model only
 * decides WHAT (this small fixed set of steps with validated fields); the code does the
 * HOW — so the model can never run arbitrary code, ffmpeg, or touch the filesystem.
 */
export type AgentStep =
  | { type: 'write_script'; topic: string; lengthMinutes?: number; languageMix?: LanguageMix }
  | {
      type: 'build_video'
      /** Where the script comes from: a script written earlier in this run, the Script Pad, or inline text. */
      source: 'generated' | 'scriptpad' | 'text'
      title?: string
      body?: string
      style?: VideoStyle
      resolution?: VideoResolution
      /** A music bed mood to generate and lay under the narration ('none' = no music). */
      musicMood?: Mood | 'none'
      soundEffects?: boolean
      /** Generate free AI visuals (one image per scene) instead of the animated look. */
      aiVisuals?: boolean
    }
  | { type: 'make_thumbnail'; headline: string; style?: VideoStyle; aiBackground?: boolean }
  | { type: 'generate_image'; prompt: string; style?: VideoStyle }
  | { type: 'generate_ideas'; focus: string; count?: number }
  // ── Tabs the agent can also operate (create/edit only — never deletes or publishes) ──
  /** Writes (or appends to) the Script Pad tab. */
  | { type: 'write_scriptpad'; text: string; title?: string; append?: boolean }
  /** Fetches LIVE PSX data for a symbol and analyses it; optionally writes a narration script. */
  | { type: 'analyze_psx'; symbol: string; language?: string; makeScript?: boolean }
  /** Generates a music bed of the given mood/length (DJ Station / audio). */
  | { type: 'generate_music'; mood: Mood; seconds?: number }
  /** Plans the scene breakdown (Scene Studio) from this run's script or the Script Pad. */
  | { type: 'plan_scenes'; source?: 'generated' | 'scriptpad'; style?: VideoStyle; direction?: string }

export type AgentStepType = AgentStep['type']

// ─────────────────────────── Timeline NLE ───────────────────────────
/** One video clip on the timeline: a source file trimmed to [inSec, outSec]. */
export interface TimelineVideoClip {
  id: string
  src: string
  /** Source in-point (seconds into the file). */
  inSec: number
  /** Source out-point (seconds into the file). */
  outSec: number
  /** Crossfade INTO this clip from the previous one, in seconds (0/undefined = hard cut). */
  transitionSec?: number
  /** UI label only. */
  name?: string
}

/** One audio clip on the timeline, placed at `atSec` on the master timeline. */
export interface TimelineAudioClip {
  id: string
  src: string
  inSec: number
  outSec: number
  /** Position on the master timeline (seconds). */
  atSec: number
  /** Linear gain (0 = mute, 1 = unchanged). */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  name?: string
}

/** A text overlay drawn over the video between [startSec, endSec]. */
export interface TimelineTextOverlay {
  id: string
  text: string
  startSec: number
  endSec: number
  x?: 'left' | 'center' | 'right'
  y?: 'top' | 'middle' | 'bottom'
  fontSize?: number
  /** Fade in/out ramp length in seconds. */
  fadeSec?: number
}

/** A full timeline project. Video and audio are separate tracks. */
export interface TimelineDoc {
  width: number
  height: number
  fps: number
  video: TimelineVideoClip[]
  audio: TimelineAudioClip[]
  text: TimelineTextOverlay[]
}

// ─────────────────────────── Storyboard Director ───────────────────────────
/** Who/what is on screen for a beat. The user keeps their REAL face via 'photo'/'clip'. */
/**
 * GRAFT region — how the moving part of the user's video is composited onto their
 * picture ("living picture"). All values normalized 0..1 of the respective frame.
 */
export interface GraftRegion {
  /** Source rect in the VIDEO (top-left x/y + width/height). */
  sx: number
  sy: number
  sw: number
  sh: number
  /** Destination on the PICTURE frame: top-left x/y + width (height follows the source aspect). */
  dx: number
  dy: number
  dw: number
  /** Edge feather as a fraction of the grafted part's width (0 = hard cut). */
  featherFrac: number
  /** Colour tweak so the part sits naturally on the picture. */
  brightness: number
  saturation: number
}

export type ShotSubjectKind = 'none' | 'photo' | 'clip' | 'ai-person'

export interface ShotSubject {
  kind: ShotSubjectKind
  /** For 'ai-person': a description of the character to generate. */
  description?: string
  /** For 'clip': the user's own footage file (optional at plan time; filled in the UI). */
  src?: string
  /** For 'photo': beautify the composited photo. */
  beautify?: boolean
}

/** Ken-Burns / camera motion hint for a beat. */
export type ShotMotion = 'still' | 'in' | 'out' | 'left' | 'right' | 'up' | 'down'

/** A sound attached to a beat: a generated music bed, a generated SFX, or the user's own file. */
export interface BeatSound {
  id: string
  kind: 'music' | 'sfx' | 'file'
  /** Music mood (a Mood) or SFX kind (a SfxKind) when generated. Ignored for 'file'. */
  ref?: string
  /** The user's own audio file when kind === 'file'. */
  src?: string
  /** Linear gain (0 = mute, 1 = unchanged). */
  gain?: number
  fadeInSec?: number
  fadeOutSec?: number
  /** Start offset within the beat, in seconds (0 = at the beat's start). */
  atSec?: number
  /** UI label only. */
  name?: string
}

/** One beat of the screenplay: a timed shot with a scene, a subject, narration and a caption. */
export interface StoryboardBeat {
  id: string
  /** How long this beat lasts, in seconds. */
  durationSec: number
  /** What the camera shows — the scene/background description (fed to free image gen). */
  visual: string
  /** Spoken narration for this beat (TTS). Optional. */
  narration?: string
  /** Optional on-screen text overlay for this beat. */
  caption?: string
  /** Who is on screen. */
  subject: ShotSubject
  /** Crossfade INTO this beat from the previous one, seconds (0 = hard cut). */
  transitionSec?: number
  /** Camera motion hint. */
  motion?: ShotMotion
  /** Mood tag for this beat (e.g. 'triumphant', 'somber'). */
  mood?: string
  /** Per-beat sounds: music beds, SFX, or the user's own audio, mixed under this shot. */
  sounds?: BeatSound[]
}

/** A full storyboard the director compiles into a TimelineDoc and renders. */
export interface StoryboardDoc {
  title: string
  style: VideoStyle
  width: number
  height: number
  fps: number
  /** Narration language, e.g. 'English', 'Roman Urdu', 'Urdu'. */
  language?: string
  beats: StoryboardBeat[]
}

/** The agent's reading of a command: an ordered plan (possibly empty) + a plain-English reply. */
export interface AgentPlan {
  /** Short plain-English summary of what it will do, or the answer when there are no steps. */
  reply: string
  steps: AgentStep[]
}

/** The outcome of one executed step, surfaced to the UI. */
export interface AgentStepResult {
  type: AgentStepType
  /** Human-readable label of what this step did. */
  label: string
  ok: boolean
  /** A produced artifact path (thumbnail), if any. */
  path?: string
  /** A produced video job (build step), so the UI can play/list it. */
  video?: VideoJob
  /** Extra detail on success (e.g. the generated script title). */
  detail?: string
  error?: string
}

export interface AgentRunResult {
  results: AgentStepResult[]
}

/** Ready-to-paste posting text for a finished clip (YouTube/TikTok/Reels). */
export interface PostMetadata {
  title: string
  description: string
  hashtags: string[]
}

export type HealthStatus = 'ok' | 'warn' | 'fail'
export interface HealthCheck {
  name: string
  status: HealthStatus
  /** Plain-English verdict — never contains key material. */
  detail: string
}
export interface HealthReport {
  checkedAt: string
  checks: HealthCheck[]
  failCount: number
  warnCount: number
}

export type ActivityActor = 'ai' | 'user'

/** One way in to the phone web-view server: a network this PC is on, and its link. */
export interface WebServerAddress {
  /** Plain-English label, e.g. "Home Wi-Fi" or "Private VPN". */
  label: string
  address: string
  url: string
  /** True for a private-VPN address — the one that keeps working on mobile data. */
  remote: boolean
}

export interface WebServerStatus {
  running: boolean
  /** The best single link, kept for existing callers. */
  url: string | null
  /** Every network this PC can be reached on, so the user picks the right one. */
  addresses: WebServerAddress[]
}

export interface ActivityLogEntry {
  id: string
  timestamp: string
  actor: ActivityActor
  action: string
  details?: string
}

/** A free, copyright-safe music track (Pixabay or an open Creative-Commons index). */
export interface MusicTrack {
  id: string
  title: string
  tags: string
  durationSec: number
  url: string
  pageUrl?: string
  source: 'pixabay' | 'openverse'
  /** e.g. 'Pixabay', 'CC0', 'BY', 'BY-SA'. Shown so the licence is never a surprise. */
  license: string
  /**
   * True when the licence obliges the user to credit the artist. Monetised YouTube is
   * fine either way, but "no credit needed" vs "must credit" is the difference between
   * pasting a line in the description or getting a claim, so it is never hidden.
   */
  needsAttribution: boolean
}

/** What the music picker gets back: the moods the AI chose plus matching tracks. */
export interface MusicSuggestion {
  moods: string[]
  tracks: MusicTrack[]
  /** Set when no music could be found, so the UI can say why instead of showing nothing. */
  note?: string
  /** Direct category pages on the FREE libraries matching these moods (opened externally). */
  libraryLinks?: { name: string; url: string }[]
  /** The built-in synthesizer mood that best fits the subject (drives "make music"). */
  synthMood?: Mood
}

/** What this PC can actually run — see main/hardware/gpu.ts. */
export interface HardwareReport {
  gpu: {
    name: string
    vramGB: number
    hasCuda: boolean
    integrated: boolean
    totalRamGB: number
  }
  summary: string
  models: {
    id: string
    label: string
    minVramGB: number
    note: string
    verdict: { canRun: boolean; message: string; suggestion?: string }
  }[]
}

/** One recorded AI failure, shown in Settings → Known Issues. */
export interface AiErrorEntry {
  at: string
  provider: string
  feature: string
  status?: number
  ms?: number
  message: string
  body?: string
}

/** One video waiting to be built. See shared/renderQueue.ts for the rules around it. */
export type { QueueItem, QueueState, QueueSummary } from './renderQueue'

/** A stretch of the recording to KEEP. See main/video/silence.ts — spans to keep are
 * planned rather than spans to remove, which makes an overlap or a backwards span
 * structurally impossible. */
export interface KeepSpan {
  startSec: number
  endSec: number
}

/** What the dead-air cut did, for the user. */
export interface SilenceSummary {
  removedSec: number
  keptSec: number
  cuts: number
  /** One line for the user. */
  headline: string
}
