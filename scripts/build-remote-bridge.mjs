/**
 * Bundles the app's preload for an ordinary browser, so the real studio UI can run on
 * the phone with the PC doing the work.
 *
 * The trick is one alias: `electron` is pointed at src/remote/electron.ts, which speaks
 * HTTP instead of IPC. Nothing else is rewritten, which is exactly the point — there is
 * one `window.api`, built from one file, and the phone gets the same one the desktop
 * does.
 *
 * Output: out/remote/bridge.js, a plain (non-module) script so it runs before the app.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outfile = resolve(root, 'out/remote/bridge.js')
mkdirSync(dirname(outfile), { recursive: true })

const result = await build({
  entryPoints: [resolve(root, 'src/remote/index.ts')],
  outfile,
  bundle: true,
  // IIFE, not ESM: a module script is deferred until after the document is parsed,
  // which would let the app start before window.api existed.
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  // Phones are the audience; a source map costs nothing to skip and keeps the payload
  // small over mobile data. The bundle is a few kilobytes either way.
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  alias: { electron: resolve(root, 'src/remote/electron.ts') },
  logLevel: 'warning',
  metafile: true
})

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0
console.log(`remote bridge -> out/remote/bridge.js (${(bytes / 1024).toFixed(1)} kB)`)
