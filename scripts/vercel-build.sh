#!/usr/bin/env bash
# Vercel build for Pantry (spec §10). Vercel runs it from apps/web (the project's Root Directory)
# through apps/web/vercel.json. It needs CONVEX_DEPLOY_KEY, which the Convex Marketplace integration
# syncs into the Vercel project. Don't run it locally against a real deployment.
#
#   1. Make sure the Convex deployment has BETTER_AUTH_SECRET (generated once, never printed).
#   2. Point Convex SITE_URL at this Vercel project's production URL.
#   3. `convex deploy`: build apps/web with the Convex URLs, typecheck, push functions/schema.
#   4. Data migrations (scripts/migrate.sh --prod): move existing rows to the new layout. A failure
#      fails the build; it's safe to re-run (docs/MIGRATIONS.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Step 3's --cmd re-enters this script to build the web app with the URLs convex deploy provides.
if [[ "${1:-}" == "--web" ]]; then
  : "${NEXT_PUBLIC_CONVEX_URL:?convex deploy should have set NEXT_PUBLIC_CONVEX_URL}"
  # https://<name>.convex.cloud → https://<name>.convex.site (Better Auth's HTTP routes live there)
  export NEXT_PUBLIC_CONVEX_SITE_URL="${NEXT_PUBLIC_CONVEX_URL/%.convex.cloud/.convex.site}"
  export NEXT_PUBLIC_SITE_URL="https://${VERCEL_PROJECT_PRODUCTION_URL:-localhost:3000}"
  echo "▸ Building apps/web against ${NEXT_PUBLIC_CONVEX_URL}"
  cd "$ROOT/apps/web"
  exec pnpm run build
fi

if [[ -z "${CONVEX_DEPLOY_KEY:-}" ]]; then
  echo "✖ CONVEX_DEPLOY_KEY is not set." >&2
  echo "  Connect the Convex integration to this project for Production and Preview, with no Custom Prefix," >&2
  echo "  then redeploy. See the README troubleshooting list." >&2
  exit 1
fi

cd "$ROOT/packages/backend"

# 1. BETTER_AUTH_SECRET. `convex env get` exits 0 even when a variable is missing, so read the names
#    list instead, and only create the secret when the list worked and the name is absent. If listing
#    fails (the key may lack env permissions) we never touch it: overwriting would sign everyone out.
if names="$(pnpm exec convex env list --names-only 2>/dev/null)"; then
  if grep -qx "BETTER_AUTH_SECRET" <<<"$names"; then
    echo "✔ BETTER_AUTH_SECRET is already set (kept)"
  elif pnpm exec convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)" >/dev/null 2>&1; then
    echo "✔ Generated BETTER_AUTH_SECRET on the Convex deployment"
  else
    echo "⚠ Couldn't set BETTER_AUTH_SECRET with this deploy key; the app's setup screen shows the one-line fix."
  fi
else
  echo "⚠ Couldn't read Convex environment variables with this deploy key (no env permission?)."
  echo "  BETTER_AUTH_SECRET and SITE_URL were not changed; the app's setup screen shows the fix if needed."
fi

# 2. SITE_URL follows the production domain, so adding a custom domain fixes itself on the next deploy.
if [[ -n "${VERCEL_PROJECT_PRODUCTION_URL:-}" ]]; then
  if pnpm exec convex env set SITE_URL "https://${VERCEL_PROJECT_PRODUCTION_URL}" >/dev/null 2>&1; then
    echo "✔ SITE_URL = https://${VERCEL_PROJECT_PRODUCTION_URL}"
  else
    echo "⚠ Couldn't set SITE_URL with this deploy key. Set it to https://${VERCEL_PROJECT_PRODUCTION_URL} in the Convex dashboard."
  fi
fi

# 3. Deploy Convex functions; `convex deploy` builds the web app (--cmd) before it pushes.
pnpm exec convex deploy \
  --cmd-url-env-var-name NEXT_PUBLIC_CONVEX_URL \
  --cmd "bash \"$ROOT/scripts/vercel-build.sh\" --web"

# 4. Migrate existing data to the schema just pushed (the transitional schema accepts both shapes,
#    so the push above succeeds on old data). Same deploy key, so the same deployment.
bash "$ROOT/scripts/migrate.sh" --prod
