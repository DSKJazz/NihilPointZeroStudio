import { app, BrowserWindow, clipboard, desktopCapturer, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, statSync, writeFileSync } from 'fs'

/** Free space (MB) on the disk holding `dir`, or null when it can't be read —
 * the guard then stays out of the way rather than blocking on bad data. */
function freeDiskMB(dir: string): number | null {
  try {
    const s = statfsSync(dir)
    return Math.round((s.bavail * s.bsize) / 1048576)
  } catch {
    return null
  }
}
import { tmpdir } from 'os'
import { spawn } from 'child_process'
import { basename, dirname, extname, join, sep } from 'path'
import { backupsRoot, listOrphans, purgeFromBackups, restoreMissing, runBackup } from './autoBackup'
import { IPC } from '../shared/ipc-channels'
import { MOODS } from '../shared/types'
import type {
  AdvisorRequest,
  IdeaGenRequest,
  LLMProviderId,
  LibraryEntry,
  MusicSuggestion,
  MusicTrack,
  ScriptGenRequest,
  VideoBuildRequest
} from '../shared/types'
import { getActiveProvider } from './llm'
import { aiErrorLogPath, logAiError, readAiErrors } from './llm/errorLog'
import { downloadMusicFile, findMusic } from './music/pixabayMusic'
import { buildMusicRegionArgs } from './video/music'
import { buildChapters, formatChapters } from './video/chapters'
import { canRunModel, describeGpu, detectGpu, VIDEO_MODELS } from './hardware/gpu'
import type { HardwareReport } from '../shared/types'

/** Probed once per session — spawning processes is slow and the answer can't change. */
let cachedHardware: HardwareReport | null = null
import { freeLibraryLinks, MOOD_PROMPT_HINT, moodsFromText, musicExamplePlan, parseMoodReply, synthMoodFromText } from './music/mood'
import { getOllamaStatus, ollamaChatStream, type ChatTurn } from './llm/ollama'
import { buildAdvisorSystemPrompt } from './prompts'
import { importPhoneProject, importPhoneProjectJson } from './project/import'
import { closeTeleprompter, openTeleprompter, setTeleprompterProtection, teleprompterState } from './teleprompter/window'
import { APP_GUIDE } from './appGuide'
import { buildTagFromRelease, diskIsNewerThanRunning, getAvailableUpdate, tagDate } from './updateCheck'
import { fetchLatestRelease, runSelfUpdate, type SelfUpdateDeps } from './selfUpdate'
import { applyOpenAtLogin } from './autoStart'
import { describeUpdateStatus } from './updateStatus'

/**
 * The real-world wiring for a self-update: where to download, how to read free space,
 * how to start the installer and how to close the app.
 *
 * Exported so the silent sign-in update in `index.ts` runs through exactly the same
 * environment as the button does. Two copies of "launch the installer" is precisely how
 * a quiet path ends up subtly different from the visible one.
 */
export function selfUpdateEnv(): SelfUpdateDeps {
  return {
    tempRoot: app.getPath('temp'),
    freeMB: freeDiskMB,
    launch: (path) => {
      // Detached + unref so the installer outlives this process; it needs the app closed
      // to replace its files, so the quit is part of the update, not a side effect.
      const child = spawn(path, [], { detached: true, stdio: 'ignore' })
      child.unref()
    },
    // A beat so the spawn is definitely away before the event loop stops.
    quit: () => setTimeout(() => app.quit(), 1200),
    log: (message) => logActivity('ai', message)
  }
}
import { whatsNewReport } from '../shared/whatsNew'
import { DEFAULT_SPEED, planReadAloud, type ReadSpeed } from '../shared/readAloud'
import { learnTitlePatterns, publishTimingReport, scoreTitle } from '../shared/channelLearning'
import { mineQuestions, summarise as summariseQuestions } from '../shared/commentMining'
import { seriesReport } from '../shared/series'
import { gapReport, searchQueries } from '../shared/competitorGap'
import { checkCopyright } from '../shared/copyrightCheck'
import {
  cancel as cancelQueued,
  clearFinished as clearFinishedQueued,
  current as currentQueued,
  reorder as reorderQueued,
  retry as retryQueued
} from '../shared/renderQueue'
import { runQueue } from './renderQueueRunner'
import { buildScenePreviewArgs, previewSeconds } from './video/scenePreview'
import { buildProxyArgs, proxyIsTrustworthy, proxySize, worthProxying } from './video/proxy'
import { KEN_BURNS_MOTIONS } from './video/render'
import { searchYouTubeSignals } from './data/youtube'
import { fetchComments, readMyChannel } from './data/youtube'
import { resolveYouTubeChannel, verifySavedYouTubeKey, verifyYouTubeKey } from './data/youtubeKeyCheck'
import { verifyGeminiKey, verifySavedGeminiKey } from './llm/geminiKeyCheck'
import { caretakerStatus, clearCaretakerLog, runCaretakerPass, updateCaretakerSchedule } from './caretaker'
import { buildCutArgs, planSilenceCut } from './video/silence'
import { buildVideoEncoderArgs, chooseEncoderForJob } from './video/encoder'
import { buildSpeedArgs } from './audio/speed'
import { speakToWav } from './voice/speak'

// Injected at build time by electron.vite.config.ts (same tag the sidebar badge shows).
declare const __BUILD_TAG__: string
import { listWinNaturalVoices, synthesizeWithWinNatural } from './voice/winNatural'
import { runHealthCheck } from './health'
import { importStranded, scanStranded } from './strandedData'
import { generateIdeasFlow, generateScriptFlow } from './services'
import { synthesizeSpeechToFile } from './voiceover'
import { analyzeImportedFile, correlateFlowWithPrice, parseSpreadsheetFile } from './analysis'
import { buildPriceSeriesFromBars } from './analysis/priceSeries'
import { buildPriceSeries } from './analysis/priceSeries'
import { extractPdfText, summarizeStatement } from './analysis/pdf'
import { attachRecordedVoice, beautifyImage, buildVideoFromScript, exportVideo, ffprobeDuration, formatExtension, renderThumbnail, renderTimeline, setVideoMusic, stitchVideos, trimVideo } from './video'
import { cancelActiveFfmpeg, ffprobeHasAudio, ffprobeVideoSize, runFfmpeg, runFfmpegCapture } from './video/ffmpeg'
import { buildWatermarkArgs, type WatermarkPosition } from './video/watermark'
import { makeSeparationScratch, separateLocal, separateOnline } from './audio/separate'
import { deriveTitleFromFilename, normalizeScriptText } from './video/scriptText'
import { renderMixToAudio, renderMusic, renderSfx, remixVideoAudio } from './audio'
import { assembleVoice } from './audio/voiceAssemble'
import { executeActions, interpretInstruction } from './director'
import { executeAgentPlan, interpretCommand, runBatch, sanitizeAgentPlan } from './agent'
import { extractJson } from './director'
import { buildStoryboardPrompt, sanitizeStoryboard, storyboardFromScript } from './video/storyboard'
import { buildShortArgs, pickShortMoments } from './video/shorts'
import { renderStoryboard } from './video/storyboardRender'
import { planPresenterStoryboard, type PresenterMode } from './video/presenter'
import { renderGraftPreview, renderGraftVideo, runGraftTool, sanitizeGraftRegion } from './video/graft'
import type { GraftRegion } from '../shared/types'
import { buildEnhanceArgs } from './video/enhance'
import { recordingAudioArgs, recordingVideoArgs } from './recorder/saveArgs'
import { generateSceneImage, planScenes } from './scene'
import { downloadPiper, installedPiperVoiceIds, isPiperInstalled, isPiperVoiceInstalled } from './voice/piper'
import { PIPER_VOICES, resolvePiperVoiceId } from './voice/piperVoices'
import { buildUploadUrl } from './youtube'
import { generateFromPhoto } from './image/horde'
import { generateVideoPlan } from './director/planner'
import { downloadTrack, searchMusic } from './data/freeMusic'
import { generatedAudioDir, getAiVideoConfig, getStockConfig, setAiVideoConfig, setStockKey, thumbnailsDir } from './store'
import { isCloudConfigured } from './video/aiCloud'
import { detectLocal, localEndpoint, localKind } from './video/aiLocal'
import { detectPuter } from './video/puter'
import { checkPollinationsKey } from './video/pollinationsVideo'
import type {
  AgentPlan,
  AiVideoConfig,
  AudioClip,
  AudioPlan,
  DirectorAction,
  ExportFormat,
  Mood,
  SfxKind,
  StoryboardDoc,
  TimelineDoc,
  TrimMode,
  VideoJob,
  VideoStyle
} from '../shared/types'
import { transcribeAudio, transcribeFileToSegments } from './speech'
import { buildBurnSubsArgs, buildSrt } from './video/captions'
import { fetchPsxDocument, PsxFetchError } from './data/psxFetch'
import {
  analyzePsxBars,
  buildPsxWorkbook,
  fetchPsxEod,
  fetchPsxEodDetailed,
  normalizeSymbol,
  setPsxCacheDir,
  summarizePsxAnalysis
} from './data/psxLive'
import { buildAnalysisScriptPrompt, type AnalysisKind, type ScriptDirectives } from './data/analysisScript'
import { getWebServerStatus, startWebServer, stopWebServer } from './webserver'
import {
  appendChat,
  appendVideo,
  clearActivityLog,
  clearChat,
  deleteChatMessage,
  deleteDjPlan,
  deleteFromLibrary,
  deleteVideo,
  emptyLibraryTrash,
  getDemucsCmd,
  getDraft,
  getHordeApiKey,
  getModel,
  getMvsepToken,
  getFaceAnimCmd,
  getScriptPad,
  getSecondBackupDir,
  getSettings,
  getYouTubeChannelId,
  getLastHealth,
  getSeenChangeIds,
  listRenderQueue,
  saveRenderQueue,
  isPurgeBackupsOnDelete,
  markChangesSeen,
  setLastHealth,
  setPurgeBackupsOnDelete,
  setSecondBackupDir,
  setStartWithWindows,
  setDemucsCmd,
  setFaceAnimCmd,
  setDraft,
  setHordeApiKey,
  setMvsepToken,
  setYouTubeChannelId,
  listActivityLog,
  listChat,
  listDjPlans,
  listLibrary,
  listTemplates,
  listVideos,
  logActivity,
  saveTemplate,
  deleteTemplate,
  restoreLibraryEntry,
  saveDjPlan,
  saveScriptPad,
  saveToLibrary,
  trashLibraryEntry,
  setActiveProvider,
  setApiKey,
  setModel,
  setPiperVoiceId,
  setProviderEnabled,
  setYouTubeApiKey,
  videosDir
} from './store'

/**
 * The Caretaker needs "is a render running?" which lives in main/index.ts; injected here
 * so ipc.ts does not import main/index (which imports ipc.ts back).
 */
let caretakerBusyCheck: () => boolean = () => true
export function setCaretakerBusyCheck(fn: () => boolean): void {
  caretakerBusyCheck = fn
}

export function registerIpcHandlers(): void {
  // Last-good PSX data cache lives with the rest of the user's data (travels with the
  // portable folder). psxLive.ts takes the dir by injection so it stays Electron-free.
  setPsxCacheDir(join(app.getPath('userData'), 'psx-cache'))

  ipcMain.handle(IPC.settingsGet, () => getSettings())

  ipcMain.handle(IPC.settingsSetProvider, (_e, provider: LLMProviderId) => {
    logActivity('user', 'Changed active provider', provider)
    return setActiveProvider(provider)
  })

  ipcMain.handle(IPC.settingsSetModel, (_e, provider: LLMProviderId, model: string) => {
    logActivity('user', `Changed ${provider} model`, model)
    return setModel(provider, model)
  })

  ipcMain.handle(IPC.settingsSetApiKey, (_e, provider: LLMProviderId, key: string) => {
    logActivity('user', `${key ? 'Updated' : 'Removed'} ${provider} API key`)
    return setApiKey(provider, key)
  })

  /**
   * The switchboard: which brains may be contacted at all. Logged because "why did my
   * AI change" must always be answerable from the Activity Log.
   */
  ipcMain.handle(IPC.settingsSetProviderEnabled, (_e, provider: LLMProviderId, on: boolean) => {
    logActivity('user', `${on ? 'Switched ON' : 'Switched OFF'} the ${provider} AI`)
    return setProviderEnabled(provider, on)
  })

  // ---- The Caretaker (see main/caretaker.ts for the whole idea) ----
  ipcMain.handle(IPC.caretakerStatus, () => caretakerStatus())
  ipcMain.handle(IPC.caretakerRunNow, async () => {
    logActivity('user', 'Ran the Caretaker by hand')
    return runCaretakerPass('manual', caretakerBusyCheck)
  })
  ipcMain.handle(IPC.caretakerSetSchedule, (_e, hours: number, paused: boolean) => {
    updateCaretakerSchedule(hours, paused, caretakerBusyCheck)
    return caretakerStatus()
  })
  ipcMain.handle(IPC.caretakerClearLog, () => {
    // Only from the user's click — his rule, same as the Activity Log.
    logActivity('user', "Cleared the Caretaker's record")
    clearCaretakerLog()
    return caretakerStatus()
  })

  /** Gemini: verify only — saving happens separately, and only on a confirmed pass. */
  ipcMain.handle(IPC.geminiKeyVerify, async (_e, rawKey: string) => {
    const verdict = rawKey ? await verifyGeminiKey(rawKey) : await verifySavedGeminiKey()
    logActivity('user', 'Checked the Gemini key', verdict.state === 'working' ? 'works' : verdict.title)
    return verdict
  })

  ipcMain.handle(IPC.settingsSetYouTubeKey, (_e, key: string) => {
    logActivity('user', `${key ? 'Updated' : 'Removed'} YouTube API key`)
    return setYouTubeApiKey(key)
  })

  /**
   * Does this key actually work? One 1-unit request to Google, and a plain sentence back.
   * Nothing is saved here — verifying and saving are separate on purpose, so a key is
   * never stored on the strength of having been typed.
   */
  ipcMain.handle(IPC.youtubeKeyVerify, async (_e, rawKey: string) => {
    const verdict = rawKey ? await verifyYouTubeKey(rawKey) : await verifySavedYouTubeKey()
    // Logged either way: a check that came back "could not tell" is exactly the event
    // that used to leave no trace at all and cost an evening to find.
    logActivity('user', 'Checked the YouTube key', verdict.state === 'working' ? 'works' : verdict.title)
    return verdict
  })

  /** @handle / channel URL / UC id → the id and the channel's NAME, to confirm by eye. */
  ipcMain.handle(IPC.youtubeChannelResolve, async (_e, input: string, rawKey: string) => {
    const found = await resolveYouTubeChannel(input, rawKey)
    logActivity('user', 'Looked up a YouTube channel', found.ok ? found.title : found.problem)
    return found
  })

  ipcMain.handle(IPC.ollamaStatus, () => getOllamaStatus())

  ipcMain.handle(IPC.ideasGenerate, (_e, req: IdeaGenRequest) => generateIdeasFlow(req))

  ipcMain.handle(IPC.scriptGenerate, (e, req: ScriptGenRequest) =>
    // Feature-length generation is 12-20 sequential model calls (can exceed an
    // hour on local Ollama); stream chaptering progress to the originating window.
    generateScriptFlow(req, (stage) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.scriptProgress, stage)
    })
  )

  ipcMain.handle(IPC.thumbnailGenerate, async (_e, topic: string, title: string) => {
    const provider = getActiveProvider()
    const brief = await provider.generateThumbnailBrief(topic, title)
    logActivity('ai', 'Generated thumbnail brief', title || topic)
    return brief
  })

  // Renders an actual thumbnail IMAGE (1280x720 PNG) from a headline + style. Free,
  // offline. Returns the file path so the renderer can preview it via file://.
  ipcMain.handle(IPC.thumbnailRender, async (_e, headline: string, style: VideoStyle, bgImage?: string) => {
    const outPath = join(thumbnailsDir(), `thumb-${randomUUID().slice(0, 8)}.png`)
    await renderThumbnail(headline, style, outPath, bgImage)
    logActivity('user', 'Generated a thumbnail image', headline)
    saveToLibrary({
      id: randomUUID(),
      kind: 'image',
      data: { title: headline.slice(0, 80) || 'Thumbnail', path: outPath, source: 'Thumbnail' },
      savedAt: new Date().toISOString()
    })
    return outPath
  })

  // Saves a copy of a generated thumbnail wherever the user chooses.
  ipcMain.handle(IPC.thumbnailSave, async (_e, srcPath: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save thumbnail',
      defaultPath: 'thumbnail.png',
      filters: [{ name: 'PNG Image', extensions: ['png'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Saved a thumbnail image', res.filePath)
    return { saved: true, path: res.filePath }
  })

  ipcMain.handle(IPC.libraryList, () => listLibrary())

  ipcMain.handle(IPC.librarySave, (_e, entry: Omit<LibraryEntry, 'id' | 'savedAt'>) => {
    logActivity('user', `Saved ${entry.kind} to library`, (entry.data as { title: string }).title)
    return saveToLibrary({ ...entry, id: randomUUID(), savedAt: new Date().toISOString() })
  })

  // "Delete" is now reversible: it only moves the entry to the Trash Can. Permanent
  // removal happens ONLY via the two explicit user actions below — nothing else in the
  // app (AI included) can destroy a library item.
  ipcMain.handle(IPC.libraryDelete, (_e, id: string) => {
    logActivity('user', 'Moved library item to Trash', id)
    return trashLibraryEntry(id)
  })

  ipcMain.handle(IPC.libraryRestore, (_e, id: string) => {
    logActivity('user', 'Restored library item from Trash', id)
    return restoreLibraryEntry(id)
  })

  ipcMain.handle(IPC.libraryDeleteForever, (_e, id: string) => {
    logActivity('user', 'Permanently deleted library item', id)
    // DELETE-EVERYWHERE: the entry, its file on disk, and the backup copies go together.
    // The UI contract is unchanged — callers still get the entries list back.
    const { entries, removedRels } = deleteFromLibrary(id)
    if (removedRels.length) void purgeFromBackups(removedRels)
    return entries
  })

  ipcMain.handle(IPC.libraryEmptyTrash, () => {
    logActivity('user', 'Emptied the Library Trash')
    const { entries, removedRels } = emptyLibraryTrash()
    if (removedRels.length) void purgeFromBackups(removedRels)
    return entries
  })

  ipcMain.handle(IPC.exportText, async (e, suggestedName: string, content: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      defaultPath: suggestedName,
      filters: [{ name: 'Text', extensions: ['txt'] }, { name: 'Markdown', extensions: ['md'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { saved: false }
    try {
      writeFileSync(result.filePath, content, 'utf-8')
    } catch (err) {
      // Match the other save handlers: return a structured error instead of
      // rejecting the invoke (which would surface as an unhandled rejection with
      // no user-visible message, making a failed export look like a success).
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Exported script to file', result.filePath)
    return { saved: true, path: result.filePath }
  })

  ipcMain.handle(IPC.voiceoverGenerate, async (e, text: string, suggestedName: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      defaultPath: suggestedName,
      filters: [{ name: 'WAV Audio', extensions: ['wav'] }]
    }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { saved: false }
    await synthesizeSpeechToFile(text, result.filePath)
    logActivity('ai', 'Generated voiceover', result.filePath)
    return { saved: true, path: result.filePath }
  })

  // Parse a user-picked price file (CSV/Excel — e.g. a PSX price export) into an OHLC
  // series with SMA/RSI overlays computed by the unit-tested analysis math, for the
  // in-app charts. No account, no scraping — your data, your math.
  ipcMain.handle(IPC.chartPriceFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a price file (CSV / Excel)',
      properties: ['openFile'],
      filters: [{ name: 'Price data', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (res.canceled || !res.filePaths[0]) return { canceled: true }
    try {
      const sheet = parseSpreadsheetFile(res.filePaths[0])
      const series = buildPriceSeries(sheet)
      logActivity('user', 'Charted a price file', basename(res.filePaths[0]))
      return { canceled: false, series, name: basename(res.filePaths[0]) }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  ipcMain.handle(IPC.dataImportFile, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    try {
      const analysis = analyzeImportedFile(filePath, basename(filePath))
      logActivity('user', 'Imported file for analysis', `${analysis.fileName} (${analysis.kind})`)
      return { canceled: false, analysis }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Failed to parse file' }
    }
  })

  ipcMain.handle(IPC.dataFetchPsxDocument, async (e, url: string) => {
    let buffer: Buffer
    let fileName: string
    try {
      ;({ buffer, fileName } = await fetchPsxDocument(url))
    } catch (err) {
      return { canceled: false, error: err instanceof PsxFetchError ? err.message : 'Failed to fetch document' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = { defaultPath: fileName }
    const result = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (result.canceled || !result.filePath) return { canceled: true }
    try {
      writeFileSync(result.filePath, buffer)
    } catch (err) {
      // Honour the PsxFetchResult contract's `error` field instead of throwing.
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not save the document.' }
    }
    logActivity('user', 'Fetched document from PSX', `${fileName} <- ${url}`)

    const ext = result.filePath.split('.').pop()?.toLowerCase()
    if (ext === 'csv' || ext === 'xlsx' || ext === 'xls') {
      try {
        const analysis = analyzeImportedFile(result.filePath, basename(result.filePath))
        return { canceled: false, savedPath: result.filePath, analysis }
      } catch {
        // Saved fine, just isn't a shape we can analyze — still a success.
      }
    }
    if (ext === 'pdf') {
      // Financial statements from PSX are usually PDFs. Extract their text +
      // detectable figures so the Writer can reason from real numbers. Uses the
      // buffer we already fetched (no re-read); failures are non-fatal.
      try {
        const text = await extractPdfText(buffer)
        const analysis = { fileName, kind: 'document' as const, summary: summarizeStatement(text) }
        logActivity('user', 'Extracted text from PSX statement PDF', fileName)
        return { canceled: false, savedPath: result.filePath, analysis }
      } catch {
        // Saved fine; text extraction just didn't work for this PDF — still a success.
      }
    }
    return { canceled: false, savedPath: result.filePath }
  })

  ipcMain.handle(IPC.dataCorrelateFlowPrice, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const flowDialog: Electron.OpenDialogOptions = {
      title: 'Select NCCPL flow data file (CSV/Excel)',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const flowResult = win ? await dialog.showOpenDialog(win, flowDialog) : await dialog.showOpenDialog(flowDialog)
    if (flowResult.canceled || !flowResult.filePaths[0]) return { canceled: true }

    const priceDialog: Electron.OpenDialogOptions = {
      title: 'Now select the PSX price history file to correlate against',
      properties: ['openFile'],
      filters: [{ name: 'Spreadsheets', extensions: ['csv', 'xlsx', 'xls'] }]
    }
    const priceResult = win ? await dialog.showOpenDialog(win, priceDialog) : await dialog.showOpenDialog(priceDialog)
    if (priceResult.canceled || !priceResult.filePaths[0]) return { canceled: true }

    try {
      const flowSheet = parseSpreadsheetFile(flowResult.filePaths[0])
      const priceSheet = parseSpreadsheetFile(priceResult.filePaths[0])
      const summary = correlateFlowWithPrice(flowSheet, priceSheet)
      logActivity(
        'user',
        'Correlated NCCPL flow data with PSX price data',
        `${basename(flowResult.filePaths[0])} + ${basename(priceResult.filePaths[0])}`
      )
      return { canceled: false, summary }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Failed to correlate files' }
    }
  })

  // LIVE PSX: fetch a symbol's real EOD history from dps.psx.com.pk and analyse it in-app.
  ipcMain.handle(IPC.psxLiveAnalyze, async (_e, symbol: string) => {
    try {
      const { bars, staleAsOf } = await fetchPsxEodDetailed(symbol)
      const analysis = analyzePsxBars(symbol, bars)
      logActivity('user', 'Fetched live PSX data', `${analysis.symbol} (${analysis.points} days)`)
      // staleAsOf ≠ null → the portal was unreachable and this is the last SAVED data;
      // the page shows that plainly so nobody mistakes it for a live quote.
      return { ok: true, analysis, summary: summarizePsxAnalysis(analysis), staleAsOf }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
  })

  // LIVE PSX: export the fetched data + indicators to a downloadable .xlsx.
  ipcMain.handle(IPC.psxLiveExcel, async (e, symbol: string) => {
    let bars, analysis
    try {
      bars = await fetchPsxEod(symbol)
      analysis = analyzePsxBars(symbol, bars)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.SaveDialogOptions = {
      title: 'Save PSX data workbook',
      defaultPath: `${normalizeSymbol(symbol)}-PSX-${analysis.to}.xlsx`,
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      buildPsxWorkbook(bars, analysis, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not write the Excel file.' }
    }
    logActivity('user', 'Exported PSX data to Excel', `${analysis.symbol} → ${basename(res.filePath)}`)
    return { saved: true, path: res.filePath }
  })

  // LIVE PSX: turn the (accurate, in-app) analysis into a reasoned narration script via the
  // active free/paid brain. The model only writes prose around figures WE computed. The
  // user drives it with an optional instruction + language.
  ipcMain.handle(IPC.psxLiveScript, async (_e, symbol: string, directives?: ScriptDirectives) => {
    let analysis, summary
    try {
      const bars = await fetchPsxEod(symbol)
      analysis = analyzePsxBars(symbol, bars)
      summary = summarizePsxAnalysis(analysis)
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
    try {
      const prompt = buildAnalysisScriptPrompt({ kind: 'technical', subject: `${analysis.symbol} on the PSX`, figures: summary, directives })
      const script = await getActiveProvider().generateText(prompt, 1800)
      logActivity('ai', 'Generated a PSX analysis script', analysis.symbol)
      return { ok: true, title: `${analysis.symbol} — PSX Live Analysis (${analysis.latestDate})`, script }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not generate the script.' }
    }
  })

  // GENERIC analysis → narration script. Used by the NCCPL tab (uploaded FIPI/LIPI files)
  // and any tab that already has computed figures. `figures` is the verified summary; the
  // model only writes prose around it, in the requested language/instruction.
  ipcMain.handle(
    IPC.analysisScript,
    async (_e, kind: AnalysisKind, subject: string, figures: string, directives?: ScriptDirectives) => {
      if (!figures || !figures.trim()) return { ok: false, error: 'Nothing to write about — analyze a file first.' }
      try {
        const prompt = buildAnalysisScriptPrompt({ kind, subject: subject || 'this data', figures, directives })
        const script = await getActiveProvider().generateText(prompt, 1800)
        logActivity('ai', 'Generated an analysis script', `${kind}: ${subject}`)
        return { ok: true, title: `${subject || 'Analysis'} — ${kind} script`, script }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not generate the script.' }
      }
    }
  )

  // LIVE PSX: fetch a symbol's EOD history and return a chart-ready PriceSeries (close
  // line + SMA20/50 + RSI14), for the Charts tab.
  ipcMain.handle(IPC.psxLiveSeries, async (_e, symbol: string) => {
    try {
      const { bars, staleAsOf } = await fetchPsxEodDetailed(symbol)
      const series = buildPriceSeriesFromBars(bars.map((b) => ({ date: b.date, close: b.close, volume: b.volume })))
      logActivity('user', 'Charted live PSX data', normalizeSymbol(symbol))
      const name = `${normalizeSymbol(symbol)} · PSX ${staleAsOf ? `SAVED data (offline — last fetched ${staleAsOf})` : 'live (EOD close)'}`
      return { ok: true, series, name, staleAsOf }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not fetch PSX data.' }
    }
  })

  ipcMain.handle(IPC.activityList, () => listActivityLog())

  // The ONLY caller of clearActivityLog() in the entire app — reachable exclusively
  // via an explicit user click on the "Clear Log" button in the renderer. No AI/generation
  // code path is wired to this channel.
  ipcMain.handle(IPC.activityClear, () => clearActivityLog())

  // Known Issues panel. Read-only by design: the point of this log is to be provable
  // evidence of what failed, so nothing in the app may erase it.
  ipcMain.handle(IPC.aiErrorsList, (_e, limit?: number) => readAiErrors(limit ?? 100))
  // Appending is allowed (the boundary needs it); erasing still is not.
  ipcMain.handle(IPC.aiErrorsRecordUi, (_e, x: { tab?: string; message?: string; stack?: string }) => {
    logAiError({
      at: new Date().toISOString(),
      provider: 'interface',
      feature: String(x?.tab || 'unknown tab'),
      message: String(x?.message || 'A tab stopped working'),
      body: x?.stack ? String(x.stack) : undefined
    })
  })
  ipcMain.handle(IPC.aiErrorsReveal, () => {
    const file = aiErrorLogPath()
    if (existsSync(file)) shell.showItemInFolder(file)
    else shell.openPath(dirname(file))
  })

  ipcMain.handle(IPC.advisorHistory, () => listChat())

  // Both deletes below are reachable ONLY from explicit user buttons in the Advisor UI —
  // no AI/generation path ever removes advisor memory.
  ipcMain.handle(IPC.advisorDelete, (_e, id: string) => {
    logActivity('user', 'Deleted an advisor message')
    return deleteChatMessage(id)
  })
  ipcMain.handle(IPC.advisorClear, () => {
    logActivity('user', 'Cleared advisor conversation')
    return clearChat()
  })

  ipcMain.handle(IPC.advisorSend, async (e, req: AdvisorRequest) => {
    const settings = getSettings()
    const system = buildAdvisorSystemPrompt(req.context)
    const messages = Array.isArray(req.messages) ? req.messages : []

    const flat = `${system}\n\n${messages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join('\n\n')}\n\nASSISTANT:`
    let reply: string
    if (settings.activeProvider === 'ollama') {
      const turns: ChatTurn[] = [{ role: 'system', content: system }, ...messages]
      try {
        reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, delta)
        })
      } catch {
        // Ollama unreachable (not installed/running) — degrade to the free hosted brain so
        // the advisor still answers instead of dying with ECONNREFUSED.
        reply = await getActiveProvider().generateText(flat, 1500)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, reply)
      }
    } else {
      reply = await getActiveProvider().generateText(flat, 1500)
      if (!e.sender.isDestroyed()) e.sender.send(IPC.advisorStream, reply)
    }

    // Persist BOTH turns only AFTER a successful reply, so a failed generation never leaves
    // durable memory with a user message and no answer.
    const lastUser = messages[messages.length - 1]
    if (lastUser?.role === 'user') {
      appendChat({ id: randomUUID(), role: 'user', content: lastUser.content, createdAt: new Date().toISOString() })
    }
    const assistantMsg = {
      id: randomUUID(),
      role: 'assistant' as const,
      content: reply,
      createdAt: new Date().toISOString()
    }
    appendChat(assistantMsg)
    logActivity('ai', 'Advisor replied')
    return assistantMsg
  })

  // Global studio assistant: a page-aware, streaming chat available on every tab.
  // Uses the active brain (free Ollama / paid). Ephemeral — not persisted like the
  // Advisor, so it never clutters your saved advisor memory.
  ipcMain.handle(IPC.assistantAsk, async (e, messages: { role: 'user' | 'assistant'; content: string }[], context: string) => {
    const settings = getSettings()
    // Cap the grounding context so a large pasted draft can't blow a small model's window.
    const ctx = typeof context === 'string' ? context.slice(0, 6000) : ''
    const system =
      `You are the channel's in-house YouTube PRODUCER inside NihilPointZero Studio — a sharp, ` +
      `highly intelligent growth strategist, script doctor AND the app's own guide. You think in hooks ` +
      `(first 3 seconds), curiosity gaps, pattern interrupts, retention/watch-time, high-CTR titles & thumbnails, ` +
      `pacing, and CTAs. Context: ${ctx || 'the app'}. Give practical, specific, direct advice — concrete rewrites ` +
      `and numbers, not vague tips. When the user wants you to actually REWRITE what they're editing (hook, title, ` +
      `intro, script), tell them to use the quick-action buttons or say "rewrite this" so the change can be applied ` +
      `to their field. For cutting/keeping video parts or adding music/SFX, point them to the AI Director in Video ` +
      `Studio or the Timeline editor.\n\n` +
      `HOW-TO QUESTIONS: when the user asks how to do something in the app ("how do I…", "where is…", "why won't…"), ` +
      `answer ONLY from the manual below with exact tab names and click-paths, as numbered steps. If the manual ` +
      `doesn't cover it, say so honestly rather than inventing buttons. ANSWER DENSITY: if the user asks for detail ` +
      `("step by step", "explain fully", or their preference in the context says detailed), give complete granular ` +
      `steps; if they ask for brevity ("quick", "short", or preference says brief), give tight high-level bullets. ` +
      `Default to short numbered steps.\n${APP_GUIDE}`
    const msgs = Array.isArray(messages) ? messages : []
    const flat = `${system}\n\n${msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
    let reply: string
    try {
      if (settings.activeProvider === 'ollama') {
        const turns: ChatTurn[] = [{ role: 'system', content: system }, ...msgs]
        try {
          reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
            if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, delta)
          })
        } catch {
          // Ollama unreachable — degrade to the free hosted brain so the on-tab assistant
          // still answers instead of dying with ECONNREFUSED.
          reply = await getActiveProvider().generateText(flat, 1200)
          if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
        }
      } else {
        reply = await getActiveProvider().generateText(flat, 1200)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
      }
    } catch (err) {
      // Never reject the invoke: surface a readable error in the chat instead of an
      // unhandled rejection that makes the panel appear dead.
      reply = `⚠ ${err instanceof Error ? err.message : 'The AI brain is unavailable'} — check Settings (Free online needs internet; Ollama/paid need setup).`
      if (!e.sender.isDestroyed()) e.sender.send(IPC.assistantStream, reply)
    }
    return reply
  })

  // The "Studio Expert" (🧭): a SECOND on-every-tab assistant, separate from the Producer.
  // Pure app expert — answers anything about the software from the manual, in whatever
  // format the user asks (bullets / steps / precise clicks / detailed / brief), and points
  // the user at the widget's Execute flow when they want steps actually RUN. Ephemeral,
  // same streaming shape as the Producer's assistantAsk.
  ipcMain.handle(IPC.guideAsk, async (e, messages: { role: 'user' | 'assistant'; content: string }[], context: string) => {
    const settings = getSettings()
    const ctx = typeof context === 'string' ? context.slice(0, 6000) : ''
    const system =
      `You are the STUDIO EXPERT inside NihilPointZero Studio — the app's dedicated, all-knowing guide ` +
      `(a separate helper from the YouTube Producer). The manual below is your ONLY source of truth about ` +
      `the app: answer with exact tab names and click-paths, and if the manual doesn't cover something, say ` +
      `so honestly instead of inventing buttons.\n\n` +
      `FORMAT — the user chooses, you obey EXACTLY: "bullet points" = tight bullets; "step by step" or ` +
      `"step wise" = numbered steps; "precise steps"/"exact clicks" = one UI action per numbered step naming ` +
      `the exact button/tab; "detailed" = a full granular walkthrough including what the user should see ` +
      `after each action; "brief"/"quick" = 3-5 lines max. A format asked in the message beats any default. ` +
      `If no format is requested, use short numbered steps.\n\n` +
      `EXECUTION — you cannot click the UI yourself, but the app CAN run real creation steps (write scripts, ` +
      `build videos, generate scenes/images/thumbnails/music/ideas, PSX analysis). When the user wants ` +
      `something DONE rather than explained, tell them to press the "⚡ Execute" button under your answer, or ` +
      `switch this panel to Execute mode and type the order directly — the app turns it into a validated plan ` +
      `they approve with Run. NEVER claim you already did or clicked something yourself.\n\n` +
      `Context: ${ctx || 'the app'}\n${APP_GUIDE}`
    const msgs = Array.isArray(messages) ? messages : []
    const flat = `${system}\n\n${msgs.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
    let reply: string
    try {
      /**
       * THE EXPERT PREFERS THE LOCAL BRAIN — his ask: the Expert "should have its own
       * LLM model in which it should know each and everything about the studio", working
       * even when nothing else does. So whenever Ollama is switched ON (not merely
       * active), the Expert tries it first with the full manual as its grounding: no
       * internet, no keys, no allowances. Only if the local brain is unreachable does it
       * degrade to the active chain — and the no-AI "Instant" mode still answers from
       * the manual when every brain is down.
       */
      if (settings.providerEnabled.ollama || settings.activeProvider === 'ollama') {
        const turns: ChatTurn[] = [{ role: 'system', content: system }, ...msgs]
        try {
          reply = await ollamaChatStream(getModel('ollama'), turns, (delta) => {
            if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, delta)
          })
        } catch {
          // Ollama unreachable — degrade to the active chain (which itself degrades)
          // so the Expert still answers instead of dying with ECONNREFUSED.
          reply = await getActiveProvider().generateText(flat, 1200)
          if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
        }
      } else {
        reply = await getActiveProvider().generateText(flat, 1200)
        if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
      }
    } catch (err) {
      // Never reject the invoke: surface a readable error in the chat instead of an
      // unhandled rejection that makes the panel appear dead.
      reply = `⚠ ${err instanceof Error ? err.message : 'The AI brain is unavailable'} — check Settings (Free online needs internet; Ollama/paid need setup).`
      if (!e.sender.isDestroyed()) e.sender.send(IPC.guideStream, reply)
    }
    return reply
  })

  // Live health check — actually talks to every service (validates keys with a cheap
  // authenticated request) instead of trusting saved settings. See src/main/health.ts.
  ipcMain.handle(IPC.healthRun, async () => {
    const report = await runHealthCheck()
    // A manual run is the freshest truth — store it so the weekly badge clears
    // (or appears) based on what the user just saw.
    setLastHealth(report.checks.filter((c) => c.status === 'fail').map((c) => c.name))
    return report
  })

  // "Update available" banner support: pull-based re-read for renderers that mounted
  // after the one-shot broadcast (slow first paint, Ctrl+R reload).
  ipcMain.handle(IPC.updateGet, () => getAvailableUpdate())

  // The one-click update for the INSTALLED app: the ship pipeline already swapped the
  // code archive on disk (Smart App Control-safe), so when the disk copy is newer than
  // what's running, a plain relaunch IS the update. Returns ok:false when that isn't
  // the case (portable exe, or nothing newer on disk) so the UI falls back to reveal.
  ipcMain.handle(IPC.updateRestart, () => {
    try {
      if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return { ok: false }
      const asar = app.getAppPath()
      if (!asar.endsWith('.asar') || !existsSync(asar)) return { ok: false }
      if (!diskIsNewerThanRunning(statSync(asar).mtimeMs, __BUILD_TAG__)) return { ok: false }
      app.relaunch()
      app.exit(0)
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  // Reveal the setup exe in the Desktop studio folder so a non-technical user finds it
  // in one click. ONLY when that exe is at least as new as the advertised build — on a
  // PC where the studio folder was merely copied, the local exe is the OLD installer and
  // revealing it would trap the user in an update loop. Stale/missing -> download page.
  ipcMain.handle(IPC.updateRevealSetup, (_e, remoteTag?: string) => {
    const setup = join(app.getPath('desktop'), 'NihilPointZeroStudio', 'NIHILPOINTZERO-OS-setup.exe')
    const remoteAt = typeof remoteTag === 'string' ? tagDate(remoteTag) : null
    if (existsSync(setup)) {
      const mtime = statSync(setup).mtimeMs
      // 30 min slack: build/copy timestamps of the SAME release can differ slightly.
      if (remoteAt === null || mtime >= remoteAt - 30 * 60_000) {
        shell.showItemInFolder(setup)
        return { ok: true, opened: 'local' }
      }
    }
    void shell.openExternal('https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest')
    return { ok: true, opened: 'download-page' }
  })

  /**
   * THE WHOLE UPDATE, done by the app: fetch the installer, check it is genuinely the
   * file GitHub described, run it, quit.
   *
   * This exists because the honest description of the old best case was "we opened a web
   * page for you" — after which the user still had to beat the browser's warning about
   * .exe downloads, find the file in Downloads, and double-click it. That is not the
   * app's job to delegate. The two older routes are still tried first / kept as the
   * fallback, so nothing was taken away.
   */
  /**
   * "Open the studio when Windows starts." Applied to Windows immediately as well as
   * saved, so the toggle takes effect now rather than after the next launch — a switch
   * whose effect you cannot observe is a switch nobody trusts.
   */
  ipcMain.handle(IPC.settingsSetStartWithWindows, (_e, on: boolean) => {
    const saved = setStartWithWindows(!!on)
    const applied = applyOpenAtLogin(saved, app)
    logActivity('user', saved ? 'Studio will open when Windows starts' : 'Studio will not open when Windows starts')
    return { on: saved, applied }
  })

  /**
   * Reads the download page NOW and says where this app stands.
   *
   * A live fetch rather than the cached startup result, because the question being asked
   * is "is it working?" and answering that from a value read minutes ago would not settle
   * it. The published tag comes out of the release notes, which is the same line the
   * startup check reads, so the two can never disagree.
   */
  ipcMain.handle(IPC.updateStatus, async () => {
    const rel = await fetchLatestRelease()
    const published = rel.ok ? buildTagFromRelease({ body: rel.body, tag_name: rel.tag_name, published_at: rel.published_at }) : null
    return { ...describeUpdateStatus(__BUILD_TAG__, published), checkedAt: new Date().toISOString() }
  })

  ipcMain.handle(IPC.updateInstall, async (e) =>
    runSelfUpdate({
      ...selfUpdateEnv(),
      onProgress: (pct, stage) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.updateInstallProgress, { pct, stage })
      }
    })
  )

  // "What changed": the new things in the build that is ACTUALLY RUNNING. The build tag
  // comes from __BUILD_TAG__ here rather than from the renderer, so a stale page cannot
  // make the app claim features it does not have.
  ipcMain.handle(IPC.whatsNewGet, () => whatsNewReport({ buildTag: __BUILD_TAG__, seenIds: getSeenChangeIds() }))

  ipcMain.handle(IPC.whatsNewMarkSeen, (_e, ids?: unknown) => {
    const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []
    markChangesSeen(list)
    return whatsNewReport({ buildTag: __BUILD_TAG__, seenIds: getSeenChangeIds() })
  })

  // CUT THE DEAD AIR out of a take. Two steps on purpose: the plan is cheap (two reads,
  // no encode) and is SHOWN before anything happens, because a silence remover that just
  // does it to a finished take is one nobody trusts. The cut then writes a NEW file and
  // the original is never touched — the hard rule of this app is that it does not destroy
  // the user's work.
  ipcMain.handle(IPC.silencePlan, async (_e, videoId: string) => {
    const src = listVideos().find((v) => v.id === videoId)
    if (!src || !existsSync(src.path)) return { ok: false as const, error: 'That video could not be found.' }
    try {
      const plan = await planSilenceCut(src.path, runFfmpegCapture, ffprobeDuration)
      return { ok: true as const, ...plan }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Could not read the recording.' }
    }
  })

  ipcMain.handle(IPC.silenceApply, async (e, videoId: string) => {
    const src = listVideos().find((v) => v.id === videoId)
    if (!src || !existsSync(src.path)) return { ok: false as const, error: 'That video could not be found.' }
    const notify = (stage: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, stage)
    }
    try {
      notify('Listening for dead air…')
      const { keeps, summary } = await planSilenceCut(src.path, runFfmpegCapture, ffprobeDuration)
      if (keeps.length < 2) return { ok: false as const, error: summary.headline }
      const id = randomUUID()
      const outPath = join(videosDir(), `tight-${id.slice(0, 8)}.mp4`)
      const [w, h] = await ffprobeVideoSize(src.path).catch(() => [1920, 1080] as [number, number])
      const encoder = await chooseEncoderForJob(w, h, summary.keptSec)
      notify(summary.headline)
      await runFfmpeg(buildCutArgs(src.path, outPath, keeps, buildVideoEncoderArgs(encoder)))
      const job: VideoJob = {
        ...src,
        id,
        title: `${src.title} (tightened)`,
        path: outPath,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', 'Cut the dead air out of a recording', summary.headline)
      return { ok: true as const, video: job, summary }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Could not cut the recording.' }
    }
  })

  // LEARN FROM YOUR OWN CHANNEL rather than from general advice. One fetch of the user's
  // uploads feeds all three answers: which title shapes have really worked, when the
  // audience really shows up, and which videos form a series that should be linked.
  //
  // Every figure is computed from the fetched table, never asked of a model — these are
  // arithmetic questions, and a fluent wrong answer here would change how the user titles
  // videos for a year. When the history is too short, the modules refuse to answer and
  // say so; an empty fetch reads as exactly that rather than as "nothing works".
  /**
   * One line in the Activity Log whenever a channel read did not fully succeed.
   *
   * The rule is that "I could not tell" has to be distinct, visible AND logged. It was
   * distinct and visible on screen after the first pass of this work, but it left no
   * trace, so a user reporting "the channel tab is empty" a day later still had nothing
   * to point at. Now the log says which of the reasons it was.
   */
  const logRead = (where: string, problem: { kind: string; detail?: string } | null): void => {
    // Not every problem is a failure, and the log must not say otherwise. An empty
    // channel means the read worked perfectly and there was nothing in it; a partial read
    // returned real data. Filing either under "could not read the channel" would put a
    // fault in his log for something that was not one — the same class of mistake as the
    // red mark next to a paid key he had chosen not to use.
    if (!problem || problem.kind === 'empty-channel') return
    const headline =
      problem.kind === 'partial' ? `${where}: read only part of the channel` : `${where}: could not read the channel`
    logActivity('ai', headline, `${problem.kind}${problem.detail ? ` — ${problem.detail}` : ''}`)
  }

  ipcMain.handle(IPC.channelLearn, async () => {
    // `problem` travels with the result so the page can say WHY it read nothing. An
    // empty answer used to mean five different things and named none of them.
    const { videos, problem } = await readMyChannel()
    logRead('Your channel', problem)
    const past = videos.map((v) => ({
      title: v.title,
      publishedAt: v.publishedAt,
      views: v.views,
      likes: v.likes,
      comments: v.comments
    }))
    return {
      problem,
      videoCount: past.length,
      titleFindings: learnTitlePatterns(past),
      timing: publishTimingReport(past),
      series: seriesReport(videos.map((v) => ({ id: v.id, title: v.title, publishedAt: v.publishedAt, url: `https://youtu.be/${v.id}` })))
    }
  })

  /** Score a proposed title against the channel's OWN history, with reasons. */
  ipcMain.handle(IPC.channelScoreTitle, async (_e, title: string) => {
    // Was on the blind read, so a refused key scored the title against zero videos and
    // reported "not enough history to tell" — a statement about the channel, when in
    // truth nothing had been read. Same treatment as the other three.
    const { videos, problem } = await readMyChannel()
    logRead('Title score', problem)
    return {
      ...scoreTitle(
        typeof title === 'string' ? title : '',
        videos.map((v) => ({ title: v.title, publishedAt: v.publishedAt, views: v.views }))
      ),
      problem
    }
  })

  // THE VIDEO IDEAS ALREADY SITTING IN THE COMMENTS. Every question returned is quoted
  // verbatim from a real comment, so it can be checked — a model summary of "what people
  // are asking" reads well and may match nothing anybody actually wrote.
  ipcMain.handle(IPC.channelComments, async (_e, videoLimit?: number) => {
    const { videos, problem } = await readMyChannel()
    logRead('Comment questions', problem)
    // Newest first, and only the recent ones: a question from three years ago has usually
    // been answered, and each video costs a quota unit.
    const recent = [...videos]
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
      .slice(0, Math.max(1, Math.min(30, typeof videoLimit === 'number' ? videoLimit : 12)))
    const comments = await fetchComments(recent.map((v) => v.id))
    const clusters = mineQuestions(comments)
    return { problem, scanned: comments.length, videosRead: recent.length, clusters, summary: summariseQuestions(clusters, comments.length) }
  })

  // A SMALL STAND-IN for scrubbing. The Timeline plays the real file, and a 4K clip is
  // decoded on every seek — so the picture lags behind the scrubber and trimming to an exact
  // word becomes guesswork. This makes a low-resolution copy that is TIME-IDENTICAL to its
  // source, so a cut made against it lands in exactly the same place in the original.
  //
  // It is verified rather than assumed: the two durations are compared afterwards, and a
  // proxy that drifted is refused with a reason rather than silently edited against.
  ipcMain.handle(IPC.timelineProxy, async (_e, sourcePath: string) => {
    if (typeof sourcePath !== 'string' || !existsSync(sourcePath)) {
      return { ok: false as const, error: 'That file could not be found.' }
    }
    try {
      const [width, height] = await ffprobeVideoSize(sourcePath)
      if (!worthProxying(width, height)) {
        return {
          ok: false as const,
          error: `This is ${width}x${height}, which already scrubs smoothly — a stand-in would cost minutes and buy nothing.`
        }
      }
      const out = join(generatedAudioDir(), `proxy-${randomUUID().slice(0, 8)}.mp4`)
      await runFfmpeg(buildProxyArgs({ sourcePath, outPath: out, width, height }))
      const [sourceSeconds, proxySeconds] = await Promise.all([ffprobeDuration(sourcePath), ffprobeDuration(out)])
      const trust = proxyIsTrustworthy(sourceSeconds, proxySeconds)
      if (!trust.ok) {
        // Unusable: remove it rather than leave something tempting on disk.
        try {
          rmSync(out, { force: true })
        } catch {
          /* a leftover file is not worth failing over */
        }
        return { ok: false as const, error: trust.reason }
      }
      const size = proxySize(width, height)
      return {
        ok: true as const,
        path: out,
        note: `${trust.reason} Scrubbing ${size.width}x${size.height} instead of ${width}x${height}.`,
        seconds: proxySeconds
      }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Could not make the stand-in.' }
    }
  })

  // WATCH ONE SCENE before committing to the whole render. A still cannot tell you whether
  // the camera move drifts its subject out of frame, or whether the grade suits this
  // particular picture — and finding out currently means rendering everything, looking at
  // the six seconds you cared about, and starting again.
  ipcMain.handle(
    IPC.scenePreview,
    async (
      _e,
      imagePath: string,
      seconds: number,
      motion: string,
      aspect?: string,
      template?: string
    ) => {
      if (typeof imagePath !== 'string' || !existsSync(imagePath)) {
        return { ok: false as const, error: 'That scene has no picture yet — generate it first.' }
      }
      const outPath = join(generatedAudioDir(), `scene-preview-${randomUUID().slice(0, 8)}.mp4`)
      try {
        await runFfmpeg(
          buildScenePreviewArgs({
            imagePath,
            outPath,
            seconds: typeof seconds === 'number' ? seconds : 4,
            motion: (KEN_BURNS_MOTIONS as readonly string[]).includes(motion)
              ? (motion as (typeof KEN_BURNS_MOTIONS)[number])
              : 'zoom-in',
            aspect: aspect as '16:9' | '9:16' | '1:1' | undefined,
            template: template as import('./video/templates').VideoTemplate | undefined
          })
        )
        return { ok: true as const, path: outPath, seconds: previewSeconds(seconds) }
      } catch (err) {
        return { ok: false as const, error: err instanceof Error ? err.message : 'Could not make the preview.' }
      }
    }
  )

  // THE RENDER QUEUE. Batch already worked through a list, but it lived only in memory, so
  // closing the app lost everything not yet built — and one failure at item three lost items
  // four to ten, after the app had worked perfectly for two hours. This is written to disk
  // after every change, can be added to while it runs, and a failure costs exactly one item.
  const broadcastQueue = (items: import('../shared/renderQueue').QueueItem[]): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(IPC.queueChanged, items)
    }
  }

  /** Starts the runner if it is not already going. Safe to call after every add. */
  const pumpQueue = (): void => {
    void runQueue({
      build: async (item, onProgress) => {
        const job = await performVideoBuild(item.request as VideoBuildRequest, onProgress)
        return { videoId: job.id }
      },
      onChange: broadcastQueue,
      onProgress: (item, stage) => {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(IPC.videoProgress, `${item.title}: ${stage}`)
          }
        }
      }
    })
  }

  ipcMain.handle(IPC.queueList, () => listRenderQueue())

  ipcMain.handle(IPC.queueAdd, (_e, req: VideoBuildRequest) => {
    const items = saveRenderQueue([
      ...listRenderQueue(),
      {
        id: randomUUID(),
        title: req?.title || 'Untitled video',
        state: 'waiting' as const,
        addedAt: new Date().toISOString(),
        request: req
      }
    ])
    logActivity('user', 'Added a video to the render queue', req?.title)
    broadcastQueue(items)
    pumpQueue()
    return items
  })

  ipcMain.handle(IPC.queueCancel, (_e, id: string) => {
    const items = saveRenderQueue(cancelQueued(listRenderQueue(), id))
    // Cancelling the one RENDERING has to stop the actual ffmpeg too — the queue module
    // records intent, it does not kill processes.
    if (currentQueued(listRenderQueue()) === null) cancelActiveFfmpeg()
    broadcastQueue(items)
    return items
  })

  ipcMain.handle(IPC.queueRetry, (_e, id: string) => {
    const items = saveRenderQueue(retryQueued(listRenderQueue(), id))
    broadcastQueue(items)
    pumpQueue()
    return items
  })

  ipcMain.handle(IPC.queueReorder, (_e, id: string, direction: number) => {
    const items = saveRenderQueue(reorderQueued(listRenderQueue(), id, direction < 0 ? -1 : 1))
    broadcastQueue(items)
    return items
  })

  ipcMain.handle(IPC.queueClearFinished, () => {
    const items = saveRenderQueue(clearFinishedQueued(listRenderQueue()))
    broadcastQueue(items)
    return items
  })

  // THE CREDIT CHECK BEFORE PUBLISHING. Not a copyright detector — only YouTube's Content
  // ID can answer that, and pretending otherwise would be worse than silence because the
  // user would trust it. This checks the PAPERWORK for what the app fetched itself: a
  // licence that obliges a credit, and whether that credit actually reached the
  // description. A missing credit on a CC-BY track is what turns a free track into a claim.
  ipcMain.handle(IPC.copyrightCheck, (_e, videoId: string, description?: string) => {
    const job = listVideos().find((j) => j.id === videoId)
    if (!job) return { found: false as const, error: 'Video not found — build it again first.' }
    // A video built before this shipped has no recorded provenance at all. "Nothing to
    // check" is the truthful answer there — it is not a claim that the video is clear, and
    // the report's own wording never implies one.
    const report = checkCopyright(job.credits ?? [], typeof description === 'string' ? description : '')
    return { found: true as const, ...report }
  })

  // WHAT OTHER CHANNELS COVERED THAT THIS ONE HAS NOT. Searches this channel's own beats
  // plus subjects it has never touched — searching only what it already covers can never
  // find a gap, it can only confirm coverage.
  ipcMain.handle(IPC.channelGaps, async () => {
    const read = await readMyChannel()
    logRead('Competitor gaps', read.problem)
    const mine = read.videos.map((v) => ({ title: v.title, views: v.views, publishedAt: v.publishedAt }))

    // STOP BEFORE SPENDING 800 QUOTA UNITS ON A QUESTION THAT CANNOT BE ANSWERED.
    // Each of the eight searches below costs 100 units of the daily 10,000 — one press of
    // this button is 8% of the day. A "gap" is a subject other channels cover and THIS one
    // does not, so with no videos of our own there is nothing to compare against and every
    // result would be discarded. Worse, the commonest way to reach here with no videos is
    // a key that was just refused, which means the whole 800 would be spent to produce an
    // empty page. The problem notice already explains what to fix.
    if (read.problem && !mine.length) {
      return { ...gapReport([], []), problem: read.problem, myVideos: 0, competitorVideos: 0, queries: [] }
    }

    const queries = searchQueries(mine)
    const theirs: { title: string; channelTitle: string; viewCount: number; publishedAt?: string }[] = []
    const mineTitles = new Set(mine.map((m) => m.title.toLowerCase()))
    for (const q of queries) {
      const signals = await searchYouTubeSignals(q, 10)
      for (const s of signals) {
        // Our own videos come back in a topic search. Counting them as a competitor's
        // would make every covered topic look contested and could never be a gap.
        if (!mineTitles.has(s.title.toLowerCase())) theirs.push(s)
      }
    }
    return { ...gapReport(mine, theirs), problem: read.problem, myVideos: mine.length, competitorVideos: theirs.length, queries }
  })

  // Proof the script BY EAR. The plan is pure and instant — what to listen for, and how
  // long the listen will take — so the user sees it before deciding to generate audio.
  ipcMain.handle(IPC.readAloudPlan, (_e, script: string, speed?: number) =>
    planReadAloud(typeof script === 'string' ? script : '', (speed as ReadSpeed) ?? DEFAULT_SPEED)
  )

  // Speak it, then speed the file up. Two steps rather than asking the voice engine to
  // talk fast: the engines cannot, and atempo holds the pitch so it still sounds human.
  ipcMain.handle(IPC.readAloudSpeak, async (_e, script: string, speed?: number, voice?: string) => {
    const text = typeof script === 'string' ? script.trim() : ''
    if (!text) return { ok: false as const, error: 'There is no script to read yet.' }
    const rate = typeof speed === 'number' && Number.isFinite(speed) ? speed : DEFAULT_SPEED
    const id = randomUUID().slice(0, 8)
    const wav = join(generatedAudioDir(), `readaloud-${id}.wav`)
    const out = join(generatedAudioDir(), `readaloud-${id}-${String(rate).replace('.', '_')}x.m4a`)
    try {
      const spoken = await speakToWav(text, wav, (voice as 'natural' | 'winnatural' | 'windows') ?? 'natural')
      await runFfmpeg(buildSpeedArgs(wav, out, rate))
      const plan = planReadAloud(text, rate as ReadSpeed)
      logActivity('ai', `Read the script aloud at ${rate}× to proof it`, `${plan.notes.length} things flagged`)
      // The PATH, not a URL. fileUrl() belongs in the renderer: called here it would
      // always produce file:///, which plays on the PC and is dead on the phone.
      return { ok: true as const, path: out, engineName: spoken.engineName, plan }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Could not read the script aloud.' }
    } finally {
      // The spoken original is an intermediate; only the sped-up file is listened to.
      try {
        if (existsSync(wav)) rmSync(wav, { force: true })
      } catch {
        /* a leftover temp file is not worth failing the feature over */
      }
    }
  })

  // The "YouTube Producer": a growth-strategist that critiques/rewrites the creator's
  // current document (script/title/brief/notes) and returns a structured result — a short
  // reasoning `reply` plus, when a rewrite is warranted, the full `edited` text the UI can
  // apply on the user's command. Grounded in what they're actually writing.
  ipcMain.handle(
    IPC.producerEdit,
    async (
      _e,
      params: { instruction: string; text: string; kind: string; pageName?: string }
    ): Promise<{ ok: boolean; reply?: string; edited?: string; error?: string }> => {
      const kind = params.kind || 'script'
      const sys = [
        'You are a world-class YouTube growth producer and script doctor for this creator\'s channel.',
        'You obsess over: a hook that lands in the first 3 seconds, curiosity gaps, pattern interrupts,',
        'tight pacing, clear CTAs, watch-time/retention, and high-CTR titles/thumbnails.',
        `The creator is working on their ${kind} on the "${params.pageName || 'app'}" screen.`,
        'Keep their voice and language exactly (English / Roman Urdu / Urdu as written).',
        'Return ONLY a JSON object (no prose, no fences):',
        '{"reply":"<1-3 sentences: what you changed or advise, and why it grows the channel>",',
        ' "edited":"<the FULL revised text, ready to paste — OMIT this key entirely if the task is a',
        '  question or advice-only with no rewrite>"}',
        '',
        `TASK: ${params.instruction}`,
        '',
        'CURRENT TEXT:',
        '<<<',
        (params.text || '').slice(0, 12000),
        '>>>',
        '',
        'JSON:'
      ].join('\n')
      try {
        // Scale the output budget to the input length so a long-script rewrite isn't
        // truncated mid-document (a cut-off reply is invalid JSON → nothing applied).
        const budget = Math.min(6000, Math.max(2200, Math.ceil((params.text || '').length / 3) + 600))
        const raw = await getActiveProvider().generateText(sys, budget)
        // extractJson THROWS on non-JSON, so it must be caught here — otherwise an
        // advice-only reply (e.g. "Title ideas") skips the fallback below and errors out.
        let parsed: { reply?: unknown; edited?: unknown } | null = null
        try {
          parsed = extractJson(raw) as { reply?: unknown; edited?: unknown }
        } catch {
          parsed = null
        }
        if (parsed && typeof parsed === 'object') {
          const reply = typeof parsed.reply === 'string' ? parsed.reply : ''
          const edited = typeof parsed.edited === 'string' && parsed.edited.trim() ? parsed.edited : undefined
          if (reply || edited) {
            logActivity('ai', 'Producer suggestion', params.instruction.slice(0, 60))
            return { ok: true, reply: reply || 'Here is a revision.', edited }
          }
        }
        // Advice-only / non-JSON reply — return the prose as advice instead of erroring.
        return { ok: true, reply: raw.trim() || 'No suggestion.' }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Producer is unavailable — set up your AI brain in Settings.' }
      }
    }
  )

  /**
   * Builds one video. Extracted from the IPC handler so the RENDER QUEUE calls the same code
   * path rather than a near-copy of it — the disk guard, the Activity Log bookkeeping and
   * the optional subtitles all have to behave identically whether a build was started by a
   * button or by the queue, and two copies of that would drift apart.
   *
   * The callbacks are exactly what used to be `e.sender.send(...)`. Nothing else changed.
   */
  async function performVideoBuild(
    req: VideoBuildRequest,
    onProgress: (stage: string) => void,
    onPreview?: (pngPath: string) => void,
    onExtras?: (extras: { videoId: string; srtPath?: string; chapters: string }) => void
  ): Promise<VideoJob> {
    const id = randomUUID()
    const slug = (req.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'video'
    const outPath = join(videosDir(), `${slug}-${id.slice(0, 8)}.mp4`)
    const narrationOutPath = `${outPath}.narration.wav`
    // DISK GUARD: a full disk mid-render produces a confusing half-broken failure
    // (or a corrupt file). Refuse clearly below 500MB; warn below 2GB and continue.
    const free = freeDiskMB(videosDir())
    if (free !== null && free < 500) {
      logActivity('ai', 'Video build refused — the disk is almost full', `Only ${free}MB free where videos are saved. Free some space (a 1080p video needs roughly 100-500MB while rendering) and try again.`)
      throw new Error(`This disk is almost full (${free}MB free) — a video can't be rendered safely. Free some space and try again.`)
    }
    if (free !== null && free < 2048) {
      onProgress(`⚠ Low disk space (${Math.round(free / 102.4) / 10}GB free) — a long or 4K video may not fit.`)
    }
    // Bookend the build in the Activity Log. Builds run here in the MAIN process, so they
    // keep going when the user switches tabs — these entries (start / failed / built) are
    // how the user can always answer "where did my video go?".
    logActivity('ai', 'Started building a video — it keeps building even if you switch tabs; the finished video appears in Video Studio', req.title)
    try {
      await buildVideoFromScript(
        req.title,
        req.body,
        outPath,
        (stage) => {
          onProgress(stage)
        },
        {
          resolution: req.resolution,
          aspect: req.aspect,
          template: req.template,
          narrationVoice: req.narrationVoice,
          winVoiceId: req.winVoiceId,
          musicPath: req.musicPath,
          soundEffects: req.soundEffects,
          engine: req.engine,
          style: req.style,
          images: req.images,
          imageShots: req.imageShots,
          textOverlays: req.textOverlays,
          useStock: req.useStock,
          // Read the key server-side (never sent from the renderer).
          stockApiKey: req.useStock ? getStockConfig().pixabayKey : undefined,
          onPreview: (png) => {
            onPreview?.(png)
          },
          narrationOutPath
        }
      )
    } catch (err) {
      logActivity('ai', 'Video build FAILED', `${req.title} — ${err instanceof Error ? err.message : 'unknown error'}`)
      throw err
    }
    const job = {
      id,
      title: req.title,
      path: outPath,
      hasCustomVoice: false,
      createdAt: new Date().toISOString(),
      narrationPath: existsSync(narrationOutPath) ? narrationOutPath : undefined,
      // Remember the video's own recipe: the AI DJ reads `body` to pick fitting
      // music, and "clean copy" rebuilds without captions/titles from these.
      body: req.body,
      resolution: req.resolution,
      aspect: req.aspect,
      template: req.template,
      engine: req.engine,
      style: req.style
    }
    appendVideo(job)
    logActivity('ai', `Built ${(req.resolution ?? '1080p').toUpperCase()} video${req.musicPath ? ' with music' : ''}${req.soundEffects ? ' + SFX' : ''}`, req.title)
    // Captions and chapters are produced ONLY when explicitly asked for. Neither has
    // ever been forced, and this keeps it that way while making the choice visible.
    if (req.captionsAndChapters) {
      try {
        onProgress('Writing subtitles and chapters…')
        const durationSec = await ffprobeDuration(outPath)
        const chapters = formatChapters(buildChapters(req.body, durationSec))
        const segments = await transcribeFileToSegments(existsSync(narrationOutPath) ? narrationOutPath : outPath)
        let srtPath: string | undefined
        if (segments.length) {
          srtPath = `${outPath.replace(/\.mp4$/i, '')}.srt`
          writeFileSync(srtPath, buildSrt(segments), 'utf-8')
        }
        onExtras?.({ videoId: id, srtPath, chapters })
        logActivity('ai', 'Wrote subtitles and chapter markers', req.title)
      } catch (err) {
        // Extras are a bonus — never let them turn a finished video into a failure.
        logActivity('ai', 'Subtitles/chapters could not be written (the video is fine)', err instanceof Error ? err.message : 'unknown error')
      }
    }
    return job
  }

  ipcMain.handle(IPC.videoBuild, (e, req: VideoBuildRequest) =>
    performVideoBuild(
      req,
      (stage) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, stage)
      },
      (png) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoPreview, png)
      },
      (extras) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoExtras, extras)
      }
    )
  )

  // Opens a file picker for a background-music track. Returns the absolute path
  // (or null if canceled). The app never fetches audio — you supply your own file,
  // which keeps the whole feature free and offline.
  ipcMain.handle(IPC.videoPickMusic, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Choose a background music file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Saves a copy of a built video wherever the user chooses (e.g. Downloads / USB).
  ipcMain.handle(IPC.videoSaveAs, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save video',
      defaultPath: suggestedName,
      filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'The original video is no longer available.' }
    }
    logActivity('user', 'Exported a copy of a video', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Transcode a built video into a chosen delivery format and save it wherever the
  // user picks (Downloads / USB). All encoders are in the bundled ffmpeg — free/offline.
  ipcMain.handle(IPC.videoExport, async (e, videoId: string, format: ExportFormat) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const ext = formatExtension(format)
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'video'
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions = {
      title: 'Download / export video',
      defaultPath: `${slug}.${ext}`,
      filters: [{ name: `${ext.toUpperCase()} video`, extensions: [ext] }]
    }
    const res = win ? await dialog.showSaveDialog(win, dialogOptions) : await dialog.showSaveDialog(dialogOptions)
    if (res.canceled || !res.filePath) return { saved: false }
    await exportVideo(src.path, format, res.filePath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    logActivity('user', `Exported video as ${format}`, res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Cut a built video: keep only a range, or remove a range. Produces a NEW video
  // (the original is untouched) saved to the videos folder and indexed.
  ipcMain.handle(IPC.videoTrim, async (e, videoId: string, mode: TrimMode, start: number, end: number) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = join(videosDir(), `${src.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'}-${mode}-${id.slice(0, 8)}.mp4`)
    await trimVideo(src.path, mode, start, end, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (${mode === 'keep' ? 'clip' : 'cut'})`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', `Trimmed a video (${mode})`, src.title)
    return job
  })

  // Import a script from a user-picked file (.txt/.md/.srt/.pdf) so a video can be
  // built from your own writing — no need to generate one in the finance Writer.
  // Text is extracted in the main process (no CSP) and returned to the renderer.
  ipcMain.handle(IPC.videoImportScript, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose a script file',
      properties: ['openFile'],
      filters: [
        { name: 'Script / text', extensions: ['txt', 'md', 'markdown', 'srt', 'text', 'pdf'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const result = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    const name = basename(filePath)
    const ext = (name.split('.').pop() || '').toLowerCase()
    try {
      let raw: string
      if (ext === 'pdf') {
        raw = await extractPdfText(readFileSync(filePath))
      } else {
        raw = readFileSync(filePath, 'utf-8')
      }
      const body = normalizeScriptText(raw, ext)
      if (!body.trim()) {
        return { canceled: false, error: 'That file had no readable text to turn into a script.' }
      }
      logActivity('user', 'Imported a script file for video', name)
      return { canceled: false, title: deriveTitleFromFilename(name), body }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  // Pick one or more images for a Ken-Burns slideshow background (preset engine).
  ipcMain.handle(IPC.videoPickImages, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose background images',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled ? [] : res.filePaths
  })

  // Live status for the engine badges + saved config for the settings inputs.
  ipcMain.handle(IPC.aiEngineStatus, async () => {
    const cfg = getAiVideoConfig()
    const provider = cfg.freeCloudProvider === 'pollinations' ? 'pollinations' : 'puter'
    // Both live checks in parallel — each has its own short timeout.
    const [localUp, freeCloud] = await Promise.all([
      detectLocal(),
      provider === 'pollinations' ? checkPollinationsKey(cfg.pollinationsKey ?? '') : detectPuter()
    ])
    return {
      cloudConfigured: isCloudConfigured(),
      localDetected: localUp,
      freeCloudAvailable: freeCloud.ok,
      freeCloudDetail: freeCloud.detail,
      freeCloudProvider: provider,
      localKind: localKind(),
      cloudEndpoint: cfg.cloudEndpoint,
      localEndpoint: localEndpoint()
    }
  })

  ipcMain.handle(IPC.aiGetConfig, () => {
    // Never send the raw keys back to the renderer — just whether one is set.
    const cfg = getAiVideoConfig()
    return {
      cloudEndpoint: cfg.cloudEndpoint ?? '',
      cloudModel: cfg.cloudModel ?? '',
      localEndpoint: cfg.localEndpoint ?? '',
      localKind: cfg.localKind ?? 'comfyui',
      comfyWorkflowPath: cfg.comfyWorkflowPath ?? '',
      freeCloudProvider: cfg.freeCloudProvider === 'pollinations' ? 'pollinations' : 'puter',
      freeCloudModel: cfg.freeCloudModel ?? '',
      pollinationsModel: cfg.pollinationsModel ?? '',
      freeCloudSceneCap: cfg.freeCloudSceneCap ?? 5,
      hasCloudKey: !!cfg.cloudApiKey,
      hasPollinationsKey: !!cfg.pollinationsKey
    }
  })

  ipcMain.handle(IPC.aiSetConfig, (_e, partial: AiVideoConfig) => {
    // The renderer can never write the encrypted-at-rest fields directly.
    const clean = { ...partial }
    delete clean.cloudApiKeyEnc
    delete clean.pollinationsKeyEnc
    setAiVideoConfig(clean)
    logActivity('user', 'Updated AI video engine settings')
    return { ok: true }
  })

  // Validates a Pollinations key (the saved one, or one just typed but not yet saved)
  // via /account/balance — costs nothing, returns the Pollen balance for the UI.
  ipcMain.handle(IPC.aiTestPollinationsKey, async (_e, candidateKey?: string) => {
    const key = (candidateKey ?? '').trim() || getAiVideoConfig().pollinationsKey || ''
    return checkPollinationsKey(key)
  })

  // Whether a stock-footage key is set (never returns the key itself).
  ipcMain.handle(IPC.stockGetConfig, () => {
    const c = getStockConfig()
    return { hasPixabay: !!c.pixabayKey, hasPexels: !!c.pexelsKey }
  })

  ipcMain.handle(IPC.stockSetKey, (_e, provider: 'pixabay' | 'pexels', key: string) => {
    const r = setStockKey(provider, key)
    logActivity('user', `${key ? 'Saved' : 'Removed'} ${provider} stock-footage key`)
    return r
  })

  // Last quiet weekly self-check (when + what failed) for the Settings badge. The
  // manual "Run full check" stores its result too, so the badge clears on a green run.
  ipcMain.handle(IPC.healthLast, () => getLastHealth())

  // ── Backups (one home, delete-sync, restore, optional second location) ──
  ipcMain.handle(IPC.backupStatus, () => ({
    root: backupsRoot(),
    secondDir: getSecondBackupDir() ?? '',
    purgeOnDelete: isPurgeBackupsOnDelete()
  }))

  ipcMain.handle(IPC.backupSetOptions, (_e, opts: { secondDir?: string; purgeOnDelete?: boolean }) => {
    if (typeof opts?.secondDir === 'string') setSecondBackupDir(opts.secondDir)
    if (typeof opts?.purgeOnDelete === 'boolean') setPurgeBackupsOnDelete(opts.purgeOnDelete)
    logActivity('user', 'Updated backup settings')
    return { ok: true }
  })

  ipcMain.handle(IPC.backupPickSecondDir, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose a SECOND home for your backups (a USB drive or another disk)',
      properties: ['openDirectory', 'createDirectory']
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths.length) return { picked: '' }
    setSecondBackupDir(res.filePaths[0])
    return { picked: res.filePaths[0] }
  })

  // Manual "back up right now" — same engine as the weekly run, reported honestly.
  ipcMain.handle(IPC.backupRunNow, async () => {
    const src = app.getPath('userData')
    const c = await runBackup(src, join(backupsRoot(), 'nihilpointzero-data'))
    const second = getSecondBackupDir()
    let secondNote = ''
    if (second) {
      if (existsSync(second)) {
        const c2 = await runBackup(src, join(second, 'nihilpointzero-data'))
        secondNote = c2.failed ? ` Second location: ${c2.failed} file(s) FAILED.` : ' Second location: done.'
      } else {
        secondNote = ' Second location unreachable (drive unplugged?).'
      }
    }
    logActivity('user', `Manual backup — ${c.copied} copied, ${c.unchanged} up to date${c.failed ? `, ${c.failed} FAILED` : ''}`, backupsRoot() + secondNote)
    return { ...c, secondNote }
  })

  // NON-DESTRUCTIVE restore: brings back anything missing from the live folder;
  // never overwrites existing work. The drill for this is unit-tested.
  ipcMain.handle(IPC.backupRestore, async () => {
    const backupData = join(backupsRoot(), 'nihilpointzero-data')
    if (!existsSync(backupData)) return { ok: false, error: 'No backup found yet — run "Back up now" first.' }
    const c = await restoreMissing(backupData, app.getPath('userData'))
    logActivity('user', `Restored from backup — ${c.copied} missing file(s) brought back, ${c.unchanged} already present${c.failed ? `, ${c.failed} FAILED` : ''}`)
    return { ok: true, ...c }
  })

  // Orphans = backup copies of things deleted in the app BEFORE delete-sync existed.
  // Listed first; deleted only via the confirmed cleanup below.
  ipcMain.handle(IPC.backupOrphans, async () => {
    const report = await listOrphans(join(backupsRoot(), 'nihilpointzero-data'), app.getPath('userData'))
    return { count: report.count, mb: Math.round(report.bytes / 1048576) }
  })

  ipcMain.handle(IPC.backupCleanOrphans, async () => {
    const report = await listOrphans(join(backupsRoot(), 'nihilpointzero-data'), app.getPath('userData'))
    const removed = await purgeFromBackups(report.relPaths, [backupsRoot()])
    logActivity('user', `Cleaned ${removed} orphaned backup cop${removed === 1 ? 'y' : 'ies'} (things previously deleted in the app)`)
    return { removed, mb: Math.round(report.bytes / 1048576) }
  })

  // Reusable script templates ("hook → context → analysis → takeaway…"): new videos
  // start half-built instead of from a blank page. Delete is user-confirmed in the UI.
  ipcMain.handle(IPC.templatesList, () => listTemplates())
  ipcMain.handle(IPC.templatesSave, (_e, name: string, title: string, body: string) => {
    const out = saveTemplate(String(name ?? ''), String(title ?? ''), String(body ?? ''))
    logActivity('user', 'Saved a script template', name)
    return out
  })
  ipcMain.handle(IPC.templatesDelete, (_e, id: string) => {
    const out = deleteTemplate(String(id ?? ''))
    logActivity('user', 'Deleted a script template')
    return out
  })

  ipcMain.handle(IPC.scriptpadGet, () => getScriptPad())

  ipcMain.handle(IPC.scriptpadSave, (_e, title: string, body: string) => saveScriptPad(title, body))

  // Procedurally generate a music bed / sound effect (free, offline, no downloads).
  // Returns the absolute file path so the renderer can preview it via file://.
  ipcMain.handle(IPC.audioGenerateMusic, async (_e, mood: Mood, durationSec: number, seed: number) => {
    const path = await renderMusic(mood, durationSec, seed)
    logActivity('ai', `Generated ${mood} music bed`, `${Math.round(durationSec)}s`)
    return path
  })

  ipcMain.handle(IPC.audioGenerateSfx, async (_e, kind: SfxKind) => {
    const path = await renderSfx(kind)
    logActivity('ai', 'Generated sound effect', kind)
    return path
  })

  // Pick your own audio file to add to the DJ station library.
  ipcMain.handle(IPC.audioPickFile, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Add an audio file',
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'] }]
    })
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // Lists the bundled royalty-free starter pack (rendered into resources/audio-pack
  // at build time). Returns [] in dev builds where the pack hasn't been generated.
  ipcMain.handle(IPC.audioListPack, () => {
    const packDir = app.isPackaged
      ? join(process.resourcesPath, 'audio-pack')
      : join(app.getAppPath(), 'resources', 'audio-pack')
    const manifest = join(packDir, 'manifest.json')
    if (!existsSync(manifest)) return []
    try {
      const items = JSON.parse(readFileSync(manifest, 'utf-8')) as Array<{
        id: string
        kind: 'music' | 'sfx'
        label: string
        file: string
      }>
      // Manifest stores basenames; resolve each to an absolute path under the pack dir.
      return items
        .map((it) => ({ ...it, file: join(packDir, basename(it.file)) }))
        .filter((it) => existsSync(it.file))
    } catch {
      return []
    }
  })

  // Re-mix a built video with the DJ-station timeline clips → a new video.
  ipcMain.handle(IPC.audioRemix, async (e, videoId: string, clips: AudioClip[]) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = join(videosDir(), `${src.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'}-mix-${id.slice(0, 8)}.mp4`)
    await remixVideoAudio(src.path, clips, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (DJ mix)`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', 'Re-mixed a video with DJ station', `${clips.length} clips`)
    return job
  })

  // DJ "create music only": render the timeline to a standalone MP3 (no video). Returns the path.
  ipcMain.handle(IPC.audioRenderMix, async (e, clips: AudioClip[], durationSec: number) => {
    if (!clips.length) throw new Error('Add at least one sound to the timeline first.')
    const outPath = join(generatedAudioDir(), `mix-${randomUUID().slice(0, 8)}.mp3`)
    await renderMixToAudio(clips, durationSec, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    logActivity('user', 'Created a standalone music mix', `${clips.length} clips`)
    return outPath
  })

  // Save/download any generated audio file to a location the user picks.
  ipcMain.handle(IPC.audioSaveFile, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save audio',
      defaultPath: suggestedName || 'mix.mp3',
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'The original audio is no longer available.' }
    }
    logActivity('user', 'Saved an audio file', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // AI Director: interpret a plain-English instruction into a validated edit plan
  // (using the active free/paid brain), then execute it on the chosen video.
  ipcMain.handle(IPC.directorInterpret, async (_e, videoId: string, instruction: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    return interpretInstruction(src.path, instruction)
  })

  ipcMain.handle(IPC.directorExecute, async (e, videoId: string, actions: DirectorAction[]) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    if (!actions.length) throw new Error('No edits to apply.')
    const id = randomUUID()
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
    const scratch = mkdtempSync(join(tmpdir(), 'director-'))
    try {
      const finalTemp = await executeActions(
        src.path,
        actions,
        (tag) => join(scratch, `${tag}.mp4`),
        (stage) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, stage)
        }
      )
      // Persist only the final result into the videos folder.
      const outPath = join(videosDir(), `${slug}-aiedit-${id.slice(0, 8)}.mp4`)
      copyFileSync(finalTemp, outPath)
      const job = {
        id,
        title: `${src.title} (AI edit)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', 'AI Director edited a video', `${actions.length} actions`)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // AI Command Panel: interpret a plain-English request into a validated, ordered plan
  // of safe steps (using the active free/paid brain). No changes are made yet.
  ipcMain.handle(IPC.agentInterpret, async (_e, command: string) => {
    if (!command || !command.trim()) throw new Error('Type a command first.')
    return interpretCommand(command)
  })

  // Execute a confirmed plan end-to-end (write scripts, build videos, make thumbnails,
  // generate ideas), streaming per-step progress. Returns the outcome of each step.
  ipcMain.handle(IPC.agentExecute, async (e, plan: AgentPlan) => {
    const safePlan = sanitizeAgentPlan(plan) // re-validate whatever the renderer sent
    if (!safePlan.steps.length) throw new Error('There are no runnable steps in this plan.')
    const results = await executeAgentPlan(safePlan, {
      onProgress: (stage) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.agentProgress, stage)
      },
      onPreview: (png) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoPreview, png)
      },
      stockApiKey: getStockConfig().pixabayKey
    })
    return { results }
  })

  // Scene Studio: plan editable scenes from a script, and generate one scene image at a
  // time (the renderer drives the loop so the user can watch, pause, and regenerate).
  ipcMain.handle(IPC.scenePlan, (_e, title: string, body: string, style: VideoStyle, direction: string) => {
    return planScenes(title || '', body || '', style, direction || '')
  })
  ipcMain.handle(IPC.sceneGenerate, async (_e, prompt: string, seed: number, fast: boolean) => {
    if (!prompt || !prompt.trim()) throw new Error('Empty scene prompt.')
    const imgPath = await generateSceneImage(prompt.trim(), Math.max(1, Math.round(seed) || 1), !!fast)
    // Every generated picture lands in the Library automatically (nothing generated is
    // losable); Trash-Can rules apply, so only the user can ever remove it.
    saveToLibrary({
      id: randomUUID(),
      kind: 'image',
      data: { title: prompt.trim().slice(0, 80), path: imgPath, source: 'Scene Studio' },
      savedAt: new Date().toISOString()
    })
    return imgPath
  })

  // Save ONE generated scene image wherever the user chooses.
  ipcMain.handle(IPC.sceneSaveImage, async (_e, srcPath: string, suggestedName: string) => {
    const res = await dialog.showSaveDialog({
      title: 'Save scene image',
      defaultPath: suggestedName || 'scene.jpg',
      filters: [{ name: 'JPEG Image', extensions: ['jpg', 'jpeg'] }]
    })
    if (res.canceled || !res.filePath) return { saved: false }
    try {
      copyFileSync(srcPath, res.filePath)
    } catch (err) {
      return { saved: false, error: err instanceof Error ? err.message : 'Could not save the file.' }
    }
    logActivity('user', 'Saved a scene image', res.filePath)
    return { saved: true, path: res.filePath }
  })

  // Save ALL generated scene images into a folder the user picks, numbered in order.
  ipcMain.handle(IPC.sceneSaveAllImages, async (_e, srcPaths: string[]) => {
    if (!Array.isArray(srcPaths) || srcPaths.length === 0) {
      return { saved: false, error: 'No generated images to save yet.' }
    }
    const res = await dialog.showOpenDialog({
      title: 'Choose a folder for the scene images',
      properties: ['openDirectory', 'createDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { saved: false }
    const dir = res.filePaths[0]
    let count = 0
    try {
      for (const src of srcPaths) {
        copyFileSync(src, join(dir, `scene-${String(count + 1).padStart(2, '0')}.jpg`))
        count++
      }
    } catch (err) {
      return {
        saved: false,
        error: err instanceof Error ? err.message : `Failed after saving ${count} image(s).`
      }
    }
    logActivity('user', `Saved ${count} scene images to a folder`, dir)
    return { saved: true, path: dir, count }
  })

  // Put the user IN a scene: image-to-image from their attached photo (free, AI Horde).
  // Streams queue progress on scene:progress so the slow free queue never looks frozen.
  ipcMain.handle(
    IPC.sceneGenerateFromPhoto,
    async (e, index: number, prompt: string, sourceImagePath: string, strength: number) => {
      if (!prompt || !prompt.trim()) throw new Error('Empty scene prompt.')
      if (!sourceImagePath) throw new Error('No photo attached.')
      const imgPath = await generateFromPhoto({
        prompt: prompt.trim(),
        sourceImagePath,
        apikey: getHordeApiKey() ?? undefined,
        strength,
        onProgress: (p) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.sceneProgress, { index, ...p })
        }
      })
      saveToLibrary({
        id: randomUUID(),
        kind: 'image',
        data: { title: prompt.trim().slice(0, 80), path: imgPath, source: 'Scene Studio (photo)' },
        savedAt: new Date().toISOString()
      })
      return imgPath
    }
  )

  // Auto-captions: transcribe the narration (offline Whisper) → .srt sidecar, and
  // optionally burn the subtitles into a new video. Free/offline.
  ipcMain.handle(IPC.videoCaptions, async (e, videoId: string, burn: boolean) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const notify = (m: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, m)
    }
    notify('Transcribing narration (offline)…')
    const audioSrc = src.narrationPath && existsSync(src.narrationPath) ? src.narrationPath : src.path
    const segments = await transcribeFileToSegments(audioSrc)
    if (!segments.length) throw new Error('No speech was detected to caption.')
    const srtPath = `${src.path.replace(/\.mp4$/i, '')}.srt`
    writeFileSync(srtPath, buildSrt(segments), 'utf-8')
    let job: VideoJob | undefined
    if (burn) {
      notify('Burning captions into the video…')
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-captioned-${id.slice(0, 8)}.mp4`)
      await runFfmpeg(buildBurnSubsArgs(src.path, srtPath, outPath), (line) => notify(line.trim().slice(0, 160)))
      job = {
        id,
        title: `${src.title} (captioned)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString(),
        narrationPath: src.narrationPath
      }
      appendVideo(job)
    }
    logActivity('user', burn ? 'Burned captions into a video' : 'Generated captions (.srt)', src.title)
    return { srtPath, job }
  })

  /**
   * MAKE SHORTS — one long video → several vertical (9:16) captioned clips for
   * YouTube Shorts / TikTok / Reels. Everything is local and free: the offline Whisper
   * transcript finds the moments, pure scoring picks the strongest, and bundled ffmpeg
   * cuts + reframes + burns the captions. Each clip is added to Video Studio.
   */
  /**
   * Ready-to-paste posting text for a finished clip: title + description + hashtags.
   * Uses the video's own title/script as grounding so it describes THIS clip, and
   * degrades to a usable non-AI fallback rather than failing the click.
   */
  async function draftPostingText(
    job: VideoJob,
    platform: 'youtube' | 'tiktok',
    vertical?: boolean
  ): Promise<{ title: string; description: string; hashtags: string[] }> {
    // The saved script isn't part of VideoJob, so the title is the grounding text.
    const source = job.title.slice(0, 2500)
    const prompt =
      `Write posting text for a ${vertical ? 'VERTICAL short-form' : 'long-form'} video on ` +
      `${platform === 'youtube' ? (vertical ? 'YouTube Shorts' : 'YouTube') : 'TikTok'}.\n` +
      `The channel covers Pakistani/global finance and markets for a general audience; the video's ` +
      `language may be Roman Urdu — match the language of the source text.\n` +
      `Return STRICT JSON only, no prose, no code fence:\n` +
      `{"title": "<=80 chars, high click-through, no clickbait lying", ` +
      `"description": "2-3 short lines, plain text, no markdown", ` +
      `"hashtags": ["8-12 relevant tags WITHOUT the # symbol"]}\n\n` +
      `VIDEO TITLE: ${source}`
    const fallback = {
      title: job.title.slice(0, 80),
      description: `${job.title}\n\nMore finance breakdowns on the channel.`,
      hashtags: ['finance', 'stockmarket', 'psx', 'pakistan', 'investing', 'money', 'shorts', 'trading']
    }
    try {
      const raw = await getActiveProvider().generateText(prompt, 700)
      // director's extractJson is untyped (and THROWS on non-JSON — caught below).
      const parsed = extractJson(raw) as { title?: string; description?: string; hashtags?: unknown }
      const tags = Array.isArray(parsed.hashtags)
        ? (parsed.hashtags as unknown[])
            .filter((t): t is string => typeof t === 'string')
            .map((t: string) => t.replace(/^#+/, '').replace(/\s+/g, '').trim())
            .filter(Boolean)
            .slice(0, 12)
        : []
      const meta = {
        title: (parsed.title || fallback.title).slice(0, 100),
        description: parsed.description || fallback.description,
        hashtags: tags.length ? tags : fallback.hashtags
      }
      logActivity('ai', 'Generated posting text for a video', job.title)
      return meta
    } catch {
      // A busy free model must not cost the user the feature — hand back the fallback.
      return fallback
    }
  }

  ipcMain.handle(IPC.videoPostMeta, async (_e, videoId: string, platform: 'youtube' | 'tiktok', vertical?: boolean) => {
    const job = listVideos().find((j) => j.id === videoId)
    if (!job) throw new Error('Video not found — build it again first.')
    return draftPostingText(job, platform, vertical)
  })

  /** Core shorts engine, reusable by the button handler AND the overnight plan. */
  async function cutShortsForVideo(
    videoId: string,
    count: number,
    notify: (m: string) => void
  ): Promise<{ jobs: VideoJob[]; moments: { title: string; reason: string; startSec: number; endSec: number }[] }> {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    notify('Listening to the video to find the best moments (offline)…')
    const audioSrc = src.narrationPath && existsSync(src.narrationPath) ? src.narrationPath : src.path
    const segments = await transcribeFileToSegments(audioSrc)
    if (!segments.length) {
      throw new Error('No speech was found in this video, so there are no moments to clip.')
    }
    const moments = pickShortMoments(segments, { count: Math.max(1, Math.min(10, Math.round(count) || 3)) })
    if (!moments.length) throw new Error('This video is too short to cut into shorts.')

    const jobs: VideoJob[] = []
    for (let i = 0; i < moments.length; i++) {
      const m = moments[i]
      notify(`Making short ${i + 1} of ${moments.length} — ${m.title}…`)
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 32) || 'video'
      const outPath = join(videosDir(), `${slug}-short${i + 1}-${id.slice(0, 8)}.mp4`)
      // Per-clip .srt on the clip's own timeline (pickShortMoments re-bases the captions).
      const srtPath = `${outPath.replace(/\.mp4$/i, '')}.srt`
      writeFileSync(srtPath, buildSrt(m.captions), 'utf-8')
      await runFfmpeg(
        buildShortArgs({ srcPath: src.path, outPath, startSec: m.startSec, endSec: m.endSec, srtPath }),
        (line) => notify(line.trim().slice(0, 160))
      )
      const job: VideoJob = {
        id,
        title: `${src.title} — Short ${i + 1}: ${m.title}`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      jobs.push(job)
    }
    logActivity('ai', `Made ${jobs.length} vertical short(s) — now in Video Studio`, src.title)
    return { jobs, moments: moments.map((m) => ({ title: m.title, reason: m.reason, startSec: m.startSec, endSec: m.endSec })) }
  }

  ipcMain.handle(IPC.videoMakeShorts, async (e, videoId: string, count: number) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (src) logActivity('user', 'Started making shorts from a video', src.title)
    return cutShortsForVideo(videoId, count, (m) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, m)
    })
  })

  // Brand kit: overlay a logo watermark in a corner. New video, original kept.
  ipcMain.handle(
    IPC.videoWatermark,
    async (e, videoId: string, logoPath: string, position: WatermarkPosition) => {
      const src = listVideos().find((j) => j.id === videoId)
      if (!src) throw new Error('Video not found — build it again first.')
      if (!logoPath) throw new Error('Pick a logo image first.')
      const [vw] = await ffprobeVideoSize(src.path)
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-logo-${id.slice(0, 8)}.mp4`)
      await runFfmpeg(
        buildWatermarkArgs({ videoPath: src.path, logoPath, logoWidthPx: Math.round(vw * 0.15), position, outPath }),
        (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      )
      const job = {
        id,
        title: `${src.title} (logo)`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString(),
        narrationPath: src.narrationPath
      }
      appendVideo(job)
      logActivity('user', 'Added a logo watermark', src.title)
      return job
    }
  )

  // Optional free AI Horde key (faster photo-to-scene). Stored encrypted like other keys.
  ipcMain.handle(IPC.settingsSetHordeKey, (_e, key: string) => setHordeApiKey(key))
  ipcMain.handle(IPC.settingsSetMvsepToken, (_e, key: string) => setMvsepToken(key))
  ipcMain.handle(IPC.settingsSetDemucsCmd, (_e, cmd: string) => setDemucsCmd(cmd))
  ipcMain.handle(IPC.settingsSetFaceAnimCmd, (_e, cmd: string) => setFaceAnimCmd(cmd))

  // AI-separate a video's audio and keep ONE side of the split:
  //   keep 'voice' → music removed (the original behavior)
  //   keep 'music' → the voice is removed, the music/instrumental stays
  // engine 'online' (MVSEP, free token) or 'local' (Demucs). New video, original kept.
  ipcMain.handle(IPC.videoSeparateMusic, async (e, videoId: string, engine: 'online' | 'local', keep: 'voice' | 'music' = 'voice') => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const notify = (msg: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, msg)
    }
    const target = keep === 'voice' ? 'vocals' : 'instrumental'
    const scratch = makeSeparationScratch()
    try {
      notify('Extracting the audio track…')
      const mixed = join(scratch, 'mixed.wav')
      await runFfmpeg(['-y', '-i', src.path, '-vn', '-ar', '44100', '-ac', '2', mixed])
      const stem =
        engine === 'online'
          ? await separateOnline(mixed, getMvsepToken() ?? '', scratch, (p) => notify(p.message), undefined, target)
          : await separateLocal(mixed, getDemucsCmd(), scratch, (p) => notify(p.message), target)
      notify(keep === 'voice' ? 'Rebuilding the video with music removed…' : 'Rebuilding the video with the voice removed…')
      const id = randomUUID()
      const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
      const outPath = join(videosDir(), `${slug}-${keep === 'voice' ? 'nomusic' : 'novoice'}-${id.slice(0, 8)}.mp4`)
      // The kept stem IS the full replacement audio → reuse the exact remove-muxer.
      await setVideoMusic(src.path, stem, 'remove', undefined, outPath, (line) => notify(line.trim().slice(0, 160)))
      const job = {
        id,
        title: `${src.title} (${keep === 'voice' ? 'music removed' : 'voice removed'})`,
        path: outPath,
        hasCustomVoice: src.hasCustomVoice,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', `Separated audio (${engine}, kept the ${keep}) on a video`, src.title)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  // Remove or replace a built video's background music WITHOUT touching the narration
  // (uses the saved narration track — exact, offline, no AI un-mixing). New video, original kept.
  ipcMain.handle(IPC.videoSetMusic, async (e, videoId: string, mode: 'remove' | 'replace', mood?: Mood) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    if (!src.narrationPath || !existsSync(src.narrationPath)) {
      throw new Error(
        'This video has no saved narration track, so its music can’t be separated. Videos built from now on support this — rebuild it once to enable music removal.'
      )
    }
    let musicPath: string | undefined
    if (mode === 'replace') {
      if (!mood) throw new Error('Choose a music mood to replace with.')
      musicPath = await renderMusic(mood, 40, 1)
    }
    const id = randomUUID()
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
    const outPath = join(videosDir(), `${slug}-music-${id.slice(0, 8)}.mp4`)
    await setVideoMusic(src.path, src.narrationPath, mode, musicPath, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = {
      id,
      title: `${src.title} (${mode === 'remove' ? 'no music' : 'new music'})`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString(),
      narrationPath: src.narrationPath
    }
    appendVideo(job)
    logActivity('user', `Music ${mode} on a video`, src.title)
    return job
  })

  // 🎧 AI DJ: one click → the app works out what the video FEELS like and lays a
  // fitting music bed under the voice (sidechain-ducked, looped to length). Where the
  // feel comes from, in order: the user's own words → the video's stored script →
  // listening to the narration (offline Whisper) → the title. New video, original kept.
  ipcMain.handle(IPC.videoAiDj, async (e, videoId: string, styleHint?: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    if (!src.narrationPath || !existsSync(src.narrationPath)) {
      throw new Error(
        'This video has no saved narration track, so music can’t be laid under the voice. Rebuild it once to enable the AI DJ.'
      )
    }
    const notify = (msg: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, msg)
    }
    const hint = (styleHint ?? '').trim()
    let moodText = hint
    let how = 'your description'
    if (!moodText && src.body?.trim()) {
      moodText = `${src.title}\n${src.body}`
      how = 'the video’s own script'
    }
    if (!moodText) {
      notify('AI DJ is listening to the narration to understand the video…')
      try {
        const segs = await transcribeFileToSegments(src.narrationPath)
        const heard = segs.map((s) => s.text).join(' ').trim()
        if (heard) {
          moodText = heard
          how = 'listening to the narration'
        }
      } catch {
        /* transcription is a bonus — the title still works */
      }
    }
    if (!moodText.trim()) {
      moodText = src.title
      how = 'the title'
    }
    // A mood named outright in the hint ("lofi", "tense"…) always wins.
    const direct = MOODS.find((m) => hint.toLowerCase().includes(m))
    const mood = direct ?? synthMoodFromText(moodText)
    notify(`AI DJ picked “${mood}” (from ${how}) — composing the track…`)
    // Size the bed to the actual video so it doesn't audibly restart every 40s
    // (capped for synth sanity; the muxer loops anything longer than the cap).
    const videoSec = Math.round(await ffprobeDuration(src.path).catch(() => 0)) || 40
    const bedSec = Math.max(8, Math.min(300, videoSec))
    const seed = ((Array.from(videoId).reduce((a, c) => a + c.charCodeAt(0), 0) % 97) + 1)
    const musicPath = await renderMusic(mood, bedSec, seed)
    notify('Laying the music under your voice…')
    const id = randomUUID()
    const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
    const outPath = join(videosDir(), `${slug}-aidj-${id.slice(0, 8)}.mp4`)
    await setVideoMusic(src.path, src.narrationPath, 'replace', musicPath, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job: VideoJob = {
      id,
      title: `${src.title} (AI DJ: ${mood})`,
      path: outPath,
      hasCustomVoice: src.hasCustomVoice,
      createdAt: new Date().toISOString(),
      narrationPath: src.narrationPath,
      body: src.body,
      resolution: src.resolution,
      aspect: src.aspect,
      template: src.template,
      engine: src.engine,
      style: src.style
    }
    appendVideo(job)
    logActivity('user', `AI DJ laid a “${mood}” track under a video (decided from ${how})`, src.title)
    return { job, mood, how }
  })

  // Where this user's work actually lives (portable folder / adopted Desktop studio /
  // per-user folder). Shown in Settings so it is never a mystery.
  ipcMain.handle(IPC.dataActiveDir, () => app.getPath('userData'))
  // Work stranded in a data folder the app isn't using, and the copy-it-in action.
  ipcMain.handle(IPC.dataStrandedScan, () => scanStranded())
  ipcMain.handle(IPC.dataStrandedImport, () => importStranded())

  // Serve audio bytes to the renderer for WebAudio decoding — a sandboxed renderer
  // cannot fetch() file:// URLs. Guarded to the app's own data folder only.
  ipcMain.handle(IPC.audioReadFile, (_e, p: string) => {
    const dataDir = app.getPath('userData')
    const norm = p.replace(/\//g, '\\')
    if (!norm.toLowerCase().startsWith(dataDir.toLowerCase() + sep)) {
      throw new Error('Only files inside the app data folder can be read this way.')
    }
    if (!existsSync(norm)) throw new Error('That audio file no longer exists.')
    return readFileSync(norm)
  })

  // Pull a video's full audio out to an MP3 so it can be loaded into the DJ decks.
  // Cached per video id (re-extracts only if the file vanished).
  ipcMain.handle(IPC.videoExtractAudio, async (_e, videoId: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found.')
    if (!existsSync(src.path)) throw new Error('The video file is missing on disk.')
    const out = join(generatedAudioDir(), `deck-${videoId.slice(0, 8)}.mp3`)
    if (!existsSync(out)) {
      await runFfmpeg(['-y', '-i', src.path, '-vn', '-ar', '44100', '-ac', '2', '-b:a', '192k', out])
    }
    return out
  })

  // FREE COPYRIGHT-SAFE MUSIC (Pixabay). Every handler degrades to "no music" with a
  // readable note rather than throwing — a missing soundtrack must never break a video.
  /**
   * HIS ASK (2026-08-07): "it gives me multiple examples... I play, I listen... and it
   * would tell me why." Three genuinely different full-length beds from the built-in
   * synthesizer — offline, free, each as long as the video — with one plain sentence of
   * reasoning apiece. He listens and clicks "Use this one"; nothing is chosen for him.
   */
  ipcMain.handle(IPC.musicExamples, async (_e, scriptText: string, durationSec: number) => {
    // Full length, but bounded: a runaway duration must not synthesize for an hour.
    const dur = Math.max(8, Math.min(Number(durationSec) || 60, 900))
    const plan = musicExamplePlan(scriptText || '')
    const out: { mood: string; why: string; path: string }[] = []
    for (let i = 0; i < plan.length; i++) {
      try {
        const path = await renderMusic(plan[i].mood, dur, i + 1)
        out.push({ mood: plan[i].mood, why: plan[i].why, path })
      } catch {
        /* one failed bed must not empty the list — the others still play */
      }
    }
    logActivity('ai', `Made ${out.length} music example(s) to listen to`, plan.map((p) => p.mood).join(', '))
    return { examples: out }
  })

  ipcMain.handle(IPC.musicSuggest, async (_e, scriptText: string) => {
    // Ask the AI for the mood, but never let a slow/broken AI hold up the music: the
    // word-matching fallback is good enough and instant.
    let moods = moodsFromText(scriptText || '')
    try {
      const reply = await getActiveProvider().generateText(
        `Read this video script and choose the background music mood.\n\n${(scriptText || '').slice(0, 1500)}\n\n${MOOD_PROMPT_HINT}`,
        60
      )
      moods = parseMoodReply(reply, scriptText || '')
    } catch (err) {
      logAiError({
        at: new Date().toISOString(),
        provider: 'chain',
        feature: 'music-mood',
        message: `mood keywords fell back to word matching: ${err instanceof Error ? err.message : String(err)}`
      })
    }
    const tracks = await findMusic(moods, getStockConfig().pixabayKey)
    return {
      moods,
      tracks,
      // Subject-aware extras: where to browse more of this vibe on the free
      // libraries, and which built-in synth mood matches the script.
      libraryLinks: freeLibraryLinks(moods),
      synthMood: synthMoodFromText(scriptText || ''),
      note: tracks.length ? undefined : 'No free music came back for this mood. The video will be built without music.'
    } satisfies MusicSuggestion
  })

  ipcMain.handle(IPC.musicMoodSearch, async (_e, query: string) => {
    const tracks = await findMusic([query], getStockConfig().pixabayKey)
    return {
      moods: [query],
      tracks,
      libraryLinks: freeLibraryLinks([query]),
      note: tracks.length ? undefined : `No free music found for “${query}”.`
    } satisfies MusicSuggestion
  })

  // Places a chosen track over one stretch of a video, producing a NEW video.
  ipcMain.handle(
    IPC.musicApplyRegion,
    async (e, videoId: string, track: MusicTrack, startSec: number, endSec: number) => {
      const src = listVideos().find((j) => j.id === videoId)
      if (!src || !existsSync(src.path)) return { ok: false, error: 'Video not found — build it again first.' }
      try {
        const musicPath = join(generatedAudioDir(), `music-${track.source}-${track.id.replace(/[^a-z0-9]/gi, '')}.mp3`)
        if (!existsSync(musicPath)) await downloadMusicFile(track.url, musicPath)
        const id = randomUUID()
        const slug = (src.title || 'video').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 40) || 'video'
        const outPath = join(videosDir(), `${slug}-music-${id.slice(0, 8)}.mp4`)
        const hasAudio = await ffprobeHasAudio(src.path)
        const args = buildMusicRegionArgs({ videoPath: src.path, musicPath, startSec, endSec, outPath, hasAudio })
        await runFfmpeg(args, (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        })
        const job: VideoJob = {
          id,
          title: `${src.title} (music)`,
          path: outPath,
          hasCustomVoice: src.hasCustomVoice,
          createdAt: new Date().toISOString(),
          narrationPath: src.narrationPath,
          // Remember the track WITH its licence. The app already knew this track needed a
          // credit; until now it had no way to say which video it went into, so the
          // pre-publish check had nothing to check.
          credits: [
            ...(src.credits ?? []),
            {
              title: track.title,
              kind: 'music' as const,
              license: track.license,
              requiresCredit: track.needsAttribution,
              source: track.source,
              url: track.pageUrl ?? track.url
            }
          ]
        }
        appendVideo(job)
        logActivity('user', 'Added free background music to a video', `${track.title} (${track.license})`)
        return { ok: true, video: job }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not add the music.' }
      }
    }
  )

  // HARDWARE HONESTY: what this PC can actually run, checked live. Cached per session
  // because probing spawns processes and the answer cannot change while the app runs.
  ipcMain.handle(IPC.hardwareCheck, async () => {
    if (!cachedHardware) {
      const gpu = await detectGpu()
      cachedHardware = {
        gpu,
        summary: describeGpu(gpu),
        models: VIDEO_MODELS.map((m) => ({ ...m, verdict: canRunModel(gpu, m) }))
      }
    }
    return cachedHardware
  })

  // Natural voice (Piper): status of the ACTIVE voice, and an opt-in per-voice download
  // into the portable data folder (English + Urdu voices are all in the catalogue).
  ipcMain.handle(IPC.voicePiperStatus, () => ({ installed: isPiperInstalled() }))
  ipcMain.handle(IPC.voicePiperCatalogue, () => {
    const installedIds = new Set(installedPiperVoiceIds())
    return PIPER_VOICES.map((v) => ({ ...v, installed: installedIds.has(v.id) }))
  })
  ipcMain.handle(IPC.voicePiperDownload, async (e, voiceId: string) => {
    const id = resolvePiperVoiceId(voiceId)
    await downloadPiper(id, (stage) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.voicePiperProgress, stage)
    })
    logActivity('user', 'Installed a natural narration voice', id)
    return { installed: isPiperVoiceInstalled(id) }
  })
  ipcMain.handle(IPC.settingsSetPiperVoice, (_e, voiceId: string) => setPiperVoiceId(voiceId))

  ipcMain.handle(IPC.settingsSetYouTubeChannel, (_e, id: string) => setYouTubeChannelId(id))

  // Assisted YouTube publish: generate title/description/hashtags with the SAME engine
  // as the "🏷 Posting text" panel (draftPostingText), copy to clipboard, open the
  // upload page, and reveal the file to drag in. Free, no OAuth, no upload limits.
  ipcMain.handle(IPC.youtubePublish, async (_e, videoId: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    // A 9:16 clip is a Short — same detection the Posting-text panel uses — so Shorts get
    // Shorts-appropriate posting text automatically, with no extra step for the user.
    const vertical = /short/i.test(src.title)
    const meta = await draftPostingText(src, 'youtube', vertical)
    const clip = `TITLE:\n${meta.title}\n\nDESCRIPTION:\n${meta.description}\n\nHASHTAGS:\n${meta.hashtags.map((h) => `#${h}`).join(' ')}`
    clipboard.writeText(clip)
    const url = buildUploadUrl(getYouTubeChannelId())
    await shell.openExternal(url)
    shell.showItemInFolder(src.path)
    logActivity('user', 'Prepared a YouTube upload', src.title)
    return { title: meta.title, description: meta.description, tags: meta.hashtags, uploadUrl: url }
  })

  // ---- Windows NATURAL voices (free, offline; the only route to Urdu Asad/Uzma) ----
  ipcMain.handle(IPC.voiceWinNaturalList, () => listWinNaturalVoices())

  // Speaks one short line so the user can HEAR a voice before committing to it.
  ipcMain.handle(IPC.voiceWinNaturalPreview, async (_e, voiceId: string, sample?: string) => {
    const dir = mkdtempSync(join(tmpdir(), 'npz-voice-preview-'))
    const wav = join(dir, 'preview.wav')
    try {
      await synthesizeWithWinNatural(sample?.trim() || 'This is how your narration will sound.', wav, voiceId)
      // Hand back the bytes so the renderer can play it without a file:// round trip.
      return { ok: true as const, wavBase64: readFileSync(wav).toString('base64') }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : 'Preview failed' }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  // Opens Windows' own speech/language settings, where free voices (incl. Urdu) install.
  ipcMain.handle(IPC.voiceOpenSpeechSettings, async () => {
    await shell.openExternal('ms-settings:speech')
    return { ok: true }
  })

  /**
   * "Plan my week": pick N topics, walk away. Writes a script and builds a video for each
   * (reusing the batch engine), then — new — cuts shorts and drafts posting text for every
   * finished video, so the morning result is publish-ready rather than raw.
   * Failures never abort the run: each topic reports its own outcome.
   */
  ipcMain.handle(
    IPC.weeklyPlanRun,
    async (
      e,
      topics: string[],
      opts?: { style?: VideoStyle; resolution?: import('../shared/types').VideoResolution; aiVisuals?: boolean; shortsPerVideo?: number }
    ) => {
      // Same cap as the plain Batch path (runBatch itself also caps at 25) — the overnight
      // checkbox must not silently process fewer topics than the shared "up to 25" hint says.
      const list = (Array.isArray(topics) ? topics : []).map((t) => String(t).trim()).filter(Boolean).slice(0, 25)
      if (!list.length) throw new Error('Add at least one topic (one per line).')
      const say = (stage: string): void => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.agentProgress, stage)
      }
      logActivity('user', `Overnight plan started — ${list.length} topic(s)`, list.join(' · '))

      const built = await runBatch(list, {
        style: opts?.style,
        resolution: opts?.resolution,
        aiVisuals: !!opts?.aiVisuals,
        stockApiKey: getStockConfig().pixabayKey,
        onProgress: say
      })

      const shortsWanted = Math.max(0, Math.min(5, opts?.shortsPerVideo ?? 2))
      const report: { topic: string; ok: boolean; videoId?: string; shorts: number; postingText?: string; error?: string }[] = []
      for (const r of built) {
        const entry = { topic: r.topic, ok: !!r.ok, videoId: r.video?.id, shorts: 0 } as (typeof report)[number]
        if (!r.ok || !r.video) {
          entry.error = r.error ?? 'build failed'
          report.push(entry)
          continue
        }
        if (shortsWanted > 0) {
          try {
            say(`Cutting shorts for “${r.video.title}”…`)
            const cut = await cutShortsForVideo(r.video.id, shortsWanted, say)
            entry.shorts = cut.jobs.length
          } catch {
            /* shorts are a bonus — a failure here must not sink the video */
          }
        }
        try {
          say(`Writing posting text for “${r.video.title}”…`)
          const meta = await draftPostingText(r.video, 'youtube', false)
          // Same '#' prefix as youtubePublish and the Posting-text panel — draftPostingText
          // stores hashtags WITHOUT the symbol, so every consumer must add it consistently.
          entry.postingText = `TITLE:\n${meta.title}\n\nDESCRIPTION:\n${meta.description}\n\nHASHTAGS:\n${meta.hashtags.map((h) => `#${h}`).join(' ')}`
        } catch {
          /* posting text is a bonus too */
        }
        report.push(entry)
      }

      const okCount = report.filter((r) => r.ok).length
      logActivity(
        'ai',
        `Overnight plan finished — ${okCount}/${report.length} video(s) built, ${report.reduce((n, r) => n + r.shorts, 0)} short(s) cut`,
        report.map((r) => `${r.ok ? '✓' : '✗'} ${r.topic}`).join(' · ')
      )
      return { report }
    }
  )

  // Batch: make a video per topic (write script → build), streaming per-topic progress.
  ipcMain.handle(
    IPC.agentBatch,
    async (e, topics: string[], style?: VideoStyle, resolution?: import('../shared/types').VideoResolution, aiVisuals?: boolean) => {
      if (!Array.isArray(topics) || !topics.length) throw new Error('Add at least one topic (one per line).')
      const results = await runBatch(topics, {
        style,
        resolution,
        aiVisuals: !!aiVisuals,
        stockApiKey: getStockConfig().pixabayKey,
        onProgress: (stage) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.agentProgress, stage)
        }
      })
      return { results }
    }
  )

  // DAW-lite: render a waveform image of a video's audio (visual reference in the DJ).
  ipcMain.handle(IPC.audioWaveform, async (_e, videoId: string) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const out = join(thumbnailsDir(), `wave-${src.id.slice(0, 8)}.png`)
    await runFfmpeg(['-y', '-i', src.path, '-filter_complex', '[0:a]showwavespic=s=1000x160:colors=0xE8B923[w]', '-map', '[w]', '-frames:v', '1', out])
    return out
  })

  // Universal autosave: renderer debounce-saves each tab's state here; restored on open.
  ipcMain.handle(IPC.draftGet, (_e, key: string) => getDraft(key))
  ipcMain.handle(IPC.draftSet, (_e, key: string, value: unknown) => {
    setDraft(key, value)
    return { ok: true }
  })

  ipcMain.handle(IPC.djPlansList, () => listDjPlans())
  ipcMain.handle(IPC.djPlanSave, (_e, plan: AudioPlan) => saveDjPlan(plan))
  ipcMain.handle(IPC.djPlanDelete, (_e, id: string) => deleteDjPlan(id))

  // Online free (Creative-Commons) music search. Returns { online:false } when there's
  // no connection so the renderer shows a notice and falls back to built-in sounds.
  ipcMain.handle(IPC.musicSearch, async (_e, query: string) => {
    const result = await searchMusic(query)
    if (result.online && result.tracks.length) logActivity('user', 'Searched free music', query)
    return result
  })

  // Downloads a chosen track into the generated-audio folder; returns its local path.
  ipcMain.handle(IPC.musicDownload, async (_e, audioUrl: string, suggestedName: string) => {
    const safe = (suggestedName || 'track').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 50) || 'track'
    const ext = (audioUrl.split('?')[0].split('.').pop() || 'mp3').toLowerCase().slice(0, 4)
    const outPath = join(generatedAudioDir(), `dl-${safe}-${randomUUID().slice(0, 6)}.${/^[a-z0-9]+$/.test(ext) ? ext : 'mp3'}`)
    await downloadTrack(audioUrl, outPath)
    logActivity('user', 'Downloaded a free music track', suggestedName)
    return outPath
  })

  ipcMain.handle(IPC.videoAttachVoice, async (_e, videoId: string, audioBytes: Uint8Array) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const id = randomUUID()
    const outPath = `${src.path.replace(/\.mp4$/i, '')}-myvoice-${id.slice(0, 8)}.mp4`
    await attachRecordedVoice(src.path, audioBytes, outPath)
    const job = {
      id,
      title: `${src.title} (my voice)`,
      path: outPath,
      hasCustomVoice: true,
      createdAt: new Date().toISOString()
    }
    appendVideo(job)
    logActivity('user', 'Recorded own voice onto video', src.title)
    return job
  })

  // Assemble a narration take from one or more recorded segments (with optional trims)
  // into a single WAV. Powers review + "redo from here" (punch-in). Returns WAV bytes.
  ipcMain.handle(
    IPC.voiceAssemble,
    (_e, segments: { bytes: Uint8Array; startSec?: number; endSec?: number }[]) => assembleVoice(segments)
  )

  // KEEP-BOTH: add the recorded voice ON TOP of the video's existing audio (does not
  // replace it), unlike video:attach-voice which replaces. Produces a new video.
  ipcMain.handle(IPC.videoAddVoice, async (e, videoId: string, audioBytes: Uint8Array) => {
    const src = listVideos().find((j) => j.id === videoId)
    if (!src) throw new Error('Video not found — build it again first.')
    const scratch = mkdtempSync(join(tmpdir(), 'finscript-addvoice-'))
    try {
      const voice = join(scratch, 'voice.wav')
      writeFileSync(voice, Buffer.from(audioBytes))
      const id = randomUUID()
      const outPath = `${src.path.replace(/\.mp4$/i, '')}-addvoice-${id.slice(0, 8)}.mp4`
      await remixVideoAudio(
        src.path,
        [{ id: 'myvoice', src: voice, label: 'My voice', atSec: 0, gain: 1, fadeIn: 0, fadeOut: 0 }],
        outPath,
        (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      )
      const job = {
        id,
        title: `${src.title} (voice added)`,
        path: outPath,
        hasCustomVoice: true,
        createdAt: new Date().toISOString()
      }
      appendVideo(job)
      logActivity('user', 'Added own voice over existing audio', src.title)
      return job
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })

  ipcMain.handle(IPC.videoList, () => listVideos())

  // User-only delete (removes the file too); no AI/generation path calls this.
  // DELETE-SYNC (user's explicit instruction): the backup copies go too, so a
  // permanent delete in the app never leaves ghosts on the disk.
  ipcMain.handle(IPC.videoDelete, (_e, id: string) => {
    logActivity('user', 'Deleted a built video')
    const dataDir = app.getPath('userData')
    const job = listVideos().find((j) => j.id === id)
    const rels: string[] = []
    for (const p of [job?.path, job?.narrationPath]) {
      if (p && p.toLowerCase().startsWith(dataDir.toLowerCase() + sep)) {
        rels.push(p.slice(dataDir.length + 1).replace(/\\/g, '/'))
      }
    }
    const out = deleteVideo(id)
    if (rels.length) void purgeFromBackups(rels)
    return out
  })

  // Stitch several built videos into one new video (non-destructive).
  ipcMain.handle(IPC.videoStitch, async (e, videoIds: string[]) => {
    const all = listVideos()
    const inputs = videoIds.map((id) => all.find((j) => j.id === id)?.path).filter((p): p is string => !!p)
    if (inputs.length < 2) throw new Error('Pick at least two videos to stitch.')
    const id = randomUUID()
    const outPath = join(videosDir(), `stitched-${id.slice(0, 8)}.mp4`)
    await stitchVideos(inputs, outPath, (line) => {
      if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
    })
    const job = { id, title: `Stitched (${inputs.length} clips)`, path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Stitched videos together', `${inputs.length} clips`)
    return job
  })

  // ── Timeline NLE ──
  // Let the user pick one or more video/image clips to drop on the timeline.
  ipcMain.handle(IPC.timelinePickClips, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Add clips to the timeline',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Video / Image', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'jpg', 'jpeg', 'png', 'webp'] }
      ]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled ? [] : res.filePaths
  })

  // Audio-track picker. Must NOT reuse the clips dialog: its video/image filter
  // made selecting an mp3/wav impossible, so "+ Add audio" could never work.
  ipcMain.handle(IPC.timelinePickAudio, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Add music or voice to the timeline',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'opus', 'wma'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled ? [] : res.filePaths
  })

  // Probe a source file's duration (seconds) so the UI can default a clip's out-point.
  ipcMain.handle(IPC.timelineProbe, async (_e, src: string) => {
    try {
      return { ok: true, duration: await ffprobeDuration(src) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not read that file.' }
    }
  })

  // Render a timeline project to a new video (non-destructive). Streams progress.
  ipcMain.handle(IPC.timelineRender, async (e, docJson: TimelineDoc, title?: string) => {
    const id = randomUUID()
    const outPath = join(videosDir(), `timeline-${id.slice(0, 8)}.mp4`)
    try {
      await renderTimeline(docJson, outPath, (line) => {
        if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
      })
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Timeline render failed.' }
    }
    const job: VideoJob = { id, title: (title && title.trim()) || 'Timeline edit', path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Rendered a timeline edit', job.title)
    return { ok: true, video: job }
  })

  // ── Storyboard Director ──
  // Pick the user's real photo for 'photo' subject beats.
  ipcMain.handle(IPC.storyboardPickPhoto, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Choose your photo',
      properties: ['openFile'],
      filters: [{ name: 'Image', extensions: ['jpg', 'jpeg', 'png', 'webp'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // ── Teleprompter ──
  // Its own always-on-top window so a screen recording of a different window/screen
  // cannot contain it, and so it can ask the OS to hide it from capture entirely.
  ipcMain.handle(IPC.teleprompterOpen, (_e, opts?: { hiddenFromCapture?: boolean }) => openTeleprompter(opts))
  ipcMain.handle(IPC.teleprompterClose, () => closeTeleprompter())
  ipcMain.handle(IPC.teleprompterState, () => teleprompterState())
  ipcMain.handle(IPC.teleprompterProtect, (_e, on: boolean) => setTeleprompterProtection(!!on))

  // ── Plans made on the phone ──
  // Opens a .npzproject.json the user transferred over, and loads it into the
  // Storyboard tab. Never destructive: the previous storyboard stays in draft history.
  ipcMain.handle(IPC.projectImportPick, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      title: 'Open a plan made on your phone',
      properties: ['openFile'],
      filters: [{ name: 'NihilPointZero plan', extensions: ['json'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, dialogOptions) : await dialog.showOpenDialog(dialogOptions)
    if (res.canceled || !res.filePaths.length) return { ok: false, canceled: true }
    try {
      return { ok: true, result: importPhoneProjectJson(readFileSync(res.filePaths[0], 'utf-8')) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'That plan could not be opened.' }
    }
  })

  // Same import, but for a plan already in hand (the phone pushes one over Wi-Fi).
  ipcMain.handle(IPC.projectImport, async (_e, raw: unknown) => {
    try {
      return { ok: true, result: importPhoneProject(raw) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'That plan could not be opened.' }
    }
  })

  // Plan a storyboard from either the user's own beats (guided) or a pasted script (auto).
  ipcMain.handle(
    IPC.storyboardPlan,
    async (
      _e,
      params: { mode: 'auto' | 'guided'; title: string; brief: string; totalSeconds?: number; language?: string; width?: number; height?: number; fps?: number }
    ) => {
      const defaults = { width: params.width ?? 1920, height: params.height ?? 1080, fps: params.fps ?? 25 }
      // Defence in depth against a runaway requested length. A real project arrived
      // here asking for 9999 seconds; every beat then pinned to its 120s ceiling and
      // the app produced a 78-minute silent film. One hour is the honest ceiling.
      if (typeof params.totalSeconds === 'number') {
        params = { ...params, totalSeconds: Math.max(10, Math.min(3600, params.totalSeconds)) }
      }
      // One AI attempt: null (never a throw) when the model is down or returns junk.
      const attemptAI = async (extra = ''): Promise<ReturnType<typeof sanitizeStoryboard> | null> => {
        try {
          const prompt =
            buildStoryboardPrompt({
              mode: params.mode,
              title: params.title,
              brief: params.brief,
              totalSeconds: params.totalSeconds,
              language: params.language
            }) + extra
          const doc = sanitizeStoryboard(extractJson(await getActiveProvider().generateText(prompt, 2600)), defaults)
          return doc.beats.length ? doc : null
        } catch {
          return null
        }
      }
      let doc = await attemptAI()
      // Weak/free models often wrap the JSON in prose — one strict retry fixes most cases.
      if (!doc) {
        doc = await attemptAI('\nIMPORTANT: Reply with ONLY the JSON object — no explanation, no markdown. Start with { and end with }.')
      }
      if (!doc) {
        // The AI failed twice — direct it ourselves. storyboardFromScript always yields at
        // least one beat, so this button never dead-ends with "could not turn that into shots".
        doc = sanitizeStoryboard(
          storyboardFromScript({
            title: params.title,
            brief: params.brief,
            totalSeconds: params.totalSeconds,
            language: params.language
          }),
          defaults
        )
        logActivity('ai', 'Director AI could not structure the script — built the storyboard directly from it instead', params.title)
      }
      // Keep the title/language the user asked for if the model dropped them.
      if (params.title.trim()) doc.title = params.title.trim()
      if (params.language) doc.language = params.language
      logActivity('ai', `Planned a ${doc.beats.length}-beat storyboard`, doc.title)
      return { ok: true, storyboard: doc }
    }
  )

  // Beautify (or roughen) a photo and return a preview file the UI can show.
  ipcMain.handle(IPC.photoBeautify, async (_e, src: string, strength: number) => {
    try {
      const dir = join(videosDir(), 'beautify')
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const out = join(dir, `preview-${randomUUID().slice(0, 8)}.jpg`)
      await beautifyImage(src, out, { strength })
      return { ok: true, path: out }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Beautify failed.' }
    }
  })

  // Render a storyboard to a video. Returns the video job AND the TimelineDoc so the
  // user can keep editing the result in the Timeline editor.
  ipcMain.handle(IPC.storyboardRender, async (e, doc: StoryboardDoc, opts?: { photoPath?: string; beautifyStrength?: number; windowsVoice?: boolean; motionEngine?: 'ai-free-video' | 'ai-local' }) => {
    const id = randomUUID()
    const outPath = join(videosDir(), `storyboard-${id.slice(0, 8)}.mp4`)
    let timeline
    try {
      ;({ timeline } = await renderStoryboard(id, doc, outPath, {
        photoPath: opts?.photoPath,
        beautifyStrength: opts?.beautifyStrength,
        windowsVoice: opts?.windowsVoice,
        motionEngine: opts?.motionEngine,
        onProgress: (line) => {
          if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160))
        }
      }))
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Storyboard render failed.' }
    }
    // The MP4 exists at this point — register it OUTSIDE the try so a store write hiccup
    // can't make a successful render look like a failure.
    const job: VideoJob = { id, title: doc.title || 'Storyboard film', path: outPath, hasCustomVoice: false, createdAt: new Date().toISOString() }
    appendVideo(job)
    logActivity('user', 'Rendered a storyboard film', job.title)
    return { ok: true, video: job, timeline }
  })

  // PRESENTER: pick your narration video (video/lip-graft modes).
  ipcMain.handle(IPC.presenterPickVideo, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: 'Choose your narration video',
      properties: ['openFile'],
      filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
  })

  // PRESENTER: build a video where YOU (real footage or your photo) are interleaved with
  // theme B-roll + AI scenes. In video/graft modes your video's OWN audio (your real voice)
  // is the master track. Saves a durable copy of your upload + the result.
  ipcMain.handle(
    IPC.presenterBuild,
    async (
      e,
      params: {
        title: string
        body: string
        mode: PresenterMode
        presenterPath?: string
        graftPhotoPath?: string
        graftRegion?: GraftRegion
        style?: VideoStyle
        everyN?: number
        windowsVoice?: boolean
        motionEngine?: 'ai-free-video' | 'ai-local'
      }
    ) => {
      if (!params.body?.trim()) return { ok: false, error: 'Paste your script first.' }
      const mode = params.mode
      const realVoice = mode === 'video' || mode === 'graft'
      if (realVoice && !params.presenterPath) return { ok: false, error: 'Upload your narration video first (or use the Photo presenter).' }
      if (mode === 'photo' && !params.presenterPath) return { ok: false, error: 'Choose your photo first (or use the Video presenter).' }
      if (mode === 'graft' && !params.graftPhotoPath) return { ok: false, error: 'Choose the picture to graft onto (the one where you look your best).' }
      const id = randomUUID()
      const assetDir = join(videosDir(), 'presenter', id)
      mkdirSync(assetDir, { recursive: true })
      const emit = (line: string): void => { if (!e.sender.isDestroyed()) e.sender.send(IPC.videoProgress, line.trim().slice(0, 160)) }
      try {
        let presenterSrc: string | undefined
        let masterAudioSrc: string | undefined
        let voiceTrackSeconds: number | undefined
        let photoPath: string | undefined
        if (realVoice) {
          emit('Reading your narration video…')
          presenterSrc = join(assetDir, `presenter${extname(params.presenterPath as string) || '.mp4'}`)
          copyFileSync(params.presenterPath as string, presenterSrc)
          masterAudioSrc = join(assetDir, 'voice.wav')
          await runFfmpeg(['-y', '-i', presenterSrc, '-vn', '-ac', '2', '-ar', '44100', masterAudioSrc])
          voiceTrackSeconds = await ffprobeDuration(masterAudioSrc).catch(() => 0)
          if (!voiceTrackSeconds) return { ok: false, error: 'Could not read audio from that video — use one that has your voice in it.' }
        } else {
          photoPath = params.presenterPath
        }
        // GRAFT: turn (your video + your best picture) into a "living picture" ONCE, then
        // the rest of the pipeline consumes it exactly like normal presenter footage. The
        // voice was already extracted from the ORIGINAL video above, so nothing about the
        // master audio changes. Engine order: optional local AI tool → built-in ffmpeg
        // graft → (on total failure) your raw clip, so a build never breaks.
        if (mode === 'graft' && presenterSrc) {
          const graftPhoto = join(assetDir, `graft-photo${extname(params.graftPhotoPath as string) || '.jpg'}`)
          copyFileSync(params.graftPhotoPath as string, graftPhoto)
          const region = sanitizeGraftRegion(params.graftRegion)
          const grafted = join(assetDir, 'living-picture.mp4')
          let done = false
          const toolCmd = getFaceAnimCmd()
          if (toolCmd) {
            emit('Running your local face-animation tool (full-quality graft)…')
            done = await runGraftTool(toolCmd, { photo: graftPhoto, video: presenterSrc, audio: masterAudioSrc, out: grafted }, emit)
          }
          if (!done) {
            emit('Grafting the moving part of your video onto your picture…')
            try {
              await renderGraftVideo({
                photoPath: graftPhoto,
                videoPath: presenterSrc,
                region,
                width: 1920,
                height: 1080,
                fps: 25,
                outPath: grafted,
                onProgress: emit
              })
              done = existsSync(grafted)
            } catch (err) {
              emit(`Graft failed (${err instanceof Error ? err.message : 'error'}) — using your raw footage instead.`)
            }
          }
          if (done) presenterSrc = grafted
        }
        const doc = planPresenterStoryboard({
          title: params.title, body: params.body, mode, style: params.style, everyN: params.everyN,
          presenterSrc, voiceTrackSeconds, masterAudioSrc, width: 1920, height: 1080, fps: 25
        })
        const outPath = join(videosDir(), `presenter-${id.slice(0, 8)}.mp4`)
        const { timeline } = await renderStoryboard(id, doc, outPath, {
          photoPath,
          beautifyStrength: 0.4,
          windowsVoice: params.windowsVoice,
          motionEngine: params.motionEngine,
          onProgress: (line) => emit(line)
        })
        const job: VideoJob = { id, title: doc.title, path: outPath, hasCustomVoice: realVoice, createdAt: new Date().toISOString() }
        appendVideo(job)
        logActivity('user', `Built a ${mode} presenter video`, doc.title)
        return { ok: true, video: job, timeline }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Presenter build failed.' }
      }
    }
  )

  // GRAFT: one composited "living picture" frame so the region sliders give instant,
  // honest feedback (this exact pixel result is what the full render produces).
  ipcMain.handle(
    IPC.graftPreview,
    async (_e, params: { photoPath: string; videoPath: string; region?: GraftRegion; atSec?: number }) => {
      if (!params?.photoPath || !params?.videoPath) return { ok: false, error: 'Pick both the picture and the video first.' }
      try {
        const outPng = join(tmpdir(), `npz-graft-preview-${Date.now().toString(36)}.png`)
        await renderGraftPreview({
          photoPath: params.photoPath,
          videoPath: params.videoPath,
          region: sanitizeGraftRegion(params.region),
          width: 1280,
          height: 720,
          atSec: Math.max(0, params.atSec ?? 1),
          outPng
        })
        return { ok: true, path: outPng }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Preview failed.' }
      }
    }
  )

  // RECORDER: enumerate screen/window sources for screen capture (renderer feeds the id
  // into getUserMedia's desktop source). Cameras/mics are enumerated in the renderer.
  ipcMain.handle(IPC.recorderScreenSources, async () => {
    const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 } })
    return sources.map((s) => ({ id: s.id, name: s.name, thumbnail: s.thumbnail.toDataURL() }))
  })

  /**
   * RECORDER: save what was just recorded.
   *
   * Two shapes, because the user records two different things. Filming yourself gives a
   * video, which goes into Video Studio ready to trim, enhance and export. Narrating
   * WITHOUT appearing on camera gives audio, which belongs with the other narration
   * tracks, not in the video list pretending to be a video with a black picture.
   *
   * `mime` says what the browser actually recorded. It decides whether the file can be
   * copied straight into an MP4 (H.264 — now the usual case) or has to be converted;
   * see recorder/saveArgs.ts for why that distinction is worth making.
   */
  ipcMain.handle(
    IPC.recorderSave,
    async (_e, bytes: Uint8Array, kind: string, enhance?: boolean, mime?: string) => {
      const id = randomUUID()
      const scratch = mkdtempSync(join(tmpdir(), 'npz-rec-'))
      const sourceIsH264 = typeof mime === 'string' && /avc1|h264|mp4/i.test(mime)
      const inPath = join(scratch, `rec.${sourceIsH264 ? 'mp4' : 'webm'}`)
      const voiceOnly = kind === 'voice'
      const outPath = voiceOnly
        ? join(generatedAudioDir(), `narration-${id.slice(0, 8)}.m4a`)
        : join(videosDir(), `recording-${kind || 'clip'}-${id.slice(0, 8)}.mp4`)
      try {
        writeFileSync(inPath, Buffer.from(bytes))
        await runFfmpeg(
          voiceOnly
            ? recordingAudioArgs(inPath, outPath, { enhance })
            : recordingVideoArgs(inPath, outPath, { enhance, sourceIsH264 })
        )
        if (voiceOnly) {
          logActivity('user', 'Saved a voice-only narration recording', outPath)
          return { ok: true, audioPath: outPath }
        }
        const job: VideoJob = { id, title: `Recording (${kind || 'clip'})`, path: outPath, hasCustomVoice: true, createdAt: new Date().toISOString() }
        appendVideo(job)
        logActivity('user', 'Saved an in-app recording', kind)
        return { ok: true, video: job }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : 'Could not save the recording.' }
      } finally {
        rmSync(scratch, { recursive: true, force: true })
      }
    }
  )

  // Enhance an existing built video: voice cleanup + video polish → a NEW video (original kept).
  ipcMain.handle(IPC.videoEnhance, async (_e, videoId: string, opts?: { audio?: boolean; video?: boolean }) => {
    const src = listVideos().find((v) => v.id === videoId)
    if (!src || !existsSync(src.path)) return { ok: false, error: 'Video not found.' }
    const id = randomUUID()
    const outPath = join(videosDir(), `enhanced-${id.slice(0, 8)}.mp4`)
    try {
      await runFfmpeg(buildEnhanceArgs(src.path, outPath, opts ?? { audio: true, video: true }))
      const job: VideoJob = { id, title: `${src.title} (enhanced)`, path: outPath, hasCustomVoice: src.hasCustomVoice, createdAt: new Date().toISOString() }
      appendVideo(job)
      logActivity('user', 'Enhanced a video', src.title)
      return { ok: true, video: job }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Enhance failed.' }
    }
  })

  // AI plans a video (hook, sections + b-roll keywords, thumbnail, CTR tips) using
  // the active brain. Throws a clear error if no brain is configured.
  ipcMain.handle(IPC.videoPlan, async (_e, title: string, body: string) => {
    const plan = await generateVideoPlan(title, body)
    logActivity('ai', 'Planned a video', title)
    return plan
  })

  ipcMain.handle(IPC.videoReveal, (_e, path: string) => shell.showItemInFolder(path))

  // Stops any in-progress render/export/trim by killing the active ffmpeg process(es).
  ipcMain.handle(IPC.videoCancel, () => {
    const n = cancelActiveFfmpeg()
    if (n) logActivity('user', 'Stopped a render')
    return { stopped: n }
  })

  // Offline speech-to-text (dictation). Receives a recorded audio clip, returns
  // the transcribed text. Runs a local Whisper model — no cloud, free for life.
  ipcMain.handle(IPC.speechTranscribe, async (_e, audioBytes: Uint8Array) => {
    const text = await transcribeAudio(audioBytes)
    if (text) logActivity('user', 'Dictated text (speech-to-text)')
    return text
  })

  ipcMain.handle(IPC.webServerStatus, () => getWebServerStatus())
  ipcMain.handle(IPC.webServerStart, () => startWebServer())
  ipcMain.handle(IPC.webServerStop, () => stopWebServer())
}
