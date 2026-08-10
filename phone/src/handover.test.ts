import { describe, expect, it } from 'vitest'
import { decideHandover, isServedByPc, safeStudioUrl, statusLine, type HandoverInputs } from './handover'

const base: HandoverInputs = {
  pcLink: 'http://192.168.1.5:8765/?t=abc123',
  pcReachable: true,
  preferSmallThisTime: false,
  alreadyOnPc: false
}

describe('decideHandover', () => {
  it('goes to the real studio when the PC is there', () => {
    // The whole point: the user asked for what is on their PC, so give them that.
    expect(decideHandover(base)).toBe('full-studio')
  })

  it('stays here when the PC has never been connected', () => {
    expect(decideHandover({ ...base, pcLink: '' })).toBe('stay-here')
    expect(decideHandover({ ...base, pcLink: '   ' })).toBe('stay-here')
  })

  it('stays here when the PC is off', () => {
    expect(decideHandover({ ...base, pcReachable: false })).toBe('stay-here')
  })

  it('respects a deliberate choice to use the small app', () => {
    expect(decideHandover({ ...base, preferSmallThisTime: true })).toBe('stay-here')
  })

  it('never hands over to itself', () => {
    // Loop guard: a link pointing back at this page would otherwise bounce forever.
    expect(decideHandover({ ...base, alreadyOnPc: true })).toBe('stay-here')
  })

  it('the loop guard beats every other reason to go', () => {
    expect(decideHandover({ ...base, alreadyOnPc: true, pcReachable: true, preferSmallThisTime: false })).toBe(
      'stay-here'
    )
  })
})

describe('statusLine', () => {
  it('names the full studio when that is what you are looking at', () => {
    expect(statusLine({ ...base, alreadyOnPc: true })).toMatch(/full studio, running on your PC/)
  })

  it('tells a never-connected user that the full studio EXISTS', () => {
    // The old line said "writing needs your PC" — a limitation, with no hint that the
    // whole studio is available. That is how the user concluded nothing was upgraded.
    expect(statusLine({ ...base, pcLink: '' })).toMatch(/connect your PC for the full studio/)
  })

  it('explains an unreachable PC instead of silently being the small app', () => {
    expect(statusLine({ ...base, pcReachable: false })).toMatch(/not reachable/)
  })

  it('offers the way back when the small app was chosen on purpose', () => {
    expect(statusLine({ ...base, preferSmallThisTime: true })).toMatch(/switch back/)
  })

  it('every situation says something different', () => {
    const lines = new Set([
      statusLine({ ...base, alreadyOnPc: true }),
      statusLine({ ...base, pcLink: '' }),
      statusLine({ ...base, preferSmallThisTime: true }),
      statusLine({ ...base, pcReachable: false }),
      statusLine(base)
    ])
    expect(lines.size).toBe(5)
  })
})

describe('isServedByPc', () => {
  it('knows the hosted copy', () => {
    expect(isServedByPc('dskjazz.github.io')).toBe(false)
    expect(isServedByPc('DSKJazz.GitHub.IO')).toBe(false)
  })

  it('treats anything else as the PC serving it', () => {
    for (const h of ['192.168.1.5', 'localhost', 'my-pc.local', '10.0.0.4']) {
      expect(isServedByPc(h)).toBe(true)
    }
  })

  it('is not fooled by a lookalike host', () => {
    // "github.io.evil.com" must not read as the hosted copy.
    expect(isServedByPc('github.io.evil.com')).toBe(true)
  })
})

describe('safeStudioUrl', () => {
  it('accepts the link the studio actually shows', () => {
    expect(safeStudioUrl('http://192.168.1.5:8765/?t=abc')).toBe('http://192.168.1.5:8765/?t=abc')
  })

  it('accepts https', () => {
    expect(safeStudioUrl('https://npz.example:8765/?t=abc')).toContain('https://')
  })

  it('refuses anything that is not a web address', () => {
    // A stored value that had become a script URL would otherwise be handed straight to
    // location.replace.
    for (const bad of ['javascript:alert(1)', 'data:text/html,<h1>x', 'file:///C:/', 'not a url', '']) {
      expect(safeStudioUrl(bad)).toBeNull()
    }
  })

  it('trims whitespace rather than failing on it', () => {
    expect(safeStudioUrl('  http://192.168.1.5:8765/  ')).toBe('http://192.168.1.5:8765/')
  })
})
