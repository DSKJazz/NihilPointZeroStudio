import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { generateImage, sceneImagePrompt } from './index'

/**
 * OPT-IN live smoke test against the real free image service (needs internet).
 * Skipped in normal test runs; run it with:  NPZ_LIVE=1 npm test
 * It proves end-to-end that scene generation genuinely produces real images —
 * including two at once, the pattern that used to fail under parallel load.
 */
describe.skipIf(!process.env.NPZ_LIVE)('live free image generation (opt-in)', () => {
  it(
    'generates two real scene images from prompts, in parallel',
    async () => {
      const prompts = [
        sceneImagePrompt('cinematic', 'Karachi stock exchange floor at golden hour, brokers celebrating', 'PSX rally'),
        sceneImagePrompt('cartoon', 'A bull and a bear shaking hands over a trading desk', 'PSX rally')
      ]
      const outs = prompts.map((_, i) => join(tmpdir(), `npz-live-scene-${i}-${Date.now()}.jpg`))
      await Promise.all(prompts.map((p, i) => generateImage(p, outs[i], { seed: i + 7, model: 'turbo', attempts: 5 })))
      for (const o of outs) {
        expect(existsSync(o)).toBe(true)
        expect(statSync(o).size).toBeGreaterThan(10_000)
      }
    },
    240_000
  )
})
