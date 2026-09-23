#!/usr/bin/env bash
#
# aidlc-resume.sh — one-shot AI-DLC workflow resume.
#
# Why this exists: resuming an AI-DLC workflow requires driving the engine's
# steering-delivery loop: `orchestrate next --resume` returns a `load-steering`
# directive with a `continue_token`, and each `orchestrate continue <token>`
# returns the next part until a terminal directive (`run-stage`, `ask`, `done`,
# `parked`, `error`) appears. Two traps make this expensive to do by hand:
#
#   1. The managed `aidlc` launcher intermittently exits 130 (SIGINT) and, when
#      driven in a shell loop, tears the loop down mid-chain. Invoking the tool
#      directly through bun (`bun .kiro/tools/aidlc.ts engine ...`) avoids the
#      launcher defect. See the project learning in memory/project.md.
#   2. `orchestrate continue` takes a POSITIONAL token. Passing it as
#      `--token <t>` trips the `args.length !== 1` guard and returns the
#      misleading error "cannot be loaded from where they left off", which looks
#      like token staleness but is not.
#
# This script performs the whole chain in one invocation via bun + positional
# tokens and prints every directive it received (each separated by a line of
# `=== directive N (<kind>) ===`). The last one printed is the terminal
# directive the conductor must act on.
#
# Usage:
#   scripts/aidlc-resume.sh                 # equivalent to /aidlc --resume
#   scripts/aidlc-resume.sh --stage <slug>  # forward any `next` flags verbatim
#
# It mutates no workflow state: `next` and `continue` are read-only transport.

set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || dirname "$(dirname "$0")")"

TOOL=".kiro/tools/aidlc.ts"
if [ ! -f "$TOOL" ]; then
  echo "aidlc-resume: cannot find $TOOL from $(pwd)" >&2
  exit 1
fi

engine() { bun "$TOOL" engine orchestrate "$@"; }
kind_of() { sed -n 's/.*"kind":"\([^"]*\)".*/\1/p' <<<"$1" | head -1; }
token_of() { sed -n 's/.*"continue_token":"\([^"]*\)".*/\1/p' <<<"$1" | head -1; }

# First call: forward all args verbatim (default to --resume when none given).
if [ "$#" -eq 0 ]; then
  out=$(engine next --resume)
else
  out=$(engine next "$@")
fi

i=0
kind=$(kind_of "$out")
echo "=== directive $i ($kind) ==="
printf '%s\n' "$out"

token=$(token_of "$out")
while [ "$kind" = "load-steering" ] && [ -n "$token" ]; do
  i=$((i + 1))
  out=$(engine continue "$token")   # POSITIONAL token — never --token
  kind=$(kind_of "$out")
  echo "=== directive $i ($kind) ==="
  printf '%s\n' "$out"
  token=$(token_of "$out")
done

echo "=== resume complete: terminal directive kind=$kind ==="
