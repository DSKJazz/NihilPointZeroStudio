/**
 * WHEN THE BRAIN YOU ARE POINTED AT DIES, MOVE — DO NOT SIT THERE FAILING.
 *
 * THE INCIDENT. The app shipped with the hosted free service as its default brain. That
 * service began returning HTTP 402 ("this now requires a paid account"). The user had
 * never opened Settings and never chosen anything, so he stayed pointed at a service that
 * refused every request. His log accumulated **50 failures**. Every one of them fell back
 * silently, so the app kept half-working and he was never told that the thing his studio
 * was configured to use had simply stopped existing.
 *
 * Defaulting NEW installs to Ollama does not rescue him: an existing install keeps its
 * saved setting forever. The switch has to happen inside the app, on his machine, without
 * him visiting a screen he has told us he will never open.
 *
 * WHY THIS IS SAFE TO DO WITHOUT ASKING
 * It moves him from something that cannot answer to something that can, and only ever
 * towards a FREE, LOCAL brain. It never selects a paid provider — that would break the
 * PAID FEATURES SLEEP rule, and "your AI broke so I enabled a paid one" is the single
 * worst thing this code could do. It is also announced, not silent: a switch he cannot
 * see is just a different kind of mystery.
 *
 * WHY ONLY ON A *PERMANENT* REFUSAL
 * A busy service (429) or a network blip is not a dead service, and switching on those
 * would bounce him between brains all day. Only a refusal that will still be true in an
 * hour — payment required, key revoked, model withdrawn — counts.
 *
 * Pure and tested; the caller supplies the facts and performs the switch.
 */

/** Providers we may switch TO. Free and local only — never a paid one, ever. */
export const RESCUE_ORDER = ['ollama', 'free'] as const
export type RescueTarget = (typeof RESCUE_ORDER)[number]

export interface RescueInputs {
  /** What the user is currently pointed at. */
  activeProvider: string
  /** That provider has refused in a way that will still be true later. */
  activeIsPermanentlyDead: boolean
  /** Ollama answered a probe on this machine. */
  ollamaAvailable: boolean
  /** The keyless hosted service is currently answering. */
  freeAvailable: boolean
}

/**
 * Which brain should the app move to, or null to stay put.
 *
 * Returns null for every uncertain case. Moving someone's AI is not something to do on a
 * guess, and staying put is always recoverable — the fallback chain still answers this
 * request either way.
 */
export function rescueTarget(i: RescueInputs): RescueTarget | null {
  if (!i.activeIsPermanentlyDead) return null
  // A paid provider that has died stays dead and asleep. We do not shop for a replacement
  // that costs money, and we do not "helpfully" turn one on.
  const available: Record<RescueTarget, boolean> = { ollama: i.ollamaAvailable, free: i.freeAvailable }
  for (const target of RESCUE_ORDER) {
    if (target === i.activeProvider) continue
    if (available[target]) return target
  }
  return null
}

/**
 * What the user is told. Plain, specific, and it names what changed and why — never just
 * "something went wrong".
 */
export function rescueMessage(from: string, to: RescueTarget): string {
  const names: Record<string, string> = {
    free: 'the free online AI',
    ollama: 'Ollama, the free AI on this PC',
    anthropic: 'Claude',
    openai: 'OpenAI'
  }
  const why =
    from === 'free'
      ? 'it now demands a paid account and can no longer answer'
      : 'it refused permanently (the key is wrong, revoked, or the model was withdrawn)'
  const gain =
    to === 'ollama'
      ? 'It runs on this computer, costs nothing, needs no internet and cannot be taken away.'
      : 'It is free and needs no key.'
  return `Your AI brain was switched from ${names[from] ?? from} to ${names[to]} because ${why}. ${gain} Nothing was lost, and you can change it back in Settings whenever you like.`
}
