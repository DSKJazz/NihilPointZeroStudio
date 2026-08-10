/**
 * Speak a piece of text with whatever voice this PC actually has.
 *
 * WHY THIS IS SEPARATE FROM THE RENDER PATH'S OWN CHAIN
 * `video/index.ts` has a narration chain of its own, and it is deliberately left alone.
 * That one also lays down a silent track when the user wants to record over the visuals
 * themselves, reports progress at each step, and checks for cancellation between them —
 * all of which a render needs and none of which applies to a throwaway proofreading file.
 * Unifying them would mean threading cancellation and progress reporting into a
 * fifteen-second job, and touching the one code path where a failure loses the user a
 * finished video. If the render chain ever grows a fourth caller, this is the place to
 * unify into.
 *
 * The order is the same for the same reason it is that order there: Piper is the natural
 * voice, the Windows natural voices are the only engine that speaks Urdu, and the old
 * built-in Windows voice is robotic but always present — so speech NEVER fails outright.
 */

import { isPiperInstalled, synthesizeWithPiper } from './piper'
import { synthesizeWithWinNatural } from './winNatural'
import { stripStageDirections, synthesizeSpeechToFile } from '../voiceover'

export type SpeakVoice = 'natural' | 'winnatural' | 'windows'

/** Which engine actually spoke, so the UI can say so rather than guess. */
export interface SpokenResult {
  engine: SpeakVoice
  /** Plain-English name for the engine that spoke. */
  engineName: string
}

const ENGINE_NAMES: Record<SpeakVoice, string> = {
  natural: 'the natural offline voice',
  winnatural: 'the Windows natural voice',
  windows: 'the built-in Windows voice'
}

/**
 * Writes `text` to `outWavPath`, falling through the engines until one works.
 *
 * Throws only when every engine failed — which on Windows means something is badly wrong,
 * because the last one ships with the operating system.
 */
export async function speakToWav(
  text: string,
  outWavPath: string,
  prefer: SpeakVoice = 'natural',
  winVoiceId?: string
): Promise<SpokenResult> {
  const clean = stripStageDirections(text ?? '')
  const failures: string[] = []

  if (prefer === 'winnatural') {
    try {
      await synthesizeWithWinNatural(clean, outWavPath, winVoiceId)
      return { engine: 'winnatural', engineName: ENGINE_NAMES.winnatural }
    } catch (err) {
      failures.push(`Windows natural voice: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  if (prefer !== 'windows' && isPiperInstalled()) {
    try {
      await synthesizeWithPiper(clean, outWavPath)
      return { engine: 'natural', engineName: ENGINE_NAMES.natural }
    } catch (err) {
      failures.push(`natural voice: ${err instanceof Error ? err.message : 'failed'}`)
    }
  }

  try {
    await synthesizeSpeechToFile(clean, outWavPath)
    return { engine: 'windows', engineName: ENGINE_NAMES.windows }
  } catch (err) {
    failures.push(`Windows voice: ${err instanceof Error ? err.message : 'failed'}`)
  }

  // Every engine reports WHY, because "could not speak the script" with no reason is the
  // kind of message that ends in a support conversation.
  throw new Error(`No voice on this PC could speak the script. ${failures.join('; ')}`)
}
