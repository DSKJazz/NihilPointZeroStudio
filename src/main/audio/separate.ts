/**
 * OPTIONAL audio source-separation for OUTSIDE videos — where the music is already
 * blended into one track, so it must be "un-mixed" with an AI model to recover the
 * spoken/vocal track. Two engines, both free:
 *
 *  - Online (MVSEP): upload the audio, poll the free queue, download the vocals stem.
 *    Internet, no install. Needs a free MVSEP API token (Settings).
 *  - Local (Demucs): run a locally-installed Demucs command. Offline, best quality,
 *    but requires a one-time install (Python + `pip install demucs`).
 *
 * Both return the path to a "vocals only" audio file (music removed). Quality is an
 * ML estimate — good on clear speech-over-music, never bit-perfect.
 */
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const MVSEP_API = 'https://mvsep.com/api'
// Baked-in MVSEP token so online music separation works on EVERY copy with zero setup.
// A user-supplied token in Settings overrides this. To revoke, regenerate at mvsep.com.
const DEFAULT_MVSEP_TOKEN = 'NQxP7gU0ItYOG8V53634R6G0BF4mCp'
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export interface SeparateProgress {
  message: string
}

/** Which side of the split to keep: the voice, or everything that isn't the voice. */
export type SeparationTarget = 'vocals' | 'instrumental'

/**
 * Picks the right stem from MVSEP's result list. Robust on names like "no_vocals"
 * (which the naive /vocal/i predicate would have mistaken for the VOICE stem).
 * Pure + unit-tested.
 */
export function pickStem<T extends { url?: string; download?: string; type?: string }>(
  files: T[],
  target: SeparationTarget
): T | undefined {
  const tag = (f: T): string => `${f.type ?? ''} ${f.url ?? ''}`
  const isInstrumental = (f: T): boolean => /instrum|accomp|no.?vocal|music/i.test(tag(f))
  const isVocals = (f: T): boolean => /vocal/i.test(tag(f)) && !isInstrumental(f)
  const hit = files.find(target === 'vocals' ? isVocals : isInstrumental)
  return hit ?? (target === 'vocals' ? files[0] : undefined)
}

/** Online separation via MVSEP's free queue. Returns a path to the requested stem. */
export async function separateOnline(
  inputAudioPath: string,
  token: string,
  outDir: string,
  onProgress?: (p: SeparateProgress) => void,
  maxWaitMs = 15 * 60 * 1000,
  target: SeparationTarget = 'vocals'
): Promise<string> {
  const key = token?.trim() || DEFAULT_MVSEP_TOKEN
  onProgress?.({ message: 'Uploading audio to the free separation queue…' })
  const form = new FormData()
  form.append('api_token', key)
  form.append('sep_type', '0') // vocals/instrumental model
  form.append('output_format', '1') // wav
  form.append('audiofile', new Blob([readFileSync(inputAudioPath) as unknown as BlobPart]), 'audio.wav')

  const createRes = await fetch(`${MVSEP_API}/separation/create`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(300_000) // uploads the whole audio file — generous, never infinite
  })
  const createJson = (await createRes.json().catch(() => ({}))) as {
    success?: boolean
    data?: { hash?: string; message?: string }
    errors?: string[]
  }
  if (!createRes.ok || !createJson.success || !createJson.data?.hash) {
    throw new Error(
      `Separation service rejected the upload: ${
        createJson.errors?.join(', ') || createJson.data?.message || createRes.status
      }`
    )
  }
  const hash = createJson.data.hash

  const started = Date.now()
  while (Date.now() - started < maxWaitMs) {
    await sleep(6000)
    const st = (await (await fetch(`${MVSEP_API}/separation/get?hash=${hash}`, { signal: AbortSignal.timeout(20_000) })).json().catch(() => ({}))) as {
      status?: string
      data?: { files?: { url?: string; download?: string; type?: string }[] }
    }
    onProgress?.({ message: `Separating audio (${st.status ?? 'working'})…` })
    if (st.status === 'done') {
      const files = st.data?.files ?? []
      const stem = pickStem(files, target)
      const url = stem?.download || stem?.url
      if (!url) {
        throw new Error(
          target === 'vocals'
            ? 'Separation finished but no voice track was returned.'
            : 'Separation finished but no music/instrumental track was returned.'
        )
      }
      const dl = await fetch(url, { signal: AbortSignal.timeout(300_000) })
      const outPath = join(outDir, target === 'vocals' ? 'vocals-online.wav' : 'instrumental-online.wav')
      writeFileSync(outPath, Buffer.from(await dl.arrayBuffer()))
      return outPath
    }
    if (st.status === 'failed' || st.status === 'error') throw new Error('The separation job failed. Try again.')
  }
  throw new Error('Separation timed out — the free queue is busy. Try again later or use the local engine.')
}

/**
 * Splits a user-configured command string into [executable, ...args] WITHOUT a shell,
 * honouring double- and single-quoted segments ("python -m demucs",
 * '"C:\Program Files\demucs\demucs.exe" -v'). Pure + unit-tested.
 *
 * Spawning without a shell means NO shell metacharacter interpretation — the
 * user-configured value can never smuggle `&&`, `|`, `;` etc. into a shell, and
 * paths with spaces are passed as clean single arguments instead of relying on
 * quote-preservation through a shell re-parse.
 */
export function parseCommandLine(cmd: string): string[] {
  const out: string[] = []
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(cmd)) !== null) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** Local separation via a Demucs CLI install. Returns a path to the requested stem. */
export function separateLocal(
  inputAudioPath: string,
  demucsCmd: string,
  outDir: string,
  onProgress?: (p: SeparateProgress) => void,
  target: SeparationTarget = 'vocals'
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!demucsCmd) {
      reject(new Error('No local Demucs command set. Install Demucs and set its command in Settings → “Music separation (local)”.'))
      return
    }
    const parts = parseCommandLine(demucsCmd)
    if (parts.length === 0) {
      reject(new Error('The Demucs command in Settings is empty or unreadable.'))
      return
    }
    onProgress?.({ message: 'Running local Demucs separation (this can take a while)…' })
    // demucs --two-stems=vocals -o <outDir> <input>  → writes <outDir>/<model>/<track>/vocals.wav
    // Argument ARRAY + no shell: outDir/input paths with spaces arrive as single args,
    // and nothing in the configured command is ever interpreted by a shell.
    const [exe, ...baseArgs] = parts
    const proc = spawn(exe, [...baseArgs, '--two-stems=vocals', '-o', outDir, inputAudioPath])
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => reject(new Error(`Could not run Demucs ("${demucsCmd}"): ${e.message}. Check the command in Settings.`)))
    proc.on('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Demucs exited with code ${code}. ${err.trim().slice(-300)}`))
        return
      }
      // --two-stems=vocals writes BOTH vocals.wav and no_vocals.wav — pick the asked-for one.
      const wanted = target === 'vocals' ? 'vocals.wav' : 'no_vocals.wav'
      const found = findFileRecursive(outDir, wanted)
      if (!found) reject(new Error(`Demucs finished but no ${wanted} was found in its output.`))
      else resolve(found)
    })
  })
}

/** Depth-first search for a file by exact name under a directory. */
function findFileRecursive(dir: string, name: string): string | null {
  if (!existsSync(dir)) return null
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      const hit = findFileRecursive(full, name)
      if (hit) return hit
    } else if (entry.name.toLowerCase() === name.toLowerCase()) {
      return full
    }
  }
  return null
}

/** Makes a scratch dir for a separation job. */
export function makeSeparationScratch(): string {
  return mkdtempSync(join(tmpdir(), 'finscript-sep-'))
}
