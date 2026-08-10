#!/usr/bin/env bash
# LIVE STATUS BOARD — printed on screen between every step of the 27-item upgrade run.
#
# Why this exists: most of the work is silent (thinking, reading code), so from the
# outside nothing appears to be happening for long stretches. This prints real, moving
# numbers pulled from the actual repo — not a decoration, not a fake spinner. Every
# figure here is read live: the clock, the commit count, the test count, the diff size.
#
#   scripts/live.sh "<what I am doing right now>" [item-number]
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0

NOW="$(date -u '+%H:%M:%S')"
DOING="${1:-working}"
ITEM="${2:-}"

# Session start is stamped once, so elapsed time is real rather than guessed.
STAMP=".live-start"
[ -f "$STAMP" ] || date +%s > "$STAMP"
ELAPSED=$(( $(date +%s) - $(cat "$STAMP") ))
MINS=$(( ELAPSED / 60 )); SECS=$(( ELAPSED % 60 ))

BRANCH="$(git branch --show-current 2>/dev/null || echo '?')"
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
DIRTY="$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')"
ADDED="$(git diff origin/main --shortstat 2>/dev/null | grep -oE '[0-9]+ insertion' | grep -oE '[0-9]+' || echo 0)"
FILES="$(git diff origin/main --name-only 2>/dev/null | wc -l | tr -d ' ')"

# Test count from the last recorded run (written by the runner below).
TESTS="$(cat .live-tests 2>/dev/null || echo '—')"

BAR=""
if [ -n "$ITEM" ]; then
  DONE_N=$(( ITEM - 1 ))
  for ((i=0;i<27;i++)); do
    if [ $i -lt $DONE_N ]; then BAR="${BAR}█"; elif [ $i -eq $DONE_N ]; then BAR="${BAR}▓"; else BAR="${BAR}░"; fi
  done
fi

printf '\n'
printf '┌──────────────────────────────────────────────────────────────────┐\n'
printf '│ NIHILPOINTZERO · 27-ITEM UPGRADE RUN            %s UTC   │\n' "$NOW"
printf '├──────────────────────────────────────────────────────────────────┤\n'
[ -n "$ITEM" ] && printf '│ %s  %2s/27 │\n' "$BAR" "$ITEM"
printf '│ NOW:      %-54s │\n' "${DOING:0:54}"
printf '│ elapsed:  %-6s   tests: %-7s   commits ahead: %-11s │\n' "${MINS}m${SECS}s" "$TESTS" "$AHEAD"
printf '│ branch:   %-24s  files changed: %-11s │\n' "${BRANCH:0:24}" "$FILES"
printf '│ new lines:%-8s  uncommitted files: %-21s │\n' "+$ADDED" "$DIRTY"
printf '└──────────────────────────────────────────────────────────────────┘\n'
