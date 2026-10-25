#!/usr/bin/env bash
# Runs the same checks as the CI "verify" job (.github/workflows/ci.yml), in the
# same order. Run before pushing: npm run verify
set -euo pipefail

cd "$(dirname "$0")/.."

step() {
  echo
  echo "==> $1"
}

step "Lint"
npm run lint

step "Check formatting"
npx prettier --check "src/**/*.ts"

step "Typecheck (MCP server)"
npx tsc --noEmit

step "Typecheck (Electron main)"
npx tsc -p tsconfig.electron.json --noEmit

step "Typecheck (renderer)"
npx tsc -p tsconfig.renderer.json --noEmit

step "Run tests"
npx vitest run

step "Verify MCP bundle is in sync"
if [ -f mcp-server/index.mjs ]; then
  # Same as CI: rebuild, then fail if the result differs from what git has.
  # `git add` the rebuilt bundle (or commit it) to make this pass.
  npm run bundle
  if ! git diff --quiet -- mcp-server/index.mjs; then
    echo "mcp-server/index.mjs is out of date. Run 'npm run bundle' and commit the result." >&2
    git diff --stat -- mcp-server/index.mjs >&2
    exit 1
  fi
fi

step "Smoke-test MCP server (initialize + tools/list)"
node scripts/mcp-smoke.mjs

echo
echo "All CI checks passed."
