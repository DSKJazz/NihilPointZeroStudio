# QA Progress — resumable checklist

- [FIXED] Recovery: restore clean working copy from GitHub and fix merge-corruption parse errors (branch: ci/fix-main-parse-errors). Tests and build verified locally.
- [PASSED] Create UPDATE-NOW.cmd to automate pulling, installing, building, and summarizing artifacts. (This file was added.)
- [PASSED] Background update scheduler: periodic silent update check added (every 4 hours) that downloads and defers install when work is in progress.
- [PASSED] Integrate electron-updater for silent installed updates (Part 0C). Implemented electron-updater (autoUpdater) for packaged installs: checks on startup and every 4 hours, auto-downloads and installs on quit, and logs events to the activity log. (See src/main/autoUpdater.ts)
- [PASSED] Update electron-builder publish block to use per-release version tags and auto-generate metadata (latest.yml). Added a publish block to electron-builder.yml pointing at GitHub Releases; the ship pipeline should create per-build tags/releases so update metadata (latest.yml) is published. This requires the ship/release process to create a versioned GitHub Release (vX.Y.Z) for electron-updater to see it.
- [PASSED] Implement portable update flow (download new exe, prompt user to replace) and logging for update checks. The existing selfUpdate download path remains and is used for portable scenarios; it now coexists with electron-updater for installed apps. The portable UX (download-only + user replace) still applies and is logged by selfUpdate.
- [IN PROGRESS] E2E UI click-through: scripts/e2e-smoke.mjs was made more tolerant of slow startups and now emits richer diagnostics. The ship gate script (scripts/ship.ps1) was updated to retry the E2E smoke up to 2 times and collect diagnostics on failure. The GitHub ship workflow was updated to prefer a self-hosted Windows runner for the ship job to avoid Playwright injecting debugger flags on hosted runners. Local E2E still timed out when Playwright injected --inspect; the harness now detects and logs this. Further verification pending once a self-hosted Windows runner is available.
- [NOT STARTED] Full QA mapping: inventory every screen/tab and create per-item checklist.
- [NOT STARTED] E2E harness hardening (scripts/e2e-smoke.mjs) and storyboard probe (scripts/e2e-storyboard-probe.mjs).
- [NOT STARTED] Full E2E run and capture logs.
- [NOT STARTED] Ship: run `npm run ship` locally to build, copy to Desktop studio, and update installed app.

Notes:
- Branch: ci/fix-main-parse-errors. Local verification steps completed: `npm ci`, `npm run lint`, `npm run build`, `npm test` (all unit tests passed).
- The next automated change will be the updater script and initial electron-updater integration. Each step will be committed and pushed so progress survives session interruptions.
# QA Progress

This file is the resumable source of truth for the runtime-aware generation and cross-studio handoff batch.

- [x] Preserve duration-aware script and storyboard prompt contracts.
- [x] Preserve creator/style instructions through storyboard planning and autosave.
- [x] Add Pakistan-specific, narration-relevant visual prompting.
- [x] Add multi-file analysis imports and partial-error handling.
- [x] Connect Script, Storyboard, Scene, and Video Studio draft handoffs.
- [x] Run the full Vitest suite.
- [x] Run the production build.
- [x] Run lint with zero errors.
- [ ] Run a clean Windows E2E click-through without debugger injection.
- [ ] Push the dedicated branch and monitor CI.
- [ ] Merge the reviewed branch and run release packaging before the next release.

## Current Session Notes

- Branch: `chore/runtime-aware-generation-handoffs`
- The stale `NihilPointZeroStudio-workshop` copy was confirmed to contain no unique commits or untracked files and was archived outside the repository.
- Audit exports and local history-scan artifacts were moved outside the repository and their paths are ignored.
- Lint has zero errors; existing React hook and explicit-`any` warnings remain as non-blocking cleanup debt.
