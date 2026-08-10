import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc-channels'
import type { ImportedProject } from '../shared/project'
import type {
  AdvisorRequest,
  IdeaGenRequest,
  LLMProviderId,
  LibraryEntry,
  ScriptGenRequest,
  VideoBuildRequest
} from '../shared/types'

const api = {
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    setProvider: (provider: LLMProviderId) => ipcRenderer.invoke(IPC.settingsSetProvider, provider),
    setModel: (provider: LLMProviderId, model: string) => ipcRenderer.invoke(IPC.settingsSetModel, provider, model),
    setApiKey: (provider: LLMProviderId, key: string) => ipcRenderer.invoke(IPC.settingsSetApiKey, provider, key),
    setYouTubeKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetYouTubeKey, key),
    /** The switchboard: turn a brain ON or OFF. Off means never contacted, even as a fallback. */
    setProviderEnabled: (provider: LLMProviderId, on: boolean) =>
      ipcRenderer.invoke(IPC.settingsSetProviderEnabled, provider, on),
    setYouTubeChannel: (id: string) => ipcRenderer.invoke(IPC.settingsSetYouTubeChannel, id),
    setHordeKey: (key: string) => ipcRenderer.invoke(IPC.settingsSetHordeKey, key),
    setMvsepToken: (key: string) => ipcRenderer.invoke(IPC.settingsSetMvsepToken, key),
    setDemucsCmd: (cmd: string) => ipcRenderer.invoke(IPC.settingsSetDemucsCmd, cmd),
    setFaceAnimCmd: (cmd: string) => ipcRenderer.invoke(IPC.settingsSetFaceAnimCmd, cmd),
    setPiperVoice: (voiceId: string) => ipcRenderer.invoke(IPC.settingsSetPiperVoice, voiceId),
    /** Open the studio when Windows starts. Applied to Windows straight away, not just
     * saved, so the toggle can be seen to work. */
    setStartWithWindows: (on: boolean): Promise<{ on: boolean; applied: boolean }> =>
      ipcRenderer.invoke(IPC.settingsSetStartWithWindows, on),
    ollamaStatus: () => ipcRenderer.invoke(IPC.ollamaStatus)
  },
  // The Caretaker: the scheduled self-diagnostic and its record (Settings → Caretaker).
  caretaker: {
    status: (): Promise<import('../shared/caretaker').CaretakerStatus> => ipcRenderer.invoke(IPC.caretakerStatus),
    runNow: (): Promise<import('../shared/caretaker').CaretakerRun> => ipcRenderer.invoke(IPC.caretakerRunNow),
    setSchedule: (hours: number, paused: boolean): Promise<import('../shared/caretaker').CaretakerStatus> =>
      ipcRenderer.invoke(IPC.caretakerSetSchedule, hours, paused),
    clearLog: (): Promise<import('../shared/caretaker').CaretakerStatus> => ipcRenderer.invoke(IPC.caretakerClearLog)
  },
  ideas: {
    generate: (req: IdeaGenRequest) => ipcRenderer.invoke(IPC.ideasGenerate, req)
  },
  script: {
    generate: (req: ScriptGenRequest) => ipcRenderer.invoke(IPC.scriptGenerate, req),
    generateVoiceover: (text: string, suggestedName: string) =>
      ipcRenderer.invoke(IPC.voiceoverGenerate, text, suggestedName),
    generateThumbnail: (topic: string, title: string) =>
      ipcRenderer.invoke(IPC.thumbnailGenerate, topic, title),
    // Renders an actual thumbnail PNG from a headline + style; returns its file path.
    renderThumbnail: (
      headline: string,
      style: import('../shared/types').VideoStyle,
      bgImage?: string
    ): Promise<string> => ipcRenderer.invoke(IPC.thumbnailRender, headline, style, bgImage),
    saveThumbnail: (srcPath: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.thumbnailSave, srcPath),
    // Subscribe to feature-length chaptering progress. Returns an unsubscribe fn —
    // the caller must call it when generation ends to avoid piling up listeners.
    onProgress: (cb: (stage: string) => void) => {
      const listener = (_e: unknown, stage: string): void => cb(stage)
      ipcRenderer.on(IPC.scriptProgress, listener)
      return () => ipcRenderer.removeListener(IPC.scriptProgress, listener)
    }
  },
  library: {
    list: () => ipcRenderer.invoke(IPC.libraryList),
    save: (entry: Omit<LibraryEntry, 'id' | 'savedAt'>) => ipcRenderer.invoke(IPC.librarySave, entry),
    // "remove" only moves the entry to the Trash Can (reversible). The two permanent
    // actions below run ONLY from explicit user clicks in the Library's Trash view.
    remove: (id: string) => ipcRenderer.invoke(IPC.libraryDelete, id),
    restore: (id: string) => ipcRenderer.invoke(IPC.libraryRestore, id),
    removeForever: (id: string) => ipcRenderer.invoke(IPC.libraryDeleteForever, id),
    emptyTrash: () => ipcRenderer.invoke(IPC.libraryEmptyTrash)
  },
  exportText: (suggestedName: string, content: string) => ipcRenderer.invoke(IPC.exportText, suggestedName, content),
  data: {
    importFile: () => ipcRenderer.invoke(IPC.dataImportFile),
    chartPriceFile: (): Promise<{ canceled: boolean; series?: import('../shared/types').PriceSeries; name?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.chartPriceFile),
    fetchPsxDocument: (url: string) => ipcRenderer.invoke(IPC.dataFetchPsxDocument, url),
    correlateFlowPrice: () => ipcRenderer.invoke(IPC.dataCorrelateFlowPrice)
  },
  // LIVE PSX data portal (dps.psx.com.pk) — fetch real EOD history, analyse it in-app
  // with the tested math, export Excel, and generate a reasoned narration script.
  psx: {
    analyze: (symbol: string): Promise<{ ok: boolean; analysis?: import('../shared/types').PsxLiveAnalysis; summary?: string; error?: string; staleAsOf?: string | null }> =>
      ipcRenderer.invoke(IPC.psxLiveAnalyze, symbol),
    excel: (symbol: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.psxLiveExcel, symbol),
    script: (
      symbol: string,
      directives?: { instruction?: string; language?: string; style?: string }
    ): Promise<{ ok: boolean; title?: string; script?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.psxLiveScript, symbol, directives),
    series: (symbol: string): Promise<{ ok: boolean; series?: import('../shared/types').PriceSeries; name?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.psxLiveSeries, symbol)
  },
  // Generic: turn already-computed figures (e.g. an uploaded NCCPL FIPI/LIPI analysis) into a
  // narration script, in the requested language/instruction. Used by the NCCPL tab.
  analysis: {
    script: (
      kind: 'technical' | 'financial' | 'flow',
      subject: string,
      figures: string,
      directives?: { instruction?: string; language?: string; style?: string }
    ): Promise<{ ok: boolean; title?: string; script?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.analysisScript, kind, subject, figures, directives)
  },
  // Presenter: put YOU in the video (your real footage or photo) + theme b-roll + AI scenes.
  presenter: {
    pickVideo: (): Promise<string | null> => ipcRenderer.invoke(IPC.presenterPickVideo),
    build: (params: {
      title: string
      body: string
      mode: 'video' | 'photo' | 'graft'
      presenterPath?: string
      /** GRAFT mode: the picture the video's moving part is composited onto. */
      graftPhotoPath?: string
      /** GRAFT mode: where the moving part is taken from and where it lands. */
      graftRegion?: import('../shared/types').GraftRegion
      style?: import('../shared/types').VideoStyle
      everyN?: number
      windowsVoice?: boolean
      /** REAL generated motion for the AI scene beats (free cloud or local GPU). */
      motionEngine?: 'ai-free-video' | 'ai-local'
    }): Promise<{ ok: boolean; video?: import('../shared/types').VideoJob; error?: string }> =>
      ipcRenderer.invoke(IPC.presenterBuild, params),
    // One composited "living picture" frame for the graft region controls (instant feedback).
    graftPreview: (params: {
      photoPath: string
      videoPath: string
      region: import('../shared/types').GraftRegion
      atSec?: number
    }): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.graftPreview, params)
  },
  // In-app Recorder: list screen/window sources (screen capture) + save a recording to Video Studio.
  recorder: {
    screenSources: (): Promise<{ id: string; name: string; thumbnail: string }[]> =>
      ipcRenderer.invoke(IPC.recorderScreenSources),
    // `kind` is 'camera' | 'screen' | 'voice'. 'voice' means narrating with no picture,
    // and comes back as an audio path instead of a video. `mime` is what the browser
    // actually recorded, which decides whether the file can be copied rather than
    // re-encoded — see main/recorder/saveArgs.ts.
    save: (
      bytes: Uint8Array,
      kind: string,
      enhance?: boolean,
      mime?: string
    ): Promise<{ ok: boolean; video?: import('../shared/types').VideoJob; audioPath?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.recorderSave, bytes, kind, enhance, mime)
  },
  activity: {
    list: () => ipcRenderer.invoke(IPC.activityList),
    clear: () => ipcRenderer.invoke(IPC.activityClear)
  },
  // Reusable script/video templates — recurring formats start half-built.
  templates: {
    list: (): Promise<{ id: string; name: string; title: string; body: string; createdAt: string }[]> =>
      ipcRenderer.invoke(IPC.templatesList),
    save: (name: string, title: string, body: string): Promise<{ id: string; name: string; title: string; body: string; createdAt: string }[]> =>
      ipcRenderer.invoke(IPC.templatesSave, name, title, body),
    /** Deletion is user-confirmed in the UI before this is ever called. */
    remove: (id: string): Promise<{ id: string; name: string; title: string; body: string; createdAt: string }[]> =>
      ipcRenderer.invoke(IPC.templatesDelete, id)
  },
  // What this PC can actually run (GPU/VRAM), so limits are stated up front.
  hardware: {
    check: (): Promise<import('../shared/types').HardwareReport> => ipcRenderer.invoke(IPC.hardwareCheck)
  },
  // Known Issues panel: the failure log. Append + read only — nothing here deletes it.
  aiErrors: {
    list: (limit?: number): Promise<import('../shared/types').AiErrorEntry[]> =>
      ipcRenderer.invoke(IPC.aiErrorsList, limit),
    reveal: (): Promise<void> => ipcRenderer.invoke(IPC.aiErrorsReveal),
    /** Called by ErrorBoundary when a tab crashes, so UI failures are provable too. */
    recordUi: (x: { tab: string; message: string; stack?: string }): Promise<void> =>
      ipcRenderer.invoke(IPC.aiErrorsRecordUi, x)
  },
  advisor: {
    send: (req: AdvisorRequest) => ipcRenderer.invoke(IPC.advisorSend, req),
    history: () => ipcRenderer.invoke(IPC.advisorHistory),
    remove: (id: string) => ipcRenderer.invoke(IPC.advisorDelete, id),
    clear: () => ipcRenderer.invoke(IPC.advisorClear),
    // Live token stream during a send(); returns an unsubscribe fn (mirrors script.onProgress).
    onStream: (cb: (delta: string) => void) => {
      const listener = (_e: unknown, delta: string): void => cb(delta)
      ipcRenderer.on(IPC.advisorStream, listener)
      return () => ipcRenderer.removeListener(IPC.advisorStream, listener)
    }
  },
  video: {
    build: (req: VideoBuildRequest) => ipcRenderer.invoke(IPC.videoBuild, req),
    // Replace the video's audio with the recorded voice.
    attachVoice: (videoId: string, audioBytes: Uint8Array) =>
      ipcRenderer.invoke(IPC.videoAttachVoice, videoId, audioBytes),
    // Keep the video's existing audio AND add the recorded voice on top.
    addVoice: (videoId: string, audioBytes: Uint8Array): Promise<import('../shared/types').VideoJob> =>
      ipcRenderer.invoke(IPC.videoAddVoice, videoId, audioBytes),
    // Assemble recorded segments (with optional trims) into one WAV; returns the bytes.
    assembleVoice: (segments: { bytes: Uint8Array; startSec?: number; endSec?: number }[]): Promise<Uint8Array> =>
      ipcRenderer.invoke(IPC.voiceAssemble, segments),
    list: () => ipcRenderer.invoke(IPC.videoList),
    remove: (id: string) => ipcRenderer.invoke(IPC.videoDelete, id),
    reveal: (path: string) => ipcRenderer.invoke(IPC.videoReveal, path),
    // Voice cleanup + video polish → a new enhanced VideoJob (original kept).
    enhance: (
      videoId: string,
      opts?: { audio?: boolean; video?: boolean }
    ): Promise<{ ok: boolean; video?: import('../shared/types').VideoJob; error?: string }> =>
      ipcRenderer.invoke(IPC.videoEnhance, videoId, opts),
    pickMusic: (): Promise<string | null> => ipcRenderer.invoke(IPC.videoPickMusic),
    saveAs: (srcPath: string, suggestedName: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.videoSaveAs, srcPath, suggestedName),
    // Opens a file picker and returns the extracted script text (or a cancel/error).
    importScript: (): Promise<import('../shared/types').ScriptImportResult> =>
      ipcRenderer.invoke(IPC.videoImportScript),
    // Transcodes a built video into a chosen format and saves it where the user picks.
    export: (
      videoId: string,
      format: import('../shared/types').ExportFormat
    ): Promise<{ saved: boolean; path?: string }> => ipcRenderer.invoke(IPC.videoExport, videoId, format),
    // Cuts a built video (keep or remove a range); returns the new VideoJob.
    trim: (
      videoId: string,
      mode: import('../shared/types').TrimMode,
      start: number,
      end: number
    ): Promise<import('../shared/types').VideoJob> => ipcRenderer.invoke(IPC.videoTrim, videoId, mode, start, end),
    // Stitches several built videos into one; returns the new VideoJob.
    stitch: (videoIds: string[]): Promise<import('../shared/types').VideoJob> =>
      ipcRenderer.invoke(IPC.videoStitch, videoIds),
    // Remove or replace the background music while keeping narration; returns the new VideoJob.
    setMusic: (
      videoId: string,
      mode: 'remove' | 'replace',
      mood?: import('../shared/types').Mood
    ): Promise<import('../shared/types').VideoJob> => ipcRenderer.invoke(IPC.videoSetMusic, videoId, mode, mood),
    // AI-separate a video's audio and keep one side: 'voice' (music removed) or 'music' (voice removed).
    separateMusic: (videoId: string, engine: 'online' | 'local', keep: 'voice' | 'music' = 'voice'): Promise<import('../shared/types').VideoJob> =>
      ipcRenderer.invoke(IPC.videoSeparateMusic, videoId, engine, keep),
    // 🎧 AI DJ: picks a mood from the video's own content (or your words) and lays a
    // ducked music bed under the voice. Returns the new job + what it decided and why.
    aiDj: (videoId: string, styleHint?: string): Promise<{ job: import('../shared/types').VideoJob; mood: string; how: string }> =>
      ipcRenderer.invoke(IPC.videoAiDj, videoId, styleHint),
    // Extracts the video's audio to an MP3 (for the DJ decks); returns the file path.
    extractAudio: (videoId: string): Promise<string> => ipcRenderer.invoke(IPC.videoExtractAudio, videoId),
    // Auto-caption: transcribe narration → .srt; if burn=true also make a subtitled video.
    captions: (videoId: string, burn: boolean): Promise<{ srtPath: string; job?: import('../shared/types').VideoJob }> =>
      ipcRenderer.invoke(IPC.videoCaptions, videoId, burn),
    // Overlay a logo watermark in a corner; returns the new VideoJob.
    watermark: (
      videoId: string,
      logoPath: string,
      position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'
    ): Promise<import('../shared/types').VideoJob> => ipcRenderer.invoke(IPC.videoWatermark, videoId, logoPath, position),
    // AI-plans the video (hook, sections+keywords, thumbnail idea, CTR tips).
    plan: (title: string, body: string): Promise<{ hook: string; sections: { title: string; keyword: string; seconds: number }[]; thumbnailIdea: string; ctrTips: string[] }> =>
      ipcRenderer.invoke(IPC.videoPlan, title, body),
    // Opens a multi-select image picker for the Ken-Burns background; returns paths.
    pickImages: (): Promise<string[]> => ipcRenderer.invoke(IPC.videoPickImages),
    // Stops any in-progress render/export/trim.
    cancel: (): Promise<{ stopped: number }> => ipcRenderer.invoke(IPC.videoCancel),
    onProgress: (cb: (stage: string) => void) => {
      const listener = (_e: unknown, stage: string): void => cb(stage)
      ipcRenderer.on(IPC.videoProgress, listener)
      return () => ipcRenderer.removeListener(IPC.videoProgress, listener)
    },
    // Fires once with a small opening-frame preview PNG during a build. Returns an unsubscribe fn.
    // Fires after a build when subtitles/chapters were requested. Returns an unsubscribe fn.
    onExtras: (cb: (x: { videoId: string; srtPath?: string; chapters: string }) => void) => {
      const listener = (_e: unknown, x: { videoId: string; srtPath?: string; chapters: string }): void => cb(x)
      ipcRenderer.on(IPC.videoExtras, listener)
      return () => ipcRenderer.removeListener(IPC.videoExtras, listener)
    },
    onPreview: (cb: (pngPath: string) => void) => {
      const listener = (_e: unknown, pngPath: string): void => cb(pngPath)
      ipcRenderer.on(IPC.videoPreview, listener)
      return () => ipcRenderer.removeListener(IPC.videoPreview, listener)
    }
  },
  timeline: {
    pickClips: (): Promise<string[]> => ipcRenderer.invoke(IPC.timelinePickClips),
    pickAudio: (): Promise<string[]> => ipcRenderer.invoke(IPC.timelinePickAudio),
    probe: (src: string): Promise<{ ok: boolean; duration?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.timelineProbe, src),
    render: (
      doc: import('../shared/types').TimelineDoc,
      title?: string
    ): Promise<{ ok: boolean; video?: import('../shared/types').VideoJob; error?: string }> =>
      ipcRenderer.invoke(IPC.timelineRender, doc, title)
    // Progress reuses video.onProgress (same 'video:progress' channel).
  },
  /**
   * The teleprompter's own window. Separate from the main window so a screen capture
   * can exclude it; hiddenFromCapture additionally asks the OS to leave it out of any
   * recording (best-effort — the UI says "asked for", never "guaranteed").
   */
  teleprompter: {
    open: (opts?: { hiddenFromCapture?: boolean }): Promise<{ open: boolean; hiddenFromCapture: boolean }> =>
      ipcRenderer.invoke(IPC.teleprompterOpen, opts),
    close: (): Promise<{ open: boolean; hiddenFromCapture: boolean }> => ipcRenderer.invoke(IPC.teleprompterClose),
    state: (): Promise<{ open: boolean; hiddenFromCapture: boolean }> => ipcRenderer.invoke(IPC.teleprompterState),
    setHiddenFromCapture: (on: boolean): Promise<{ open: boolean; hiddenFromCapture: boolean }> =>
      ipcRenderer.invoke(IPC.teleprompterProtect, on)
  },
  /** Plans made on the phone: open one from a file, or take one pushed over Wi-Fi. */
  project: {
    importPick: (): Promise<{ ok: boolean; canceled?: boolean; error?: string; result?: ImportedProject }> =>
      ipcRenderer.invoke(IPC.projectImportPick),
    import: (raw: unknown): Promise<{ ok: boolean; error?: string; result?: ImportedProject }> =>
      ipcRenderer.invoke(IPC.projectImport, raw)
  },
  storyboard: {
    pickPhoto: (): Promise<string | null> => ipcRenderer.invoke(IPC.storyboardPickPhoto),
    plan: (params: {
      mode: 'auto' | 'guided'
      title: string
      brief: string
      totalSeconds?: number
      language?: string
      width?: number
      height?: number
      fps?: number
    }): Promise<{ ok: boolean; storyboard?: import('../shared/types').StoryboardDoc; error?: string }> =>
      ipcRenderer.invoke(IPC.storyboardPlan, params),
    render: (
      doc: import('../shared/types').StoryboardDoc,
      opts?: { photoPath?: string; beautifyStrength?: number; windowsVoice?: boolean; motionEngine?: 'ai-free-video' | 'ai-local' }
    ): Promise<{
      ok: boolean
      video?: import('../shared/types').VideoJob
      timeline?: import('../shared/types').TimelineDoc
      error?: string
    }> => ipcRenderer.invoke(IPC.storyboardRender, doc, opts),
    // Beautify (strength>0) or roughen (strength<0) a photo; returns a preview file path.
    beautify: (src: string, strength: number): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.photoBeautify, src, strength)
    // Progress reuses video.onProgress.
  },
  drafts: {
    // Autosave: get/set any tab's working state. get returns {current, history} or null.
    get: (key: string): Promise<{ current: unknown; history: { at: string; value: unknown }[] } | null> =>
      ipcRenderer.invoke(IPC.draftGet, key),
    set: (key: string, value: unknown): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.draftSet, key, value)
  },
  scriptpad: {
    get: (): Promise<import('../shared/types').ScriptPad> => ipcRenderer.invoke(IPC.scriptpadGet),
    save: (title: string, body: string): Promise<import('../shared/types').ScriptPad> =>
      ipcRenderer.invoke(IPC.scriptpadSave, title, body)
  },
  dataHome: {
    /** Where this user's work is being kept right now. */
    activeDir: (): Promise<string> => ipcRenderer.invoke(IPC.dataActiveDir),
    /** Finished videos the app cannot currently show (unlisted here, or in another folder). */
    strandedScan: (): Promise<import('../shared/types').StrandedReport> => ipcRenderer.invoke(IPC.dataStrandedScan),
    /** Lists them in the app; anything in another folder is COPIED, never moved. */
    strandedImport: (): Promise<{ imported: number; skipped: number; bytes: number }> =>
      ipcRenderer.invoke(IPC.dataStrandedImport)
  },
  audio: {
    // Read an audio file's bytes for WebAudio decoding (renderers can't fetch file://).
    // Only paths inside the app's data folder are served.
    readFile: (path: string): Promise<Uint8Array> => ipcRenderer.invoke(IPC.audioReadFile, path),
    // Generate a music bed / SFX; returns an absolute path playable via file://.
    generateMusic: (mood: import('../shared/types').Mood, durationSec: number, seed: number): Promise<string> =>
      ipcRenderer.invoke(IPC.audioGenerateMusic, mood, durationSec, seed),
    generateSfx: (kind: import('../shared/types').SfxKind): Promise<string> =>
      ipcRenderer.invoke(IPC.audioGenerateSfx, kind),
    pickFile: (): Promise<string | null> => ipcRenderer.invoke(IPC.audioPickFile),
    listPack: (): Promise<Array<{ id: string; kind: 'music' | 'sfx'; label: string; file: string }>> =>
      ipcRenderer.invoke(IPC.audioListPack),
    // Re-mix a built video with timeline clips; returns the new VideoJob.
    remix: (
      videoId: string,
      clips: import('../shared/types').AudioClip[]
    ): Promise<import('../shared/types').VideoJob> => ipcRenderer.invoke(IPC.audioRemix, videoId, clips),
    // Render the DJ timeline to a standalone MP3 (create music only). Returns its path.
    renderMix: (clips: import('../shared/types').AudioClip[], durationSec: number): Promise<string> =>
      ipcRenderer.invoke(IPC.audioRenderMix, clips, durationSec),
    // Save/download a generated audio file wherever the user picks.
    saveFile: (srcPath: string, suggestedName: string): Promise<{ saved: boolean; path?: string }> =>
      ipcRenderer.invoke(IPC.audioSaveFile, srcPath, suggestedName),
    // Render a waveform image (PNG path) of a built video's audio.
    waveform: (videoId: string): Promise<string> => ipcRenderer.invoke(IPC.audioWaveform, videoId)
  },
  dj: {
    listPlans: (): Promise<import('../shared/types').AudioPlan[]> => ipcRenderer.invoke(IPC.djPlansList),
    savePlan: (plan: import('../shared/types').AudioPlan): Promise<import('../shared/types').AudioPlan[]> =>
      ipcRenderer.invoke(IPC.djPlanSave, plan),
    deletePlan: (id: string): Promise<import('../shared/types').AudioPlan[]> =>
      ipcRenderer.invoke(IPC.djPlanDelete, id)
  },
  music: {
    // Online free (CC) music search; returns { online:false } when offline.
    search: (query: string): Promise<import('../shared/types').MusicSearchResult> =>
      ipcRenderer.invoke(IPC.musicSearch, query),
    // Downloads a track locally; returns its file path.
    download: (audioUrl: string, suggestedName: string): Promise<string> =>
      ipcRenderer.invoke(IPC.musicDownload, audioUrl, suggestedName),
    // Mood-matched free music for a script (AI picks the mood; Pixabay + Openverse).
    suggest: (scriptText: string): Promise<import('../shared/types').MusicSuggestion> =>
      ipcRenderer.invoke(IPC.musicSuggest, scriptText),
    moodSearch: (query: string): Promise<import('../shared/types').MusicSuggestion> =>
      ipcRenderer.invoke(IPC.musicMoodSearch, query),
    // Places a track over one stretch of a video; makes a NEW video, original untouched.
    applyRegion: (
      videoId: string,
      track: import('../shared/types').MusicTrack,
      startSec: number,
      endSec: number
    ): Promise<{ ok: boolean; video?: import('../shared/types').VideoJob; error?: string }> =>
      ipcRenderer.invoke(IPC.musicApplyRegion, videoId, track, startSec, endSec)
  },
  director: {
    // Interpret a plain-English instruction into a validated edit plan (no changes yet).
    interpret: (videoId: string, instruction: string): Promise<import('../shared/types').DirectorInterpretation> =>
      ipcRenderer.invoke(IPC.directorInterpret, videoId, instruction),
    // Execute the confirmed edit plan; returns the new VideoJob.
    execute: (
      videoId: string,
      actions: import('../shared/types').DirectorAction[]
    ): Promise<import('../shared/types').VideoJob> => ipcRenderer.invoke(IPC.directorExecute, videoId, actions)
  },
  weekly: {
    // "Plan my week": one video per topic, then shorts + posting text for each.
    // Long-running; progress streams over the shared agent progress channel.
    planRun: (
      topics: string[],
      opts?: {
        style?: import('../shared/types').VideoStyle
        resolution?: import('../shared/types').VideoResolution
        aiVisuals?: boolean
        shortsPerVideo?: number
      }
    ): Promise<{
      report: { topic: string; ok: boolean; videoId?: string; shorts: number; postingText?: string; error?: string }[]
    }> => ipcRenderer.invoke(IPC.weeklyPlanRun, topics, opts)
  },
  agent: {
    // Turn a plain-English command into a validated plan of steps (no changes yet).
    interpret: (command: string): Promise<import('../shared/types').AgentPlan> =>
      ipcRenderer.invoke(IPC.agentInterpret, command),
    // Execute a confirmed plan end-to-end; returns each step's outcome.
    execute: (
      plan: import('../shared/types').AgentPlan
    ): Promise<import('../shared/types').AgentRunResult> => ipcRenderer.invoke(IPC.agentExecute, plan),
    // Batch: one video per topic. Returns each topic's outcome; streams via onProgress.
    batch: (
      topics: string[],
      style?: import('../shared/types').VideoStyle,
      resolution?: import('../shared/types').VideoResolution,
      aiVisuals?: boolean
    ): Promise<{ results: { topic: string; ok: boolean; video?: import('../shared/types').VideoJob; error?: string }[] }> =>
      ipcRenderer.invoke(IPC.agentBatch, topics, style, resolution, aiVisuals),
    // Live per-step progress during execute()/batch(); returns an unsubscribe fn.
    onProgress: (cb: (stage: string) => void) => {
      const listener = (_e: unknown, stage: string): void => cb(stage)
      ipcRenderer.on(IPC.agentProgress, listener)
      return () => ipcRenderer.removeListener(IPC.agentProgress, listener)
    }
  },
  scene: {
    // Plan editable scenes from a script (no network).
    plan: (
      title: string,
      body: string,
      style: import('../shared/types').VideoStyle,
      direction: string
    ): Promise<{ index: number; label: string; prompt: string }[]> =>
      ipcRenderer.invoke(IPC.scenePlan, title, body, style, direction),
    // Generate one scene image from a prompt (free, keyless). Returns its file path.
    generate: (prompt: string, seed: number, fast: boolean): Promise<string> =>
      ipcRenderer.invoke(IPC.sceneGenerate, prompt, seed, fast),
    // Put the user in the scene from an attached photo (free img2img). Returns a path;
    // streams queue progress via onProgress. strength 0..1 (higher = transform more).
    generateFromPhoto: (index: number, prompt: string, sourceImagePath: string, strength: number): Promise<string> =>
      ipcRenderer.invoke(IPC.sceneGenerateFromPhoto, index, prompt, sourceImagePath, strength),
    onProgress: (cb: (p: { index: number; message: string; queuePosition?: number; waitSeconds?: number }) => void) => {
      const listener = (_e: unknown, p: { index: number; message: string; queuePosition?: number; waitSeconds?: number }): void => cb(p)
      ipcRenderer.on(IPC.sceneProgress, listener)
      return () => ipcRenderer.removeListener(IPC.sceneProgress, listener)
    },
    // Save one generated scene image (save dialog), or all of them into a chosen folder.
    saveImage: (srcPath: string, suggestedName: string): Promise<{ saved: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.sceneSaveImage, srcPath, suggestedName),
    saveAllImages: (srcPaths: string[]): Promise<{ saved: boolean; path?: string; count?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.sceneSaveAllImages, srcPaths)
  },
  shorts: {
    /** One long video → N vertical captioned clips, added to Video Studio. */
    make: (
      videoId: string,
      count: number
    ): Promise<{
      jobs: import('../shared/types').VideoJob[]
      moments: { title: string; reason: string; startSec: number; endSec: number }[]
    }> => ipcRenderer.invoke(IPC.videoMakeShorts, videoId, count),
    // Ready-to-paste posting text (title + description + hashtags) for one clip.
    postMeta: (
      videoId: string,
      platform: 'youtube' | 'tiktok',
      vertical?: boolean
    ): Promise<import('../shared/types').PostMetadata> =>
      ipcRenderer.invoke(IPC.videoPostMeta, videoId, platform, vertical)
  },
  ai: {
    engineStatus: (): Promise<import('../shared/types').AiEngineStatus> => ipcRenderer.invoke(IPC.aiEngineStatus),
    getConfig: (): Promise<{
      cloudEndpoint: string
      cloudModel: string
      localEndpoint: string
      localKind: 'comfyui' | 'generic'
      comfyWorkflowPath: string
      freeCloudProvider: 'puter' | 'pollinations'
      freeCloudModel: string
      pollinationsModel: string
      freeCloudSceneCap: number
      hasCloudKey: boolean
      hasPollinationsKey: boolean
    }> => ipcRenderer.invoke(IPC.aiGetConfig),
    setConfig: (partial: import('../shared/types').AiVideoConfig): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.aiSetConfig, partial),
    /** Validates a Pollinations key (typed or saved) via /account/balance — spends nothing. */
    testPollinationsKey: (candidateKey?: string): Promise<{ ok: boolean; balance?: number; detail: string }> =>
      ipcRenderer.invoke(IPC.aiTestPollinationsKey, candidateKey),
    // Fires when the chosen paid/local AI failed and the free AI answered instead
    // (drives the on-screen warning banner). Returns an unsubscribe fn.
    onFallback: (cb: (notice: { provider: string; detail: string }) => void) => {
      const listener = (_e: unknown, notice: { provider: string; detail: string }): void => cb(notice)
      ipcRenderer.on(IPC.aiFallback, listener)
      return () => ipcRenderer.removeListener(IPC.aiFallback, listener)
    }
  },
  updates: {
    // Fires when a newer shipped build exists on GitHub (drives the update banner).
    onAvailable: (cb: (info: { remoteTag: string; localTag: string }) => void) => {
      const listener = (_e: unknown, info: { remoteTag: string; localTag: string }): void => cb(info)
      ipcRenderer.on(IPC.updateAvailable, listener)
      return () => ipcRenderer.removeListener(IPC.updateAvailable, listener)
    },
    // Pull the already-found update (covers renderers that mounted after the broadcast).
    get: (): Promise<{ remoteTag: string; localTag: string } | null> => ipcRenderer.invoke(IPC.updateGet),
    // Opens the studio folder with the setup exe selected — but only when that exe is as
    // new as the advertised build; otherwise opens the download page.
    revealSetup: (remoteTag?: string): Promise<{ ok: boolean; opened: string }> =>
      ipcRenderer.invoke(IPC.updateRevealSetup, remoteTag),
    /** One-click update for the installed app: the ship already swapped the code on
     * disk, so this relaunches onto it. ok:false = not applicable (portable/stale). */
    restart: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.updateRestart),
    /** Reads the download page now and says where this app stands: up to date, behind,
     * ahead, or "could not check" — which is never reported as up to date. */
    status: (): Promise<{
      state: 'current' | 'behind' | 'ahead' | 'unknown'
      runningTag: string
      publishedTag: string | null
      message: string
      checkedAt: string
    }> => ipcRenderer.invoke(IPC.updateStatus),
    /** Downloads the installer and runs it — no browser, no Downloads folder. On success
     * the app quits so the installer can replace it, so nothing follows this call. */
    install: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke(IPC.updateInstall),
    /** Download progress for the button above: { pct, stage }. */
    onInstallProgress: (cb: (p: { pct: number; stage: string }) => void) => {
      const listener = (_e: unknown, p: { pct: number; stage: string }): void => cb(p)
      ipcRenderer.on(IPC.updateInstallProgress, listener)
      return () => ipcRenderer.removeListener(IPC.updateInstallProgress, listener)
    }
  },
  // "What changed" — what is new in the build actually running. The build tag is read in
  // the main process, never passed in from here, so a stale page cannot make the app
  // advertise a feature it does not have.
  whatsNew: {
    get: (): Promise<import('../shared/whatsNew').WhatsNewReport> => ipcRenderer.invoke(IPC.whatsNewGet),
    markSeen: (ids: string[]): Promise<import('../shared/whatsNew').WhatsNewReport> =>
      ipcRenderer.invoke(IPC.whatsNewMarkSeen, ids)
  },
  /**
   * A small stand-in for scrubbing a big clip, guaranteed time-identical to the original,
   * so a cut made against it lands in exactly the same place. Refuses (with a reason) when
   * the file is already small enough, or when the copy came out a different length.
   */
  timelineProxy: (
    sourcePath: string
  ): Promise<{ ok: true; path: string; note: string; seconds: number } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.timelineProxy, sourcePath),
  // Watch ONE scene before committing to the whole render. Returns a PATH — the page turns
  // it into a playable link, which is what makes it work on the phone too.
  scenePreview: (
    imagePath: string,
    seconds: number,
    motion: string,
    aspect?: string,
    template?: string
  ): Promise<{ ok: true; path: string; seconds: number } | { ok: false; error: string }> =>
    ipcRenderer.invoke(IPC.scenePreview, imagePath, seconds, motion, aspect, template),
  // The render queue: line up an evening's work and walk away. Written to disk, so it
  // survives the app closing, and one failure costs exactly one item.
  queue: {
    list: (): Promise<import('../shared/types').QueueItem[]> => ipcRenderer.invoke(IPC.queueList),
    add: (req: VideoBuildRequest): Promise<import('../shared/types').QueueItem[]> =>
      ipcRenderer.invoke(IPC.queueAdd, req),
    cancel: (id: string): Promise<import('../shared/types').QueueItem[]> => ipcRenderer.invoke(IPC.queueCancel, id),
    retry: (id: string): Promise<import('../shared/types').QueueItem[]> => ipcRenderer.invoke(IPC.queueRetry, id),
    reorder: (id: string, direction: number): Promise<import('../shared/types').QueueItem[]> =>
      ipcRenderer.invoke(IPC.queueReorder, id, direction),
    clearFinished: (): Promise<import('../shared/types').QueueItem[]> => ipcRenderer.invoke(IPC.queueClearFinished),
    /** Fires on every change, so the list follows a render without polling. */
    onChanged: (cb: (items: import('../shared/types').QueueItem[]) => void) => {
      const listener = (_e: unknown, items: import('../shared/types').QueueItem[]): void => cb(items)
      ipcRenderer.on(IPC.queueChanged, listener)
      return () => ipcRenderer.removeListener(IPC.queueChanged, listener)
    }
  },
  // The credit check before publishing. NOT a copyright detector — see
  // shared/copyrightCheck.ts for why nothing on this PC can be one.
  copyright: {
    check: (
      videoId: string,
      description?: string
    ): Promise<
      | ({ found: true } & import('../shared/copyrightCheck').CopyrightReport)
      | { found: false; error: string }
    > => ipcRenderer.invoke(IPC.copyrightCheck, videoId, description)
  },
  // Cut the dead air out of a take. Plan first (cheap, no encode, nothing changed), then
  // apply — which writes a NEW video and never touches the original.
  silence: {
    plan: (
      videoId: string
    ): Promise<
      | {
          ok: true
          keeps: import('../shared/types').KeepSpan[]
          summary: import('../shared/types').SilenceSummary
          durationSec: number
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.silencePlan, videoId),
    apply: (
      videoId: string
    ): Promise<
      | { ok: true; video: import('../shared/types').VideoJob; summary: import('../shared/types').SilenceSummary }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.silenceApply, videoId)
  },
  // What YOUR channel's own history says — not general advice about channels in general.
  channel: {
    /**
     * Title shapes that worked, when the audience shows up, and your series.
     *
     * `problem` is non-null when nothing could be read, and says which of the five
     * reasons it was — a bare empty result used to cover all of them at once.
     */
    learn: (): Promise<{
      problem: import('../shared/youtubeKeySetup').ChannelReadProblem | null
      videoCount: number
      titleFindings: import('../shared/channelLearning').Finding[]
      timing: ReturnType<typeof import('../shared/channelLearning').publishTimingReport>
      series: ReturnType<typeof import('../shared/series').seriesReport>
    }> => ipcRenderer.invoke(IPC.channelLearn),
    /** Scores a proposed title against your own history, with the reasons. */
    scoreTitle: (
      title: string
    ): Promise<
      import('../shared/channelLearning').TitleScore & {
        problem: import('../shared/youtubeKeySetup').ChannelReadProblem | null
      }
    > => ipcRenderer.invoke(IPC.channelScoreTitle, title),
    /** Subjects other channels get views on that this one has never covered. */
    gaps: (): Promise<
      import('../shared/competitorGap').GapReport & {
        problem: import('../shared/youtubeKeySetup').ChannelReadProblem | null
        myVideos: number
        competitorVideos: number
        queries: string[]
      }
    > => ipcRenderer.invoke(IPC.channelGaps),
    /** The questions your comments keep asking, quoted verbatim and ranked. */
    comments: (
      videoLimit?: number
    ): Promise<{
      problem: import('../shared/youtubeKeySetup').ChannelReadProblem | null
      scanned: number
      videosRead: number
      clusters: import('../shared/commentMining').QuestionCluster[]
      summary: string
    }> => ipcRenderer.invoke(IPC.channelComments, videoLimit)
  },
  // Hear the script read out at speed, to catch by ear what silent reading hides.
  readAloud: {
    // Instant and pure: what to listen for, and how long the listen will take.
    plan: (script: string, speed?: number): Promise<import('../shared/readAloud').ReadAloudPlan> =>
      ipcRenderer.invoke(IPC.readAloudPlan, script, speed),
    // Speaks it and speeds the file up. Returns a PATH — the page turns that into a
    // playable link with fileUrl(), which is what makes it work on the phone too.
    speak: (
      script: string,
      speed?: number,
      voice?: 'natural' | 'winnatural' | 'windows'
    ): Promise<
      | { ok: true; path: string; engineName: string; plan: import('../shared/readAloud').ReadAloudPlan }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.readAloudSpeak, script, speed, voice)
  },
  // "What changed" — what is new in the build actually running. The build tag is read in
  // the main process, never passed in from here, so a stale page cannot make the app
  // advertise a feature it does not have.
  whatsNew: {
    get: (): Promise<import('../shared/whatsNew').WhatsNewReport> => ipcRenderer.invoke(IPC.whatsNewGet),
    markSeen: (ids: string[]): Promise<import('../shared/whatsNew').WhatsNewReport> =>
      ipcRenderer.invoke(IPC.whatsNewMarkSeen, ids)
  },
  // The credit check before publishing. NOT a copyright detector — see
  // shared/copyrightCheck.ts for why nothing on this PC can be one.
  copyright: {
    check: (
      videoId: string,
      description?: string
    ): Promise<
      | ({ found: true } & import('../shared/copyrightCheck').CopyrightReport)
      | { found: false; error: string }
    > => ipcRenderer.invoke(IPC.copyrightCheck, videoId, description)
  },
  // Cut the dead air out of a take. Plan first (cheap, no encode, nothing changed), then
  // apply — which writes a NEW video and never touches the original.
  silence: {
    plan: (
      videoId: string
    ): Promise<
      | {
          ok: true
          keeps: import('../shared/types').KeepSpan[]
          summary: import('../shared/types').SilenceSummary
          durationSec: number
        }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.silencePlan, videoId),
    apply: (
      videoId: string
    ): Promise<
      | { ok: true; video: import('../shared/types').VideoJob; summary: import('../shared/types').SilenceSummary }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.silenceApply, videoId)
  },
  // What YOUR channel's own history says — not general advice about channels in general.
  channel: {
    /** Title shapes that worked, when the audience shows up, and your series. */
    learn: (): Promise<{
      videoCount: number
      titleFindings: import('../shared/channelLearning').Finding[]
      timing: ReturnType<typeof import('../shared/channelLearning').publishTimingReport>
      series: ReturnType<typeof import('../shared/series').seriesReport>
    }> => ipcRenderer.invoke(IPC.channelLearn),
    /** Scores a proposed title against your own history, with the reasons. */
    scoreTitle: (title: string): Promise<import('../shared/channelLearning').TitleScore> =>
      ipcRenderer.invoke(IPC.channelScoreTitle, title),
    /** The questions your comments keep asking, quoted verbatim and ranked. */
    comments: (
      videoLimit?: number
    ): Promise<{
      scanned: number
      videosRead: number
      clusters: import('../shared/commentMining').QuestionCluster[]
      summary: string
    }> => ipcRenderer.invoke(IPC.channelComments, videoLimit)
  },
  // Hear the script read out at speed, to catch by ear what silent reading hides.
  readAloud: {
    // Instant and pure: what to listen for, and how long the listen will take.
    plan: (script: string, speed?: number): Promise<import('../shared/readAloud').ReadAloudPlan> =>
      ipcRenderer.invoke(IPC.readAloudPlan, script, speed),
    // Speaks it and speeds the file up. Returns a PATH — the page turns that into a
    // playable link with fileUrl(), which is what makes it work on the phone too.
    speak: (
      script: string,
      speed?: number,
      voice?: 'natural' | 'winnatural' | 'windows'
    ): Promise<
      | { ok: true; path: string; engineName: string; plan: import('../shared/readAloud').ReadAloudPlan }
      | { ok: false; error: string }
    > => ipcRenderer.invoke(IPC.readAloudSpeak, script, speed, voice)
  },
  health: {
    // Live self-test of every dependency (validates saved keys with a cheap request).
    run: (): Promise<import('../shared/types').HealthReport> => ipcRenderer.invoke(IPC.healthRun),
    // The last quiet weekly self-check (when + which checks failed) — for the badge.
    last: (): Promise<{ at: string | null; failed: string[] }> => ipcRenderer.invoke(IPC.healthLast)
  },
  // Backups: one home in your user folder, optional second home, delete-sync,
  // non-destructive restore, and cleanup of pre-delete-sync orphans.
  backups: {
    status: (): Promise<{ root: string; secondDir: string; purgeOnDelete: boolean }> =>
      ipcRenderer.invoke(IPC.backupStatus),
    setOptions: (opts: { secondDir?: string; purgeOnDelete?: boolean }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.backupSetOptions, opts),
    pickSecondDir: (): Promise<{ picked: string }> => ipcRenderer.invoke(IPC.backupPickSecondDir),
    runNow: (): Promise<{ copied: number; unchanged: number; failed: number; secondNote: string }> =>
      ipcRenderer.invoke(IPC.backupRunNow),
    restore: (): Promise<{ ok: boolean; copied?: number; unchanged?: number; failed?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.backupRestore),
    orphans: (): Promise<{ count: number; mb: number }> => ipcRenderer.invoke(IPC.backupOrphans),
    /** User-confirmed in the UI before this is ever called. */
    cleanOrphans: (): Promise<{ removed: number; mb: number }> => ipcRenderer.invoke(IPC.backupCleanOrphans)
  },
  stock: {
    getConfig: (): Promise<{ hasPixabay: boolean; hasPexels: boolean }> => ipcRenderer.invoke(IPC.stockGetConfig),
    setKey: (provider: 'pixabay' | 'pexels', key: string): Promise<{ hasPixabay: boolean; hasPexels: boolean }> =>
      ipcRenderer.invoke(IPC.stockSetKey, provider, key)
  },
  assistant: {
    // Page-aware streaming chat, available everywhere. Not persisted.
    ask: (messages: { role: 'user' | 'assistant'; content: string }[], context: string): Promise<string> =>
      ipcRenderer.invoke(IPC.assistantAsk, messages, context),
    onStream: (cb: (delta: string) => void) => {
      const listener = (_e: unknown, delta: string): void => cb(delta)
      ipcRenderer.on(IPC.assistantStream, listener)
      return () => ipcRenderer.removeListener(IPC.assistantStream, listener)
    }
  },
  guide: {
    // The Studio Expert (🧭) — a second, separate on-every-tab assistant: pure app
    // knowledge, answers in whatever format is asked. Streaming, not persisted.
    ask: (messages: { role: 'user' | 'assistant'; content: string }[], context: string): Promise<string> =>
      ipcRenderer.invoke(IPC.guideAsk, messages, context),
    onStream: (cb: (delta: string) => void) => {
      const listener = (_e: unknown, delta: string): void => cb(delta)
      ipcRenderer.on(IPC.guideStream, listener)
      return () => ipcRenderer.removeListener(IPC.guideStream, listener)
    }
  },
  producer: {
    // Ask the YouTube Producer to critique/rewrite the current field. Returns a short
    // reasoning `reply` and, when a rewrite is warranted, the full `edited` text to apply.
    edit: (params: {
      instruction: string
      text: string
      kind: string
      pageName?: string
    }): Promise<{ ok: boolean; reply?: string; edited?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.producerEdit, params)
  },
  webServer: {
    status: () => ipcRenderer.invoke(IPC.webServerStatus),
    start: () => ipcRenderer.invoke(IPC.webServerStart),
    stop: () => ipcRenderer.invoke(IPC.webServerStop)
  },
  speech: {
    // Offline dictation: send a recorded audio clip, get transcribed text back.
    transcribe: (audioBytes: Uint8Array): Promise<string> =>
      ipcRenderer.invoke(IPC.speechTranscribe, audioBytes)
  },
  youtube: {
    // Assisted publish: prepare metadata (→ clipboard), open the upload page, reveal the file.
    publish: (videoId: string): Promise<{ title: string; description: string; tags: string[]; uploadUrl: string }> =>
      ipcRenderer.invoke(IPC.youtubePublish, videoId),
    /**
     * Try the pasted key against Google for real. Pass nothing to re-check the saved
     * one. The answer is three-state — working / broken / could-not-tell — because a
     * check that cannot reach Google must never look like a pass.
     */
    verifyKey: (rawKey?: string): Promise<import('../shared/youtubeKeySetup').KeyVerdict> =>
      ipcRenderer.invoke(IPC.youtubeKeyVerify, rawKey ?? ''),
    /** Gemini's free AI-Studio key, tested for real — same three-state verdict as YouTube's. */
    verifyGeminiKey: (rawKey?: string): Promise<import('../shared/youtubeKeySetup').KeyVerdict> =>
      ipcRenderer.invoke(IPC.geminiKeyVerify, rawKey ?? ''),
    /** 3 full-length music beds with a plain WHY each — play, compare, pick one. */
    musicExamples: (scriptText: string, durationSec: number): Promise<{ examples: { mood: string; why: string; path: string }[] }> =>
      ipcRenderer.invoke(IPC.musicExamples, scriptText, durationSec),
    /** @handle, channel URL or UC id → the id plus the channel NAME, so it can be confirmed by eye. */
    resolveChannel: (input: string, rawKey?: string): Promise<import('../shared/youtubeKeySetup').ChannelResolution> =>
      ipcRenderer.invoke(IPC.youtubeChannelResolve, input, rawKey ?? '')
  },
  voice: {
    // Windows NATURAL voices (WinRT) — the best free narration, and the only route to
    // the Urdu voices (Asad/Uzma) once the Windows Urdu speech pack is installed.
    winNaturalList: (): Promise<{ id: string; name: string; language: string }[]> =>
      ipcRenderer.invoke(IPC.voiceWinNaturalList),
    winNaturalPreview: (voiceId: string, sample?: string): Promise<{ ok: boolean; wavBase64?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.voiceWinNaturalPreview, voiceId, sample),
    openSpeechSettings: (): Promise<{ ok: boolean }> => ipcRenderer.invoke(IPC.voiceOpenSpeechSettings),
    // Natural narration voice (Piper) — optional per-voice download into the data folder.
    // The catalogue includes real Urdu (Pakistan) neural voices alongside English ones.
    piperCatalogue: (): Promise<
      { id: string; label: string; language: string; approxMB: number; installed: boolean }[]
    > => ipcRenderer.invoke(IPC.voicePiperCatalogue),
    piperStatus: (): Promise<{ installed: boolean }> => ipcRenderer.invoke(IPC.voicePiperStatus),
    piperDownload: (voiceId: string): Promise<{ installed: boolean }> => ipcRenderer.invoke(IPC.voicePiperDownload, voiceId),
    onPiperProgress: (cb: (stage: string) => void) => {
      const listener = (_e: unknown, stage: string): void => cb(stage)
      ipcRenderer.on(IPC.voicePiperProgress, listener)
      return () => ipcRenderer.removeListener(IPC.voicePiperProgress, listener)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type FinScriptApi = typeof api
