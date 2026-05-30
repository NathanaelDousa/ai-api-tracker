#!/usr/bin/env bash
set -euo pipefail

# ──────────────────────────────────────────────
#  AI API Tracker — Stream Deck dev script
#  Does everything in one go:
#    1. Installs deps (only if needed)
#    2. Builds + deploys to Stream Deck
#    3. Links the plugin (first-time only)
#    4. Optionally watches for changes
#
#  Usage:
#    ./dev.sh           # full build + deploy
#    ./dev.sh watch     # watch mode (auto-rebuild on save)
#    ./dev.sh restart   # just kill + restart the plugin
# ──────────────────────────────────────────────

PLUGIN_NAME="com.nathanaeldousa.ai-api-tracker"

# ── helpers ───────────────────────────────────
say()   { echo -e "\n\033[1;36m→\033[0m $*"; }
ok()    { echo -e "  \033[32m✓\033[0m $*"; }
warn()  { echo -e "  \033[33m⚠\033[0m $*"; }
fail()  { echo -e "  \033[31m✗\033[0m $*"; exit 1; }

# ── step 1: install deps ──────────────────────
if [ ! -d "node_modules" ]; then
  say "Installing dependencies..."
  npm install || fail "npm install failed"
else
  ok "Dependencies already installed"
fi

# ── step 2: build ─────────────────────────────
say "Building..."
npm run build || fail "Build failed"

# ── step 3: link plugin (first-time only) ─────
if ! streamdeck list 2>/dev/null | grep -q "$PLUGIN_NAME"; then
  say "Linking plugin to Stream Deck (first-time setup)..."
  streamdeck link "${PLUGIN_NAME}.sdPlugin" || fail "Failed to link plugin"
else
  ok "Plugin already linked"
fi

# ── step 4 (optional): watch mode ─────────────
if [ "${1:-}" = "watch" ]; then
  say "Starting watch mode — Ctrl+C to stop"
  npm run dev
fi

say "Done! Your plugin should be live on the Stream Deck now."
