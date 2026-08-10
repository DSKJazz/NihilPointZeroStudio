# BRIEF — the personal AI ("the brain"), a SEPARATE project

**If you are a new session picking this up: read this file and `CLAUDE.md`, then start.
The user should not have to explain any of it again.** He dictates by voice, is
non-technical, and is tired of repeating himself.

This project is **deliberately separate** from NihilPointZero Studio. Different folder,
different repo. It gets linked to the studio only once it stands on its own. The user runs
several projects and wants ONE brain that eventually serves all of them.

The name is his to give. Until he does, call it "the brain". Do not invent one.

---

## The person you are building for

- Non-technical. Dictates everything by voice. **Will not follow multi-step instructions** —
  if the answer is "just go and configure X", that is a design failure, not his task.
- Runs a finance/economics YouTube studio in Roman Urdu / Urdu / English.
- Windows laptop, **Intel UHD integrated graphics, no NVIDIA, CPU only**. Ollama with
  llama3.1:8b runs locally.
- Has spent thousands on tokens and is exhausted by things breaking, by silent failure, and
  by being handed chores.
- Judges work by whether it visibly works, not by whether the tests passed.

## Hard constraints — these are not preferences

1. **It must stay free.** No paid APIs, no subscriptions, no rented GPUs. Paid paths may
   exist in code but stay dormant until he personally activates them. See **PAID FEATURES
   SLEEP** in `CLAUDE.md` — it applies here too.
2. **No GPU.** Anything needing CUDA is out.
3. **Nothing may breach a service's terms.** He proposed rotating identities to evade
   free-tier rate limits. That was declined and stays declined. The legitimate substitutes
   are honouring `Retry-After`, backoff with jitter, pacing, caching, and free *keyed* tiers.
4. **It must get smarter over time.** His headline requirement — and he was explicit that it
   is only ONE EXAMPLE of the calibre he expects. Infer the other unstated requirements of
   that standard rather than answering only the literal ask.
5. **No manual procedures.** Anything a machine can do, the machine does.

## What he asked for, in his words

A personal AI that knows all his projects, remembers everything, acts rather than advises,
and improves with use. Built separately, then linked to NihilPointZero — and to the other
projects he is running now and will start later.

## What he has already been told, and rejected as "too basic"

Persistent memory · tools and hands · named skills · works across projects · reasoning
capped by an 8B local model. **Do not repeat this back to him as if it were new.** It is
the floor, not the answer.

## The honest technical ceiling — say this plainly, do not oversell

Training a frontier model is impossible here: it needs tens of thousands of GPUs and sums
that dwarf his token spend. His hardware cannot even fine-tune a small model at useful
speed.

What IS achievable, and where nearly all the value lives: everything wrapped around the
model — memory, tools, skills, evaluation, orchestration. Raw reasoning stays bounded by
whatever model runs locally. **Excellent memory and integration with a modest brain** is
the honest description. Swapping in a stronger model later must be a one-line change, which
means the architecture has to keep the brain replaceable from day one.

## Work already done in the studio chat, 2026-08-02

A **40-agent workflow** was run to design this properly: 18 independent expert lenses
(memory, self-improvement without training, small-model performance on CPU, legitimate
distillation, free compute durability, skills, evaluation, multi-project orchestration,
signal capture, voice-first interface, resilience, privacy, zero-cost engineering, grounding,
agency, personality, sequencing, and unstated requirements), each adversarially critiqued,
then three competing staged plans judged against each other, a completeness critic, and a
final synthesis.

**Run ID `wf_22d1a707-aca`.** Transcript:
`/root/.claude/projects/-home-user-NihilPointZeroStudio/fbd385f9-a5eb-5eea-8ed6-3dff39fa6049/subagents/workflows/wf_22d1a707-aca`
(that path is session-local and will not survive; the conclusions get appended below when
the run lands.)

> **STATUS: the workflow was still running when the chats were split.** If the section
> below is still empty, the analysis did not get captured — say so honestly and re-run it
> rather than inventing conclusions. The script is saved and can be re-run.

## The design, from the fan-out

_(to be appended)_

## First milestone, unless he redirects

The memory core and the skill runner — the parts that are his forever and do not depend on
which model sits underneath. Everything else can be rebuilt; those two are expensive to get
wrong later.

## Ground rules carried over from the studio, which apply here too

- **NOTHING IS LOST** — push at every coherent step; keep a RESUME file current in the repo;
  never leave the tree un-buildable; put the reasoning in commit messages.
- **THE LAST STEP IS MINE, NOT THE USER'S** — never hand him a procedure a machine could run.
- **Never let "I could not tell" render as success.** Every check needs a distinct, visible,
  logged "unknown" state. This has bitten him repeatedly.
- **Other projects in this account belong to other sessions.** Leave them alone.
