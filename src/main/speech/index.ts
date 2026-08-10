import { spawn } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { app } from 'electron'
import { env, pipeline } from '@huggingface/transformers'
import { ffmpegPath } from '../video/ffmpeg'

/**
 * Offline speech-to-text ("dictation"). Runs Whisper (base, quantized) entirely
 * locally via onnxruntime-node — no cloud, no API key, free for life. The model
 * is bundled in resources/models and loaded straight off disk, so we force
 * transformers.js to never touch the network.
 */
env.allowRemoteModels = false
env.localModelPath = app.isPackaged
  ? join(process.resourcesPath, 'models')
  : join(app.getAppPath(), 'resources', 'models')

// Lazily load the pipeline once and reuse it — the first call warms it (~1-2s),
// later calls are fast. Kept as a promise so concurrent calls share one load.
// dtype 'q8' is REQUIRED: it maps to the bundled *_quantized.onnx files (verified
// against DEFAULT_DTYPE_SUFFIX_MAPPING in the installed package); the v4 default
// (fp32) would look for model.onnx, which is deliberately not shipped.
let transcriberPromise: Promise<unknown> | null = null
function getTranscriber(): Promise<unknown> {
  if (!transcriberPromise) {
    transcriberPromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-base', { dtype: 'q8' })
    // A REJECTED load must not stay cached: one transient failure (a file briefly
    // locked by antivirus, low memory at startup) otherwise disabled dictation and
    // auto-captions for the entire session. Clear it so the next call retries.
    transcriberPromise.catch(() => {
      transcriberPromise = null
    })
  }
  return transcriberPromise
}

/** Decodes arbitrary recorded audio (webm/opus from the mic) to the 16 kHz mono
 * float PCM Whisper expects, using the already-bundled ffmpeg. */
function toFloat32Pcm(inputPath: string, rawPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ['-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-f', 'f32le', rawPath])
    let err = ''
    proc.stderr.on('data', (d) => (err = (err + d.toString()).slice(-1000)))
    proc.on('error', reject)
    proc.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`audio decode failed: ${err.trim()}`))))
  })
}

/**
 * Transcribes recorded microphone audio to text. `bytes` is the raw recording
 * (e.g. an audio/webm blob from MediaRecorder). Language is auto-detected, so
 * spoken English → English and spoken Urdu → Urdu script.
 */
export async function transcribeAudio(bytes: Uint8Array): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'finscript-stt-'))
  const inPath = join(dir, 'clip')
  const rawPath = join(dir, 'audio.f32')
  try {
    writeFileSync(inPath, Buffer.from(bytes))
    await toFloat32Pcm(inPath, rawPath)
    const buf = readFileSync(rawPath)
    if (buf.byteLength < 4) return ''
    const audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
    const transcriber = (await getTranscriber()) as (
      a: Float32Array,
      o: Record<string, unknown>
    ) => Promise<{ text?: string }>
    const out = await transcriber(audio, { chunk_length_s: 30, task: 'transcribe' })
    return String(out?.text ?? '').trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Transcribes any audio/video file into timestamped segments (for captions/subtitles).
 * ffmpeg extracts + resamples the audio, then Whisper returns chunk-level timestamps.
 */
export async function transcribeFileToSegments(
  inputPath: string
): Promise<{ text: string; start: number; end: number }[]> {
  const dir = mkdtempSync(join(tmpdir(), 'finscript-caption-'))
  const rawPath = join(dir, 'audio.f32')
  try {
    await toFloat32Pcm(inputPath, rawPath)
    const buf = readFileSync(rawPath)
    if (buf.byteLength < 4) return []
    const audio = new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 4))
    const transcriber = (await getTranscriber()) as (
      a: Float32Array,
      o: Record<string, unknown>
    ) => Promise<{ chunks?: { text: string; timestamp: [number, number | null] }[]; text?: string }>
    const out = await transcriber(audio, { chunk_length_s: 30, task: 'transcribe', return_timestamps: true })
    const chunks = out?.chunks ?? []
    if (!chunks.length && out?.text) return [{ text: String(out.text).trim(), start: 0, end: 3 }]
    return chunks
      .map((c) => ({
        text: String(c.text ?? '').trim(),
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 2
      }))
      .filter((c) => c.text)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
