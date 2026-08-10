# NIHILPOINTZERO-OS (NihilPointZero Studio)

Desktop studio for planning, writing, and producing YouTube finance & economics
content in Roman Urdu / Urdu / English — institutional-grade tone.

---

## 📥 Download the app

**Everything is on the [Downloads page](https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest)** — or use these direct links:

| I want to… | Download this | What it does |
|---|---|---|
| **Install it on a PC** (recommended) | [**NIHILPOINTZERO-OS-setup.exe**](https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest/download/NIHILPOINTZERO-OS-setup.exe) | Normal Windows installer. Creates a Start-menu entry and desktop shortcut. ~207 MB |
| **Run it on a PC without installing** (USB stick, borrowed PC) | [**NIHILPOINTZERO-OS-portable.exe**](https://github.com/DSKJazz/NihilPointZeroStudio/releases/latest/download/NIHILPOINTZERO-OS-portable.exe) | One file, no installation. Keeps its data in a `nihilpointzero-data` folder next to itself. ~207 MB |

The guide, cheatsheet, and how-to documents are also attached on the Downloads page — those are small and readable on a phone.

> **📖 New here, or setting up on a new machine? Read [SETUP_GUIDE.md](SETUP_GUIDE.md).**
> Step-by-step: install or run portable, move it by USB or CD, first-run settings, and a
> full developer section for building from source (prerequisites, commands, troubleshooting).

### ⚠️ Read this first

- **This is a Windows program.** It runs on Windows PCs and laptops only.
  A phone or tablet can *download and store* the file (for example to carry it
  to a PC later), but **cannot run it**.
- **You must be signed in to GitHub** to download — this is a private
  repository, so the links only work for your account.
- **On a new PC, Windows may show "Windows protected your PC."** That's
  because the app isn't code-signed yet. Click **More info → Run anyway**.
- **Portable copies store API keys with weaker protection** (see below) —
  only keep keys on portable copies you physically control.

---

## What it does

- **Ideas & Trends**: generates video ideas scored for view potential, with reasoning, competition level, and content pillars.
- **Script Writer**: writes full long-form scripts (short/long/deep-dive), with adjustable Roman Urdu/English mix, structured as hook → context → analysis → counterpoint → takeaway → outro.
- **Video production**: scene planning, narration, and rendering via bundled ffmpeg — plus offline speech-to-text.
- **Library**: saves ideas and scripts locally, browsable and exportable.
- **Settings**: swap between Claude and OpenAI, change models, manage keys.

## First-time setup (API key)

1. Get a key from [console.anthropic.com](https://console.anthropic.com) (Claude, recommended) or [platform.openai.com](https://platform.openai.com) (OpenAI).
2. Open the app → **Settings** → paste the key → **Save Key**.
3. Pick that provider as "Active provider".

Keys are stored only in your local user data folder and never sent anywhere except directly to the provider you chose. **Installed builds** encrypt them at rest via Windows DPAPI (Electron's `safeStorage`). **Portable mode is different by design**: DPAPI blobs can't move between PCs, so a portable copy stores keys base64-obfuscated (NOT encrypted) in `nihilpointzero-data\settings.json` next to the exe — anyone who can read that folder (shared USB, synced drive) can recover them. Only store keys on a portable copy you physically control.

---

## For development

```
npm run dev        # run with hot reload
npm run test       # tests
npm run dist:win   # build installer + portable exe -> release\
npm run ship       # test, build, deploy to Desktop studio, push, update release downloads
```

### Upgrade paths (by design)

- **Real trend data**: `src/main/trends/index.ts` is the only place that needs to change to swap the current LLM-reasoning trend source for a real YouTube Data API / Google Trends client — nothing else in the app depends on how trends are fetched.
- **New LLM provider**: implement the `LLMProvider` interface in `src/main/llm/` (see `anthropic.ts` / `openai.ts`) and register it in `src/main/llm/index.ts`.
- **Richer storage**: `src/main/store.ts` currently persists to flat JSON files; swap its internals for SQLite later without touching IPC or renderer code, since callers only see the exported functions.
