/**
 * OPT-IN natural narration voice via Piper (free, offline neural TTS). To keep the base
 * app small + portable, Piper (its binary + a voice model, ~80 MB) is downloaded ONCE
 * into the portable data folder (so it travels with the folder). The user's own recorded
 * voice remains the default way to narrate; this is just a nicer computer voice when
 * they want it, replacing the robotic Windows voice.
 */
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { runFfmpeg, throwIfCancelled } from '../video/ffmpeg'
import { getSettings } from '../store'
import {
  PIPER_VOICES,
  findPiperVoice,
  piperConfigUrl,
  piperModelFileName,
  piperModelUrl,
  resolvePiperVoiceId,
  type PiperVoice
} from './piperVoices'

const BIN_URL = 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip'

function piperRoot(): string {
  const dir = join(app.getPath('userData'), 'piper')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
function piperExe(): string {
  return join(piperRoot(), 'piper', 'piper.exe')
}

/** On-disk path of a given voice's model (voices live side by side in the piper folder). */
function voiceModelPath(voiceId: string): string {
  const v = findPiperVoice(resolvePiperVoiceId(voiceId))
  return join(piperRoot(), piperModelFileName(v as PiperVoice))
}

/** The voice the user picked in Settings, falling back to the bundled default. */
function activeVoiceId(): string {
  return resolvePiperVoiceId(getSettings().piperVoiceId)
}

/** True when the engine is installed AND that specific voice's model is present. */
export function isPiperVoiceInstalled(voiceId: string): boolean {
  const model = voiceModelPath(voiceId)
  // piper.exe needs BOTH the .onnx model and its .onnx.json config. Checking only
  // the model let a half-finished download show "Installed ✓" while every
  // narration then failed.
  return existsSync(piperExe()) && existsSync(model) && existsSync(`${model}.json`)
}

/** True once the engine + the ACTIVE voice are ready to narrate. */
export function isPiperInstalled(): boolean {
  return isPiperVoiceInstalled(activeVoiceId())
}

/** Which catalogue voices are downloaded, for the Settings list. */
export function installedPiperVoiceIds(): string[] {
  if (!existsSync(piperExe())) return []
  return PIPER_VOICES.filter((v) => {
    const model = join(piperRoot(), piperModelFileName(v))
    return existsSync(model) && existsSync(`${model}.json`)
  }).map((v) => v.id)
}

async function downloadFile(url: string, dest: string, onFrac?: (frac: number) => void): Promise<void> {
  // One-time ~80 MB voice download: generous cap so slow connections still finish,
  // but a stalled socket can no longer hang the "Download natural voice" button forever.
  const res = await fetch(url, { signal: AbortSignal.timeout(30 * 60_000) })
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}) for ${url}`)
  const total = Number(res.headers.get('content-length') || 0)
  const ws = createWriteStream(dest)
  // A disk-full/permission error must reject THIS promise — with no 'error' listener
  // it was an uncaught exception that took down the whole main process.
  const wsFailed = new Promise<never>((_, reject) => ws.on('error', reject))
  const reader = res.body.getReader()
  let done = 0
  try {
    for (;;) {
      const { done: finished, value } = await Promise.race([reader.read(), wsFailed])
      if (finished) break
      if (value) {
        ws.write(Buffer.from(value))
        done += value.length
        if (total) onFrac?.(done / total)
      }
    }
    await Promise.race([new Promise<void>((resolve) => ws.end(() => resolve())), wsFailed])
  } catch (err) {
    // Close the fd and remove the truncated file — a partial model left on disk
    // would otherwise read as "installed" and fail every narration afterwards.
    ws.destroy()
    try {
      rmSync(dest, { force: true })
    } catch {
      /* best effort */
    }
    throw err
  }
}

/** Doubles single quotes so a value is safe inside a PowerShell single-quoted string. */
function psQuote(s: string): string {
  return s.replace(/'/g, "''")
}

function extractZip(zipPath: string, destDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Paths are app-controlled (userData) today, but escape them anyway — same
    // single-quote-doubling discipline as voiceover.ts, so this can never become an
    // injection point if the inputs ever turn user-influenced.
    const p = spawn('powershell.exe', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath '${psQuote(zipPath)}' -DestinationPath '${psQuote(destDir)}' -Force`
    ])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d.toString()).slice(-500)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Unzip failed: ${err.trim()}`))))
  })
}

/**
 * Downloads + installs one catalogue voice into the data folder. The ~30 MB engine is
 * shared across all voices and is only fetched once (first ever voice download);
 * downloading a second voice afterwards just adds its model, so switching between an
 * English and an Urdu voice never re-downloads the engine.
 */
export async function downloadPiper(voiceId: string, onProgress?: (stage: string) => void): Promise<void> {
  const v = findPiperVoice(resolvePiperVoiceId(voiceId)) as PiperVoice
  const root = piperRoot()
  if (!existsSync(piperExe())) {
    const zip = join(root, 'piper.zip')
    onProgress?.('Downloading natural-voice engine… 0%')
    await downloadFile(BIN_URL, zip, (f) => onProgress?.(`Downloading natural-voice engine… ${Math.round(f * 100)}%`))
    onProgress?.('Unpacking voice engine…')
    await extractZip(zip, root)
  }
  const modelPath = voiceModelPath(v.id)
  onProgress?.(`Downloading ${v.label}… 0%`)
  await downloadFile(piperModelUrl(v), modelPath, (f) => onProgress?.(`Downloading ${v.label}… ${Math.round(f * 100)}%`))
  await downloadFile(piperConfigUrl(v), `${modelPath}.json`)
  onProgress?.(`${v.label} installed.`)
  if (!isPiperVoiceInstalled(v.id)) throw new Error('Install finished but the voice files are missing — try again.')
}

/**
 * Splits narration into single-line chunks for Piper. This is essential, not cosmetic:
 * Piper synthesizes stdin one LINE at a time and, with --output_file, OVERWRITES that
 * file for every line — so feeding a multi-paragraph script left only the last line's
 * audio in the WAV (almost the whole narration was silently lost). We normalise each
 * chunk to a single line and keep chunks modest so a long script never chokes the
 * phonemizer; the per-chunk WAVs are concatenated into one continuous track.
 */
export function chunkForPiper(text: string, maxChars = 600): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // Break on sentence boundaries — but ONLY at punctuation followed by a space.
  // The old any-'.' split mutated decimal numbers ("45.3" was re-joined as "45. 3"),
  // which a finance narration voice then read out wrong.
  const sentences = clean.split(/(?<=[.!?])\s+/)
  const chunks: string[] = []
  let cur = ''
  for (const s of sentences) {
    const piece = s.trim()
    if (!piece) continue
    if (cur && (cur.length + 1 + piece.length) > maxChars) {
      chunks.push(cur)
      cur = piece
    } else {
      cur = cur ? `${cur} ${piece}` : piece
    }
    // A single sentence longer than maxChars still goes out as its own chunk.
    if (cur.length >= maxChars) {
      chunks.push(cur)
      cur = ''
    }
  }
  if (cur) chunks.push(cur)
  return chunks
}

/** Runs Piper once on a single-line chunk, writing one WAV, using the given voice model. */
function piperOnce(line: string, outWavPath: string, modelPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(piperExe(), ['--model', modelPath, '--output_file', outWavPath])
    let err = ''
    p.stderr.on('data', (d) => (err = (err + d.toString()).slice(-500)))
    p.on('error', reject)
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Natural voice failed: ${err.trim()}`))))
    // Force a single line so Piper treats the whole chunk as one utterance → one file.
    p.stdin.write(line.replace(/[\r\n]+/g, ' '))
    p.stdin.end()
  })
}

/** Synthesizes `text` to a WAV using the user's ACTIVE Piper voice. Requires isPiperInstalled(). */
export async function synthesizeWithPiper(text: string, outWavPath: string): Promise<void> {
  if (!isPiperInstalled()) {
    throw new Error('Natural voice not installed. Download it in Settings first.')
  }
  const modelPath = voiceModelPath(activeVoiceId())
  const chunks = chunkForPiper(text)
  if (chunks.length === 0) {
    throw new Error('Nothing to narrate — the script was empty after cleanup.')
  }
  // Single chunk: synthesize straight to the target, no concat needed.
  if (chunks.length === 1) {
    await piperOnce(chunks[0], outWavPath, modelPath)
    return
  }
  // Multiple chunks: render each to its own WAV, then concat losslessly into one track.
  const work = mkdtempSync(join(tmpdir(), 'piper-'))
  try {
    const parts: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      // Honour Stop between chunks — narration used to ignore it entirely and
      // kept spawning piper.exe for every remaining chunk of a long script.
      throwIfCancelled()
      const part = join(work, `part-${String(i).padStart(4, '0')}.wav`)
      await piperOnce(chunks[i], part, modelPath)
      parts.push(part)
    }
    // concat demuxer: identical-format WAVs join with a stream copy (no re-encode).
    const listPath = join(work, 'list.txt')
    writeFileSync(listPath, parts.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n'), 'utf-8')
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outWavPath])
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
