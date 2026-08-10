# NIHILPOINTZERO-OS — Setup Guide

Two ways to get the studio running. **Most people want Part 1** (two minutes, no
technical steps). Part 2 is for setting up the source code on a new machine so you can
build the app yourself.

---

# PART 1 — Just run the app (no installation knowledge needed)

## Option A — Install it (recommended for your main PC)

1. Go to the download page:
   **https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest**
2. Download **`NIHILPOINTZERO-OS-setup.exe`**.
3. Double-click it. If Windows shows *"Windows protected your PC"*, click
   **More info → Run anyway** (the app isn't code-signed yet — a certificate costs money).
4. It installs in a few seconds and adds a Desktop shortcut. Open it and you're done.

## Option B — Portable (USB / no installation)

1. Download **`NIHILPOINTZERO-OS-portable.exe`** from the same page.
2. Put it in any folder — a USB stick, an external drive, anywhere.
3. Double-click to run. First launch takes ~60–90 seconds while it unpacks; later
   launches are faster.
4. Your work is saved in a `nihilpointzero-data` folder **next to the exe**, so the exe
   plus that folder is your whole studio — copy both to move machines.

### Moving between computers (USB / CD)

- **USB / external drive:** copy the portable exe **and** its `nihilpointzero-data`
  folder. Everything — videos, scripts, settings, even API keys — travels with it.
- **CD/DVD:** a disc is *read-only*, and the app needs to write your work. So:
  burn the exe to the disc for transport, then **copy it off the disc onto the new PC's
  hard disk or a USB stick before running it.** Running directly from a CD will fail to save.
- **Installed vs portable on the same PC:** they share the same data folder, so your
  work appears in both.

## First-run setup (2 minutes, optional but recommended)

1. Open **Settings** (bottom of the left sidebar).
2. **AI brain** — nothing to do. (Want Google's Gemini as a brain? **Settings →
   Connect Gemini** walks you to a genuinely free key in about two minutes — optional.) The app runs on the local, free brain (Ollama) and
   falls back to a free keyless online service. Both are free and stay that way. The
   paid options (Claude, OpenAI) are present but asleep: they are never contacted and
   never chosen for you, and you only wake one by deliberately selecting it yourself.
3. **Connect YouTube** — free, about three minutes, and Google never asks for a card.
   Press **Show me how** and follow the five numbered steps; each has a button that
   opens the exact page, so nothing has to be found by hunting. Paste the key, press
   **Check**, and the app really tries it and tells you in plain English whether it
   works — and if it does not, which step fixes it. Then type your **@name** and it
   finds your channel ID for you.

   This is worth doing: without it the **Your channel** tab, the questions mined from
   your comments, and the competitor gaps all read nothing at all.
4. Other optional free keys: **AI Horde key** (faster "put me in the scene" photo
   generation — a shared key is already built in, so this is only if you want your own).
5. **Natural voice** — install the offline Piper voice when prompted for human-sounding
   narration that works with no internet.

> **If answers ever feel dumb:** open the **Activity Log** tab, then **Settings → Setup
> Health**, which runs a real test of each service and names the actual cause. It will
> never tell you to buy anything: the free and local paths are the ones that are meant
> to work, and if one of them is failing that is what gets fixed.

## Updating later

**Normally: you do nothing at all.**

### First, how to check where you stand

**Settings → the Version box at the top.** It says one of three things: you are up to
date, a newer one exists, or it could not check just now. It also shows the version you
are running beside the newest published one, and there is a **Check now** button.

If it says it could not check, that means exactly that — it will never tell you that you
are up to date when it did not manage to look.

### It opens with Windows, and updates itself then

The studio opens by itself when you turn the laptop on. That moment is chosen on purpose —
nobody is waiting for the app and nothing is running — so that is when it quietly installs
anything new. You sit down to the newest version having pressed nothing.

It will not do this while a render or a queue is running, and it will not do it to a
launch you made yourself (then you get the notice below and you choose). If the download
finishes and by then you have started working, it holds the installer back instead of
closing on you.

Off switch: **Settings → "Open the studio when Windows starts"**.

One honest limit: while the app is *closed*, nothing can update it — no part of it is
running to do the work. Opening it at sign-in is exactly how that gap is closed.

### The one-button update, if you'd rather do it yourself

Open the app. If a newer version has been published, a blue notice appears at the
bottom of the window: *"A newer version of the app exists"*. Press **Get the update**.

That is the whole thing. The app downloads the update itself — you will see a progress
bar — checks that the file really is the one GitHub published, starts it, and closes so
the update can finish. Windows will ask you once whether to allow it; say **yes**, or
click **More info → Run anyway** if you get the blue "Windows protected your PC" box.
The app then reopens, updated.

You do not open a web page. You do not go into Downloads. You do not need File Explorer.
If the download gets interrupted, press the button again — it keeps what it already got
rather than starting over.

If it cannot download for some reason, it tells you why in that same notice and then
offers to show you the setup file instead, so the button never just does nothing.

### Also updating the code folder — one double-click (needs the code folder)

If you have the `NihilPointZeroStudio-workshop` folder on your PC, open it and
double-click **`UPDATE-MY-STUDIO.cmd`**.

That is the whole procedure. It gets the newest code, installs whatever that code
needs, builds the app, copies it into your Desktop studio folder, updates the
installed app, and pushes to GitHub. It takes five to ten minutes and you can walk
away. If anything goes wrong it stops and says so in plain words rather than
half-updating — and it never goes near your `nihilpointzero-data` folder, so your
videos, scripts and settings are not at risk either way.

When it finishes it will tell you to run `NIHILPOINTZERO-OS-setup.exe` once. Do that.

### The other way — download the finished app

If you do NOT have the code folder, or the easy way will not run, just download the
already-built app:

1. Go to **https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest**
2. Under **Assets**, click **NIHILPOINTZERO-OS-setup.exe** — it downloads.
3. Open your Downloads folder and double-click it.

It updates in place and keeps all your work. That page is rebuilt automatically every
time the code changes, so what you download there is always current — you never have
to check whether it is the newest one.

### Confirming you are actually current

Open the app and look at **Settings → What changed**. It lists what is new in the
build you are *running*, and it deliberately withholds anything that is not in it —
so it can never send you looking for a button that is not there yet.

The gold badge in the sidebar (under "OS") shows the exact build. It always matches
the `## Build:` line at the top of `MEGA-DIAGNOSTIC-REPORT.md`.

## System requirements

Windows 10/11 64-bit · ~2 GB free disk (plus room for videos) · internet for AI features
(video rendering, editing and the offline voice work without it).

---

# PART 2 — Build from source (developers)

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Windows | 10/11 x64 | The build targets Windows only |
| Node.js | **22 LTS or newer** | `node -v` to check |
| npm | 10+ | Ships with Node |
| Git | any recent | For cloning |

## Clone, install, run

```bash
git clone https://github.com/DSKJazz/NihilPointZeroStudio.git
cd NihilPointZeroStudio
npm install
npm run dev
```

`npm install` takes several minutes the first time (Electron + native modules). `npm run
dev` opens the app with hot reload.

## The commands you'll actually use

| Command | What it does |
|---|---|
| `npm run dev` | Run the app in development with hot reload |
| `npm test` | Run the full test suite (must be green before shipping) |
| `npm run lint` | ESLint over `src` |
| `npm run dist:win` | Build the portable exe + installer into `release\` |
| `npm run ship` | **The one that matters:** test → build → copy to the Desktop studio folder → push to GitHub → refresh the GitHub download page |

### Optional live tests

Most tests are offline. To also verify real AI image generation over the internet:

```bash
set NPZ_LIVE=1 && npm test
```

## Project layout

```
src/main/       Everything that does real work (Electron main process)
  agent/        The Producer — plans and runs validated actions
  analysis/     Finance math: SMA, RSI, correlation, backtests, PDF/XLSX parsing
  video/        Rendering: storyboard, timeline, graft, thumbnails (bundled ffmpeg)
  scene/ image/ Scene planning + free AI image generation
  speech/ voice/ Offline Whisper speech-to-text + Piper natural voice
  llm/          AI providers (Anthropic, OpenAI, Ollama, free Pollinations) + fallback chain
  appGuide.ts   The in-app assistant's manual of every tab
  store.ts      All persistence (settings, library, videos, activity log)
  ipc.ts        The bridge the UI calls into
src/renderer/   The React UI (pages/ = one file per tab)
src/preload/    The secure bridge between UI and main
src/shared/     Types and IPC channel names used by both sides
docs/           The four plain-English user documents
scripts/ship.ps1  The ship pipeline
```

## Troubleshooting the build

| Symptom | Cause & fix |
|---|---|
| `spawn UNKNOWN` during build | Your antivirus quarantined `makensis.exe` (a known NSIS false positive). The ship script now detects and self-heals this, but the real fix is an **antivirus exclusion** for `%LOCALAPPDATA%\electron-builder\Cache`. |
| `Can't open output file` | Antivirus is holding the previous exe open. Add an exclusion for the repo's `release\` folder too, then re-run. |
| `npm error ENOENT ... package.json` | You're in the wrong folder — `cd` into the repo first. |
| Native module errors after a Node upgrade | `rm -rf node_modules && npm install` |
| GitHub upload step fails | Run any `git push` once so Windows stores your GitHub credential, then re-ship. |

## Data locations

- **Installed app:** `%APPDATA%\finscript-studio` — unless a
  `Desktop\NihilPointZeroStudio\nihilpointzero-data` folder exists, which it adopts instead.
- **Portable app:** `nihilpointzero-data` next to the exe.
- Never edit these by hand while the app is running; everything is written atomically.
