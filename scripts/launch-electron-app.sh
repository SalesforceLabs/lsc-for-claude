#!/usr/bin/env bash
#
# launch-electron-app.sh — build (if needed) and launch the Roz for LSC desktop app.
#
# Used by the /lsc:launch-app command. Safe to run repeatedly: it only builds
# artifacts that are missing, then launches the Electron app detached so the
# calling shell (or Claude Code command) returns immediately.
#
# Override behavior with env vars:
#   LSC_FORCE_BUILD=1     Rebuild all artifacts even if present.
#   LSC_SKIP_REBUILD=1    Skip the Electron native-module rebuild step.
#
set -euo pipefail

# Resolve the plugin/repo root as the parent of this script's directory,
# regardless of where it's invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT}"

log()  { printf '\033[36m▸ %s\033[0m\n' "$1"; }
ok()   { printf '\033[32m✓ %s\033[0m\n' "$1"; }
warn() { printf '\033[33m! %s\033[0m\n' "$1"; }
fail() { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

# --- Prerequisites -----------------------------------------------------------
command -v node >/dev/null 2>&1 || fail "Node.js 18+ is required but was not found on PATH. Install from https://nodejs.org and retry."
command -v npm  >/dev/null 2>&1 || fail "npm is required but was not found on PATH."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "${NODE_MAJOR}" -lt 18 ]; then
  fail "Node.js 18+ is required (found $(node -v))."
fi
ok "Node $(node -v) detected"

FORCE="${LSC_FORCE_BUILD:-0}"

# --- 1. Dependencies ---------------------------------------------------------
if [ "${FORCE}" = "1" ] || [ ! -d "node_modules" ] || [ ! -d "node_modules/electron" ]; then
  log "Installing dependencies (first run — this can take a minute)…"
  npm install
  ok "Dependencies installed"
else
  ok "Dependencies already installed"
fi

# --- 2. MCP server build (dist/index.js — spawned by the app) ----------------
if [ "${FORCE}" = "1" ] || [ ! -f "dist/index.js" ]; then
  log "Building MCP server…"
  npm run build
  ok "MCP server built"
else
  ok "MCP server already built"
fi

# --- 3. Electron main + renderer build --------------------------------------
if [ "${FORCE}" = "1" ] || [ ! -f "dist-electron/main.js" ] || [ ! -f "dist-renderer/index.html" ]; then
  log "Building desktop app (Electron main + renderer)…"
  npm run electron:build
  ok "Desktop app built"
else
  ok "Desktop app already built"
fi

# --- 4. Rebuild native modules for Electron's ABI ----------------------------
# better-sqlite3 is a native module; it must match Electron's ABI, not Node's.
# Best-effort: if the rebuild tool or step fails, continue — a matching prebuilt
# binary may already be in place.
if [ "${LSC_SKIP_REBUILD:-0}" != "1" ]; then
  log "Rebuilding native modules for Electron…"
  if npx --yes @electron/rebuild -f -w better-sqlite3 >/dev/null 2>&1; then
    ok "Native modules rebuilt for Electron"
  else
    warn "Could not rebuild native modules (continuing). If the app fails to open, run: npx @electron/rebuild -f -w better-sqlite3"
  fi
fi

# --- 5. Launch (detached) ----------------------------------------------------
log "Launching Roz for LSC…"
LOG_FILE="${TMPDIR:-/tmp}/lsc-assistant.log"
# Detach so the app keeps running after this script/command returns.
nohup npm run electron:start >"${LOG_FILE}" 2>&1 &
disown || true

ok "Roz for LSC is starting. A window should appear shortly."
printf '  Logs: %s\n' "${LOG_FILE}"
