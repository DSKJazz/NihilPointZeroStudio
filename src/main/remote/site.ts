/**
 * Serves the real studio UI — the exact files the desktop window loads — to a phone.
 *
 * There is no second copy of the app here. `out/renderer` is the build that the
 * Electron window itself opens; this hands the very same files to a browser, with one
 * small script added at the top so `window.api` exists before the app starts.
 */
import { readFileSync, statSync } from 'fs'
import { extname, join, normalize, resolve, sep } from 'path'

/** Where the built UI lives, in dev and inside the packaged app alike. */
export function rendererDir(): string {
  return join(__dirname, '../renderer')
}

/** Where the browser bridge lands (see scripts/build-remote-bridge.mjs). */
export function bridgePath(): string {
  return join(__dirname, '../remote/bridge.js')
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
}

export function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Turns a request path into a real file inside `baseDir`, or null.
 *
 * The guard matters: without it `/../../../../etc/passwd` would walk straight out of
 * the build folder. Everything is resolved to an absolute path first and then checked
 * to still be underneath the base — the only check that survives `..`, encoded
 * separators and Windows' backslashes at once.
 */
export function resolveStatic(baseDir: string, urlPath: string): string | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  if (decoded.includes('\0')) return null
  const base = resolve(baseDir)
  const target = resolve(base, '.' + normalize('/' + decoded))
  if (target !== base && !target.startsWith(base + sep)) return null
  try {
    if (!statSync(target).isFile()) return null
  } catch {
    return null
  }
  return target
}

/**
 * The studio's index.html with the bridge added.
 *
 * Both tags are plain scripts, so they run before the app's own `<script type=module>`
 * — browsers defer modules until the document is parsed, which is exactly the ordering
 * the desktop gets from its preload.
 */
export function injectBridge(html: string, token: string): string {
  const tags =
    `<script>window.__NPZ_TOKEN__=${JSON.stringify(token)};window.__NPZ_REMOTE__=true;</script>` +
    `<script src="/bridge.js"></script>`
  if (html.includes('</head>')) return html.replace('</head>', `${tags}</head>`)
  // No <head> to hook into (shouldn't happen, but a blank page would be worse).
  return tags + html
}

/** Reads and prepares the studio page. Returns null when the UI has not been built. */
export function studioPage(token: string, dir = rendererDir()): string | null {
  try {
    return injectBridge(readFileSync(join(dir, 'index.html'), 'utf8'), token)
  } catch {
    return null
  }
}
