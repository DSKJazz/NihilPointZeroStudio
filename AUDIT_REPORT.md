# Static Audit Report — Comprehensive (Option A)

Repository: DSKJazz/NihilPointZeroStudio
Date: 2026-08-08
Auditor: GitHub Copilot Chat Assistant (automated static review)

Scope
- Quick-but-comprehensive static review of main code paths and key files in src/ (main, preload, renderer, remote, phone) and build scripts. Focus on security-sensitive surfaces, data handling, IPC, update flow, and key management.

Files inspected (examples)
- src/main/ipc.ts
- src/main/index.ts
- src/main/remote/registry.ts
- src/main/remote/remote.test.ts
- src/main/selfUpdate.ts
- src/main/store.ts
- src/main/crashReport.ts
- src/main/webserver/page.ts
- src/main/video/captions.ts
- src/main/voice/winNatural.ts
- phone/src/* (phone UI bundle code)

Positive findings (strong practices)
- Explicit IPC design and careful boundaries: registerIpcHandlers + remote registry capture pattern centralises and records handlers (src/main/remote/registry.ts). DENIED_CHANNELS explicitly prevents exposing PC-only dialog handlers to remote callers.
- Atomic file writes everywhere (atomicWrite) reduce risk of truncated JSON and data loss (src/main/store.ts). Good defensive programming.
- Secrets keyed to platform protection: uses Electron safeStorage / DPAPI when available; portable mode documented and intentionally weaker with clear warning (src/main/store.ts, README). The behavior is documented prominently in README.
- Self-update flow is cautious: checks release asset state/size, optional SHA256 verification when GitHub provides it, streaming download with hashing, disk-space guard and final safety check before launching installer (src/main/selfUpdate.ts).
- Crash reporting distinguishes fatal vs non-fatal: uncaughtException treated fatal (with logging + notification); unhandledRejection recorded but non-fatal (src/main/crashReport.ts). This balances stability vs observability.
- Most file operations guard paths to the app data folder and never touch user files outside it (deleteFromLibrary, libraryEntryFiles) — preserves user's originals.
- Remote phone/bridge design deliberate and tested: remote events wrapper, wire format for binary carried through JSON, and end-to-end tests (src/main/remote/*, tests present) improving confidence.
- No usage of eval() discovered and code avoids obvious dynamic code execution patterns. No direct embedding of untrusted script into child processes.

Potential issues & recommendations
1) innerHTML usage in phone/renderer code (XSS risk surface)
   - Context: phone and webserver pages use innerHTML to render dynamic content in many places (phone/src/app.ts, phone/src/scenesUi.ts, src/main/webserver/page.ts). Most uses call a local esc(...) wrapper before interpolating user-sourced strings; however any future code change that adds an interpolation without esc() could introduce XSS in the phone UI or web server pages.
   - Recommendation: prefer textContent (or safe element creation) for user data; where HTML rendering is necessary, centralise sanitisation and add automated tests asserting that every interpolated value is escaped. Add a linter or code review checklist item for any innerHTML usage.

2) Remote IPC surface (phone → PC)
   - Context: handlers are captured and selectively made remote-accessible. DENIED_CHANNELS lists dialog-opening and installer actions. Tests exist to assert refused channels.
   - Recommendation: continue to review the DENIED_CHANNELS list on changes that add new IPC channels. Add a unit test that enumerates all handlers and fails the build if any new handler appears in a deny-list category (e.g. any channel whose name matches patterns like "pick-", "save-dialog", "open-dialog", "reveal" should be denied remotely).

3) Installer execution / spawn of external commands
   - Context: runSelfUpdate launches an external installer. PowerShell scripts are used in Windows voice glue (winNatural). Scripts appear to be constructed from static prelude + controlled inputs, but any future use that injects user-controlled strings into executed commands could be risky.
   - Recommendation: continue to avoid passing untrusted data into shell commands. Where unavoidable, validate/whitelist and escape carefully. Add code comments and unit tests exercising the functions that spawn processes.

4) Portable key storage
   - Context: portable mode intentionally stores keys obfuscated (base64) with explicit warning in README. This is a security trade-off by design.
   - Recommendation: keep the documentation and UI warning; optionally add an automated check that warns at runtime when running in portable mode with keys present (already present in README but an in-app badge might help non-technical users).

5) Update & code signing
   - Context: self-update works; README notes code signing is off and docs exist for signing (docs/SIGNING.md). Running an unsigned installer will trigger Windows warnings.
   - Recommendation: enable code signing in release pipeline when possible; CI should verify release artifact checksums and signatures before making them available.

6) Path normalization / directory checks
   - Context: several path validations compare startsWith(dataDir + sep) after simple normalisation. This is generally fine on Windows but be careful with symlink/junction attacks or mixed slash/backslash forms.
   - Recommendation: when security-critical, resolve realpath (fs.realpathSync) before startsWith checks or add unit tests for path boundary checks across platforms.

Low-risk notes / housekeeping
- Good test coverage exists for many critical modules (remote, crash reporting, backup). Continue to expand tests around update flow, selfUpdate, and remote invocation edge-cases.
- The code has multiple explicit "best-effort" error-handling choices (log and continue), which is reasonable for a desktop creative app — keep these intentional and documented.

Suggested next steps (actionable)
1. Add a linter rule or codeowner review for innerHTML usage; fail CI if innerHTML contains string concatenation without esc().
2. Add an automated test that fails if a new ipcMain.handle() registration that opens a dialog or changes files is exposed to remoteChannels (explicit pattern matching or a deny-list check).
3. Add an e2e test that runs runSelfUpdate flow in dry-run mode with a fake release to assert verifyDownload / hash paths.
4. Consider resolving fs.realpath for any path-based security boundary checks (deleteFromLibrary, audioReadFile) or add unit tests for path traversal and symlink cases.
5. Add a scheduled dependency-scan (OSS/vuln scanner) in CI for npm and native modules.

Conclusion
The repository demonstrates careful, security-aware design with many strong defensive patterns and unit tests covering sensitive areas. The main actionable items are tightening innerHTML usage, continuing careful review of any newly added IPC handlers (especially ones that could surface to the remote phone), and small hardening steps around path normalization and release signing.

If you want, I can:
- Create this file (AUDIT_REPORT.md) in the repository (I will commit it to the repo's default branch). [I will proceed now unless you ask for changes.]
- Open a branch instead (preferred when you want review) and create a PR with the report.

