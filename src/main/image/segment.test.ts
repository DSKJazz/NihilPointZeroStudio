import { describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pngHasAlpha, removeBackgroundToPng } from './segment'

function pngWithColorType(colorType: number): Buffer {
  const header = Buffer.alloc(26)
  header.write('\x89PNG\r\n\x1a\n', 0, 'binary')
  header[25] = colorType
  return header
}

describe('background-removal image boundary', () => {
  it('detects RGBA and grayscale-alpha PNGs without invoking the model', () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-segment-test-'))
    const rgba = join(root, 'rgba.png')
    const grayAlpha = join(root, 'gray-alpha.png')
    const rgb = join(root, 'rgb.png')
    writeFileSync(rgba, pngWithColorType(6))
    writeFileSync(grayAlpha, pngWithColorType(4))
    writeFileSync(rgb, pngWithColorType(2))
    expect(pngHasAlpha(rgba)).toBe(true)
    expect(pngHasAlpha(grayAlpha)).toBe(true)
    expect(pngHasAlpha(rgb)).toBe(false)
  })

  it('uses the existing transparent PNG through the real removal call path', async () => {
    const root = mkdtempSync(join(tmpdir(), 'npz-segment-test-'))
    const input = join(root, 'input.png')
    const output = join(root, 'output.png')
    const bytes = Buffer.concat([pngWithColorType(6), Buffer.from('fixture')])
    writeFileSync(input, bytes)
    await expect(removeBackgroundToPng(input, output)).resolves.toBe(true)
    expect(readFileSync(output)).toEqual(bytes)
  })
})
