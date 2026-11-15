#!/usr/bin/env bash
# Runs the same checks as .github/workflows/ci.yml, in the same order, from
# a clean tree, so a failure shows up here before it shows up on GitHub.
#
# Usage:
#   pnpm ci:local          every job
#   pnpm ci:local --fast   skip the slow site checks (Lighthouse, Playwright)

set -euo pipefail
cd "$(dirname "$0")/.."

fast=false
if [ "${1:-}" = "--fast" ]; then
  fast=true
fi

step() {
  printf '\n\033[1m== %s ==\033[0m\n' "$1"
}

step "Clean build outputs (CI starts from a fresh checkout)"
rm -rf packages/contracts/dist apps/backend/dist apps/web/dist apps/web/.astro coverage
find . -name '*.tsbuildinfo' -not -path '*/node_modules/*' -delete

step "Install from the lockfile"
pnpm install --frozen-lockfile

step "Lint"
pnpm lint
pnpm format:check

step "Type-check"
pnpm typecheck

step "Test"
pnpm test:coverage

step "Validate data"
pnpm backend validate

step "Determinism check"
pnpm backend score
pnpm backend report
if [ -n "$(git status --porcelain -- results/)" ]; then
  git status --porcelain -- results/
  echo "Scoring output differs from the committed results/ files." >&2
  exit 1
fi

step "Build"
pnpm build

step "Site checks: links and HTML"
pnpm --filter web check:links
pnpm --filter web check:html

if [ "$fast" = true ]; then
  echo
  echo "Skipped Lighthouse and Playwright (--fast)."
else
  # Lighthouse needs Chrome. Fall back to Playwright's browser if there is one.
  if [ -z "${CHROME_PATH:-}" ]; then
    chrome="$(cd apps/web && node -e "try{process.stdout.write(require('@playwright/test').chromium.executablePath())}catch{}" 2>/dev/null || true)"
    if [ -n "$chrome" ] && [ -x "$chrome" ]; then
      export CHROME_PATH="$chrome"
    fi
  fi

  step "Site checks: Lighthouse budgets"
  pnpm --filter web check:lighthouse

  step "Site checks: end-to-end and accessibility (fixture build)"
  MVI_RESULTS_DIR=test/fixtures/site/results pnpm --filter web build
  pnpm --filter web test:e2e --trace off
fi

step "Security"
pnpm audit --audit-level high

printf '\n\033[1mAll local CI checks passed.\033[0m\n'
