---
description: Install (build) and launch Roz for LSC, the Life Sciences Cloud (LSC) desktop app
---

# Launch Roz for LSC (Desktop App)

Build (on first run) and launch **Roz for LSC**, the Electron desktop app — a
standalone chat UI backed by this plugin's knowledge base, skills, and Salesforce
org tools.

## Steps

1. Run the launch script from the plugin directory:

   ```bash
   bash "${CLAUDE_PLUGIN_ROOT}/scripts/launch-electron-app.sh"
   ```

   If `$CLAUDE_PLUGIN_ROOT` is not set, fall back to the current repository root
   (the directory containing `package.json` and `src-electron/`).

2. The script is idempotent and does the following:
   - Verifies Node.js 18+ and npm are available.
   - Installs npm dependencies (first run only).
   - Builds the MCP server (`dist/`), then the Electron main + renderer bundles
     (`dist-electron/`, `dist-renderer/`) — only what's missing.
   - Rebuilds native modules (`better-sqlite3`) for Electron's ABI (best effort).
   - Launches the app **detached**, so this command returns immediately.

3. Report the outcome to the user:
   - On success, tell them the **Roz for LSC** window is opening, and that on
     first launch they'll be asked to choose an **LLM provider** — either an
     **Anthropic API key** or a **Bedrock / custom gateway** (base URL + key).
     If `ANTHROPIC_API_KEY` or `ANTHROPIC_BEDROCK_BASE_URL` are set in their
     environment, the app auto-detects and connects without prompting.
   - If the build or launch fails, surface the error and the log path the script
     prints (`$TMPDIR/lsc-assistant.log`).

## Notes

- **Prerequisites:** Node.js 18+ and npm. Everything else is built from source —
  no downloads or code signing involved.
- **Rebuild from scratch:** `LSC_FORCE_BUILD=1 bash "${CLAUDE_PLUGIN_ROOT}/scripts/launch-electron-app.sh"`
- **Native module issues:** if the window never appears, check the log; a common
  fix is `npx @electron/rebuild -f -w better-sqlite3` in the plugin directory.
