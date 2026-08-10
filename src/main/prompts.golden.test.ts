/**
 * GOLDEN test for the prompt builders.
 *
 * The prompt wording is the studio's most valuable asset: it is what makes output
 * sound like this channel rather than generic AI writing. Any change to it silently
 * changes the quality of every video produced afterwards.
 *
 * So the exact output of every builder is snapshotted here. Refactoring the prompt
 * module (for example, splitting the wording out so the phone can cache it) is only
 * safe if these snapshots do not move. If one does, the wording changed — either fix
 * the refactor, or update the snapshot deliberately because the change was intended.
 */
import { describe, expect, it } from 'vitest'
import {
  buildAdvisorSystemPrompt,
  buildIdeaPrompt,
  buildOutlinePrompt,
  buildScriptPrompt,
  buildSectionPrompt,
  buildThumbnailPrompt,
  buildTrendPrompt
} from './prompts'
import { buildStoryboardPrompt } from '../shared/storyboard'
import type { ScriptGenRequest } from '../shared/types'

const SCRIPT_REQ: ScriptGenRequest = {
  topic: 'Why the rupee keeps devaluing',
  ideaContext: 'Explain the mechanism, not the blame',
  audienceNote: 'new investors in Karachi',
  length: 'long',
  languageMix: 'balanced',
  styles: ['standard', 'deep-dive'],
  verifiedData: 'PKR/USD 278.5 as of 2026-07-31'
}

describe('prompt wording is frozen', () => {
  it('trend prompt', () => {
    expect(buildTrendPrompt('Pakistan economy', 5)).toMatchSnapshot()
  })

  it('idea prompt — no trends, no YouTube signals (the phone case)', () => {
    expect(buildIdeaPrompt({ focusArea: 'Pakistan inflation', count: 5 }, [], [])).toMatchSnapshot()
  })

  it('idea prompt — with trends and real YouTube signals', () => {
    expect(
      buildIdeaPrompt(
        { focusArea: 'Pakistan inflation', audienceNote: 'young savers', count: 3 },
        [{ topic: 'Rupee slide', why: 'Budget season', momentum: 'rising' }],
        [
          {
            title: 'Why the rupee fell',
            channelTitle: 'Some Channel',
            viewCount: 1_250_000,
            publishedAt: '2026-06-01T00:00:00Z'
          }
        ]
      )
    ).toMatchSnapshot()
  })

  it('script prompt — every optional field supplied', () => {
    expect(buildScriptPrompt(SCRIPT_REQ)).toMatchSnapshot()
  })

  it('script prompt — bare minimum, no verified data', () => {
    expect(buildScriptPrompt({ topic: 'Gold vs dollar', length: 'short', languageMix: 'formal-urdu' })).toMatchSnapshot()
  })

  it('every language mix is worded exactly as before', () => {
    for (const mix of ['balanced', 'mostly-english', 'mostly-roman-urdu', 'formal-urdu'] as const) {
      expect(buildScriptPrompt({ topic: 't', length: 'long', languageMix: mix })).toMatchSnapshot(`language-${mix}`)
    }
  })

  it('every style is worded exactly as before', () => {
    const styles = [
      'standard',
      'deep-dive',
      'masterclass',
      'institutional-framework',
      'financial-research',
      'technical-charting',
      'fundamental-deep-dive',
      'infotainment',
      'normal',
      'hooking'
    ] as const
    for (const style of styles) {
      expect(
        buildScriptPrompt({ topic: 't', length: 'long', languageMix: 'balanced', styles: [style] })
      ).toMatchSnapshot(`style-${style}`)
    }
  })

  it('every length guide is worded exactly as before', () => {
    for (const length of ['short', 'long', 'deep-dive', 'feature-90', 'feature-180'] as const) {
      expect(buildScriptPrompt({ topic: 't', length, languageMix: 'balanced' })).toMatchSnapshot(`length-${length}`)
    }
  })

  it('advisor system prompt, with and without context', () => {
    expect(buildAdvisorSystemPrompt()).toMatchSnapshot('advisor-plain')
    expect(buildAdvisorSystemPrompt('working on the rupee video')).toMatchSnapshot('advisor-context')
  })

  it('thumbnail prompt', () => {
    expect(buildThumbnailPrompt('Rupee devaluation', 'The Rupee Trap')).toMatchSnapshot()
  })

  it('storyboard prompt, both modes', () => {
    expect(
      buildStoryboardPrompt({ mode: 'auto', title: 'The Rupee Trap', brief: 'A script', totalSeconds: 600, language: 'Roman Urdu' })
    ).toMatchSnapshot('storyboard-auto')
    expect(buildStoryboardPrompt({ mode: 'guided', title: 'The Rupee Trap', brief: 'My shots' })).toMatchSnapshot(
      'storyboard-guided'
    )
  })

  it('feature-length outline and section prompts', () => {
    expect(buildOutlinePrompt({ ...SCRIPT_REQ, length: 'feature-90' }, 12)).toMatchSnapshot('outline')
    expect(
      buildSectionPrompt({ ...SCRIPT_REQ, length: 'feature-90' }, { title: 'The mechanism', focus: 'How it works' }, 0, 12, [
        { title: 'The mechanism', focus: 'How it works' },
        { title: 'The consequences', focus: 'What follows' }
      ])
    ).toMatchSnapshot('section-first')
  })
})
