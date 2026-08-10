import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const dir = mkdtempSync(join(tmpdir(), 'npz-errlog-'))
vi.mock('electron', () => ({ app: { getPath: () => dir } }))

const { aiErrorLogPath, logAiError, readAiErrors } = await import('./errorLog')

afterAll(() => rmSync(dir, { recursive: true, force: true }))
beforeEach(() => rmSync(aiErrorLogPath(), { force: true }))

describe('AI error log', () => {
  it('writes a failure and reads it back with every field intact', () => {
    logAiError({
      at: '2026-07-30T10:00:00.000Z',
      provider: 'free/openai',
      feature: 'text',
      status: 402,
      ms: 5510,
      message: 'The free AI service now requires a paid account',
      body: '{"error":"402 Payment Required"}'
    })
    const [e] = readAiErrors()
    expect(e.at).toBe('2026-07-30T10:00:00.000Z')
    expect(e.provider).toBe('free/openai')
    expect(e.status).toBe(402)
    expect(e.ms).toBe(5510)
    expect(e.message).toContain('paid account')
    expect(e.body).toContain('402 Payment Required')
  })

  it('returns newest first', () => {
    logAiError({ at: '2026-07-30T10:00:00.000Z', provider: 'a', feature: 'text', message: 'first' })
    logAiError({ at: '2026-07-30T11:00:00.000Z', provider: 'b', feature: 'text', message: 'second' })
    expect(readAiErrors().map((e) => e.message)).toEqual(['second', 'first'])
  })

  it('keeps entries on one line each so a multi-line body cannot corrupt the log', () => {
    logAiError({
      at: '2026-07-30T10:00:00.000Z',
      provider: 'a',
      feature: 'text',
      message: 'broke\nacross\nlines',
      body: 'body\nwith\nnewlines'
    })
    expect(readFileSync(aiErrorLogPath(), 'utf-8').trim().split('\n')).toHaveLength(1)
    expect(readAiErrors()).toHaveLength(1)
  })

  it('omits absent optional fields rather than inventing zeros', () => {
    logAiError({ at: '2026-07-30T10:00:00.000Z', provider: 'a', feature: 'text', message: 'no status' })
    const [e] = readAiErrors()
    expect(e.status).toBeUndefined()
    expect(e.ms).toBeUndefined()
    expect(e.body).toBeUndefined()
  })

  it('reads an empty list when nothing has ever failed', () => {
    expect(readAiErrors()).toEqual([])
  })

  it('never throws, whatever it is handed', () => {
    expect(() => logAiError({ at: '', provider: '', feature: '', message: '' })).not.toThrow()
  })
})
