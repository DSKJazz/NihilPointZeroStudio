#!/usr/bin/env bash
# Runs the suite and records the count so the live board can show it. Prints the
# tail so the numbers move on screen rather than vanishing into a variable.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 0
OUT="$(npx vitest run "$@" 2>&1)"
echo "$OUT" | tail -5
echo "$OUT" | grep -oE '[0-9]+ passed' | head -2 | tail -1 | grep -oE '[0-9]+' > .live-tests 2>/dev/null || true
