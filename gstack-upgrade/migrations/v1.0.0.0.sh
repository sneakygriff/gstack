#!/usr/bin/env bash
# Migration: v1.0.0.0 — V1 writing style notice
#
# What changed: tier-≥2 skills default to ELI10 writing style (jargon glossed on
# first use, outcome-framed questions, short sentences). Power users who prefer
# the older V0 prose can set `gstack-config set explain_level terse`.
#
# History: this migration originally wrote a "pending prompt" flag that the
# preamble was meant to turn into a one-time AskUserQuestion. That prompt never
# fired in production — the preamble never echoed the WRITING_STYLE_PENDING
# flag, and the explain_level short-circuit was always taken because
# `gstack-config get` falls back to the 'default' value (never empty). The
# prompt plumbing was removed with the #48 preamble carve; the migration now
# just prints a one-line notice with the opt-out. Idempotent — safe to run
# multiple times.
#
# Affected: every user on v0.19.x and below who upgrades to v1.x
set -euo pipefail

GSTACK_HOME="${GSTACK_HOME:-$HOME/.gstack}"
PROMPTED_FLAG="$GSTACK_HOME/.writing-style-prompted"

mkdir -p "$GSTACK_HOME"

# If the notice was already shown (or the user answered the old prompt), skip.
if [ -f "$PROMPTED_FLAG" ]; then
  exit 0
fi

# Clean up a stale pending flag from the old prompt plumbing, if one exists.
rm -f "$GSTACK_HOME/.writing-style-prompt-pending"

touch "$PROMPTED_FLAG"

echo "  [v1.0.0.0] V1 writing style is now the default (glossed jargon, outcome framing). Prefer the older terse prose? Run: gstack-config set explain_level terse"
