import { describe, expect, it } from 'vitest'
import { sceneImagePrompt } from './index'

describe('sceneImagePrompt', () => {
  it('includes the scene, the title, and a style-specific look', () => {
    const p = sceneImagePrompt('anime', 'TRADE DEFICIT', 'Pakistan Economy')
    expect(p).toContain('TRADE DEFICIT')
    expect(p).toContain('Pakistan Economy')
    expect(p.toLowerCase()).toContain('anime')
  })

  it('always steers away from on-screen text (the renderer adds titles)', () => {
    for (const style of ['cinematic', 'cartoon', 'anime', 'neon', 'minimal']) {
      expect(sceneImagePrompt(style, 'scene', 'title').toLowerCase()).toContain('no text')
    }
  })

  it('falls back to a cinematic look for an unknown style', () => {
    expect(sceneImagePrompt('unknown-style', 'scene', 'title').toLowerCase()).toContain('cinematic')
  })
})

describe('the people problem — why a finance video came out ninety percent women', () => {
  it('bans people from scenes that never asked for any', async () => {
    const { sceneImagePrompt, sceneWantsPerson } = await import('./styles')
    const abstract = 'Karachi skyline at dusk, stock exchange building, rising line chart overlay'
    expect(sceneWantsPerson(abstract)).toBe(false)
    expect(sceneImagePrompt('cinematic', abstract, 'PSX weekly analysis')).toMatch(/No people, no faces/)
  })

  it('dresses the people that WERE asked for', async () => {
    const { sceneImagePrompt, sceneWantsPerson } = await import('./styles')
    const withPerson = 'A tired trader at his desk at the Pakistan Stock Exchange'
    expect(sceneWantsPerson(withPerson)).toBe(true)
    expect(sceneImagePrompt('cinematic', withPerson, '')).toMatch(/fully and modestly dressed/)
    expect(sceneImagePrompt('cinematic', withPerson, '')).not.toMatch(/No people/)
  })

  it('always sends the service its strict content filter', async () => {
    const { sceneImageUrl } = await import('./styles')
    // safe=true was simply never sent, which is how undressed strangers got into an
    // institutional-analysis video. The phone preview and the PC render share this URL.
    expect(sceneImageUrl('anything', { width: 64, height: 64 })).toContain('safe=true')
  })
})
