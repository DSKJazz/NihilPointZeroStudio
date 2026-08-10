import { afterEach, describe, expect, it } from 'vitest'
import {
  beginRenderSession,
  cancelActiveFfmpeg,
  endRenderSession,
  isCancelRequested,
  isRenderSessionOpen
} from './ffmpeg'

/**
 * THE STICKY-STOP BUG (real user report, 2026-07-31): pressing ⏹ Stop on a build set a
 * global cancel flag that was only cleared when the NEXT build started. Every one-shot
 * ffmpeg call in between — Scene Studio's photo conversion in particular — died with
 * "Render cancelled by user." These tests pin the fixed lifecycle: a Stop lives and
 * dies with the session it stopped.
 */
describe('render-session cancel lifecycle', () => {
  afterEach(() => endRenderSession())

  it('a Stop inside a session is visible to the session', () => {
    beginRenderSession()
    cancelActiveFfmpeg()
    expect(isCancelRequested()).toBe(true)
    expect(isRenderSessionOpen()).toBe(true)
  })

  it('ending the session clears the Stop — later unrelated work starts clean', () => {
    beginRenderSession()
    cancelActiveFfmpeg()
    endRenderSession()
    expect(isCancelRequested()).toBe(false)
    expect(isRenderSessionOpen()).toBe(false)
  })

  it('a fresh session never inherits a Stop from a previous one', () => {
    beginRenderSession()
    cancelActiveFfmpeg()
    endRenderSession()
    beginRenderSession()
    expect(isCancelRequested()).toBe(false)
  })

  it('a Stop pressed OUTSIDE any session leaves the session closed (one-shot ffmpeg calls are not gated)', () => {
    cancelActiveFfmpeg()
    // The runFfmpeg pre-check is `cancelRequested && sessionOpen` — with the session
    // closed, a stale flag can no longer block utility conversions.
    expect(isRenderSessionOpen()).toBe(false)
  })
})
