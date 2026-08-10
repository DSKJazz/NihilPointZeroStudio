// DEV-ONLY config for the visual probe (src/renderer/probe.html). Lets the real React UI
// run in a plain browser so layouts can be rendered and measured. Not used by any build
// script — electron-vite.config.ts is the real one. Safe to delete.
import { resolve } from 'path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
  define: { __BUILD_TAG__: JSON.stringify('v0.1.1 · probe') },
  plugins: [react()],
  server: { port: 5199, strictPort: true }
})
