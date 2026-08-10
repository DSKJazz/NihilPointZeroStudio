/**
 * One place that turns a file on disk into something a <video>, <audio> or <img> can
 * actually play.
 *
 * On the PC that is a `file:///` link straight to the disk — instant, no copying.
 * On a phone the same path is meaningless (the file is on the laptop), so the link is
 * pointed at the PC's own file route instead and the bytes stream over the private
 * connection.
 *
 * The desktop behaviour is deliberately byte-identical to the ten hand-written copies
 * of this line that used to live in the page files: same slash flipping, same leading
 * slash trim. Nothing about the installed app changes.
 */

/**
 * Set on `window` by the remote bridge to the PC's file route. Never set inside
 * Electron, which is what makes the desktop behaviour the default.
 */
export const REMOTE_MEDIA_GLOBAL = '__NPZ_REMOTE_MEDIA__'

/**
 * The path is a URL *segment*, not a query parameter, for a reason worth writing down:
 * several pages append their own `?t=<now>` cache-buster to whatever this returns. If
 * the path lived in a query parameter that buster would land INSIDE it, and the PC
 * would be asked for a file whose name ends in "?t=1753…". As a segment, an appended
 * query is simply a query.
 */
export const REMOTE_MEDIA_ROUTE = '/api/file/'

function remotePrefix(): string | null {
  const value = (globalThis as Record<string, unknown>)[REMOTE_MEDIA_GLOBAL]
  return typeof value === 'string' && value ? value : null
}

/** True when the UI is running in a phone browser rather than inside the app. */
export function isRemoteUi(): boolean {
  return remotePrefix() !== null
}

/**
 * `p` is an absolute path on the PC. Any `?t=` style cache-buster the caller appends
 * afterwards keeps working in both modes.
 */
export function fileUrl(p: string): string {
  const prefix = remotePrefix()
  if (prefix) return prefix + encodeURIComponent(p)
  return `file:///${p.replace(/\\/g, '/').replace(/^\/+/, '')}`
}

/**
 * Undoes fileUrl() back to a plain disk path, including a trailing `?t=…` cache-buster.
 * The Scene Studio needs this: it shows a preview and then hands the same picture to
 * the builder, which wants a path, not a link.
 */
export function pathFromFileUrl(url: string): string {
  if (url.startsWith(REMOTE_MEDIA_ROUTE)) {
    try {
      return decodeURIComponent(url.slice(REMOTE_MEDIA_ROUTE.length).split('?')[0])
    } catch {
      return ''
    }
  }
  // Byte-identical to the line this replaced in SceneStudioPage.
  return decodeURI(url.replace(/^file:\/\/\//, '').split('?')[0])
}
