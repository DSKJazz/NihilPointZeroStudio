import { describe, expect, it, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

vi.mock('electron', () => ({ app: { getPath: () => mkdtempSync(join(tmpdir(), 'npz-piper-app-')) } }))
vi.mock('../store', () => ({ getSettings: () => ({ piperVoiceId: 'en_US-lessac-low' }) }))

import { extractZip } from './piper'

describe('Piper archive extraction boundary', () => {
    it.skipIf(process.platform !== 'win32')('extracts a real ZIP through PowerShell Expand-Archive', async () => {
        const root = mkdtempSync(join(tmpdir(), 'npz-piper-zip-test-'))
        const source = join(root, 'source')
        const archive = join(root, 'voice.zip')
        const destination = join(root, 'destination')
        const marker = join(source, 'voice-model.onnx.json')
        const markerText = '{"sample_rate":22050}'
        execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Path '${source}' -Force | Out-Null; Set-Content -LiteralPath '${marker}' -Value '${markerText}'; Compress-Archive -Path '${source}\\*' -DestinationPath '${archive}' -Force`])
        await extractZip(archive, destination)
        expect(existsSync(join(destination, 'voice-model.onnx.json'))).toBe(true)
        expect(readFileSync(join(destination, 'voice-model.onnx.json'), 'utf8').trim()).toBe(markerText)
    })

    it('escapes apostrophes in the actual extraction command path', async () => {
        const root = mkdtempSync(join(tmpdir(), 'npz-piper-quote-test-'))
        const archive = join(root, "voice's.zip")
        const destination = join(root, "destination's")
        writeFileSync(archive, Buffer.from('not-a-real-zip'))
        await expect(extractZip(archive, destination)).rejects.toThrow(/Unzip failed|Expand-Archive|spawn|ENOENT/)
    })
})
