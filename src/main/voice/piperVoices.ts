/**
 * The catalogue of installable Piper voices (free, offline neural TTS).
 *
 * Kept as pure data + pure helpers (no electron/fs imports) so it is unit-testable and
 * so the renderer can show the same list the main process downloads from.
 *
 * WHY THIS EXISTS: narration used to be one hardcoded English voice. A Roman-Urdu /
 * Urdu channel needs an actual Urdu voice, and the honest way to get free neural Urdu
 * is Piper's own ur_PK models — NOT Microsoft's Edge "read aloud" endpoint, which
 * requires spoofing a browser token that Microsoft rotates (it breaks on every Edge
 * release) and is not offered for third-party apps.
 */

export interface PiperVoice {
  /** Stable id used in settings + as the on-disk model basename. */
  id: string
  /** What the user sees in the picker. */
  label: string
  /** Language shown next to the label. */
  language: string
  /** Path inside the rhasspy/piper-voices repo (without the .onnx / .onnx.json suffix). */
  repoPath: string
  /** Rough download size, for honest UI copy. */
  approxMB: number
}

const HF_BASE = 'https://huggingface.co/rhasspy/piper-voices/resolve/main'

/**
 * Voices offered in the app. The first entry is the historical default and MUST keep
 * its exact id: an existing install already has `en_US-lessac-low.onnx` on disk, and
 * changing the id would strand that file and re-download it for no reason.
 */
export const PIPER_VOICES: PiperVoice[] = [
  {
    id: 'en_US-lessac-low',
    label: 'Lessac (clear, fast)',
    language: 'English (US)',
    repoPath: 'en/en_US/lessac/low/en_US-lessac-low',
    approxMB: 20
  },
  {
    id: 'en_US-amy-medium',
    label: 'Amy (warmer, higher quality)',
    language: 'English (US)',
    repoPath: 'en/en_US/amy/medium/en_US-amy-medium',
    approxMB: 60
  },
  {
    id: 'ur_PK-fasih-medium',
    label: 'Fasih (male)',
    language: 'Urdu (Pakistan)',
    repoPath: 'ur/ur_PK/fasih/medium/ur_PK-fasih-medium',
    approxMB: 60
  },
  {
    id: 'ur_PK-aegis_female-medium',
    label: 'Aegis (female)',
    language: 'Urdu (Pakistan)',
    repoPath: 'ur/ur_PK/aegis_female/medium/ur_PK-aegis_female-medium',
    approxMB: 60
  }
]

export const DEFAULT_PIPER_VOICE_ID = 'en_US-lessac-low'

export function findPiperVoice(id: string): PiperVoice | undefined {
  return PIPER_VOICES.find((v) => v.id === id)
}

/**
 * Resolves a possibly-missing/unknown saved voice id to a real one. A settings value
 * from a newer build (or a typo) must never break narration — fall back to the default.
 */
export function resolvePiperVoiceId(id: string | undefined | null): string {
  return id && findPiperVoice(id) ? id : DEFAULT_PIPER_VOICE_ID
}

export function piperModelUrl(v: PiperVoice): string {
  return `${HF_BASE}/${v.repoPath}.onnx`
}

export function piperConfigUrl(v: PiperVoice): string {
  return `${piperModelUrl(v)}.json`
}

/** Basename used on disk for a voice's model file. */
export function piperModelFileName(v: PiperVoice): string {
  return `${v.id}.onnx`
}
