# QA Progress — resumable checklist

- [FIXED] Recovery: restore clean working copy from GitHub and fix merge-corruption parse errors (branch: ci/fix-main-parse-errors). Tests and build verified locally.
- [IN PROGRESS] Create UPDATE-NOW.cmd to automate pulling, installing, building, and summarizing artifacts. (This file added in current commit.)
- [NOT STARTED] Integrate electron-updater for silent installed updates (Part 0C).
- [NOT STARTED] Update electron-builder publish block to use per-release version tags and auto-generate metadata (latest.yml).
- [NOT STARTED] Implement portable update flow (download new exe, prompt user to replace) and logging for update checks.
- [NOT STARTED] Full QA mapping: inventory every screen/tab and create per-item checklist.
- [NOT STARTED] E2E harness hardening (scripts/e2e-smoke.mjs) and storyboard probe (scripts/e2e-storyboard-probe.mjs).
- [NOT STARTED] Full E2E run and capture logs.
- [NOT STARTED] Ship: run `npm run ship` locally to build, copy to Desktop studio, and update installed app.

Notes:
- Branch: ci/fix-main-parse-errors. Local verification steps completed: `npm ci`, `npm run lint`, `npm run build`, `npm test` (all unit tests passed).
- The next automated change will be the updater script and initial electron-updater integration. Each step will be committed and pushed so progress survives session interruptions.
