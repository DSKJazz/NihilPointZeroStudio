/**
 * This helper replaced ten hand-written copies of the same line spread across the
 * app's pages. The first job of these tests is therefore not the new phone behaviour
 * but the old desktop one: prove the replacement produces the SAME string, so the
 * installed app plays exactly the files it played before.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { REMOTE_MEDIA_GLOBAL, REMOTE_MEDIA_ROUTE, fileUrl, isRemoteUi, pathFromFileUrl } from './mediaUrl'

/** The line that used to be written out by hand in every page file. */
const original = (p: string): string => `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`

function beRemote(): void {
  ;(globalThis as Record<string, unknown>)[REMOTE_MEDIA_GLOBAL] = REMOTE_MEDIA_ROUTE
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[REMOTE_MEDIA_GLOBAL]
})

describe('on the desktop (nothing set)', () => {
  it('is byte-identical to the code it replaced', () => {
    const paths = [
      'C:\\Users\\me\\Desktop\\NihilPointZeroStudio\\nihilpointzero-data\\videos\\a.mp4',
      'C:/Users/me/pic.png',
      '/home/me/clip.webm',
      '//server/share/deck.mp4',
      'D:\\a b\\file with spaces.mp3',
      'C:\\Users\\me\\اردو.mp4'
    ]
    for (const p of paths) expect(fileUrl(p), p).toBe(original(p))
  })

  it('reports that it is not remote', () => {
    expect(isRemoteUi()).toBe(false)
  })

  it('undoes itself, cache-buster and all', () => {
    const p = 'C:/Users/me/scene 3.png'
    expect(pathFromFileUrl(`${fileUrl(p)}?t=12345`)).toBe(p)
  })
})

describe('on the phone', () => {
  it('points at the PC and escapes the path safely', () => {
    beRemote()
    expect(fileUrl('C:\\Users\\me\\a b&c.mp4')).toBe('/api/file/C%3A%5CUsers%5Cme%5Ca%20b%26c.mp4')
  })

  it('does not mangle the path — no slash flipping, no trimming', () => {
    beRemote()
    // The PC needs the path exactly as its own filesystem wrote it.
    expect(decodeURIComponent(fileUrl('C:\\x\\y.mp4').slice('/api/file/'.length))).toBe('C:\\x\\y.mp4')
  })

  it('leaves room for the cache-buster the pages append', () => {
    beRemote()
    // The bug this guards: with the path in a query parameter, `?t=…` landed INSIDE
    // the filename and the PC was asked for a file that does not exist.
    const busted = `${fileUrl('C:\\x\\y.png')}?t=999`
    expect(busted).toBe('/api/file/C%3A%5Cx%5Cy.png?t=999')
    expect(pathFromFileUrl(busted)).toBe('C:\\x\\y.png')
  })

  it('reports that it is remote', () => {
    beRemote()
    expect(isRemoteUi()).toBe(true)
  })

  it('undoes itself, cache-buster and all', () => {
    beRemote()
    const p = 'C:\\Users\\me\\scene 3.png'
    expect(pathFromFileUrl(`${fileUrl(p)}?t=12345`)).toBe(p)
  })

  it('still reads a plain file:/// link, so a stored preview from a desktop session works', () => {
    beRemote()
    expect(pathFromFileUrl('file:///C:/x/y.png?t=1')).toBe('C:/x/y.png')
  })
})
