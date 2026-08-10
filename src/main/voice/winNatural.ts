/**
 * Windows NATURAL voices (WinRT SpeechSynthesizer) — free, offline, no key, and
 * MUCH better than the old System.Speech "desktop" voices the app used before.
 *
 * Why this exists: System.Speech only sees legacy SAPI "Desktop" voices (David/Zira
 * Desktop — robotic). Windows 10/11 ships better OneCore voices, and installing a
 * language pack (Settings → Time & language → Speech) adds real voices for that
 * language — including Urdu (Pakistan): Asad and Uzma. Those are invisible to
 * System.Speech but reachable through WinRT, so this module unlocks them.
 *
 * Implementation: a short-lived PowerShell process using the WinRT API. Text and
 * output paths are passed via a JSON file and env vars — NEVER interpolated into the
 * script — so a script containing quotes or $ can't break or inject into the command.
 */
import { spawn } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

export interface WinNaturalVoice {
  /** Stable id used to select the voice (WinRT voice Id string). */
  id: string
  /** Human name, e.g. "Microsoft Uzma". */
  name: string
  /** BCP-47 language, e.g. "ur-PK". */
  language: string
}

/** The WinRT bootstrap both scripts share. Contains no interpolated user data. */
const WINRT_PRELUDE = `
$ErrorActionPreference = 'Stop'
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer,Windows.Media,ContentType=WindowsRuntime]
[void][Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'
})[0]
function Await($op, $t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
`

function runPowerShell(script: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'npz-winvoice-'))
  const scriptPath = join(dir, 'run.ps1')
  // UTF-8 with BOM so PowerShell reads non-ASCII (Urdu) correctly.
  writeFileSync(scriptPath, '﻿' + script, 'utf-8')
  return new Promise<string>((resolve, reject) => {
    const proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { env: { ...process.env, ...env } }
    )
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      proc.kill()
      reject(new Error('The Windows voice engine did not respond in time.'))
    }, timeoutMs)
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    proc.on('exit', (code) => {
      clearTimeout(timer)
      rmSync(dir, { recursive: true, force: true })
      if (code === 0) resolve(out)
      else reject(new Error(`Windows voice engine failed (exit ${code}): ${err.trim().slice(0, 300)}`))
    })
  })
}

/** Every natural voice Windows can offer right now (empty list if unsupported). */
export async function listWinNaturalVoices(): Promise<WinNaturalVoice[]> {
  try {
    const script = `${WINRT_PRELUDE}
[Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object {
  [pscustomobject]@{ id = $_.Id; name = $_.DisplayName; language = $_.Language } } |
  ConvertTo-Json -Compress -Depth 3
`
    const out = (await runPowerShell(script, {}, 25_000)).trim()
    if (!out) return []
    const parsed = JSON.parse(out) as WinNaturalVoice | WinNaturalVoice[]
    const list = Array.isArray(parsed) ? parsed : [parsed]
    return list.filter((v) => v && typeof v.id === 'string' && typeof v.name === 'string')
  } catch {
    return []
  }
}

/** True when at least one natural voice exists (i.e. this engine is usable). */
export async function hasWinNaturalVoices(): Promise<boolean> {
  return (await listWinNaturalVoices()).length > 0
}

/**
 * Synthesizes `text` to `outWavPath` with the given natural voice (or the system
 * default when voiceId is empty/unknown). Text goes through a file, never the
 * command line, so any characters are safe.
 */
export async function synthesizeWithWinNatural(text: string, outWavPath: string, voiceId?: string): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'npz-winvoice-in-'))
  const textPath = join(dir, 'text.txt')
  writeFileSync(textPath, text, 'utf-8')
  try {
    const script = `${WINRT_PRELUDE}
$text = [IO.File]::ReadAllText($env:NPZ_TEXT_FILE, [Text.Encoding]::UTF8)
$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
if ($env:NPZ_VOICE_ID) {
  $picked = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Id -eq $env:NPZ_VOICE_ID } | Select-Object -First 1
  # A specific voice was requested (e.g. Urdu Asad/Uzma) — if it's gone (language pack
  # removed since it was picked) we must NOT silently narrate in the wrong voice/language.
  # Throwing lets the caller fall through to Piper's own Urdu voice instead.
  if ($picked) { $synth.Voice = $picked }
  else { throw "The selected Windows voice ($env:NPZ_VOICE_ID) is no longer installed." }
}
$stream = Await ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
$reader = New-Object Windows.Storage.Streams.DataReader($stream)
Await ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]) | Out-Null
$bytes = New-Object byte[] $stream.Size
$reader.ReadBytes($bytes)
[IO.File]::WriteAllBytes($env:NPZ_OUT_WAV, $bytes)
$synth.Dispose()
`
    await runPowerShell(
      script,
      { NPZ_TEXT_FILE: textPath, NPZ_OUT_WAV: outWavPath, NPZ_VOICE_ID: voiceId ?? '' },
      // Long scripts take a while; generous but never infinite.
      10 * 60_000
    )
    if (!existsSync(outWavPath) || readFileSync(outWavPath).length < 1000) {
      throw new Error('The Windows natural voice produced no audio.')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** Voices whose language starts with the given prefix, e.g. 'ur' for Urdu. */
export function voicesForLanguage(voices: WinNaturalVoice[], langPrefix: string): WinNaturalVoice[] {
  const p = langPrefix.toLowerCase()
  return voices.filter((v) => (v.language ?? '').toLowerCase().startsWith(p))
}
