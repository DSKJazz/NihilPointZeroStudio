import { resolve } from 'path'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Build identity, injected into the renderer as __BUILD_TAG__ (rendered by
// Sidebar.tsx as the gold badge under "OS"). Generated automatically at build
// time — version from package.json, local build timestamp, git short hash —
// so a deploy can never ship with a stale hand-edited tag again.
const pkg = JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }
const now = new Date()
const two = (n: number): string => String(n).padStart(2, '0')
const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())} ${two(now.getHours())}:${two(now.getMinutes())}`
let gitHash = ''
try {
  gitHash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
    .toString()
    .trim()
} catch {
  // git absent or not a repo — the tag still carries version + timestamp.
}
// ship.ps1 passes NPZ_BUILD_TAG so the sidebar badge and the Build line it stamps into
// MEGA-DIAGNOSTIC-REPORT.md are byte-identical; standalone builds still self-stamp.
const BUILD_TAG = process.env.NPZ_BUILD_TAG || `v${pkg.version} · ${stamp}${gitHash ? ` · ${gitHash}` : ''}`

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      // Also injected into MAIN so the startup update-check can compare the running
      // build's date against the newest GitHub release without asking the renderer.
      __BUILD_TAG__: JSON.stringify(BUILD_TAG)
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    define: {
      __BUILD_TAG__: JSON.stringify(BUILD_TAG)
    },
    plugins: [react()]
  }
})
