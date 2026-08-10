/**
 * Streams a file from the PC to the phone — finished videos, scene pictures, recorded
 * audio, thumbnails.
 *
 * RANGE REQUESTS ARE THE WHOLE POINT
 * Phone browsers will not let you scrub, and iOS will not play a video at all, unless
 * the server answers `Range:` requests with a 206 and a `Content-Range`. Without that,
 * a 40-minute render either refuses to open or has to download in full before the
 * first frame. So this speaks the range protocol properly rather than dumping bytes.
 *
 * WHAT IT IS ALLOWED TO READ
 * Any readable file, but only behind the web server's token — and that same token
 * already lets the caller run the app's handlers, which read and write files as the
 * user themselves. Restricting this route while leaving that open would be theatre.
 * Directories, and paths that are not absolute, are refused outright.
 */
import { createReadStream, statSync } from 'fs'
import { isAbsolute } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { mimeFor } from './site'

/** Parses a single `bytes=start-end` range against a known size. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (!header) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, rawStart, rawEnd] = m
  if (rawStart === '' && rawEnd === '') return null
  let start: number
  let end: number
  if (rawStart === '') {
    // "last N bytes"
    const n = Number(rawEnd)
    if (!Number.isFinite(n) || n <= 0) return null
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd === '' ? size - 1 : Number(rawEnd)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || start >= size || end < start) return null
  return { start, end: Math.min(end, size - 1) }
}

export function serveFile(req: IncomingMessage, res: ServerResponse, path: string): void {
  if (!path || !isAbsolute(path) || path.includes('\0')) {
    res.writeHead(400, { 'Content-Type': 'text/plain' })
    res.end('Not a file path.')
    return
  }
  let size: number
  try {
    const st = statSync(path)
    if (!st.isFile()) throw new Error('not a file')
    size = st.size
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('That file is not on the PC any more.')
    return
  }

  const type = mimeFor(path)
  const range = parseRange(req.headers.range, size)
  if (range) {
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': range.end - range.start + 1,
      'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=60'
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(path, { start: range.start, end: range.end }).on('error', () => res.end()).pipe(res)
    return
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=60'
  })
  if (req.method === 'HEAD') return void res.end()
  createReadStream(path).on('error', () => res.end()).pipe(res)
}
