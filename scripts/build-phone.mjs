/**
 * Builds the standalone phone app into `phone/dist/`.
 *
 *   node scripts/build-phone.mjs
 *
 * The bundle pulls `src/main/prompts.ts` and `src/main/llm/parse.ts` straight
 * out of the desktop app, which is the whole point: the phone and the PC write
 * from one identical set of instructions and can never drift apart.
 *
 * Output is a plain static folder — index.html, one JS bundle, a manifest, a
 * service worker and icons. It needs no server of its own, which is what makes
 * it hostable on GitHub Pages and installable as a home-screen app.
 *
 * This does NOT touch the Electron build in any way. `npm run dist:win` and
 * `npm run ship` are completely unaffected by anything in `phone/`.
 */
import { build } from 'esbuild'
import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'phone', 'src', 'app.ts')
const PUBLIC = join(ROOT, 'phone', 'public')
const DIST = join(ROOT, 'phone', 'dist')

/**
 * Build identity, stamped into the bundle and into the service worker's cache name.
 *
 * WHY THIS EXISTS — a real problem, not housekeeping
 * A phone app is cached ON the handset. Publish a new one and the old one keeps
 * running until the browser decides otherwise, so the user sits looking at last
 * week's app with no way to tell. That happened. The stamp fixes both halves:
 * the cache name changes, so the previous version's files are deleted rather than
 * lingering; and the app can SHOW which version it is, the same way the desktop's
 * gold sidebar badge does.
 */
const now = new Date()
const two = (n) => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`
let gitHash = ''
try {
  gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
} catch {
  // Not a git checkout — the stamp still carries the date and time.
}
const BUILD_TAG = `${stamp}${gitHash ? ` · ${gitHash}` : ''}`

rmSync(DIST, { recursive: true, force: true })
mkdirSync(DIST, { recursive: true })

const result = await build({
  entryPoints: [SRC],
  outfile: join(DIST, 'app.js'),
  bundle: true,
  format: 'esm',
  // Baseline that covers the Android Chrome and iOS Safari versions actually in
  // use, while still allowing top-level await and optional chaining.
  target: ['chrome100', 'safari15'],
  minify: true,
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'warning',
  metafile: true,
  define: { __PHONE_BUILD__: JSON.stringify(BUILD_TAG) }
})

cpSync(PUBLIC, DIST, { recursive: true })

// A cache name that changes every build. Without this the service worker keeps the
// previous version's files forever under the same key, which is exactly how an old
// app survives a publish.
const swPath = join(DIST, 'sw.js')
writeFileSync(
  swPath,
  readFileSync(swPath, 'utf8').replace("'npz-phone-v1'", JSON.stringify(`npz-phone-${BUILD_TAG}`))
)

const bytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0)
const files = readdirSync(DIST).sort()
const total = files.reduce((n, f) => n + statSync(join(DIST, f)).size, 0)

console.log(`phone app built -> phone/dist (${files.length} files, ${(total / 1024).toFixed(1)} KB total)`)
console.log(`  build:  ${BUILD_TAG}`)
console.log(`  bundle: ${(bytes / 1024).toFixed(1)} KB`)
for (const f of files) console.log(`  - ${f}`)
