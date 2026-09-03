# Dependency Security

## Current status

The Vite and esbuild advisories were remediated by upgrading to the compatible
`electron-vite` 5 and Vite 7 toolchain. The remaining `npm audit` result is four
high-severity findings in the local speech-to-text native dependency chain:

- `@huggingface/transformers@4.2.0`
- `onnxruntime-node@1.24.3` -> `adm-zip@0.5.18`
- `sharp@0.34.5`

`npm audit` currently reports no automated fix for these findings. The project
uses this chain for offline Whisper speech transcription in
`src/main/speech/index.ts`, so removing or forcing newer native packages would
risk breaking a supported feature. Do not run `npm audit fix --force` for this
repo without testing the speech workflow and native packaging.

Recheck with:

```powershell
npm audit --omit=optional --audit-level=high
```

Revisit this exception when `@huggingface/transformers` or its native runtime
publishes compatible versions that resolve `adm-zip` to `0.6.0` or newer and
`sharp` to `0.35.0` or newer. The advisory status should then be revalidated
with a clean install, production build, test suite, and speech smoke test.
