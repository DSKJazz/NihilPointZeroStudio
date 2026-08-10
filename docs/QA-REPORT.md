# QA REPORT — NIHILPOINTZERO-OS (2026-07-31)

_What was tested, how it was tested, what broke, what got fixed, and what genuinely
cannot be fixed. Written to be re-checkable: every claim here comes from an actual
run, not from reading code and hoping._

## Current release hardening (2026-08-08)

The release process is now hardened so the latest shipped build carries a current changelog,
CI validation, and the same documentation set across the workshop, Desktop studio folder,
and GitHub release assets. The repository now includes:

- `CHANGELOG.md` for the current shipped build summary.
- `scripts/update-changelog.mjs` and `npm run changelog:update` for refreshing the changelog.
- `.github/workflows/ci.yml` for push/PR validation.
- Updated GitHub release uploads so the changelog and QA notes travel with the build.

## How the testing works now (the part that outlives this report)

The app is tested by a machine, not by promises. A hard gate in the ship pipeline
(`npm run test:e2e`) launches the REAL built app in an isolated throwaway data home
(it can never touch your work), and:

- opens **every tab** — Today, Ideas & Trends, AI Command, Scene Studio, Script
  Writer, Script Pad, Video Studio, Storyboard Director, Presenter Studio, Recorder,
  Timeline Editor, Charts, Live PSX Data, NCCPL Analysis, Advisor, Library,
  Activity Log, Settings — and verifies each renders alive (headline present, real
  content, working controls, no crash screen);
- **builds a real video by clicking the UI** (paste script → Style presets →
  🎬 Build Video → a finished, playable video appears), fully offline;
- **renders a storyboard film AND re-renders it in the Timeline editor** — a guided
  one-shot storyboard with a photo subject is seeded the way the app itself saves
  drafts, a shot is added and deleted through the real confirm dialog, the film is
  rendered, opened in Timeline, and rendered AGAIN there — both pipelines proven
  end-to-end on every ship;
- hammers the edge cases below.

If ANY check fails, the ship stops. 471 unit tests (math, ffmpeg graphs, engines,
fallbacks) run before it. This gate exists because unit tests alone let dead buttons
reach you.

## Edge cases exercised (all passing)

| Case | What happens (verified by the machine) |
|---|---|
| Empty input | 🎬 Build stays **clickable** and explains itself: a standing hint says script words are needed, clicking highlights the script box and toasts the reason, and no build starts. (It used to sit silently disabled with a ⊘ cursor — a real user read that as "the app is broken", twice. Dead-looking buttons are treated as bugs now.) |
| Roman Urdu + Urdu script + emoji script | Builds **to completion**; the finished video appears (UTF-8 through narration, layout, encoding) |
| Huge script (~15,000 characters) | Build starts normally; UI stays responsive |
| Rapid double-click on Build | Second click is harmless — no double build, no crash |
| ⏹ Stop mid-build | Build stops, UI recovers, Build becomes usable again within seconds |
| Typed work + tab switching | Autosave keeps it — leaving and returning restores the text |
| Tab crash (any tab) | Contained by the crash guard: plain-English message, "Try this tab again", rest of app usable, failure logged to Settings → Known Issues |
| Free service down/busy | Falls back per scene/feature with the reason in the build log and ai-errors.log (verified live against real 429/402/401 outages this week) |

## Broken and NOW FIXED (this week, each verified by a real run)

- **~15 GB of finished videos were invisible inside the app** (found 2026-08-01 by
  auditing the real machine, not by reading code). Two separate causes: ~14 GB sat in
  the active work folder but were missing from the app's video list, and 1.15 GB sat
  in a data folder the app had stopped using. Nothing in the app had ever mentioned
  either. Fixed by a detector that runs on every launch, reports both cases in
  Settings and the Activity Log, and recovers them with one button — listing in-place
  files instantly and COPYING (never moving) anything from another folder. 0-byte
  files from interrupted builds are deliberately excluded.

- **"Put me in the photo → Regenerate → error" (user-reported, twice)** — root cause
  found and pinned by tests: pressing ⏹ Stop on any build left a global "cancelled"
  flag on until the NEXT build began; the photo-scene's final conversion step saw the
  stale flag and died with "Render cancelled by user", forever. A Stop now lives and
  dies with the run it stopped (`cancelLifecycle.test.ts`). Also fixed on the same
  path: moved/renamed photos now say so plainly (no raw ENOENT), 6–12MB phone photos
  are auto-shrunk before upload (the free service rejects huge posts), and a failed
  regenerate now shows its reason in red on the scene card instead of hiding behind
  the previous image.
- **"Build Video won't click" (user-reported, twice)** — the button sat silently
  disabled with a ⊘ cursor whenever the script box was empty (including after picking
  an empty saved script), with zero explanation. The previous "fix" made that silence
  deliberate — wrong call, now reversed: the button is never silently disabled; it
  explains, points at the script box, and refuses to build. The gate now FAILS any
  silently-dead Build button.

- **The gate's own wait-timeouts were silently ignored** — every long wait passed its
  timeout in the wrong argument slot (playwright's `waitForFunction(fn, arg, options)`),
  so all of them ran on the 30s default. Found the moment a genuinely longer render
  (the new storyboard step) was added; every call site fixed. The gate now truly waits
  as long as it claims.
- **Backups had never been restored from** — restore didn't exist. Now it does
  (Settings → Backups), it is non-destructive by construction (only copies what is
  missing), and a unit "restore drill" runs on every ship: back up real files →
  delete one → restore → byte-identical, secrets excluded, purge stays inside the
  backup tree.

- **"Get the update" looked dead** — its only effect was an Explorer window that
  opened BEHIND the app, with zero feedback. Now: one click **restarts straight onto
  the already-updated code** (the ship swaps it in place); on machines where that
  doesn't apply it falls back to revealing the installer/download page **and says so
  in the banner**.
- **Update checks could silently fail when the GitHub release notes did not include
  the expected build stamp**. The app now falls back to the release tag and published
  timestamp, so the Settings page can still tell whether the installed app is current.
- **Updates were being blocked by Windows Smart App Control** — every new unsigned
  installer is an unknown file to Windows. Ships now update the installed app in
  place; nothing new for Windows to judge.
- **A crashed tab used to blank the whole app** — now contained per tab, logged.
- **Free-cloud video tier was unusable here** (Puter rejects Pakistani phone
  numbers) — added the Pollinations key route (no phone); found and fixed the
  Test-key button rejecting valid sk_ keys; keys stored encrypted.
- **Video engine correctness bugs caught before shipping** by adversarial review +
  the gate: motion clips routed through the wrong renderer path, wrong 9:16
  generation size, Stop surfacing as a failure instead of a cancel, a text-encoding
  corruption, missing network timeouts.
- **Urdu/Roman-Urdu scripts fell through to generic music** — the mood matcher now
  understands both (tested), links to matching category pages on the free libraries,
  and tells the built-in music maker which mood fits.
- **The engine choice reset on every visit** — now remembered.

## Cannot be fixed, and why (the honest list)

- **Local AI motion video / talking-photo models** — this PC has Intel graphics
  built into the processor; these models need a dedicated NVIDIA card. Not slowly —
  not at all. Everything is pre-wired and unlocks the day the hardware exists.
  Workaround today: the free-cloud tier or the photo slideshow.
- **Free cloud services having a bad hour** — Pollinations/Puter/image services can
  rate-limit or change terms at any time (it happened twice this week, live). No
  code prevents that; the app's job — done — is to fall back visibly, never break,
  and log the reason. Also: cloud video spends allowance credits (Pollen), and
  Pollinations' video currently requires more wallet balance than starter quests
  grant — real options: their contribution bounties (free), a small top-up (paid,
  user's choice), or waiting for more quests.
- **Unsigned-app warnings on NEW machines** — until code signing is purchased
  (documented in docs/SIGNING.md), Windows will warn on first run. In-place updates
  sidestep this on an already-approved machine.

## Flagged (found, deliberately not silently "fixed")

- Pexels stock support is half-plumbed (storage/IPC exist; no search, no UI) —
  needs a decision: finish it or remove it.
- The phone webserver exposes a `/api/library` endpoint no page uses — leftover or
  future feature; needs a decision.
- ~~The one manual backup in the Desktop `archive` folder (July 19, 2.1 GB)~~ —
  resolved 2026-07-31: its 16 unique files were preserved into the backup folder,
  then the archive was deleted with the user's explicit approval.

_Regenerate this confidence at any time: `npm run test` then `npm run test:e2e` —
or just ship, which runs both and refuses to proceed on any failure._

## Phase 8 pre-push notes (automated) - 2026-08-10T02:12:00Z
- Final history secret scan performed: no matches for private-key, Google API or AWS access key patterns across git history (see history_*.txt outputs).
- Working-tree pattern scan (tracked files) still shows token-shaped placeholders only in docs and tests (intended fixtures). Recommend manual human review of scripts/ship.ps1 and any test fixtures before push. No push performed � awaiting explicit approval per Phase 8 gate.

