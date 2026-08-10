/**
 * The bridge script the PC injects into the studio page when it is opened on a phone.
 *
 * It runs before the app itself (this is a plain script; the app's own code is a
 * module, which browsers always defer until after), so by the time the UI starts,
 * `window.api` already exists and looks exactly as it does inside Electron.
 *
 * Two imports, in this order, and nothing else:
 *   1. bootstrap — points media links at the PC instead of at a disk that isn't there;
 *   2. the preload — whose last line is `exposeInMainWorld('api', api)`, which our
 *      stand-in for Electron turns into `window.api = api`.
 */
import './bootstrap'
import '../preload/index'
