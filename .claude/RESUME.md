# RESUME — where the work stands

**Read this first if you have no memory of the conversation.** The user's next message may
be nothing but the word "continue". This file has to be enough.

Kept current under the **NOTHING IS LOST** rule in `CLAUDE.md`. Update it as part of the
work, not afterwards: before starting anything long, and again when it lands. It lives in
the repo because the container, the assistant's memory and the harness task list all die
with the session — only what is pushed to GitHub survives.

Last updated: **2026-08-07** (after PR #37, the lockfile-test merge).

## The 2026-08-07 round — his screen recording, and what it exposed

He sent a screen recording and a long voice-note. Shipped the same day (#25, #26):
drawtext `expansion=none` (a % in a finance headline killed every build); `safe=true`
plus a no-people/modest-dress clause on scene image prompts (NSFW/irrelevant imagery);
the 402 "add a Claude/OpenAI key" message removed everywhere (PAID FEATURES SLEEP);
a known-dead free service is skipped in the fallback chain; the Actions artifact upload
(435 MB/build vs a 500 MB allowance — his "storage full" emails) now runs only when the
release upload fails. Existing artifacts self-expire by 2026-08-16.

**HE APPROVED ALL TEN ITEMS (2026-08-07, in his own words: "I approve all of your
work").** Build order (dependencies first), each lands as its own small PR:

1. ~~AI switchboard~~ — DONE, #28 (free-online OFF by default; off = never contacted)
2. ~~Gemini + browser doors~~ — DONE, #28 (free AI-Studio key walkthrough; ChatGPT/Grok
   open-in-browser only — NEVER stored passwords, NEVER browser automation)
3. ~~Honesty gate~~ — DONE, #29 (all three builders refuse a mostly-failed video, with
   reasons; fixes the "8-9 empty black videos")
4. ~~Scene-length control~~ — DONE, #30 ("Every scene stays N sec" + per-card override)
5. ~~Delete-everywhere~~ — DONE, #31 (library images: file + backups + entry together;
   the boundary test caught an outside-userData deletion — never weaken it)
6. ~~Expert offline brain~~ — DONE, #32 (Expert prefers Ollama whenever its switch is ON)
7. ~~Music examples~~ — DONE (this branch): musicExamplePlan (pure, tested) + IPC
   music:examples + Video Studio UI ("Make me examples to listen to").
8. Merge Script Writer + Script Pad — THE ONLY ITEM LEFT. UI-heavy; plan: Script
   Writer's generate flow becomes a panel inside Script Pad, one sidebar entry, old
   route redirects.
9. ~~The Caretaker~~ — DONE (this branch): src/main/caretaker.ts + shared/caretaker.ts +
   CaretakerCard in Settings. Replaces the old weekly quiet health check. Busy-check
   injected from main/index (setCaretakerBusyCheck) to avoid the import cycle.
10. Free-video watch — fold into a caretaker note when a candidate service appears;
    nothing reliable exists today (researched 2026-08-07)

Work these in order without asking. Push at every coherent step. Every done item is
already MERGED to main and in the rolling release — nothing in flight is unpushed.

## CI WAS RED FOR NINE MERGES AND I DID NOT LOOK (2026-08-07) — read this before reporting

I merged #28-#34, said "shipped", and only checked the build afterwards. It had been
FAILING since a2f5c80: that commit is a 512-line pure DELETION of the lock file which
removed every `@esbuild/*` platform entry for esbuild 0.28.1 (vitest's copy) while
leaving the 0.21.5 tree intact. Nothing local complains — an existing node_modules never
needs them — but `npm ci` installs strictly from the lock and aborts:

    npm error Missing: @esbuild/win32-x64@0.28.1 from lock file

So nine merges produced NO exes. Fixed in #35 by restoring the complete lock, verified
with `npm ci --dry-run` (773 packages, no missing entries) rather than by eye.

**CLOSED OUT, verified end to end:** the build for the fix commit (`5b3194f`, run
31171239755) concluded `success`. The rolling `latest` release was read back afterwards:
both exes carry the `10:54` timestamp from that run, and all six docs (plus
BACKUP-NOW.cmd) are present and freshly re-uploaded. **It was safe to tell the user to
update at that point**, and he was told so.

A permanent guard against the same class of bug is now merged too: `#37` added
`src/shared/lockfile.test.ts`, which reads `package.json` + `package-lock.json` and
performs the same completeness check `npm ci` does (every optional/hard dependency of
every locked package actually resolves) as a plain `npm test` — no network, runs in this
sandbox. It passed against the restored lock and `npm run lint` + all five typechecks
were clean before merging. Merging #37 produced one more `main` build (`0ba9321`,
run 31195069652) — **check its conclusion before assuming green**, same rule as above.

**THE RULE, restated because I broke it:** "pushed is not shipped" applies to THE RUN,
not just the release assets. Before the word "shipped" is used, read the workflow run's
conclusion for the merge commit. A merge that cannot even install is not a merge that
shipped. If the lock is ever regenerated, check `npm ci --dry-run` in the same breath.

## THE 493-SHOT INCIDENT (2026-08-08, from his screenshot) — fixed on this branch
storyboardFromScript: beat count ignored the target (2 sentences/beat → 493 beats) and
the scaler's per-beat round+clamp let the 2s floor push a "606s" film to 986s real
seconds. Fix: target decides beat count (~6s/shot), largest-remainder distribution sums
to the target EXACTLY. Pinned in src/shared/storyboard.test.ts — do not weaken the
"sums to the requested total EXACTLY" test.

---

## The standing rules that govern every task

Read these in `CLAUDE.md` before doing anything, in this order. They are not background
colour; each was written after something went wrong.

- **THE LAST STEP IS MINE, NOT THE USER'S** — phone + PC + GitHub all brought to one
  version before reporting, without asking. Where a session cannot reach the PC, say so in
  one sentence and change the software so the remainder is one click. Never hand over a
  manual procedure a machine could run.
- **ONE VERSION EVERYWHERE** — five places, and the phone is the one that silently breaks
  the rule because a phone app is cached on the handset.
- **The six documents** — any change touching code, docs or resources updates every one of
  the six that it affects, in the SAME commit.
- **NOTHING IS LOST** — this file, and pushing at every coherent step.
- **The AI features must never delete user work.** This one does not bend.

## Where things stand

**Everything asked for is built, merged and shipped.** `main` is green across five
consecutive builds; the rolling `latest` release carries the two exes and all six
documents, re-uploaded by CI on every build.

Tonight's four merges, newest first:

| PR | What |
|---|---|
| #14 | The NOTHING IS LOST rule and this file |
| #13 | Fixed the update notice that never appeared; added `Settings → Version` |
| #12 | Open with Windows, and update at sign-in |
| #11 | The app installs its own updates; the phone repo publishes itself |
| #10 | Items 18/19/20 — the last three of the twenty-seven |

Health at the last check: **1443 tests passing**, 0 lint errors, five clean typechecks,
`npm run build` succeeds, zero unreachable modules.

Five test files fail in a Linux container and this is **not** a defect: `xlsx` is installed
from a CDN tarball (`package.json` → `https://cdn.sheetjs.com/...`) that the sandbox proxy
blocks. They pass on the Windows CI runner. Do not "fix" them.

## In progress right now

**Nothing.** Everything asked for is built, merged, verified and published.

PR #13's build (`0c4da26`) was verified end to end: every step green, and the release notes
read back to confirm they now carry

```
Build v0.1.1 · 2026-08-01 20:03 · 0c4da26
```

which parses to `2026-08-01 20:03`, so an app stamped earlier will finally see it. The exe
from that run carries the same `20:03` stamp, so updating settles rather than looping.

### A transient worth knowing about before you panic

Mid-run, the release genuinely has **the docs but no exes**, for roughly ten seconds. It is
`gh release upload --clobber` deleting each asset before replacing it, and a 217 MB exe
takes far longer to re-upload than a text file. A read taken in that window shows a download
page with no application on it and the previous build's notes.

This happened during the PR #13 verification and read exactly like a catastrophe. It was
not. **Before reporting missing exes, read the release a second time** — and check whether
the job's final step has actually completed, rather than trusting a step that reports
success while later steps are still running.

Not worth engineering around (the window is short, and the alternative is uploading under
temporary names and renaming), but absolutely worth knowing.

## What the user still has to do, once each, and cannot be done from a container

- **PC:** open the app → the blue notice → **Get the update** → the download page → run
  `NIHILPOINTZERO-OS-setup.exe`. Their badge read `v0.1.1 · 2026-08-01 04:30 · 3354ec9` as
  of 19:50, i.e. they were still on the morning build and had accidentally re-run the stale
  installer from their Desktop folder. After PR #13's build lands, the notice will finally
  appear for them.
- **Phone:** Chrome → `dskjazz.github.io/nihilpointzero-phone` → ⋮ → Add to Home screen.
  Once only; the service worker keeps it current after that. The published Pages site
  cannot be fetched from this sandbox (proxy 403 on `github.io`), so the GitHub API is the
  only available evidence — say which is which rather than claiming the page was seen.

## Corrections that cost real time today — do not repeat them

- **Anthropic is PAID.** Never recommend adding or replacing that key as a fix. The user's
  standing rule: paid features stay inert until he deliberately selects one. A saved key
  for a non-active provider is now not even contacted (`checkPaidKey` returns early).
  I also misread its red health line as a live fault and told him his output quality was
  capped by it. It was not — his active brain is `free`, by choice, and always was.
- **Ollama is local and has no rate limit.** It is slow on a CPU-only machine, not
  throttled. The 429s in his log are the free IMAGE service, which is hosted and unrelated.
- **He asked for identity rotation to evade free-tier limits. That was declined**, and the
  reasoning should hold: it means impersonating many users to take more than the service
  offers. The legitimate substitute is P4 below — honour `Retry-After`, back off with
  jitter, pace requests, cache, and use the free KEYED tiers (AI Horde, Pollinations).

## THE TELEPROMPTER INCIDENT — why the ship guard exists

Committed 04:13, shipped 04:30, and the installed app had **18 tabs where the code had 20**
(no Teleprompter, no Your Channel). `c81405e` is not an ancestor of the shipped `3354ec9`:
the ship ran from a tree that did not contain the work. Nothing failed — the tests passed
because they tested the tree being built, the exe was valid, the badge was honest. Only the
user noticing found it, days later.

`scripts/ship.ps1` now refuses to build when `git rev-list --count HEAD..origin/main` is
non-zero. If that guard is ever removed, this class of bug comes straight back.

## THE STANDING MANDATE (2026-08-02)

He has told me to stop asking and just work: plan, build, test, stress test, fix, and come
back only when it is done, with a detailed report. Work the queue below in order without
checking in. See DO NOT ASK in `CLAUDE.md` for the three narrow exceptions.

## Done in the 2026-08-02 run

| PR | What |
|---|---|
| #23 | **P3 — the YouTube key walkthrough.** The last of the approved four. Also fixed the defect underneath it: five different empty-read reasons all printed one wrong sentence |
| #21 | Backup nudge — his work is on one disk and 8 files already went missing once |
| #20 | Honour `Retry-After` on image 429s (backoff already existed; my earlier diagnosis was wrong) |
| #19 | Rescue a dead brain — switch an EXISTING install off a permanently-refusing provider |
| #18 | Ollama becomes the default brain; PAID FEATURES SLEEP rule |
| #17 | Ship-from-behind guard; local-model timeouts; unused paid keys go quiet |

1649 tests passing, 0 lint errors, five clean typechecks, build green.

### The sandbox now needs one workaround to run the tests at all

`npm ci` FAILS outright in the container: `xlsx` is installed from `https://cdn.sheetjs.com/...`
and the proxy returns 403, which aborts the whole install, leaving no `node_modules`. The
RESUME used to say "five test files fail"; it is worse than that — nothing installs.

What works, and is safe because both files are restored afterwards:

```bash
cp package.json package-lock.json <scratch>/          # keep originals
# delete the xlsx entry from dependencies in BOTH files, then:
npm install --no-audit --no-fund
git checkout package.json package-lock.json           # put them back BEFORE committing
# then, so the typechecks pass, stub the missing module (node_modules is gitignored):
mkdir -p node_modules/xlsx
printf '{"name":"xlsx","version":"0.20.3","main":"index.js","types":"index.d.ts"}' > node_modules/xlsx/package.json
printf 'declare const xlsx: any\nexport = xlsx\n' > node_modules/xlsx/index.d.ts
echo 'module.exports = {}' > node_modules/xlsx/index.js
```

After that: all five typechecks clean, lint clean, and only `src/main/data/psxLive.test.ts`
fails (it needs the real xlsx) plus `src/main/autoBackup.test.ts` when the electron binary
did not download. Neither is a defect; both pass on the Windows runner.

**CI does not run on feature branches** — `windows-build.yml` is `branches: [main]` on
purpose, because Windows runners bill at 2x. A PR with no checks is normal here; the build
only happens after the merge, which is also when the rolling release is refreshed.

## WHAT THE #23 AUDIT PROVED, AND WHY IT IS WORTH REPEATING

After building the walkthrough I ran four independent reviewers over the diff — correctness,
honesty, integration, quota — each told to REFUTE rather than confirm. They found **eighteen
issues in code that already had 49 passing tests, a clean lint and five clean typechecks**.
Three were real bugs that would have reached the user:

- The saved key was not the verified key (cleaning applied to one and not the other), so a
  key pasted with quotes went green and then failed every request afterwards.
- The restricted-key branch could never fire, because Google buries the useful reason in
  `error.details` behind a useless `errors[0].reason: 'forbidden'`. My test passed because
  I had fed it a hand-simplified body instead of Google's real one.
- "Find the gaps" spent 800 quota units — 8% of the free day — running searches whose
  results it was guaranteed to discard.

**The lesson: my own tests confirm what I already believed.** Where a test is built from an
assumed response shape, it certifies the assumption. Use real payloads, and get an
adversarial reader onto anything that classifies an external service's replies.

## BLOCKED FROM THIS SANDBOX — do not attempt blind

**The Piper voice catalogue.** He wants 20-30 voices (British, kids, robotic); only 4 exist
(2 en_US, 2 ur_PK). Adding more is cheap — it is a data table in
`src/main/voice/piperVoices.ts` — BUT every id must be exactly right or the download 404s
on his machine, and `huggingface.co` is unreachable from this container (curl returns 000,
proxy blocked). Adding unverified ids would ship voices that fail to download.

**Do this from a session that can reach huggingface.co**, or verify each id against
`https://huggingface.co/rhasspy/piper-voices/resolve/main/<lang>/<locale>/<name>/<quality>/<id>.onnx.json`
before adding it. Do not guess.

## Approved by the user, NOT yet built

**Nothing.** All four approved items are built and merged.

1. ~~P3 YouTube key walkthrough~~ — done in #23. What it turned into, because the shape
   matters for the next thing like it: the four steps that live inside the user's own
   Google account became one button each landing on the EXACT page, and everything after
   the paste was automated — the key is tested for real before being saved, each Google
   failure is named with the one action that fixes it, and the channel id is looked up
   from the @handle so the buried `UCxxxx` string never has to be found. Underneath it
   was a worse bug: `fetchMyChannelVideos` returned `[]` for no-key, no-channel,
   key-refused, offline AND empty-channel alike, and all three panels printed
   "check the YouTube key and channel ID in Settings" for all five. `readMyChannel()`
   now carries a `ChannelReadProblem` and they are told apart.
2. ~~P4 image backoff~~ — done in #20.
3. ~~P5 backup nudge~~ — done in #21.
4. ~~Dead-brain switch~~ — done in #19. Original note kept for context: **Dead-brain switch notice.** When the active provider refuses permanently (the hosted
   free service returned HTTP 402 twice), say so plainly and move him to Ollama in one
   action. He must never be left pointed at a dead service failing 50 times in silence.
   Partly addressed by defaulting to Ollama, but an EXISTING install keeps its saved
   'free' setting, so the switch still has to happen for him.

## Autopilot — spine built, rest outstanding

`src/shared/autopilot.ts` (planner + approval gate) is done and merged. Still to do:
voice catalogue (only 4 Piper voices exist: 2 en_US, 2 ur_PK — he wants 20-30 incl. British
and kids), per-platform SEO metadata, wiring the planner to the render queue, and
evidence-backed title scoring from `channelLearn`.

**Automatic PUBLIC posting is gated by the platforms, not by our code.** Google locks
API-uploaded videos to private until the app passes verification; TikTok's Content Posting
API is the same until audit. There is no upload code yet at all — `youtube/index.ts` only
opens the browser upload page.

## Offered and awaiting a decision — do not start these unsolicited

Put to the user after PR #12; **no answer yet**. A background task notification is not an
answer.

1. **Wi-Fi-only guard on the sign-in auto-update.** Today it would download ~210 MB over a
   phone hotspot without asking. Ready to build.
2. **A copy of the user's work off the laptop.** Backups exist but the second home is
   likely another folder on the same machine; a dead laptop takes everything.
3. **Publish at the audience's actual peak hour** — join `channelLearn` (which already
   computes when the audience shows up) to the render queue.
4. **Code signing** (`docs/SIGNING.md`, Azure Trusted Signing, ~$10/month, currently off).
   The single biggest remaining source of friction: it is why every install shows "Windows
   protected your PC", and why a fully silent background install can be blocked by Smart
   App Control. **Cannot be started without the user** — it needs their Azure account.

## Traps worth knowing before touching this code

Each of these cost real time at least once.

- **`fileUrl()` must be called in the RENDERER, never in main.** In main it always produces
  `file:///`, which is dead on the phone. `src/shared/mediaUrl.ts` is the only place a disk
  path becomes a playable link.
- **`src/preload` must never import from `src/main`.** The web typecheck enforces it.
- **Five typechecks, not one:** `node`, `web`, `remote` (DOM types, no Node), `phone`,
  `phone-test`. A browser-incompatible import in the remote bridge fails only in `remote`.
- **A module with passing tests that nothing imports is not a feature.** Ten of the
  twenty-seven were finished, correct, and unreachable from the UI. Check the chain to a
  button before calling anything done.
- **`atempo` in the bundled ffmpeg accepts 0.5–100**, not the documented 0.5–2.0 — measured
  against the binary, not assumed. Only the 0.5 floor is enforced.
- **`zoompan` emits `d` frames per INPUT frame**, so feeding it a looped input explodes the
  frame count.
- **Release notes are a contract with the app**, not prose. `src/main/releaseNotes.test.ts`
  guards it; that test exists because the contract broke silently and cost the user an
  evening.

## The failure mode to design against, always

The bug in PR #13 was invisible for hours because the app's response to *"I could not read
that"* was byte-identical to its response to *"you are up to date"*: silence. Nothing
failed, nothing was logged, no test broke — two files simply stopped agreeing.

When adding anything that checks, compares or verifies: make "I could not tell" a distinct,
visible, logged outcome. Never let it render as success.
