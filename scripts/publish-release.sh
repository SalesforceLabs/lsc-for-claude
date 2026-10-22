#!/usr/bin/env bash
#
# publish-release.sh — publish a tagged release from the Release workflow's
# artifact.
#
# The SalesforceLabs org's IP allow list blocks GitHub's hosted runners from
# creating releases, so the Release workflow uploads the signed installers as
# an artifact. Run this from an allowed network: it waits for the tag's run,
# downloads the artifact and creates the GitHub Release with those files.
#
# Usage:
#   scripts/publish-release.sh v0.2.3
set -euo pipefail

TAG="${1:-}"
if [[ ! "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "Usage: $0 <vX.Y.Z>" >&2
  exit 1
fi

REPO="SalesforceLabs/lsc-for-claude"

if gh release view "$TAG" -R "$REPO" >/dev/null 2>&1; then
  echo "Release $TAG already exists: https://github.com/$REPO/releases/tag/$TAG"
  exit 0
fi

RUN_ID="$(gh run list -R "$REPO" --workflow release.yml --branch "$TAG" -L 1 --json databaseId --jq '.[0].databaseId')"
if [[ -z "$RUN_ID" ]]; then
  echo "No Release workflow run found for $TAG. Was the tag pushed?" >&2
  exit 1
fi

echo "Waiting for run ${RUN_ID}…"
gh run watch "$RUN_ID" -R "$REPO" --interval 30 >/dev/null || true

# The release step is allowed to fail (the allow list), so check the artifact
# rather than the run's conclusion.
DIR="$(mktemp -d)"
trap 'rm -rf "$DIR"' EXIT
if ! gh run download "$RUN_ID" -R "$REPO" -n "release-$TAG" -D "$DIR"; then
  echo "Run $RUN_ID has no release-$TAG artifact. Check it: https://github.com/$REPO/actions/runs/$RUN_ID" >&2
  exit 1
fi

gh release create "$TAG" -R "$REPO" --verify-tag --generate-notes "$DIR"/*
echo "Published: https://github.com/$REPO/releases/tag/$TAG"
