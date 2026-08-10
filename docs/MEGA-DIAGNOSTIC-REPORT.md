# NIHILPOINTZERO STUDIO — Status & Honest Capabilities

_What actually works, what needs internet, what needs a one-time setup, and what it
deliberately doesn't do. No hype — this is the "will it do X?" reference._

## Build: v0.1.1 · 2026-08-10 03:02
The running app shows this in the sidebar (under "OS") as a gold badge. The badge is now stamped
**automatically at build time** (version · build date+time · code id) — it can never be forgotten
or go stale by hand. If yours shows an older tag, you launched a stale copy — see **"If updates
don't show up"** at the bottom of this file.

## Fixed (2026-08-01, late — the update notice that never appeared)

**What went wrong.** The app finds the newest published version by looking for a line
reading `Build v0.1.1 · <date> · <code>` in the GitHub release notes. `ship.ps1` writes
that line. The CI workflow — added earlier the same day, so that releases could be built
without a Windows PC — wrote something different: *"Built automatically from main on
&lt;date&gt; UTC"*, with no `Build v...` anywhere.

So the check found nothing to compare, decided there was no update, and returned. Silently.
**Every release published from a cloud session was invisible to every installed app.**

**Why it took so long to notice.** Nothing failed. No test broke, no build went red, no
error was logged. Two files simply stopped agreeing — and the app's response to *"I could
not read it"* was identical to its response to *"you are up to date"*: say nothing at all.
From the outside there was no way to tell a working app from a broken one.

**The three fixes, in order of what each one is for:**

1. **The workflow now writes the line the app reads**, and decides the build tag once and
   exports it, so the stamp baked into the exe and the stamp quoted in the notes are
   provably the same string. If they differed by a minute, the app could update
   successfully and still believe it was behind — an update loop.
2. **A failed read is now on the record.** An unreadable version line writes a line into
   the activity log instead of returning in silence, so this class of fault leaves
   evidence next time.
3. **Settings → Version says it out loud.** Up to date, newer available, or "could not
   check just now" — never reported as up to date when the check did not run — with the
   running build shown beside the published one and a **Check now** button. This is the
   real fix: the app was missing a sentence, and its absence was indistinguishable from a
   failure.

There is a test (`src/main/releaseNotes.test.ts`) that reads the actual workflow and the
actual ship script and asserts each still produces something the actual parser can read.
That is the only kind of test that could have caught this, because the defect lived in the
gap between two files rather than inside either one.

## New in this build (2026-08-01, evening — updating is no longer your job)

### 🔌 It opens with Windows, and that is when it updates itself

The honest limit first: **nothing can update an app that is not running.** While the
studio is closed, no code of ours is on the CPU — there is no process to notice a new
release, download it, or install it. Any claim otherwise would be a lie.

What *can* be arranged is that the app is already current by the time you look at it, and
the way to arrange it is to have Windows open the app at sign-in. That is now the default.
And sign-in is the deliberately chosen moment for the update, not an afterthought: nobody
is waiting for the app, nothing is running, so it is the only point in the day when
spending three minutes replacing itself costs nothing.

Three guarantees, each one closing a way this could have gone wrong:

- **It never updates while a render or a queue is running.** The app does not destroy the
  user's work, and restarting under a running render would do exactly that.
- **The busy check happens again AFTER the download, not only before it.** A ~210 MB
  download takes minutes; an update that was safe to install when it started can become
  unsafe by the time it finishes, because you sat down in between. If that happens the
  verified installer simply stays on disk, and the blue notice becomes instant — there is
  nothing left to fetch.
- **A launch you made yourself is never hijacked.** You opened it to work; a forced
  download before you can type would be worse than a button. Only a launch that Windows
  made updates silently.

Rejected alternatives, and why: a resident background updater service is a second thing to
install, sign and debug when it silently stops. An hourly scheduled task is worse than it
sounds — this installer relaunches the app when it finishes, so an hourly task means the
studio window appearing on its own at some random point in the afternoon. Tying it to
sign-in turns that relaunch into the behaviour that was asked for instead of a surprise.

Off switch: **Settings → "Open the studio when Windows starts"**. Turning it off returns
you to the one-button update, which still works exactly as described below.


### ⬆ The app installs its own updates
The honest description of the old "Get the update" button, in its most common case, was
*"we opened a web page for you"*. After that you still had to get past the browser's
warning about downloading an .exe, find the file in your Downloads folder, and
double-click it. That is four things, each of them a place to get stuck — and none of
them a job a person should be doing.

Now the button does the work: it downloads the installer (with a progress bar), checks
the file against the checksum GitHub itself published, runs it, and closes the app so the
installer can replace it. Windows asks once whether to allow it; after that the app
reopens updated.

Details that matter:
- **The download is verified, not just finished.** Size *and* sha256 are both checked
  against GitHub's own values, and a file that fails either is deleted rather than run.
  An installer is the one download where "probably fine" is not good enough.
- **An interrupted download is not wasted.** Press the button again and it re-uses what
  it already has.
- **It refuses to start without room.** Under ~1.2 GB free, it says so in plain words
  instead of half-downloading.
- **Nothing was removed.** The instant restart (when a ship already put the new code on
  disk) is still tried first because it is faster, and revealing the setup file is still
  the fallback — now with the reason the download failed printed in the banner, so it
  can never read as a shrug.
- **Not available from the phone.** Running a Windows installer and quitting the app
  would kill the very connection the phone is using, so that channel is refused with an
  explanation rather than half-working.

### 📱 The phone app publishes itself now
The phone app was finished and correctly uploaded, but GitHub was storing the files
without serving them, because publishing was switched off — and that switch is buried in
settings pages. It is now turned on by the workflow itself, so a push publishes the phone
app with nobody hunting for a toggle.

## New in this build (2026-08-01, afternoon — twenty-seven upgrades, and an honest correction)

### The correction first
Ten of these features were written, tested and correct — and **not reachable from the
app**. Nothing in the interface called them, so there was no button, no tab, and no way
for you to use a single one. They were counted as finished because their tests passed.
A tested piece of code the app never calls is not a feature.

They are all wired now, and there is a check in place that lists any module the app
cannot reach, so this cannot quietly happen again. Where a claim below says "verified",
it means it was run against the real bundled ffmpeg and the numbers are printed — not
that a unit test passed.

### A new tab: Your Channel
Reads **your own** uploads and answers three questions from your own data rather than
from general advice:

- **Which title shapes worked here.** Median views, never mean — one video that went
  viral would otherwise set your strategy for a year. Every claim carries the number of
  videos behind it, and anything below 8 videos (or 3 in either group) is reported as
  "not enough videos to tell yet" rather than answered. Differences under 10% are called
  no real difference, because they are noise.
- **When your audience shows up.** Grouped by day and by hour separately — a channel
  would need thousands of videos before any single day-and-hour slot meant anything.
- **Which of your videos are a series.** Read out of your titles (#4, Part 2, Episode 3,
  Hissa 2, Qist 3, 2 of 5), so it works on the whole back catalogue immediately. It never
  reads a number that is part of the topic: "Budget 2026" is not episode 2026, "PSX
  crosses 78000" is not episode 78000. It flags missing numbers and two videos claiming
  the same one, and writes the description block, pinned comment and end-screen line.

It also reads your **comments**, finds the questions, groups the ones asking the same
thing across English and Roman Urdu, and ranks them by how many different people asked.
Every question is quoted verbatim from a real comment. No model summarises them, because
a summary that reads well and matches no actual comment is indistinguishable from one
that does.

**Cost:** about 4 of the free 10,000 daily YouTube requests to read a hundred videos. It
goes through the uploads playlist, not the search endpoint — search costs 100 units per
call, so eight calls would burn a tenth of your day. Checking a key costs 1 unit; finding
your channel from an @name costs 1 more.

**When it reads nothing, it now says which of seven reasons it was.** This used to be a
single sentence — "no videos could be read, check the YouTube key and channel ID in
Settings" — printed for every case, and it described most of them wrongly. The seven: no
key yet; a key but no channel set; Google refused the request (with Google's own reason
translated); Google itself erroring; could not reach YouTube at all; only part of the
channel readable; or everything working and the channel genuinely has no videos yet.

Only the first three are things to act on. The rest are the app saying "I could not tell",
shown in amber, and it will never dress one of those up as a fault of yours — a partial
read in particular now says its numbers are a floor rather than a total, instead of
letting half a history pass as the whole story.

### In the Script Writer
- **Read it to me.** Hears the script back at 2x with the pitch held, so it still sounds
  like a person talking quickly. A twelve-minute script proofs in six minutes. It also
  lists what to listen for: sentences too long for one breath, a word said twice in a
  row, a figure that cannot be read aloud ("11.2bn"), a line that switches language.
  Deliberately restrained — a check that flags forty things in a finance script is a
  check you switch off, after which it catches nothing forever.
- **Five openings.** The same material as a contradiction, a number, a question, what is
  at stake, and dropped mid-scene — using only sentences already in your script, with the
  source sentence shown under each one.
- **Where your numbers came from.** Reads the "Verified data" box back against the script
  and flags any figure it cannot trace, plus a sources block for the description.

### In Video Studio and Charts
- **Dead air.** Tells you what would be cut, then cuts it to a NEW video. Verified on a
  file with silence planted at 8-16s and 24-31s of 40: found exactly those, kept
  0-8.25 / 16-24.25 / 31-40 (the quarter-second of breath is visible in those numbers),
  predicted 25.499s and produced 25.60s with picture and sound cut together.
- **Draw it on.** The chart draws itself over four seconds and holds.

### Quietly, on every render
- **One encode instead of four.** Colour, captions, watermark and trimming used to be
  four separate passes, and each one throws away a little picture quality. Measured
  earlier with SSIM: 4 passes scored 0.9508 against the master, 1 pass scored 0.9957.
- **Audio at -14 LUFS.** YouTube normalises every upload to about that. Delivering louder
  does not make you louder, it makes YouTube turn you down — and you lose the dynamics
  rather than gain the loudness. Verified: a source at -16.1 LUFS came out at exactly
  -14.0, on both the narration-only and the music-mix paths, duration unchanged.
- **Movement on footage.** Footage was the one background that sat completely still —
  stills already had camera moves, a video clip got nothing, and a locked-off frame for a
  whole minute is the single thing that most makes a video look cheap. Verified on frozen
  footage: frame-to-frame difference went from 0.00014 to 0.604, output size exactly as
  asked in 16:9, 9:16 and 4K.
- **Scenes tighten toward the end**, where finance videos lose people, with the total
  length preserved exactly so the narration stays in sync.
- **B-roll lands on the word** it belongs to, in both languages, instead of on an equal
  split that had gold on screen three sentences after you said gold.
- **A one-second pre-flight.** Checks that ffmpeg really *runs* (antivirus quarantine
  leaves the file exactly where it was and refuses to execute it, so "the file is there"
  is not the check), that the work folder can be written to, and that there is disk space.
  It refuses **only** when the render genuinely cannot finish — warnings never stop a
  render, because this app is built to work offline with software encoding and a
  pre-flight that blocks that takes away more than it protects.

### And a "What changed" screen
Settings → What changed. An old build looks exactly like a new one; the gold badge proves
*which* build is running but never what was in it. This lists what is new in the build you
are actually running — and **withholds** anything dated after that build, so it can never
send you looking for a button that is not there yet. What you have already read is
remembered per item, not per date, because this project ships more than once a day.

### Not yet done, so you know
**All twenty-seven are now built.** The last three were the render-lifecycle ones, and
they are the ones where a mistake loses somebody a finished video, so they were left until
last and each was verified against the real bundled ffmpeg rather than only in tests:

- **Resuming a failed render.** A twenty-minute render dying at minute eighteen used to
  throw away all eighteen. The narration is the slow part and it finishes before anything
  that usually goes wrong has started, so pressing Build again now reuses it. It only ever
  reuses a recording made for *exactly* these words in *exactly* this voice — the folder is
  named after a fingerprint of those inputs, so a changed script cannot even see the old
  narration. Narration that does not match the words would be far worse than the time lost.
- **Watching one scene first.** A still cannot show whether the slow camera move drifts
  your subject out of frame, or whether the colour treatment suits that particular photo.
  Any finished scene can now be watched on its own in a few seconds, using the render's own
  camera maths and the same finishing filters — not an approximation of them, because a
  preview you cannot trust is worse than none.
- **Smooth scrubbing on big videos.** Editing against a small stand-in instead of decoding
  4K on every drag. The stand-in is built to be time-identical to the original and that is
  *checked* afterwards, not assumed: verified on a 4K master at 29.97fps over 37.3 seconds,
  the copy came out 0.0000s different in length at an identical frame rate, 281.6 MB down
  to 2.4 MB. A copy that ever drifted is refused with a reason rather than silently edited
  against, because a cut made on a drifting stand-in lands further and further out as the
  video goes on — fine at the start, ruined at the end, invisible until somebody watches
  the whole thing. The finished video is always made from the master.

Undo already existed for the Timeline and Storyboard and was extended to the Scene Studio
rather than a second undo being written alongside it.

On **thumbnail A/B specifically**, one thing is worth being straight about: a properly
automated test is not possible from this app. YouTube does not expose click-through per
thumbnail to any application — the figure lives behind an OAuth login and is per video, so
swapping the image overwrites it. What the app does instead is give genuinely different
variants, catch the faults that need no data at all, and do the arithmetic that says whether
a difference is real or chance. The swapping and the reading of two numbers are the user's
to do, and the panel says so rather than implying an automation that does not exist.

## New in this build (2026-08-01, morning — the whole studio on your phone)

### 📱 Not a phone version. The studio itself.
Settings → **Phone access** → open the link on your phone and you get the REAL app: the same
tabs, the same buttons, the same screens you look at on the laptop. Video Studio, Scene Studio,
Storyboard, Timeline, Presenter, DJ Station, Charts, PSX, Library, the Agent, Settings — all of
it. Your PC does the rendering, voice-over and analysis exactly as before; the phone is the
screen. Finished videos play on the phone straight from the PC, and you can scrub through a long
one without downloading it first.

**Why this was possible without rewriting anything:** the desktop screens never talk to the app
directly — everything they do goes through one file. That file was rebuilt a second time for a
phone browser, pointing at your PC over the private link. So there is no "phone version" to fall
behind: it is literally the same screens.

**Two things stay on the laptop, and the app says so instead of failing quietly:**
- anything that opens a "choose a file" window ON the PC (from a phone that would be an invisible
  box you cannot see or close — it looks exactly like a freeze);
- recording the PC's own screen. Your phone's camera and mic still record from the phone.

Deleting works exactly as it always did: you ask, it confirms. Nothing here skips that, and the
AI still cannot delete anything from either device.

### 🎥 Recording that doesn't look like it came off a phone
The thing that gave phone footage away was never the resolution — it was the **bitrate**, and
every browser quietly uses about 2.5 Mbps no matter what size you pick. That is a third of what
1080p needs and a fifteenth of what 4K needs, which is why "4K" recordings came out *bigger than
1080p and worse*.

The Recorder now sets it from YouTube's own published upload figures:

| | 30 fps | 60 fps |
|---|---|---|
| 1080p | 8 Mbps | 12 Mbps |
| 1440p | 16 Mbps | 24 Mbps |
| 4K | 45 Mbps | 68 Mbps |

You never have to think about that. The Recorder shows the number and the MB-per-minute before
you press record, and afterwards tells you what your camera **actually** managed — asking for 4K
on a 1080p camera now says so, instead of leaving you wondering why it looks soft.

- **Frames per second** is a choice now: 24 (cinematic) · 30 (normal) · 60 (smooth — screens and
  movement).
- **🎙 Voice only — no face** opens no camera at all. No permission prompt, no camera light,
  nothing that could end up in the file. Saved as a narration track for scenes or stock footage,
  cleaned with the same voice chain the video enhancer uses.
- **On the phone, "🎥 Film it now" opens your phone's OWN camera app** rather than filming inside
  a web page. That is the biggest single difference: real sensor, hardware encoding,
  stabilisation, proper autofocus. 🤳 is the front camera.
- **Nothing is lost when it saves.** Recordings are captured as H.264 now, which is also what the
  studio stores — so the file is copied into place rather than re-encoded. When a conversion is
  genuinely needed it runs at a quality where you cannot see the difference.

## New in this build (2026-08-01, early morning — the cure, not the bandage)

### 📌 Your work folder is now decided ONCE and written down
This is the real fix behind last night's "15 GB of invisible videos". The app used to
work out where to keep your work **every single time it started** — portable folder?
Desktop studio? private Windows folder? If anything around it changed, the guess changed
with it, the app quietly moved house, and everything made before that vanished from view.

Now it decides **once**, records the answer in a tiny file at a fixed address, and every
later launch simply reads it. The guess can never come back and change its mind.
Two deliberate exceptions, both correct: the portable exe always uses the data beside it
(travelling with your work is the point of a portable build), and the self-test harness
always uses its own throwaway folder. And if the recorded folder is ever unreachable —
an external drive unplugged, a folder renamed — the app does **not** silently start empty:
it says so in plain English, tells you nothing was deleted, and keeps working meanwhile.
Nine tests pin every one of those branches.

### 🎬 No more accidental 78-minute silent films
A real project on this PC asked for a **9,999-second** film. Every one of its 39 shots
pinned to the 120-second maximum, none had any narration, and the app spent hours
rendering **78 minutes of silence** without a word of warning. Now: the length box is
capped at 60 minutes (and a wild value saved in an old project is corrected on the way
back in), and before rendering anything over 20 minutes — or anything with no narration
at all — the app tells you exactly what it is about to make and lets you back out.

### 🧹 15.2 GB of proven garbage removed from this PC
Nine video files that **no player could open** (interrupted builds — 14.8 GB, including a
10.7 GB one), the stranded old data folder (1.15 GB) and the Recovered-Videos folder
(1.13 GB, whose contents were already in the app or corrupt at source). Every file was
re-checked with the video prober at the moment of deletion — anything that played was
left alone. **Five narration recordings were deliberately kept**, including 71 minutes of
Fiscal Federalism narration, because those are real work that a video can be rebuilt from.
Your work folder went from 61 GB to 46 GB.

## New in this build (2026-08-01 — lost-work detector + the recovered videos)

### 📍 "Where is my work kept?" — and 14 GB of your videos the app wasn't showing you
Two real problems found on your PC tonight, both invisible until someone went looking:

1. **1.15 GB of finished videos** sat in a folder the app had stopped using. The app can
   keep its data in one of three places (next to the portable exe, in the Desktop studio
   folder, or in your private Windows folder) — work made while one was active silently
   vanishes from view once another takes over.
2. **~14 GB of finished videos were sitting right there in your own work folder** — but
   missing from the app's list, so Video Studio never showed them. Including one 10.7 GB
   video.

Neither was ever announced. Now the app **looks for both on every launch**: Settings shows
the exact folder your work is kept in, and if any finished video isn't being shown — for
either reason — you get a plain-English notice there AND in the Activity Log, with one
button: **"Show these in Video Studio"**. Videos already in your folder are listed
instantly (nothing is copied); videos in another folder are COPIED in. Nothing is ever
moved or deleted, and empty 0-byte files from interrupted builds are ignored rather than
offered to you as if they were work. The ship gate now checks this card can always name
the real folder.

### 🎞 The recovered folder — what was really in it (correction)
The "Pakistan ke Fiscal Federalism" pair (585 MB + 211 MB) was imported into Video Studio,
and an earlier version of this note called them playable. **They are not.** A later check
with the video prober found both files were already broken *before* they were ever copied —
identical corruption in all three places they existed, from a build that was interrupted on
19 July. No player can open them; the copy was faithful, the source was dead.

What IS recoverable from that video is real: its **70.5-minute narration audio is intact**,
and its full script is in your Library. So it can be rebuilt rather than mourned.

Genuinely rescued from that folder: one script that existed nowhere else in the app
(4,609 words, the "stressed retail investor" piece), now in your Library. Everything else
there was already in the app — checked file by file, not assumed.

### 🩺 Corrupt videos are now detected, never offered as "recovered work"
A build that gets interrupted (Stop, crash, power cut) leaves a full-size .mp4 that no
player can open — the index at the end never got written. **Nine such files, 14.8 GB, were
sitting in your work folder.** The recover feature above now runs every candidate through
the video prober first, so it can only ever offer you files that genuinely play.

## New in this build (2026-07-31, late night — your reported errors, fixed at the root)

### 🚫 "Build Video won't click" — the dead-button era is over
The button showed the ⊘ not-allowed cursor with ZERO explanation whenever the script box
was empty (including when a picked saved script had no words in it). That silence was the
bug. Now the Build button is **never silently disabled**: it stays clickable, a standing
note under it says exactly what's missing, and clicking it highlights the script box and
tells you plainly ("The script box is empty — write or pick the words to be spoken").
Empty saved scripts are now labeled "(empty — no words in it)" in the list. The automated
gate now FAILS any build button that sits disabled without explanation.

### 📷 "Put me in the photo → Regenerate → error" — found it, a real bug
Pressing ⏹ Stop on ANY video build left an invisible "cancelled" flag switched on until
the next build started. The photo-scene generator's last step saw that stale flag and
died with "Render cancelled by user" — every time, even 10 minutes later. Fixed at the
root: a Stop now lives and dies with the build it stopped (pinned by new tests). Also
fixed around it: a moved/renamed photo now says so plainly instead of a raw system error;
huge phone photos are auto-shrunk before upload (the free service rejected 8MB+ posts);
and a failed regenerate now shows its reason in red on the scene card — it used to be
invisible when an older image was still on screen.

### 🎧 The AI DJ (Video Studio → under each video)
One click: the app reads the video's own script (videos now remember their script), or
listens to the narration if there isn't one, judges the mood — Roman Urdu and Urdu too —
composes a fitting track sized to the video, and mixes it softly under your voice
(auto-ducked). Type a hint ("lofi", "tense", "calm…") to steer it, or leave it empty and
let it decide. New copy; the original is kept.

### 🎵 Music/voice separation — now BOTH directions
"Remove music (keep my voice)" existed. Now there's also **"Remove my voice (keep the
music)"** — on app-built videos and on outside videos (Online free / Local Demucs).

### 🧹 Clean copy — one click removes titles, headings and captions
Videos now remember their own recipe, so "🧹 Clean copy (no on-screen text)" rebuilds the
exact same video with NOTHING drawn over the picture. (Burned captions never touched your
original anyway — it's always still in the list.)

### 🎛 "Open audio in DJ decks" (under each video)
Pulls the video's audio out and loads it straight onto Deck A of the Dual decks — EQ,
loops, hot cues, BPM, crossfader — no file-hunting.

### 🎞 Scene Studio — your pacing, your transitions
Every scene card now has **"⏱ Stays … sec"** and **"✨ Arrives by"** (straight cut, fade,
dissolve, slide from any side, circle open). Leave them empty for the classic automatic
pacing; set them and every image appears exactly once, in your order, at your pace — and
the total is always stretched to fit the narration so speech never gets cut off. The
video settings row (Style · Video look · Resolution · Format · Look) got a clear header —
it was always there, just easy to miss.

## New in this build (2026-07-31, night)

### 💾 Backups grew up: new home, restore button, delete-sync, second copy
- **New home:** backups now live in `C:\Users\<you>\NihilPointZero-Backups` (moved from
  Documents — the app relocates the old folder automatically, nothing to do).
- **RESTORE exists and is PROVEN:** Settings → Backups → "Restore missing files" copies back
  anything in the backup that's missing from the app. It **never overwrites** what you have —
  and an automated drill now runs on every ship: back up real files → delete one → restore →
  verify it comes back byte-for-byte identical. A backup nobody ever restored from is a hope;
  this one is tested.
- **Delete-sync (your instruction, ON by default):** permanently deleting a video in the app
  now deletes its backup copy too — deleted means **gone for good**, no ghost copies. The
  delete dialog says so. Toggleable in Settings → Backups.
- **"Clean deleted-items ghosts":** removes backup copies of things deleted before delete-sync
  existed. Shows the count and size first and asks.
- **Second backup home (optional):** point it at a USB stick or second disk in Settings →
  Backups and every weekly backup lands there too. Unplugged that week? Skipped and noted —
  never an error. A backup on the same disk can't survive a disk failure; this one can.

### 🩺 The health check now runs itself
About once a week, quietly. Real problems put a **red dot on "Settings" in the sidebar** and
a plain-English line in the Activity Log. No more discovering a dead key mid-project.

### 🈳 Disk-space guard on video builds
Almost-full disk → the build says so **before** starting instead of dying halfway with a
cryptic error. Merely low → the build runs but warns you early.

### 🧪 The ship gate now proves the Storyboard AND Timeline pipelines
Every ship now also: seeds a guided one-shot storyboard with a photo subject, renders the
film through the real UI, opens it in the Timeline editor and **re-renders it there** —
plus exercises add-shot/delete-shot and the confirm dialog. (This immediately caught a real
bug: the gate's own wait-timeouts were silently ignored — fixed.)

## New in this build (2026-07-31, evening)

### ⬆ "Get the update" can never look dead again
The button's old behavior — opening a folder window that usually appeared BEHIND the app —
is gone. Now one click **restarts the app straight onto the already-updated code** (ships
update the installed app in place, so the update is already on disk). Where that doesn't
apply, it falls back to revealing the installer or download page **and says so right in the
banner**, so you always know what happened.

### 🎛 Dual decks in the DJ studio — a real two-track mixer, free for life
Inside Video Studio → Sound Studio: load any two audio files and mix them live —
play/pause per deck, clickable waveforms, **BPM detection**, pitch sliders, **3-band EQ**
(low/mid/high), **loop in/out**, **4 hot cues per deck**, and an equal-power **crossfader**.
Runs 100% on this PC (WebAudio) — no service, no key, no internet, nothing to expire.

### 🎵 Music that understands the subject — in BOTH languages
The music picker's mood detection now reads **Roman Urdu and Urdu script**, not just
English ("girawat", "بحران" → tense; "munafa", "ترقی" → uplifting). It also shows direct
links to matching category pages on the free libraries (Pixabay Music, Free Music Archive)
and tells the built-in music maker which mood fits your script.

### 🧪 The self-test gate got meaner (see docs/QA-REPORT.md)
The pre-ship click-through now also proves: an empty script never builds (and the app says why), a Roman Urdu +
Urdu script + emoji video builds to completion, a 15,000-character script starts fine,
rapid double-clicks are harmless, ⏹ Stop halts a build instantly and the UI recovers, and
autosave survives tab switches. The full honest test report lives in **docs/QA-REPORT.md**.

## New in this build (2026-07-31, later)

### 🎬 The free-cloud video tier now has a SECOND route — a Pollinations key (no phone number)
Tested the same day it shipped: Puter's sign-up **rejects Pakistani phone numbers**, which
blocked the whole free-cloud tier here. So the tier now has two routes (pick in Settings →
AI Video):
- **Pollinations (recommended on this PC):** sign up free at **enter.pollinations.ai**
  with GitHub or email — **no phone number** — create a key (pk_/sk_) and paste it into
  Settings. Free Pollen is **claimed from the dashboard's Quests tab** (retroactive rewards —
  "Create your first API key" alone pays 0.25); the default wan-fast model costs ~0.05 Pollen
  per 5-second scene, so one small claim is several real-motion scenes. A **"Test key"
  button** shows your balance without spending anything. The key is stored encrypted, like
  every other key.
- **Puter (Google Veo):** unchanged — no key, a sign-in window pops up during the first
  build. Use it where their phone verification works.
Both routes fall back per scene to AI stills with the reason in the build log.

Live-tested the same day with a real account (thank you): **use the SECRET key (sk_…)**
— pk_ keys are often created with an empty model allowlist and every generation gets
refused. The "Test key" button now checks the key the right way for both kinds, warns
when a key has no models enabled, and says plainly when the Pollen balance is 0 (free
Pollen is claimed from the Quests tab on enter.pollinations.ai — rewards are retroactive).

### 🚦 Nothing ships unless a machine has clicked through the whole app first
New hard gate in the ship pipeline: before any build can go out, an automated harness
launches the REAL app (in an isolated throwaway data home — it can never touch your
work), opens **every single tab** — Today, Ideas & Trends, AI Command, Scene Studio,
Script Writer, Script Pad, Video Studio, Storyboard Director, Presenter Studio,
Recorder, Timeline Editor, Charts, Live PSX Data, NCCPL Analysis, Advisor, Library,
Activity Log, Settings — verifies each renders alive with working controls and no
crash screen, and then **builds an actual video by clicking the UI** (paste script →
pick engine → Build → finished video appears), fully offline. If ANY of that fails,
the ship stops. Straight talk about what this does and doesn't promise: it cannot
stop a free online service from having a bad hour (those failures fall back with the
reason logged), but "a tab is broken / a button does nothing" can no longer reach you
in a shipped build.

### 🛡 Updates no longer fight Windows Smart App Control
Smart App Control blocks each freshly built (unsigned) setup.exe as an unknown file —
which stranded the installed app on an old build. Shipping now updates the installed
app **in place**: the already-allowed program stays exactly as Windows approved it, and
only the app's code archive (`app.asar`, a data file) is swapped. Verified safe against
the build's own integrity settings. The installer is only needed again when the Electron
runtime itself changes — and the durable fix for that day is code signing
(docs/SIGNING.md).

## New in this build (2026-07-31)

### 🎬 REAL AI video — free cloud (no API key)
A new tier in Video Studio's "Video look (engine)" list. It generates **real moving video
per scene** — Google's Veo model, through a free service called Puter — not a photo
slideshow. The honest catches, stated plainly:
- You sign into a **free Puter account** once — a sign-in window pops up during the first
  build. No key to paste, nothing to pay.
- The free allowance is **small and monthly**. When it runs out, scenes automatically fall
  back to AI still images and the build log says why. Nothing breaks.
- By default only up to **5 scenes per build** get real motion (adjustable in Settings →
  AI Video, "Real-motion scenes per build") — this protects the free allowance. The rest
  of the scenes use AI stills.
- Each real-motion scene takes **minutes** to generate.

Also available in Scene Studio ("Video look"), Storyboard Director (the "Scenes:"
selector) and Presenter Studio (the AI-scene selector — your own footage/photo is never
AI-generated).

### 🟢 REAL AI video — local GPU (ComfyUI) — built, and waiting for hardware
The "AI motion video (local GPU)" tier is now a real integration with **ComfyUI**, the
standard local AI video server (default address `http://127.0.0.1:8188`). The hard truth
has NOT changed: **this PC (Intel UHD, no NVIDIA card) cannot run it — not slowly, not at
all.** What has changed: the option is now deliberately VISIBLE but greyed out —
"Requires NVIDIA GPU — not detected on this system" — and everything can be configured in
Settings → AI Video today, so it unlocks by itself the day the PC has an NVIDIA card.
Settings shows which model fits which card: 8GB → AnimateDiff / Wan 2.1 (1.3B) · 12GB →
LTX-Video / LTX-2 · 16GB → **LTX-2.3 (recommended)** · 24GB+ → Wan 2.2 / HunyuanVideo 1.5.
Advanced users can point it at their own ComfyUI workflow file (exported via
"Save (API format)", with a `{{PROMPT}}` placeholder).

### Every AI video engine now falls back safely
If a real-video engine can't run (offline, allowance used up, no server), the build
automatically continues as the photo slideshow and the status log states the reason.
**A build never breaks because of these engines.**

### The Known Issues panel now also records interface crashes
It used to log only AI service failures. Now if a tab crashes, the crash is contained to
that tab — the rest of the studio keeps working, with a plain-English message and a
"Try this tab again" button — and the failure is written to the same log
(Settings → Known Issues), so it's provable instead of a mystery.

## New in this build (2026-07-30, later)

### The AI "stops responding" bug — found and fixed
The free online AI brain the app shipped with (Pollinations) **stopped being free.** This was
proven, not guessed: repeated live tests got `402 Payment Required` ("this key has 0.0000"),
`404 Model not found — this is our legacy API`, `429 Queue full`, and Cloudflare `520` error
pages. It is a change at their end, not a fault in your PC or your internet.

Why it looked like a freeze: the app used to ask that same dead service **twice** for every
question, waiting up to two minutes each time, and **never wrote the failure down anywhere**.
So you got a long hang and then nothing.

What changed:
- **Ollama is now the automatic backup brain.** If you have Ollama installed (you do — with
  `llama3.2:3b` and `llama3.1:8b`), the app now falls through to it and *answers*. Free,
  offline, no key.
- **No more asking a dead service twice.** A service that refuses permanently is skipped for
  30 minutes instead of being retried before every single answer.
- **Failures are now written down** to `nihilpointzero-data/logs/ai-errors.log`, with the time,
  the service, the HTTP code and the service's own words.
- **New "Known Issues" panel in Settings** shows that log, so a problem is provable instead of
  silently vanishing.
- **"Run full check" now actually tests the AI.** It used to ping a different address than the
  one the app really uses, which is why it showed a green light through the whole outage.

### Pictures that never appeared — fixed
Generated images (Scene Studio and elsewhere) were being created and saved correctly, but the
app's own security policy blocked the window from displaying files from your disk. One line
fixed it; images, video previews and audio players across nine screens now show up.

### Video editing
- **Touch-friendly trim.** Tap the bar to move the nearest marker or drag it, instead of typing
  numbers into boxes. Asks **"Remove this section?"** before it cuts. (Typing exact times is
  still there, tucked under "Type exact times instead".)
- **Visual music track** under the trim bar: a green region you can drag to place, showing where
  music plays.

### Free, copyright-safe background music
Tap the music lane and the AI reads your script, picks the mood, and offers matching tracks —
preview with one tap, use with one tap. Sources are Pixabay (when you add a free key) and
Openverse (needs no key at all, so this works out of the box). **Every track shows its licence
and whether you must credit the artist** — credit-free tracks are listed first.

### Voice & captions
- **New "🔇 No voice / silent" narration option** — builds the video with no narration so you
  can record your own over it. Its length is set from how long your script would take to read.
- **Captions & YouTube chapters are now an explicit tick-box, off by default.** Worth being
  straight with you: captions were *never* being forced — they only ever ran when you clicked
  the Captions button. Chapter markers did not exist at all before now. Both are now under one
  visible switch, and chapters come with a copy button for your description.

### "Real video generation" — the honest answer (updated 2026-07-31)
You asked for real AI motion video (LTX-Video, Wan 2.2, CogVideoX) and talking photos
(SadTalker, LivePortrait). **Local models cannot run on this laptop.** Not slowly — not at all.

They need a *dedicated NVIDIA graphics card*. This PC has Intel UHD Graphics built into the
processor, which shares system memory and has no CUDA cores. The lightest of those models
wants 6GB of dedicated video memory; there is none here. Anyone who tells you a setting will
fix that is wrong.

**Update (2026-07-31): there IS now real AI motion video here — through the cloud, not this
PC's hardware.** The new "REAL AI video — free cloud" tier generates real moving video per
scene. Two free routes: a Pollinations key (free Quest Pollen, signup with GitHub/email —
no phone number — the route that works here) or a free Puter account (their phone
verification rejects Pakistani numbers). Up to 5 real-motion scenes per build, minutes per
scene; full details in the 2026-07-31 entries above. And the local tier is now fully built
(ComfyUI) and waiting: greyed out today, it unlocks by itself the day this PC has an NVIDIA
card.

What was built at the time (all still true):
- **A real hardware check** that detects your graphics card at startup and says plainly what
  can and cannot run, *before* you start a build — no silent failure, no hang, no garbage.
- **The slideshow is now labelled honestly** as "Photo slideshow (AI images)" and described as
  "a moving photo slideshow — not filmed motion", so it is never passed off as something else.
- **16 distinct visual styles** instead of 5 — five cinematic looks (modern film, film noir,
  blockbuster, vintage 70s, documentary), four cartoon, four anime, plus neon, minimal and
  infographic.

If you ever run this on a PC with an NVIDIA card, the hardware check will say so and the
motion-video option becomes available.

## New in this build (2026-07-30)
- **🇵🇰 Real free Urdu narration voices.** Two ways to get a natural Urdu computer voice,
  both free: (1) Piper — pick and download an Urdu neural voice (male "Fasih" or female
  "Aegis") in Settings, no Windows setup needed; or (2) Windows' own natural voices —
  install the Urdu (Pakistan) language pack in Windows' Speech settings (one click from
  Settings or Video Studio) to unlock Asad/Uzma, with a "🔊 Preview" button so you can hear
  a voice before committing. Both are far better than the old robotic Windows voice.
- **🌙 Overnight content factory.** AI Command's Batch section now has an "🌙 Overnight
  plan" checkbox: pick your topics before bed, and the app also cuts Shorts and writes
  posting text for every finished video — wake up to publish-ready material, not just raw
  builds. One failure never stops the rest, same as regular batch.
- **▶ Publish to YouTube now uses the same posting-text engine as "🏷 Posting text".**
  Shorts get Shorts-appropriate copy automatically (grounded in the actual clip, not a
  generic description) — one consistent, better result whichever button you click.
- **📈 Real YouTube data was already wired into Ideas & Trends** — add a free YouTube
  Data API key in Settings and idea generation starts calibrating against ACTUAL view
  counts and competition instead of guessing. (This existed already; worth knowing about
  if you haven't added a key yet.)
- **🩺 "Run full check" in Settings — LIVE tests, not guesses.** The old health panel only
  asked "is a key saved?", which is why a WRONG Anthropic key showed a green light while
  every request failed for 11 days. The new check actually contacts each service: internet,
  the free text + image AI, Ollama (and whether your chosen model is installed), and it
  validates saved Anthropic/OpenAI keys with a real authenticated request — a rejected key
  now shows RED with the reason. First thing to click when answers feel weak.
- **💾 Automatic weekly backup.** The app now backs up your work by itself, at most once
  every 7 days, shortly after startup, and records it in the Activity Log. Copy-only: it
  never deletes or moves anything, and files you removed from your work folder stay in the
  backup. **Your API keys and the app's browser data are deliberately NOT copied** — the
  backup folder is often cloud-synced, and saved keys are recoverable in
  the portable copy. (The backup now lives in `C:\Users\<you>\NihilPointZero-Backups` —
  see the 2026-07-31 night build notes above.) It backs up videos, thumbnails, scripts, library, drafts and logs (no
  size limit — the big finished videos are the whole point). If any file can't be copied the
  Activity Log says INCOMPLETE and it retries next launch instead of falsely reporting success.
  BACKUP-NOW.cmd applies the same exclusions.
- **🏷 One-click posting text.** Every video in Video Studio has "Posting text · YouTube /
  TikTok": it writes a click-worthy title, a short description and hashtags for that clip,
  each with a Copy button. Pair it with "📱 Cut into vertical shorts" and uploading becomes
  copy-paste. If the free AI is busy it hands back a sane fallback instead of failing.
- **🏠 A "Today" home screen.** The app now opens on Today: your latest videos, what
  happened recently, and one-click cards for the usual jobs. Ideas & Trends moved to its own
  sidebar item right below it (nothing was removed).

## New in the 2026-07-29 build
- **⬆ The app now tells you when a newer version exists.** On startup it quietly checks
  the download page; if a newer build was published, a small blue notice appears with a
  "Show me the file" button that opens the studio folder with the setup exe selected.
  Offline or failed check = total silence, never a nag.
- **→ "Take me there" chips in the 🧭 Expert.** When an Expert answer mentions a tab
  ("open Scene Studio…"), one-click chips appear under the answer that jump straight to
  that tab — the Expert now walks you to the room, not just describes it.
- **💾 BACKUP-NOW.cmd** now sits in the Desktop studio folder: double-click to copy all
  your work (videos, scripts, settings) to the backup folder (now
  `C:\Users\<you>\NihilPointZero-Backups`). Copy-only — it can never delete anything.
- **🧭 A second AI helper — the STUDIO EXPERT — now floats on every tab**, separate from
  the 🎬 Producer. It knows the entire app and answers anything about it in whatever
  format you ask (bullet points · step-wise · precise clicks · fully detailed · brief —
  chips or your own words). Under each answer, "⚡ Execute these steps" turns the
  explanation into a validated action plan, and its Execute mode takes orders you write
  yourself — nothing runs until you click "▶ Run it", and it can never delete anything.
- **📱 MAKE SHORTS.** Every video in Video Studio now has a "Cut into vertical shorts"
  button: the app listens to the video (offline Whisper), picks the strongest moments —
  hooks, questions, concrete numbers — and cuts 1–5 vertical 9:16 clips with big
  burned-in captions, ready for YouTube Shorts / TikTok / Reels. It tells you why it
  picked each moment, and the clips land in the same list. Completely free and offline.
- **The 🎬 Producer button (bottom-right of EVERY tab) is now also your in-app guide.**
  Ask it "how do I…?" about anything — it knows every tab, every button and every
  workflow, and answers with exact click-paths instead of guesses. Two new buttons let
  you choose the answer length: **📖 Detailed** (full step-by-step) or **⚡ Brief**
  (quick bullets). It still does everything it did before: growth advice, rewriting your
  script/title (you approve with Apply), and "Do it" action plans you approve with Run.
- **A new `SETUP_GUIDE.md`** (in the project folder and on GitHub) explains, in plain
  English, how to install or run the portable app on ANY new machine — including USB and
  CD transfer rules — plus a developer section for building from source.
- **Storyboard Director can no longer say "could not turn that into shots".** If the AI
  fails to structure your script (common on the free backup AI), the Director now retries
  once with stricter instructions and then — if the AI still fails — builds the storyboard
  DIRECTLY from your script with no AI at all: timed pointers like "0-15s: …" or
  "0:15 to 0:40 …" (typos forgiven) become shots, [bracketed directions] become shots, and
  plain prose is split into speech-paced beats. Even a bare title yields an editable shot.
- **"Generate all scenes" now finishes the whole board in one click.** The free image
  service rate-limits parallel requests; generation is now paced to what it accepts, retries
  are spread out instead of hammering in lockstep, and any scenes that still fail are
  automatically retried in up to two extra passes — no more clicking "regenerate" one by one.
- **A building video can never silently vanish.** Builds always ran in the background (they
  keep going when you switch tabs, and the finished video lands in Video Studio) — but now
  the Activity Log records when a build STARTS, when it FINISHES, and — new — if it FAILS
  and why. If you ever wonder "where did my video go?", the Activity Log has the answer.
- **Scene Studio images are now downloadable.** Every generated scene has a "⬇ Save"
  button, and "⬇ Save all images" copies the whole storyboard, numbered in order, into a
  folder you pick — so you can use the pictures outside the studio too.
- **After building a scene video, two new buttons take you onward:** "🎥 Open in Video
  Studio" (voice, music, captions, export) and "✂ Edit in Timeline" (cut/trim/rearrange).
- **The Library now keeps EVERY generated picture automatically** (scene images and
  thumbnails), with new filter tabs: All · Ideas · Scripts · Images · Trash.
- **Deleting from the Library is no longer permanent.** "Delete" now moves items to a
  Trash Can; only YOU can restore or permanently remove them ("Delete forever" / "Empty
  Trash" ask for confirmation). Nothing in the app — the AI included — can destroy a
  library item.
- **The app now TELLS you when the free backup AI answered.** Before, if your chosen AI
  (Anthropic/OpenAI/Ollama) failed for any reason — wrong key, no credits, a typo in the
  model name — the app silently asked a free public AI instead and showed that answer as
  if nothing happened, which looked like "the AI got dumb". Now every such switch is
  written to the Activity Log in plain English (e.g. "Your anthropic AI failed — this
  answer came from the free AI instead"), including the technical reason. If answers seem
  weak, check the Activity Log first.
- **...and shows an amber WARNING BANNER on screen the moment it happens.** The banner
  names the AI that failed, shows the technical reason in small print, and links straight
  to Settings so a wrong/expired API key gets fixed in seconds instead of going unnoticed
  for weeks. Dismissing it hides it until the next failure.
- **The sidebar build badge now names the exact commit that was built.** It used to run
  one commit behind (the hash was read before the ship commit existed), which could make
  a perfectly current app look outdated when checked against the project history.
- **Model names are cleaned up automatically.** A pasted model name with an accidental
  space (e.g. " claude-sonnet-5") used to break every AI call invisibly; spaces are now
  removed when you save.
- **The Build line at the top of this file is now stamped automatically at ship time**
  and matches the sidebar badge's version and date (the badge additionally shows the
  exact commit that was built) — it can no longer drift out of date and wrongly tell
  you a stale app is current.

## New in the 2026-07-19 build
- **An INSTALLED version now exists** — run `NIHILPOINTZERO-OS-setup.exe` once (in the studio
  folder). It opens in ~2 seconds (no 60-90s unpack), taskbar pins are SAFE forever, and it uses
  the SAME `nihilpointzero-data` folder as the portable exe — same videos, scripts and settings
  in both. Keep the portable exe for USB travel; use the installed one day-to-day.
- **The exe went on a diet: 270 MB → 196 MB (–27%).** Mac/Linux binaries that could never run
  on Windows were being packaged; removed. Portable launches unpack faster too (~1.2 GB → 0.8 GB).
- **⏹ Stop is now instant in every stage.** Pressing Stop used to wait out the full retry cycle
  of an in-flight AI image download (up to minutes); it now aborts mid-download.
- **Real progress percentages.** Timeline renders, Storyboard renders and Stitch now show
  "Rendering 42% (0:34 / 1:20)" instead of raw ffmpeg text (Video Studio already had this).
- **Live PSX Data works offline now.** Every successful fetch is saved; if the PSX portal is
  unreachable, the app shows your last SAVED data with a clear amber "not live, fetched <date>"
  banner instead of a blank tab — and it retries once before giving up.
- **No more infinite hangs.** Every internet call in the app (free AI, images, music removal,
  music search, stock clips, news, currency, YouTube signals, voice download) now has a hard
  time limit — a dead connection fails with a clear message instead of hanging forever.
- **The whole source code is now under version control (git)** with the shipped build tag
  traceable to the exact code that produced it.

## Health check (last full sweep)
The whole app was reviewed file-by-file and machine-verified:
- **279 automated tests pass**, both TypeScript type-checks clean, full production build clean.
- 148 source files / ~19,000 lines; 101 app commands, all real (no dead/placeholder features).
- The video engine, audio graphs, and the finance math were checked against known-correct
  references and validated by actually running ffmpeg.
- A full read-only audit of every screen + IPC channel confirmed there are no missing/mis-wired
  handlers, and the AI paths fall back to the free brain when a provider is down.

## Latest fixes (build 2026-07-19-C)
- **Images now FOLLOW your script's `[bracketed cinematic directions]`.** A bug capped bracket
  parsing at 40 characters, so long shot descriptions were dropped and images were built from
  meaningless 5-word snippets of narration. Now each full direction becomes its own AI image
  (up to 30), and **"AI visuals (free)" is the default engine** in Video Studio.
- **"Only 1–2 of N images generated" is fixed.** The free image service used to fail with no
  retry; now every scene retries with backoff + a timeout and falls back to a faster model, so
  far more scenes come out with a real image (offline/very-busy still falls back to the animated look).
- **The ⏹ Stop button now stops EVERY stage** — voice, image downloads, and render — not just the
  final ffmpeg step (before, Stop did nothing while images were generating).
- **Natural voice (Piper) no longer drops your script.** A multi-paragraph script used to keep
  only the LAST line's audio; it's now synthesized in chunks and joined into one continuous track.
- **AI Director** now correctly labels the free online brain as "· free" (was mislabeled "· paid").

## The math is exact
SMA (20/50/200), Wilder RSI(14), % returns, correlation, and the flow↔price backtest all
match the standard textbook formulas and are unit-tested (RSI is even checked against the
published StockCharts worked example). The tools compute from real data and **never invent
numbers** — if a figure can't be derived, it says so.

## Bugs found and FIXED (verified)
- **Video generation** — the render used to balloon frames ~100× and crash; fixed, so videos
  now render at the correct length, fast. One bad image no longer aborts a build.
- **Audio** — added a peak limiter to every mix (no more clipping/distortion), set it to
  attenuate-only, and normalized sample-rate/channels before mixing (Piper voice + music no
  longer clash). "Replace background music" (was broken) works.
- **Burn-in captions** — fixed (now ships an explicit font, so they actually appear).
- **Narration** — the natural voice is the default when installed; the voice now reads
  UTF-8 correctly (em-dashes, curly quotes, Urdu, accents pronounced right).
- **Finance** — fundamentals auto-detect newest-first columns (no more backwards growth %).
- **Music removal (offline Demucs)** — fixed for folders with spaces in the path.
- **Data safety** — all saves are now atomic (a USB yank / crash mid-save can't wipe data);
  autosave added to every tab that holds work; the mic is released when you leave a tab.
- **AI reliability** — every AI feature falls back to the free hosted brain if your provider
  is down; idea output is validated so it can't crash or save garbage.

## What's REAL and works
- Make videos 3 ways (Producer "Do it" · Storyboard Director · Video Studio), Batch (many at once)
- **🎬 Producer that operates the app** — on any tab, "Do it" plans real actions and runs them
  after you approve (scripts, videos, thumbnails, images, music, ideas, PSX analysis, scenes).
  Safe validated actions only — it creates/edits, **never deletes**.
- Script / idea / thumbnail generation; AI Command & AI Director
- 🎞 Storyboard Director (shot-by-shot) + ✂ Timeline Editor (real NLE)
- **🎥 Presenter Studio** — YOU present, three modes: Real Video (upload your narration
  video; the app cuts to theme b-roll + AI scenes on your voice), Photo (your photo
  presents), ✨ Living Picture (the moving part of your video grafted onto your best
  picture). Your own footage/photo is never AI-generated.
- **⏺ Recorder** — webcam AND screen recording in-app, up to 8K, with noise suppression
  and OBS virtual camera support; recordings land in Video Studio.
- Looks (Clean/News/Cinematic/Bold), 16:9 / 9:16 / 1:1, up to 8K
- Voice: your own recording, Natural (Piper), or Windows
- Music synth + DJ mixer (auto-duck + limiter), captions (.srt + burn-in), trim, stitch, export
- **📈 Live PSX Data** (real prices → analysis → Excel → script → video) and **Charts** (live or your file)
- **Photo Beautify** — retouches your REAL photo (skin/brightness/sharpen); it is a genuine
  retouch of your own pixels, not "AI makeup" and not a fabricated face.

## Real, but needs internet or a one-time setup
- **Needs internet** (keys already built in, nothing to sign up for): AI writing/ideas/advisor,
  AI images & visuals, "put me in a scene", online music removal.
- **REAL AI video — free cloud** — needs internet + one free sign-up: a Pollinations key
  (enter.pollinations.ai, GitHub/email, no phone — free Quest Pollen, claimed on their dashboard) or a Puter
  sign-in (window appears on the first build; their phone verification rejects some
  countries' numbers). Small allowances; up to 5 real-motion scenes per build (adjustable),
  the rest use AI stills; minutes per scene. If it can't run, the build falls back to the
  slideshow with the reason logged — it never breaks.
- **REAL AI video — local GPU (ComfyUI)** — real and fully configurable in Settings → AI Video,
  but it needs an NVIDIA card this PC doesn't have; visible but greyed out until the hardware
  exists.
- **Put me in a scene** — free, but the queue can be slow and the generated look **approximates**
  you; your true face is preserved by compositing your actual photo/clip, not by faking a face.
- **Natural voice (Piper)** — a one-time ~80 MB download (already done on this PC).
- **Offline music separation (Demucs)** — needs Python (already set up on this PC); not needed
  if you have internet (the Online button removes music).
- **YouTube (Your channel, comment questions, competitor gaps)** — needs the free YouTube
  Data API key, and **Settings → Connect YouTube** now walks you through getting one: five
  numbered steps, a button on each that opens the exact Google page, then a real test of the
  key with a plain-English answer if it fails. It also finds your channel ID from your @name,
  so the buried "UC..." string is no longer something you have to know. Free, ~3 minutes, no
  card. **Until it is done, those three features read nothing** — and they now say so with
  the reason, instead of showing an empty panel.
- **Pixabay / Pexels stock footage** — optional free API keys in Settings.

## What it deliberately does NOT do (so you're never misled)
- **NCCPL live auto-fetch** — NCCPL's portal blocks automated access, so the app does NOT scrape
  it. Instead you download the FIPI/LIPI file yourself and upload it — then it's fully analysed.
- **A fabricated video of your real face** — not done on purpose; free AI can't guarantee a
  made-up face is truly you, so the app composites your real photo/clip instead.
- **One-click YouTube upload** — it prepares the title/description/tags and opens your upload
  page so you drop the file in (reliable + free). Full auto-upload would require Google app
  verification and force videos private until approved.
- **Automating a third-party charting site** (TradingView etc.) from a pasted URL — fragile and
  can't be accurate from a screenshot; the app charts real PSX data itself instead.
- **"Beautify" is a retouch, not plastic surgery** — it smooths/brightens/sharpens; it does not
  reshape hair/skin/muscles into someone else.

## Added on 2026-08-07 — the Caretaker
The studio checks itself on a visible, user-controlled schedule (Settings → Caretaker):
live health checks, dead-brain rescue, lost-video detection, every pass recorded. Honest
scope: it fixes settings, state and services; it cannot rewrite its own code, and it
never runs during a render. Only the user can delete its record.

## Added on 2026-08-07 — the honesty gate on video builds
A build where MOST scenes failed to get their real image now refuses to finish, naming
the failed scenes and the reason, instead of shipping a dark void with a filename (one
or two lost scenes still pass — that has always been the soft-fail promise). This is the
fix for the "8 or 9 empty black videos" found in the output folder.

## Added on 2026-08-07 — the switchboard and Gemini
- **AI switchboard** (Settings): every brain with a real ON/OFF. Off = never contacted,
  not even as a fallback. Free-online defaults OFF (it went paid); Ollama ON; paid asleep.
- **Gemini** as a full brain via Google's genuinely free AI-Studio key, with a two-minute
  tested walkthrough. ChatGPT/Grok: open-in-browser buttons only — no free machinery
  exists, and the studio will never store passwords.

## Fixed on 2026-08-07, from the owner's screen recording
- **A percent sign in a headline crashed the whole video build** ("Stray %", "ffmpeg
  exited with code null"). Finance titles are full of percent signs, so this was the main
  case, not a corner. Fixed at the filter level and pinned with a test.
- **Scene images could come out with inappropriate, mostly-female subjects** on scripts
  that never mentioned a person. Two causes: the image service's strict content filter was
  never being sent (now sent on every request), and the model invents a person for abstract
  finance prompts (scenes that don't mention one now ban people from the frame; scenes that
  do require modest professional dress).
- **The app recommended buying a paid key when the free online AI died.** Removed
  everywhere; the free local brain is the answer, and a dead free service is no longer
  consulted on every request.
- **GitHub "storage full" emails**: every build was storing 435 MB of exes as a 14-day
  Actions artifact against a 500 MB allowance. It now stores nothing unless the release
  upload itself fails; the old copies expire by themselves within two weeks.

## Honest note on "bug-free forever"
The logic and math are tested and correct today. The parts that reach the internet (live PSX
prices, free AI services, online music removal) depend on those services staying up and
unchanged — if one changes, the app fails with a clear message rather than inventing a result.

## If updates don't show up (IMPORTANT — this wasted real time once)
The **portable exe** unpacks itself into a temporary folder on each launch and runs from there.
If you **pin the running portable app to the taskbar or Start**, Windows freezes that pin to the
*temporary* unpacked path — so it keeps launching an **old copy forever**, no matter how many
times the exe on disk is updated.

How to always run the newest build:
1. **Easiest fix: use the installed version** (`NIHILPOINTZERO-OS-setup.exe`, run once). It has
   no temp folder and no pin trap — pins always launch the current code, in ~2 seconds.
2. If using the portable exe: launch from the **Desktop shortcut** ("NIHILPOINTZERO-OS") or the
   **.exe in this folder** — never an old taskbar/Start pin.
3. Check the **build badge** in the sidebar (under "OS"). It should read the build at the top of
   this file. If it's older, you're on a stale copy.
4. If a taskbar/Start icon shows old code: **unpin it**, then pin the installed app or the
   Desktop shortcut instead.
5. **Running the installer does NOT upgrade anything on its own.** It installs whichever exe
   is already sitting in the folder. A new exe only exists after a build — either `npm run ship`
   on this PC, or the automatic Windows build on GitHub. If the badge does not change after
   installing, that is why.

## One version everywhere — including the phone
There is only ever ONE live version. An upgrade REPLACES the old copy; it is never left running
beside it. Five places, and they always match: this workshop folder, the Desktop studio folder,
the installed app, GitHub, and **the phone** — both the hosted app and the studio served from
this PC.

**The phone is the one that used to break this quietly.** A phone app is cached ON the handset so
it can open with no signal. Publishing a new one did not remove the old one, so the phone could
keep showing last week's app indefinitely with nothing on screen to say so. That is fixed:

- every build stamps its own identity into the phone app's cache, so the previous version's files
  are deleted rather than left sitting there;
- the app notices a new version and reloads itself, once;
- **Settings → "This app's version"** shows the stamp, with a "Check for a newer version" button
  beside it. That is the phone's equivalent of the gold sidebar badge, and for the same reason:
  an old copy looks identical to a new one.

If the phone ever still looks old: open Settings, press "Check for a newer version", or simply
close the tab and open it again.

_This is a snapshot of the current build. Re-run a check any time; the app tells you plainly
when something needs internet or setup._
