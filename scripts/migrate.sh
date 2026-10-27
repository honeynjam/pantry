#!/usr/bin/env bash
# Data migrations after a deploy (docs/MIGRATIONS.md). Runs from anywhere; extra arguments go to
# `convex run`, so the Vercel build passes --prod (with CONVEX_DEPLOY_KEY set, that's the deployment
# `convex deploy` just pushed to) and local dev passes nothing (your local or dev deployment).
#
#   bash scripts/migrate.sh                    # local / dev deployment
#   bash scripts/migrate.sh --prod             # what scripts/vercel-build.sh runs
#   bash scripts/migrate.sh --check-only --prod  # only the guard: fails while old rows remain
#                                              # (the schema-narrowing release runs it BEFORE deploying)
#
# 1. migrations:run moves M2 rows to the Spaces layout (idempotent, batched, logs what it did).
# 2. migrations:assertMigrated fails if anything is left, so a half-done migration fails loudly.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/packages/backend"

if [[ "${1:-}" == "--check-only" ]]; then
  shift
  if ! pnpm exec convex run "$@" migrations:assertMigrated; then
    echo "✖ This deployment still has data in the old layout, or runs a release older than the Spaces" >&2
    echo "  release (no migrations:assertMigrated). Deploy the Spaces release first; it migrates on deploy." >&2
    exit 1
  fi
  echo "✔ No data left to migrate"
  exit 0
fi

echo "▸ Running data migrations (migrations:run)"
if ! pnpm exec convex run "$@" migrations:run; then
  echo "✖ The data migration failed. The new functions are deployed but some data wasn't moved." >&2
  echo "  Fix what the error above names, then re-run: bash scripts/migrate.sh $*  (it's safe to repeat)." >&2
  exit 1
fi
if ! pnpm exec convex run "$@" migrations:assertMigrated >/dev/null; then
  echo "✖ migrations:assertMigrated found rows that still need migrating (see above)." >&2
  exit 1
fi
echo "✔ Data is on the current layout"
