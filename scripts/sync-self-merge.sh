#!/usr/bin/env bash
# Merges an "Update Pantry" PR that Sync upstream marked for self-merge, once CI has passed on its head commit.
# This is automatic updates (SYNC_AUTO_MERGE) where GitHub's own auto-merge isn't available, e.g. private repos
# on GitHub Free. Called by .github/workflows/sync-upstream-merge.yml when a CI run completes, and once by
# sync-upstream.yml right after it marks the PR (in case CI already finished).
#
# Merges only when all of these hold, and otherwise leaves the PR open (with a comment when it's stuck):
#   - an open PR from a sync-upstream/* branch in this repo has this commit as its head;
#   - its description carries Sync upstream's marker for this exact commit (so a push by anyone else after
#     the bot's stops it);
#   - every run of the CI workflow on the commit has completed, and all of them succeeded;
#   - GitHub says it merges cleanly.
# It merges with a merge commit (the next update then merges cleanly) and only if the head is still this commit.
#
#   GH_TOKEN=<SYNC_UPSTREAM_TOKEN> GITHUB_REPOSITORY=owner/repo bash scripts/sync-self-merge.sh <head sha>
# The token's merge starts other workflows (Vercel deploys, Watch update deploys) like a merge by a person.
set -euo pipefail

sha="${1:-}"
repo="${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is not set}"
upstream="${UPSTREAM_REPO:-honeynjam/pantry}"
ci="${CI_WORKFLOW:-CI}"
notice() { echo "::notice::$*"; }
lower() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
err="$(mktemp)"

if [ "$(lower "$repo")" = "$(lower "$upstream")" ]; then
  notice "This is $upstream itself; nothing to merge."
  exit 0
fi
if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::usage: sync-self-merge.sh <40-character head sha>"
  exit 1
fi
short="${sha:0:7}"

# The open update PR whose head is this commit.
pr="$(gh api "repos/$repo/commits/$sha/pulls" --jq "[.[] | select(.state == \"open\" and .head.sha == \"$sha\"
  and (.head.ref | startswith(\"sync-upstream/\")) and .head.repo.full_name == \"$repo\")][0].html_url // empty")"
if [ -z "$pr" ]; then
  echo "No open Sync upstream PR has $short as its head; nothing to merge."
  exit 0
fi

comment_once() { # comment_once <key> <text>: one comment per reason (hidden marker)
  if gh pr view "$pr" --repo "$repo" --json comments --jq '.comments[].body' | grep -qF "<!-- pantry-sync:$1 -->"; then
    return 0
  fi
  printf '%s\n\n<!-- pantry-sync:%s -->\n' "$2" "$1" >"$err.comment"
  gh pr comment "$pr" --repo "$repo" --body-file "$err.comment" >/dev/null
}

body="$(gh pr view "$pr" --repo "$repo" --json body --jq .body)"
if ! printf '%s\n' "$body" | grep -qF "<!-- pantry-sync:self-merge sha=$sha -->"; then
  if printf '%s\n' "$body" | grep -qF "<!-- pantry-sync:self-merge sha="; then
    comment_once human-push "Someone pushed to this branch after Sync upstream opened it, so it won't merge by itself any more. Merge it yourself when you're happy with it."
    echo "$pr: the head ($short) isn't the commit Sync upstream pushed; not merging."
  else
    echo "$pr isn't marked to merge by itself; nothing to do."
  fi
  exit 0
fi

# Every CI run on this commit (one for the branch push, one for the PR) must have finished, and all passed.
if ! runs="$(gh api "repos/$repo/actions/runs?head_sha=$sha&per_page=100" \
  --jq ".workflow_runs[] | select(.name == \"$ci\") | \"\(.status) \(.conclusion // \"none\") \(.html_url)\"" 2>"$err")"; then
  if grep -q "HTTP 403" "$err"; then
    comment_once actions-read "This PR can't merge by itself yet: \`SYNC_UPSTREAM_TOKEN\` can't read this repo's Actions runs, so it can't see whether CI passed. Edit the token and add **Actions: Read** (next to Contents, Pull requests and Workflows), then re-run CI on this PR; it merges once CI passes. Or merge it yourself."
    echo "::error::SYNC_UPSTREAM_TOKEN can't read Actions runs (HTTP 403): give it Actions: Read. $pr stays open."
  else
    echo "::error::Couldn't read CI runs for $short: $(cat "$err")"
  fi
  exit 1
fi
if [ -z "$runs" ]; then
  echo "CI hasn't started on $short yet; this runs again when it completes."
  exit 0
fi
if printf '%s\n' "$runs" | grep -qv "^completed "; then
  echo "CI is still running on $short; this runs again when it completes."
  exit 0
fi
failed="$(printf '%s\n' "$runs" | grep -v "^completed success " | head -n 1 || true)"
if [ -n "$failed" ]; then
  url="${failed##* }"
  comment_once "ci-failed-$sha" "CI didn't pass on this update ([the run]($url) ended: ${failed#completed }), so it won't merge by itself. Have a look; you can re-run CI from that page, and once it passes this PR merges by itself. Or merge or close it yourself."
  echo "::warning::CI didn't pass on $short ($url); $pr stays open."
  exit 0
fi

# GitHub works out mergeability in the background; give it a moment.
mergeable=UNKNOWN
for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
  mergeable="$(gh pr view "$pr" --repo "$repo" --json mergeable --jq .mergeable)"
  [ "$mergeable" = UNKNOWN ] || break
  sleep "${POLL_SECONDS:-5}"
done
if [ "$mergeable" = CONFLICTING ]; then
  comment_once "conflicts-$sha" "CI passed, but this PR now conflicts with \`$(gh pr view "$pr" --repo "$repo" --json baseRefName --jq .baseRefName)\`, so it won't merge by itself. Resolve the conflicts, then merge it yourself."
  echo "::warning::$pr conflicts; not merging."
  exit 0
fi
if [ "$mergeable" != MERGEABLE ]; then
  echo "::warning::GitHub hasn't worked out whether $pr merges cleanly; run Sync upstream again to retry, or merge it yourself."
  exit 0
fi

# A merge commit, and only if the head is still the commit CI passed on.
if gh pr merge "$pr" --repo "$repo" --merge --match-head-commit "$sha" 2>"$err"; then
  notice "Merged $pr: CI passed on $short."
  exit 0
fi
cat "$err" >&2
if grep -qi "merge commits are not allowed" "$err"; then
  text="CI passed, but this repo doesn't allow merge commits, so this PR can't merge by itself. Updates need a merge commit (a squash drops the link to Pantry's history). Turn on **Settings → General → Pull Requests → Allow merge commits** and merge this PR with a merge commit."
else
  text="CI passed, but merging this PR failed. GitHub said: \`$(tr '\n`' '  ' <"$err")\`. Merge it yourself (with a merge commit)."
fi
comment_once "merge-failed-$sha" "$text"
echo "::warning::$text"
