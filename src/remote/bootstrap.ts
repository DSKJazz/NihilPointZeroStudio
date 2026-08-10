/**
 * Runs before anything else in the bridge.
 *
 * Kept in its own file on purpose: `import` statements are hoisted, so plain code
 * sitting above an import in the same file would still run AFTER it. A separate module
 * imported first is the only way to guarantee ordering.
 */
import { REMOTE_MEDIA_GLOBAL, REMOTE_MEDIA_ROUTE } from '../shared/mediaUrl'

// On the desktop a finished video is `file:///C:/…`, which means nothing in a phone
// browser. Setting this makes the app's one media-link helper hand back a link to the
// PC's file route instead. The desktop never sets it, so the desktop is unchanged.
//
// No token in the link: a <video src> cannot send a header, and putting the secret in
// every media URL would splash it through the page's HTML. The cookie the PC set when
// it served this page authenticates these requests instead.
;(globalThis as Record<string, unknown>)[REMOTE_MEDIA_GLOBAL] = REMOTE_MEDIA_ROUTE
