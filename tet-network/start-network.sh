#!/usr/bin/env bash
# TET Network — one-click dev stack: Ollama (llama3) + L1 node + Next.js UI
# Usage: chmod +x start-network.sh && ./start-network.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
L1_DIR="${TET_L1_DIR:-$ROOT/../tet-core-node}"
UI_DIR="${TET_UI_DIR:-$ROOT/ui}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3}"

log() { printf '%s\n' "$*"; }

if ! command -v ollama >/dev/null 2>&1; then
  log "ERROR: ollama not found. Install from https://ollama.com"
  exit 1
fi

# Ensure ollama daemon is up (required for `ollama run` / API)
if ! pgrep -x ollama >/dev/null 2>&1; then
  log "[ollama] starting ollama serve in background…"
  nohup ollama serve >>/tmp/tet-ollama-serve.log 2>&1 &
  sleep 2
else
  log "[ollama] daemon already running"
fi

# Keep the requested model hot (background). Pull if missing.
if ollama list 2>/dev/null | awk '{print $1}' | grep -qx "$OLLAMA_MODEL"; then
  log "[ollama] model $OLLAMA_MODEL present"
else
  log "[ollama] pulling $OLLAMA_MODEL (first run may take a while)…"
  ollama pull "$OLLAMA_MODEL" || true
fi

if pgrep -af "ollama run $OLLAMA_MODEL" >/dev/null 2>&1; then
  log "[ollama] ollama run $OLLAMA_MODEL already running"
else
  log "[ollama] ollama run $OLLAMA_MODEL in background…"
  nohup ollama run "$OLLAMA_MODEL" </dev/null >>/tmp/tet-ollama-run.log 2>&1 &
fi

if [[ ! -d "$L1_DIR" ]]; then
  log "ERROR: L1 node directory not found: $L1_DIR (set TET_L1_DIR)"
  exit 1
fi
log "[L1] starting solochain-template-node --dev (release)…"
(
  cd "$L1_DIR"
  cargo run --release --bin solochain-template-node -- --dev
) >>/tmp/tet-l1-node.log 2>&1 &
log "[L1] pid $! — logs: /tmp/tet-l1-node.log"

if [[ ! -d "$UI_DIR" ]]; then
  log "ERROR: UI directory not found: $UI_DIR (set TET_UI_DIR)"
  exit 1
fi
cd "$UI_DIR"
if [[ ! -d node_modules ]]; then
  log "[ui] npm install…"
  npm install
fi
log "[ui] npm run dev (foreground; Ctrl+C stops the UI only)…"
exec npm run dev
