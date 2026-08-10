/**
 * The phone's AI adapter — decides WHERE the writing happens.
 *
 * Two routes, tried in this order:
 *
 *  1. ON THIS PHONE, if the user has copied their prompt pack across (Settings →
 *     "Copy my prompts to this phone"). The wording came from their own PC over the
 *     private link and lives only on the handset; the phone assembles the prompt and
 *     talks to the AI service directly. Works with the PC switched off.
 *  2. ON THE PC, otherwise. The phone sends plain parameters and the PC — which owns
 *     the wording — sends back finished text.
 *
 * What must never happen is a third option: prompt wording bundled into this app.
 * The app is served from a public address, so anything in it is readable by anyone.
 * `phone.test.ts` reads the built bundle and fails if any of the wording appears.
 */
import {
  assembleAdvisorPrompt,
  assembleIdeaPrompt,
  assembleScriptPrompt,
  assembleThumbnailPrompt
} from '../../src/shared/promptAssembly'
import { extractJson, parseScriptResponse } from '../../src/main/llm/parse'
import { complete } from './freeAi'
import * as PC from './pc'
import { getPromptPack } from './promptCache'

export { PcNotConfiguredError, PcUnreachableError, pcConfigured, ping } from './pc'
export type { PcIdea, PcStyle } from './pc'

export type PhoneIdea = PC.PcIdea

/** True when this phone can write on its own, with the PC off. */
export function canWriteOffline(): boolean {
  return !!getPromptPack()
}

export async function generateIdeas(req: {
  focusArea: string
  audienceNote?: string
  count: number
}): Promise<PhoneIdea[]> {
  const pack = getPromptPack()
  if (!pack) return PC.generateIdeas(req)

  const prompt = assembleIdeaPrompt(pack, { ...req, trends: [], ytSignals: [] })
  const ideas = extractJson<PhoneIdea[]>(await complete(prompt, 3000))
  if (!Array.isArray(ideas) || !ideas.length) throw new Error('The AI did not return any ideas. Try again.')
  return ideas
}

export async function generateScript(req: {
  topic: string
  length: string
  languageMix: string
  styles?: string[]
}): Promise<{ title: string; body: string }> {
  const pack = getPromptPack()
  if (!pack) return PC.generateScript(req)
  return parseScriptResponse(await complete(assembleScriptPrompt(pack, req), 8000))
}

export async function generateThumbnailBrief(topic: string, title: string): Promise<string> {
  const pack = getPromptPack()
  if (!pack) return (await PC.generateThumbnail({ topic, title })).brief
  return (await complete(assembleThumbnailPrompt(pack, topic, title), 1000)).trim()
}

/**
 * Streams the Advisor's reply. Offline the answer arrives in one piece rather than
 * word by word — a clean complete answer beats a fake typing effect.
 */
export async function advisorStream(
  messages: { role: 'user' | 'assistant'; content: string }[],
  onDelta: (chunk: string) => void
): Promise<string> {
  const pack = getPromptPack()
  if (!pack) return PC.advisorStream(messages, onDelta)

  const system = assembleAdvisorPrompt(pack)
  const flat = `${messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n')}\n\nASSISTANT:`
  const text = (await complete(flat, 1500, system)).trim()
  onDelta(text)
  return text
}
