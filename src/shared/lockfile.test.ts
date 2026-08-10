/**
 * THE LOCK FILE IS PART OF THE BUILD, SO IT GETS TESTED LIKE THE BUILD.
 *
 * THE INCIDENT (2026-08-07). A commit called "Lockfile refresh" was a 512-line pure
 * DELETION: it removed every `@esbuild/*` platform entry belonging to esbuild 0.28.1
 * (the copy vitest depends on) while leaving the 0.21.5 tree intact. Nothing local
 * complained — an already-installed `node_modules` never needs those entries — so nine
 * changes were merged and reported as shipped while every Windows build died in its
 * first 30 seconds:
 *
 *     npm error Missing: @esbuild/win32-x64@0.28.1 from lock file
 *
 * `npm ci` installs strictly from the lock and refuses when the tree it must build is
 * not fully described. It caught the fault correctly; the failure was that nobody
 * looked for ten minutes, and by then the user had been told his work had shipped.
 *
 * These tests move that discovery to the place where mistakes are cheap: `npm test`,
 * on this machine, before the push. They are pure file reads — no network, no install
 * — so they cost milliseconds and run everywhere, including the sandbox where a real
 * `npm ci` cannot run at all.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

interface LockPackage {
  version?: string
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
}
interface Lock {
  lockfileVersion: number
  packages: Record<string, LockPackage>
}

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}
const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf-8')) as Lock

/**
 * Where npm would look for `name` when resolving it from inside `fromPath` — the same
 * walk up the node_modules chain that npm itself performs, so a dependency satisfied by
 * a NESTED copy counts as present and does not produce a false alarm.
 */
function resolvable(fromPath: string, name: string): boolean {
  // "node_modules/vitest/node_modules/esbuild" → try that dir, then each parent.
  let base = fromPath
  for (;;) {
    if (lock.packages[`${base}${base ? '/' : ''}node_modules/${name}`]) return true
    const cut = base.lastIndexOf('/node_modules/')
    if (cut === -1) break
    base = base.slice(0, cut)
  }
  return !!lock.packages[`node_modules/${name}`]
}

describe('package-lock.json describes a tree npm ci can actually install', () => {
  it('every dependency named in package.json has a lock entry', () => {
    const declared = [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})]
    const missing = declared.filter((name) => !lock.packages[`node_modules/${name}`])
    expect(missing, `not in the lock: ${missing.join(', ')}`).toEqual([])
  })

  it('every optional dependency of every locked package is itself locked', () => {
    /**
     * THE EXACT CHECK THAT WOULD HAVE CAUGHT THE INCIDENT. Platform binaries
     * (@esbuild/win32-x64, @rollup/rollup-linux-x64-gnu, …) are declared as
     * optionalDependencies, so they are absent from a pruned install and easy to drop
     * from a regenerated lock — and their absence is invisible until `npm ci` runs on
     * a machine that needs them. Which is to say: invisible until the Windows build.
     */
    const missing: string[] = []
    for (const [path, entry] of Object.entries(lock.packages)) {
      for (const name of Object.keys(entry.optionalDependencies ?? {})) {
        if (!resolvable(path, name)) missing.push(`${path || '<root>'} → ${name}`)
      }
    }
    expect(missing, `optional deps absent from the lock:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('every hard dependency of every locked package is itself locked', () => {
    const missing: string[] = []
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (!path) continue // the root entry mirrors package.json, covered by the first test
      for (const name of Object.keys(entry.dependencies ?? {})) {
        if (!resolvable(path, name)) missing.push(`${path} → ${name}`)
      }
    }
    expect(missing, `dependencies absent from the lock:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('is a lockfileVersion npm ci understands', () => {
    expect(lock.lockfileVersion).toBeGreaterThanOrEqual(2)
  })
})
