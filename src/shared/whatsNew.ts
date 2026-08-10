/**
 * "What changed" — the screen that tells you what is new in the build you are running.
 *
 * WHY THIS EXISTS
 * An old build looks exactly like a new one. The gold badge in the sidebar proves WHICH
 * build is running, but it cannot tell you what that build actually does differently.
 * So every upgrade so far has been invisible: work lands, the app looks identical, and
 * the only way to find a new feature is to be told about it in a chat message that
 * scrolls away.
 *
 * THE ONE RULE THIS MODULE MUST NEVER BREAK
 * It must never advertise something the running build does not have. That is the exact
 * failure mode of a hand-written changelog: the note ships before the code, the user
 * goes looking for the button, and the button is not there. So every entry carries the
 * date it shipped, and an entry dated after the running build's own timestamp is
 * WITHHELD — not shown greyed out, not shown as "coming soon". Withheld, and shown for
 * the first time in the build that really contains it.
 *
 * WHY "SEEN" IS TRACKED BY ENTRY, NOT BY DATE
 * This project ships several times a day. Remembering "the last build the user saw" and
 * showing entries newer than that date loses every change that shipped later on the same
 * day. Remembering which ENTRIES have been read is exact, survives multiple ships an
 * hour, and cannot drift.
 *
 * Pure and shared: the desktop window and the phone both read this same list, so the
 * "what changed" screen can never disagree between them.
 */

export interface ChangeEntry {
  /** Stable id, never reused and never renamed — this is what "already read" is keyed on. */
  id: string
  /** yyyy-mm-dd the change shipped. Used ONLY to withhold entries newer than the build. */
  date: string
  /** One line, the headline. Written the way the user would describe it. */
  title: string
  /** What it does for them and why they would care. Plain English, no jargon. */
  detail: string
  /** Where to find it in the app, so the entry ends in an action. */
  where: string
}

/**
 * Newest first. Written in the same plain voice as the shipped docs.
 *
 * Add an entry in the same commit as the change it describes, so the two can never come
 * apart. Never edit an existing id.
 */
export const CHANGELOG: ChangeEntry[] = [
  {
    id: 'music-examples-and-shot-math',
    date: '2026-08-08',
    title: 'Music examples you can hear, and film lengths that finally add up',
    detail:
      'Two things. Video Studio\u2019s music panel gains "Make me examples to listen to": three genuinely different full-length beds, composed offline for free, each with one plain sentence saying why it fits your script — play them, compare, press "Use this one"; nothing is picked for you. And the Storyboard Director\u2019s maths is fixed: a long script with a 10-minute target used to explode into hundreds of two-second flashes whose real total was far longer than asked (seen on your screen: 493 shots "for" 606 seconds that actually summed to 986). Now the target decides how many shots fit, the seconds are shared out so the total equals the target TO THE SECOND, and longer sentences get proportionally longer on screen.',
    where: 'Video Studio → Background music → "🎼 Make me examples", and Storyboard Director → Direct storyboard (automatic)'
  },
  {
    id: 'caretaker',
    date: '2026-08-07',
    title: 'The Caretaker — the studio now checks itself on a schedule',
    detail:
      'A new section in Settings. On a schedule you control (recommended: at every app start and every 6 hours while open — the reason is stated right on the card), the studio runs its live health checks, moves your AI brain off a service that has died, looks for finished videos it lost track of, and keeps a record of every check-up: what it looked at, what it found, what it fixed. You can change the schedule, pause it, run a check-up on demand, and delete the record — only you can. It never runs during a render, and it fixes settings and services only; it never touches your videos, scripts or work.',
    where: 'Settings → 🩺 Caretaker (top of the page)'
  },
  {
    id: 'expert-local-brain',
    date: '2026-08-07',
    title: 'The Expert now runs on its own local brain whenever it can',
    detail:
      'The Expert widget\u2019s "Ask AI" mode used to use whichever brain the whole app was set to — so with an online brain selected and no internet, the one helper you need when things break could not answer. Now the Expert prefers your local brain (Ollama) whenever its switch is ON, with the complete manual as its knowledge, regardless of which brain the rest of the studio uses: no internet, no keys, no allowances. If the local brain is not running it falls back to your active brain, and the Instant button still answers from the manual with no AI at all.',
    where: '🧭 Expert (bottom-left) → Ask AI — automatic when Ollama\u2019s switch is ON in Settings.'
  },
  {
    id: 'library-delete-everywhere',
    date: '2026-08-07',
    title: 'Deleting from the Library now really deletes — file and backups together',
    detail:
      'Deleting a saved image "forever" (or emptying the Trash) used to remove only the list entry: the picture itself, and its backup copies, stayed on your disk as ghosts you would have to hunt down by hand. Now the entry, the file and the backup copies go together, in one action, and the Activity Log records it. Two protections stand: only files inside the studio\u2019s own data folder are ever touched — a picture you imported from your Desktop is YOUR original and is never deleted — and as always, only you can delete anything; nothing automatic ever does.',
    where: 'Automatic — Library → Trash → "Delete forever" / "Empty Trash" now clean up completely.'
  },
  {
    id: 'scene-length-control',
    date: '2026-08-07',
    title: 'One box sets how long every scene stays — and any scene can still differ',
    detail:
      'Scene Studio now has "Every scene stays … sec" at the top: type 1.5 and press Apply to all, and every scene card is set to a second and a half — from half a second up to minutes, your call. Then change any single card\u2019s own "Stays" box to make just that scene run longer or shorter than the rest, like five seconds for the one that matters. Leave everything empty and the automatic pacing still fits the total to the narration exactly as before.',
    where: 'Scene Studio → the "⏱ Every scene stays" box next to Plan scenes'
  },
  {
    id: 'honesty-gate',
    date: '2026-08-07',
    title: 'No more black-void videos pretending to be finished',
    detail:
      'You found videos in your folder that were just dark emptiness with a filename. Cause: when a scene image failed to arrive, the builder quietly substituted a plain dark frame — or skipped the scene — and kept going, so on a day the free image service refused everything, it happily built an hour of nothing and told no one. Now every builder counts its failures: one or two lost scenes still pass (that has always been the promise), but a build where MOST scenes failed refuses to finish and says which scenes failed and why, instead of wasting an hour producing a void.',
    where: 'Automatic — Video Studio, Storyboard Director and Presenter builds all refuse dishonest results and name the reason.'
  },
  {
    id: 'switchboard-gemini',
    date: '2026-08-07',
    title: 'An AI switchboard, and Gemini as a free brain',
    detail:
      'Settings now has a switchboard: every AI brain the studio can use, each with a plain ON/OFF switch and a "use this one" button. OFF finally means off — a switched-off brain is never contacted, not even as a backup. The old free online service (the one that started demanding payment) is off by default; your local brain stays on. And Gemini joins as a real brain through a key Google gives away free: a two-minute walkthrough with a button for each step, the key tested against Google before it is saved, and a generous free daily allowance that renews itself. ChatGPT and Grok give away their websites but not their machinery, so they get honest open-in-browser buttons instead — the studio will never ask to store your passwords.',
    where: 'Settings → AI switchboard, and Settings → Connect Gemini → "Show me how"'
  },
  {
    id: 'recording-fixes',
    date: '2026-08-07',
    title: 'Percent signs no longer kill video builds, and scene images behave',
    detail:
      'Three fixes straight from your screen recording. A headline with a percent sign in it — "OIL UP 40%" — crashed the whole video build with a cryptic ffmpeg error; fixed, with a test so it stays fixed. Scene images now carry the image service’s strict content filter on every request (it existed and was never being switched on), scenes that never mention a person now say NO PEOPLE to the image maker instead of letting it invent one, and scenes that do ask for a person require modest professional dress. And when the free online AI died, the error told you to add a paid key — that sentence is gone everywhere; the answer to a free service dying is the free local brain, and the app stops consulting a dead service on every request.',
    where: 'Automatic — nothing to set. Scene Studio → regenerate any scenes you disliked and they follow the new rules.'
  },
  {
    id: 'youtube-walkthrough',
    date: '2026-08-02',
    title: 'Connecting YouTube is now a walkthrough, not an instruction',
    detail:
      'Three tabs — Your channel, the questions from your comments, and the competitor gaps — read nothing without a free YouTube key, and all Settings ever did was tell you to go to Google Cloud, switch a service on, make a key, and get on with it. That is accurate and useless. Now it is five numbered steps with a button on each that opens the exact page, and when you paste the key the app really tries it: if something is wrong it says which step to go back to, in plain English. The commonest fault by far is a perfectly good key on a project where the service was never switched on, and it now says exactly that instead of letting you assume you mistyped it. Then type your @name and it finds your channel ID for you — the long UC… string YouTube buries three menus deep — and shows the channel name back so you can see it picked the right one. If a channel panel ever comes back empty it now says WHICH of seven reasons it was, and "could not reach YouTube" is amber and honest rather than a claim that you have no videos. Red means wrong and here is the fix; amber means the app could not tell, and is never something for you to chase.',
    where: 'Settings → Connect YouTube → "Show me how"'
  },
  {
    id: 'version-panel',
    date: '2026-08-01',
    title: 'The app now tells you whether it is up to date',
    detail:
      'Before this, the app only ever spoke when it was BEHIND — so if you had just updated, it said nothing, and "nothing" looks exactly like a broken app. There is now a Version panel that says plainly: up to date, or a newer one exists, or "could not check just now" — and it shows which build you are running next to which one is published, so you can see it rather than take my word for it. It fixed a real bug too: updates published from the cloud were invisible to the app, and nothing anywhere said so.',
    where: 'Settings → Version (top of the page) → "Check now"'
  },
  {
    id: 'start-with-windows',
    date: '2026-08-01',
    title: 'Turn the laptop on and the studio is open — and already up to date',
    detail:
      'The studio now opens by itself when Windows starts. And because nobody is waiting for it at that moment, that is when it quietly installs any update it finds — so by the time you sit down it is already the newest version, with nothing to press. If you open the app yourself instead, it does not hijack you: you get the notice and you choose. It never updates while a render or a queue is running.',
    where: 'Settings → "Open the studio when Windows starts" (on by default)'
  },
  {
    id: 'self-installing-update',
    date: '2026-08-01',
    title: 'The app now updates itself',
    detail:
      'Updating used to mean opening a web page, getting past a download warning, finding the file and double-clicking it. Now the blue "A newer version exists" notice does the whole thing: it downloads the update, checks it is the right file, starts it, and closes the app so it can finish. You say yes to Windows once and it reopens updated. Nothing to find, nothing to open.',
    where: 'The blue notice at the bottom of the window → "Get the update"'
  },
  {
    id: 'whats-new-screen',
    date: '2026-08-01',
    title: 'A "What changed" screen',
    detail:
      'Every upgrade used to be invisible — the app looked identical afterwards. Now the new things in the build you are running are listed here, and only the ones that are really in it.',
    where: 'Settings → What changed'
  },
  {
    id: 'proxy-editing',
    date: '2026-08-01',
    title: 'Smooth scrubbing on big videos',
    detail:
      'A 4K clip has to be decoded every time you drag the scrubber, so the picture lags behind your finger and trimming to an exact word becomes guesswork. This makes a small stand-in copy to scrub against. It is built to be exactly the same length as the original, and that is checked afterwards rather than assumed — so a cut you make against the stand-in lands in precisely the same place. The finished video is still made from your full-quality file.',
    where: 'Timeline Editor → "⚡ Scrub smoothly" on any clip bigger than 1080p'
  },
  {
    id: 'resume-render',
    date: '2026-08-01',
    title: 'A failed render no longer starts again from nothing',
    detail:
      'The narration is the slow part and it is finished before anything that usually goes wrong has even started — so if a render dies twenty minutes in, pressing Build again now picks up the narration it already recorded instead of speaking the whole script over again. It only ever reuses narration recorded for exactly these words in exactly this voice; change one word and it starts fresh, because narration that does not match the words would be far worse than the time lost.',
    where: 'Automatic — just press Build again'
  },
  {
    id: 'scene-preview',
    date: '2026-08-01',
    title: 'Watch one scene before rendering the whole video',
    detail:
      'A still picture cannot tell you whether the slow camera move drifts your subject out of the frame, or whether the colour treatment suits that particular photo. Now you can watch any one scene — with the real move and the real look, in a few seconds — instead of rendering the whole video to check six seconds of it.',
    where: 'Scene Studio → "▶ Watch this scene" under any finished scene'
  },
  {
    id: 'render-queue',
    date: '2026-08-01',
    title: 'Line up an evening of videos and walk away',
    detail:
      'Queue as many videos as you like and they build one after another. The list is written down, so closing the app — or a power cut — does not lose what has not been built yet, and anything interrupted goes back in the queue next time you open the studio. If one fails, only that one fails: the rest carry on, and the failure stays on the list with its reason so you can try it again.',
    where: 'Video Studio → "＋ Queue it" instead of Build'
  },
  {
    id: 'crash-report',
    date: '2026-08-01',
    title: 'A crash can no longer close the app without a word',
    detail:
      'A tab that stopped working was already caught and written down. The app itself closing was not — it simply vanished, with no message and nothing in the log, which is impossible to report to anyone. Now it tells you it has to close and writes what happened into Known Issues first. Your work is saved either way.',
    where: 'Settings → Known Issues'
  },
  {
    id: 'scene-undo',
    date: '2026-08-01',
    title: 'Undo in the Scene Studio',
    detail:
      'Scene Studio was the one place where deleting a scene, or rewriting a prompt you liked, was final for the session — and it is the place where one scene can be several minutes of generating. Ctrl+Z now works there like it already did in the Timeline and Storyboard.',
    where: 'Scene Studio → the two arrows at the top, or Ctrl+Z'
  },
  {
    id: 'thumbnail-test',
    date: '2026-08-01',
    title: 'Test two thumbnails without fooling yourself',
    detail:
      'It gives you genuinely different thumbnails to try — a number, a question, the subject alone — built from your own words, plus a plain one to test them against. It warns when a headline is too long to read at the size people see it, or just repeats the title sitting right beside it. And once you have the numbers from YouTube Studio it tells you whether the difference is real or just chance, which is the part nobody can do by eye. YouTube does not let any app read click-through per thumbnail, so the swapping and the reading are yours to do — the app says so instead of pretending.',
    where: 'Script Writer → Test two thumbnails properly'
  },
  {
    id: 'credit-check',
    date: '2026-08-01',
    title: 'A credit check before you publish',
    detail:
      'It is not a copyright detector — nothing on your PC can tell you whether YouTube will claim something, and it says so. What it does check is the paperwork for music and footage the app fetched for you: whether the licence obliges you to credit the artist, and whether that credit is actually in your description. A missing credit is exactly what turns a free track into a claim. It also says plainly when a file came from you, because then only you know.',
    where: 'Video Studio → Credits → Check before publishing'
  },
  {
    id: 'dual-language-upload',
    date: '2026-08-01',
    title: 'Upload in both languages, with the codes right',
    detail:
      'YouTube shows every viewer the title and description in their own language, if you give it both. Roman Urdu is not English and not Urdu — it is its own code, ur-Latn, and labelling it wrong quietly costs you reach. It also warns before YouTube silently cuts a title over 100 characters or tags over 500.',
    where: 'Script Writer → Upload in both languages'
  },
  {
    id: 'competitor-gaps',
    date: '2026-08-01',
    title: 'What other channels get views on that you have never made',
    detail:
      'Trending tells you what is popular. This tells you what is popular that YOU have never covered — demand somebody has already proved, with nothing of your own competing for it. Every gap comes with the real videos behind it so you can check it, and it needs more than one channel covering something before it says anything.',
    where: 'Your Channel → Find the gaps'
  },
  {
    id: 'read-aloud',
    date: '2026-08-01',
    title: 'Hear your script read out at double speed',
    detail:
      'A script is spoken, not read, and reading it silently hides the faults that cost a retake — the sentence you cannot say in one breath, the number that is ambiguous out loud, the word repeated twice that the eye skips over. It reads the script to you at double speed and lists what to listen for, with the time each one happens.',
    where: 'Script Writer → Read it to me'
  },
  {
    id: 'series-linking',
    date: '2026-08-01',
    title: 'Your episodes linked to each other',
    detail:
      'It reads your own titles, works out which videos belong to the same series, tells you if a number is missing or used twice, and writes the description block, the pinned comment and the end-screen line for you. Reads Part, Episode, Hissa and Qist.',
    where: 'Your Channel → Get the links'
  },
  {
    id: 'channel-learning',
    date: '2026-08-01',
    title: 'The studio learns from YOUR channel, not from general advice',
    detail:
      'It reads your own past videos and works out which title shapes actually did better for you, and which day and hour your audience really shows up. It reports the number of videos behind every claim, and it refuses to answer at all until there is enough history to be honest.',
    where: 'Your Channel → Work it out'
  },
  {
    id: 'comment-mining',
    date: '2026-08-01',
    title: 'Video ideas pulled straight out of your comments',
    detail:
      'It reads your comments, finds the questions, groups the ones asking the same thing in English and Roman Urdu together, and ranks them by how many different people asked. Every question is quoted word for word from a real comment, so you can check it.',
    where: 'Your Channel → Read my comments'
  },
  {
    id: 'preflight',
    date: '2026-08-01',
    title: 'Problems caught in one second instead of twenty minutes',
    detail:
      'Before a render starts it checks the things that actually waste an hour: that ffmpeg really runs (not just that the file is there), that the work folder can be written to, that there is disk space, and which encoder you will get. It refuses only when the render genuinely cannot finish.',
    where: 'Runs automatically before every render'
  },
  {
    id: 'sources',
    date: '2026-08-01',
    title: 'Every figure traceable to a file and a row',
    detail:
      'Numbers that came out of a spreadsheet or PDF now carry where they came from, down to the row. If a figure in the script cannot be traced back to a source, it is flagged before you record it.',
    where: 'Script Writer → Where your numbers came from'
  },
  {
    id: 'pacing',
    date: '2026-08-01',
    title: 'Videos tighten toward the end instead of sagging',
    detail:
      'Scene lengths are planned so the last third moves faster than the first, which is where most finance videos lose people. The total length is preserved exactly, so the narration still lines up.',
    where: 'Automatic on every render'
  },
  {
    id: 'hook-rebuild',
    date: '2026-08-01',
    title: 'The first fifteen seconds rebuilt, from your own words',
    detail:
      'It offers five different openings for the script you already wrote — a contradiction, a number, a question, what is at stake, or dropping the viewer mid-scene — using only sentences from your script. Nothing is invented.',
    where: 'Script Writer → Rebuild the first fifteen seconds'
  },
  {
    id: 'chart-animation',
    date: '2026-08-01',
    title: 'Charts that draw themselves on screen',
    detail:
      'A line or bar chart now animates in as you talk over it, instead of appearing all at once as a flat picture.',
    where: 'Charts → Draw it on'
  },
  {
    id: 'broll-timing',
    date: '2026-08-01',
    title: 'B-roll that lands on the word it belongs to',
    detail:
      'When the script says "reserves" or "mehngai", the matching footage now appears on that word rather than somewhere near it. Works on English and Roman Urdu.',
    where: 'Automatic when stock footage is on'
  },
  {
    id: 'auto-zoom',
    date: '2026-08-01',
    title: 'Slow camera movement on every shot',
    detail:
      'Still footage no longer sits frozen. Each shot gets a slow push in or pull out, alternating so it never drifts in one direction, which is what makes a static clip look cheap.',
    where: 'Automatic on footage backgrounds'
  },
  {
    id: 'silence-removal',
    date: '2026-08-01',
    title: 'Cut the dead air out of a take',
    detail:
      'It tells you first what would be cut, then removes the long pauses where nothing is said, keeping a quarter-second of breath so it still sounds like a person talking. Picture and sound are cut together, so nothing goes out of sync. It makes a new video — your original is never touched.',
    where: 'Video Studio → Dead air → What would be cut?'
  },
  {
    id: 'youtube-loudness',
    date: '2026-08-01',
    title: 'Audio at the level YouTube actually wants',
    detail:
      'YouTube turns loud uploads down. Delivering at its own target instead means your video is not quietly turned down against everyone else.',
    where: 'Automatic on every render'
  },
  {
    id: 'one-pass-render',
    date: '2026-08-01',
    title: 'One render instead of four, so quality stops leaking',
    detail:
      'Colour, captions, watermark and trimming used to be four separate encodes, and every encode loses a little picture quality. They now happen in one pass.',
    where: 'Automatic on every render'
  },
  {
    id: 'repurpose',
    date: '2026-08-01',
    title: 'One script, every platform',
    detail:
      'From a finished script it writes the YouTube description with chapters, a community post, an X thread inside the character limit, a LinkedIn post and a WhatsApp broadcast — each in that platform\'s own shape, not the same text pasted five times.',
    where: 'Writer → Repurpose'
  },
  {
    id: 'ai-timeouts',
    date: '2026-08-01',
    title: 'An AI outage can no longer hang the app',
    detail:
      'When a provider stops answering, the wait is now bounded and it moves to the next brain instead of sitting there. The app also tells you which brain answered.',
    where: 'Automatic; the brain used is shown with the answer'
  },
  {
    id: 'phone-studio',
    date: '2026-08-01',
    title: 'The whole studio on your phone',
    detail:
      'Not a cut-down mobile version — the same screens, with your laptop doing the work. Anything added to the app appears on the phone too, automatically.',
    where: 'Settings → Phone, scan the QR code'
  },
  {
    id: 'phone-version-stamp',
    date: '2026-08-01',
    title: 'The phone can no longer get stuck on an old version',
    detail:
      'A phone keeps a copy of the app on the handset, so publishing a new one used to leave the old one running. Now the old copy is deleted and the page reloads itself once, and the version it is running is printed on the Settings screen.',
    where: 'Phone → Settings, bottom of the screen'
  }
]

/** How many entries a first run shows before it starts counting the rest. */
export const FIRST_RUN_MAX = 12

/**
 * The date+time out of a build tag like "v0.1.1 · 2026-08-01 04:30 · 3354ec9".
 * Null when the tag carries no timestamp — in which case nothing is claimed.
 */
export function tagStamp(tag: string): number | null {
  const m = /(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/.exec(tag ?? '')
  if (!m) return null
  const t = Date.parse(`${m[1]}T${m[2]}:${m[3]}:00`)
  return Number.isNaN(t) ? null : t
}

/** The yyyy-mm-dd out of a build tag, or null. */
export function tagDay(tag: string): string | null {
  return /(\d{4}-\d{2}-\d{2})/.exec(tag ?? '')?.[1] ?? null
}

/**
 * The entries that are genuinely IN this build.
 *
 * Compared at day granularity, and inclusive of the build's own day: an entry is written
 * in the same commit as its change, so a change that shipped this morning is in a build
 * stamped this afternoon. An entry dated tomorrow is not in today's build and is
 * withheld — that is the whole point of the check.
 */
export function entriesInBuild(buildTag: string, log: ChangeEntry[] = CHANGELOG): ChangeEntry[] {
  const day = tagDay(buildTag)
  const entries = (log ?? []).filter((e) => e && typeof e.id === 'string' && typeof e.date === 'string')
  // Without a readable build date there is no way to know what is in this build, so
  // nothing is claimed. Silence is the honest answer; a guess is not.
  if (!day) return []
  return entries.filter((e) => e.date <= day)
}

export interface WhatsNewReport {
  /** Unread entries that really are in this build, newest first. */
  entries: ChangeEntry[]
  /** True when nothing has ever been marked read — the first time the screen is opened. */
  firstRun: boolean
  /** One line for the top of the screen. */
  headline: string
  /** How many to show before "and N more" — the UI may collapse past this. */
  showAtMost: number
  /** The ids to remember once the user has seen the screen. */
  rememberIds: string[]
  /** The build the report describes, echoed back so the screen can show it. */
  buildTag: string
}

/**
 * What is new in the running build that this user has not read yet.
 *
 * `seenIds` is whatever was stored last time. An unknown id in it is ignored rather than
 * treated as an error, so an entry can be removed from the changelog without breaking
 * anyone's stored state.
 */
export function whatsNewReport(input: {
  buildTag: string
  seenIds?: string[] | null
  log?: ChangeEntry[]
}): WhatsNewReport {
  const log = input.log ?? CHANGELOG
  const inBuild = entriesInBuild(input.buildTag, log)
  const seen = new Set((input.seenIds ?? []).filter((x) => typeof x === 'string'))
  const firstRun = !input.seenIds || input.seenIds.length === 0
  const entries = inBuild.filter((e) => !seen.has(e.id))

  let headline: string
  if (!tagDay(input.buildTag)) {
    headline = 'Cannot tell which build this is, so nothing is claimed about what changed in it.'
  } else if (!entries.length) {
    headline = 'Nothing new since you last looked. You are up to date with this build.'
  } else if (firstRun) {
    headline = `${entries.length} thing${entries.length === 1 ? '' : 's'} in this build you have not seen yet.`
  } else {
    headline = `${entries.length} new thing${entries.length === 1 ? '' : 's'} since you last looked.`
  }

  return {
    entries,
    firstRun,
    headline,
    showAtMost: firstRun ? FIRST_RUN_MAX : entries.length,
    // Everything in the build is remembered, not just what fitted on screen: the list is
    // expandable, and re-announcing an entry the user already scrolled past is noise.
    rememberIds: inBuild.map((e) => e.id),
    buildTag: input.buildTag
  }
}

/**
 * True when there is something worth putting a dot on the Settings link for.
 *
 * Kept separate from the report so the sidebar can ask the cheap question without
 * building the whole thing.
 */
export function hasUnread(buildTag: string, seenIds?: string[] | null, log: ChangeEntry[] = CHANGELOG): boolean {
  return whatsNewReport({ buildTag, seenIds, log }).entries.length > 0
}

/** Groups entries by the day they shipped, newest day first — how the screen reads best. */
export function groupByDay(entries: ChangeEntry[]): { date: string; entries: ChangeEntry[] }[] {
  const byDay = new Map<string, ChangeEntry[]>()
  for (const e of entries ?? []) {
    const arr = byDay.get(e.date)
    if (arr) arr.push(e)
    else byDay.set(e.date, [e])
  }
  return [...byDay.entries()]
    .map(([date, list]) => ({ date, entries: list }))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
}
