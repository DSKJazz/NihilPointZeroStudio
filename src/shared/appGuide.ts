/**
 * THE APP MANUAL the on-every-tab Producer assistant answers "how do I…?" questions
 * from. Written in plain English, tab by tab, workflow by workflow — so the assistant
 * gives exact, truthful click-paths instead of generic guesses. Keep this in sync when
 * tabs or flows change (same rule as the user docs).
 */
export const APP_GUIDE = `
NIHILPOINTZERO STUDIO — TAB-BY-TAB MANUAL (what each tab does and how to use it)

SIDEBAR (left edge, top to bottom): 🏠 Today · Ideas & Trends · ✦ AI Command · 🎬 Scene Studio ·
Script Writer · Script Pad · Video Studio · 🎞 Storyboard Director · 🎥 Presenter Studio ·
⏺ Recorder · ✂ Timeline Editor · Charts · 📈 Live PSX Data · 🏦 NCCPL Analysis · Advisor ·
Library · Activity Log · Settings. The gold badge under "OS" shows the build version.

TWO HELPERS FLOAT ON EVERY TAB:
• 🎬 PRODUCER (bottom-RIGHT) — the growth strategist: hooks, titles, retention advice, rewrites
  your current script/title (you approve with Apply), and "Do it" action plans (approve with Run).
• 🧭 EXPERT (bottom-LEFT, next to the sidebar) — the app's dedicated guide (separate from the
  Producer): ask ANYTHING about
  the software in ANY format — bullet points, step-wise, precise clicks, fully detailed, or
  brief (chips at the top, or just ask in your own words). Under each answer, "⚡ Execute
  these steps" turns the explanation into a validated action plan; its Execute mode takes
  orders you write yourself. Nothing runs until the user clicks Run; nothing can be deleted.
  When an Expert answer mentions a tab, "→ Open <tab>" chips appear under it — one click
  jumps straight to that tab.

WHERE WORK IS KEPT: the folder is decided ONCE and pinned to a small record file, so the
app can never quietly move house between launches (that is what made ~15 GB of videos
invisible on 2026-08-01). An unreachable pinned folder is reported in plain English —
never treated as "no work". A portable exe still always uses the data beside it.
Settings names the exact data folder in use. The app supports three
(portable folder next to the exe / adopted Desktop studio folder / the default per-user
folder), and work created while one was active becomes invisible when another takes over —
so the app now scans the others for finished videos, reports them in Settings and the
Activity Log, and offers a one-click COPY-them-in ("Bring them into the app"). It never
moves or deletes the originals.

OTHER GLOBAL FEATURES: on startup the app quietly checks for a newer published version and
shows a small blue notice with a "Get the update" button (opens the studio folder with
NIHILPOINTZERO-OS-setup.exe selected, or the download page if that copy is old). Backups live
in C:\\Users\\<you>\\NihilPointZero-Backups: the app backs up all user work there automatically
at most once every 7 days (BACKUP-NOW.cmd in the Desktop studio folder does the same by hand),
copy-only. Settings -> Backups has: Back up now, Restore missing files (non-destructive — only
brings back what is missing, never overwrites), an optional SECOND backup home (USB/other disk),
delete-sync (on by default: permanently deleting in the app also removes the backup copy, so
deleted means gone for good), and a ghost cleaner for pre-delete-sync leftovers. A quiet weekly
self-check also runs; if it finds real problems, a red dot appears on Settings in the sidebar
and a line lands in the Activity Log.

POSTING TEXT: in Video Studio, every video has "🏷 Posting text · YouTube / TikTok" — one click
writes a click-worthy title, a short description and hashtags for THAT clip, each with a Copy
button. Best used right after "📱 Cut into vertical shorts" so uploading is copy-paste.

• 🏠 TODAY — the landing screen (first item in the sidebar). Shows your latest videos, what
  happened recently, and one-click cards to start the usual jobs. Read-only: everything on
  it is a link, so it can't change anything.
• IDEAS & TRENDS — generate video ideas with trend/YouTube signals. Each idea has a hook,
  angle, and view-potential score. Save good ones to the Library.
• ✦ AI COMMAND — type what you want in plain words ("write a 1-minute script about gold
  and build it in 1080p"); it plans validated steps and runs them after you approve. It
  can create scripts, videos, thumbnails, images, music, ideas, PSX analysis and scenes —
  it can never delete anything. The "📦 Batch" section (one topic per line) makes many
  videos at once; ticking "🌙 Overnight plan" also cuts Shorts and writes posting text for
  every video — pick topics before bed, wake up to publish-ready material, not just raw
  builds. One failure never stops the rest.
• 🎬 SCENE STUDIO — paste/write a script (use [SECTION HEADERS] or [bracketed shot
  directions]), click "Plan scenes", then "▶ Generate all scenes". Failed scenes retry
  automatically. Each scene: edit its prompt, "↻ Regenerate", "⬇ Save" the image, or
  "📎 Put me in (photo)" to base the scene on your own photo. "⬇ Save all images" exports
  the whole storyboard numbered. NEW per scene: "⏱ Stays … sec" (how long the image is on
  screen) and "✨ Arrives by" (cut/fade/dissolve/slides/circle) — empty = automatic pacing;
  set them and every image shows once, in order, at your pace, always fitted to the
  narration. The VIDEO SETTINGS row above the scenes holds Style · Video look ·
  Resolution · Format · Look. A failed regenerate shows its reason in red on the card.
  "🎬 Build video" merges the scenes AND narrates the
  script; when done, buttons take you to Video Studio or the Timeline Editor. Builds keep
  running if you switch tabs — the finished video lands in Video Studio, and the Activity
  Log records started/finished/failed.
• SCRIPT WRITER — full script generation for the finance niche; can fetch real PSX data
  (paste a dps.psx.com.pk link) to ground the script in real numbers.
• SCRIPT PAD — a scratchpad for drafting; other tabs (Scene Studio, Video Studio) can
  pull from it with their "Use Script Pad" buttons.
• VIDEO STUDIO — the main builder: script → narrated video. Choose narration voice: your
  own recording, ★ Windows natural voice (free, offline, includes real Urdu — Asad/Uzma —
  once installed via Windows' own Speech settings, one click from this picker), Natural
  voice (Piper — free, offline, own downloadable voices including two real Urdu neural
  voices, picked and installed in Settings), or the robotic built-in Windows voice. Visual
  engine (AI visuals is the free default), Look (clean/news/cinematic/bold), style,
  resolution up to 8K, format 16:9 / 9:16 / 1:1, background music, captions (.srt or
  burned-in), and export/save-as. Built videos are listed here. The AI Director (in this
  tab) takes plain-word instructions about cutting/keeping parts or adding music/SFX.
  Every video in the list also has "📱 Make Shorts": pick how many, click, and the app
  listens to the video offline, picks the strongest moments (hooks, numbers, questions),
  and cuts vertical 9:16 clips with big burned-in captions — ready for YouTube Shorts /
  TikTok / Reels. The clips appear in the same list, and it explains WHY it picked each
  moment. "🏷 Posting text" (YouTube/TikTok) writes a ready-to-paste title, description
  and hashtags for any video or short, with Copy buttons — and "▶ Publish to YouTube" now
  uses this SAME engine automatically (Shorts get Shorts-appropriate text), copies it to
  the clipboard, and opens the upload page. NEW under each video: 🎧 AI DJ (reads the
  video's own script or listens to the narration, judges the mood — English/Roman
  Urdu/Urdu — and lays a fitting composed track softly under the voice; type "lofi"/
  "tense"/etc. to steer it), "Remove my voice (keep music)" (the reverse of remove-music,
  via AI separation, also for outside videos), 🧹 Clean copy (rebuilds the exact video
  with NO title/headings/captions on it — videos now remember their own recipe), and
  "Open audio in DJ decks" (loads the video's sound onto Deck A of the Dual decks).
  The Build button is NEVER silently disabled: with no script text it stays clickable,
  explains what's missing, and highlights the script box when pressed.
• 🎞 STORYBOARD DIRECTOR — shot-by-shot filmmaking. AUTO mode: paste a script and it
  plans timed beats (visual + narration + captions + transitions). GUIDED mode: write
  your own pointers, one per line, like "0-15s: I arrive in a Ferrari, VO: 'welcome'" —
  times are parsed forgivingly. If the AI can't structure it, the app builds the board
  directly from your text — the button never dead-ends. Edit any beat, then render.
• 🎥 PRESENTER STUDIO — presenter-style videos from your real footage or photo, plus the
  "Living Picture" mode (animates a still portrait; region sliders + preview).
• ⏺ RECORDER — record your webcam + microphone or your screen, with device pickers,
  noise suppression and resolution choice. If OBS's Virtual Camera is running, it shows
  up as a camera choice here. Recordings save into Video Studio.
• ✂ TIMELINE EDITOR — the cutting room: trim, cut, rearrange clips, add audio and text
  overlays, then render. This is where "clip/edit this video" lives.
• CHARTS — price charts with SMA/RSI etc., from live data or an imported CSV file.
• 📈 LIVE PSX DATA — live Pakistan Stock Exchange prices → analysis → Excel export; keeps
  the last successful fetch for offline viewing (amber "not live" banner when offline).
• 🏦 NCCPL ANALYSIS — investor-flow analysis; "backtest" answers: when big investors
  (NCCPL flows) bought/sold in the past, what did the price actually do afterwards? The
  math (SMA, Wilder RSI, correlation, flow↔price backtest) is textbook-exact and
  unit-tested; it never invents numbers.
• ADVISOR — a candid strategy partner for the channel: pitch it topics/plans, it pushes
  back with sharper angles. Saved chat history.
• LIBRARY — everything saved: ideas, scripts, and EVERY generated picture (auto-saved).
  Filter tabs: All / Ideas / Scripts / Images / 🗑 Trash. "Delete" only moves items to
  the Trash; only the user can Restore, "Delete forever", or "Empty Trash".
• ACTIVITY LOG — the app's diary: what the AI did, when a video build started/finished/
  FAILED and why, and — important — whether an answer came from your chosen AI or the
  FREE backup AI (if answers feel weak, check here first).
• SETTINGS — pick the AI brain: Ollama (local, free, the default) or the free keyless
  online service. Anthropic and OpenAI are there but ASLEEP: they are never contacted and
  never chosen for you, and only wake if you deliberately select one. "🩺 Run full check"
  (top of the page) LIVE-tests everything — internet, the free AI, the free image service,
  Ollama + whether your chosen model is installed. A saved key for a provider you are not
  using is simply noted as "saved but not in use", never marked as a fault. If answers feel
  weak, this check names the real cause; the answer is never "go and pay for something".
  Model names are cleaned of stray spaces automatically. Natural narration voices live here too: pick and
  download Piper voices (English + two real Urdu neural voices — no Windows setup
  needed), and see/refresh which Windows natural voices (incl. Urdu Asad/Uzma) are
  installed, with a one-click link to add more via Windows' own Speech settings. "Connect YouTube"
  lives here: five numbered steps, each with a button that opens the exact Google page,
  then it TESTS the key for real and says in plain English what is wrong and which step
  fixes it. It also finds your channel from your @name, so you never have to hunt for the
  long UC… ID. Free, about 3 minutes, no card. It switches on Your Channel, the questions
  mined from your comments, the competitor gaps, and real view/competition figures in
  Ideas & Trends (ideas still work without it; the three channel tabs do not, and they now
  say so with the reason instead of showing an empty panel). Also: AI Horde key
  (faster photo scenes), demucs/faceAnim commands, and the Photo Beautify tool.

STANDARD WORKFLOWS
1) Idea → video (fast): AI Command → "write a script about X and build a video" → Run.
2) Scene-by-scene control: Script Writer (or Script Pad) → Scene Studio "Use Script Pad"
   → Plan scenes → Generate all → fix any prompts → Build video → refine in Video Studio
   or cut in Timeline Editor.
3) Shot-by-shot film: Storyboard Director (AUTO from a script, or GUIDED with timed
   pointers) → edit beats → render → Timeline for final cuts.
4) You on camera: Recorder (webcam/screen) → Video Studio or Timeline. Or Presenter
   Studio for presenter overlays / Living Picture.
5) Finance video with real data: Live PSX Data or NCCPL → analysis → Script Writer →
   Scene Studio/Video Studio.

TROUBLESHOOTING
- "The AI feels dumb": Activity Log will show "…came from the free AI instead" — fix the
  key/model in Settings; with a working Anthropic/OpenAI key everything gets smarter.
- "Where did my video go": builds keep running across tab switches; check Video Studio's
  list and the Activity Log (started/finished/FAILED with the reason).
- "Scenes fail to generate": the free image queue gets busy; the app now paces and
  auto-retries. Pause and resume later if the queue is having a bad hour.
- Stale app: compare the sidebar badge to the Build line in MEGA-DIAGNOSTIC-REPORT.md;
  if older, run NIHILPOINTZERO-OS-setup.exe once from the Desktop studio folder.
`
