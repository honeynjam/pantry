#!/usr/bin/env bash
# Local dry run of .github/workflows/sync-upstream.yml, with no act, Docker or network, and nothing pushed
# anywhere real. It pulls the workflow's script out of the YAML and runs it against throwaway repos:
#   upstream.git  stands in for github.com/honeynjam/pantry (releases are tags, release notes are files)
#   origin.git    stands in for a self-hoster's copy made by the Deploy button (its own first commit)
# A stub `gh` answers the API calls, records PRs, comments and merges, and can play each auto-merge answer
# GitHub gives. Needs bash, git 2.38+ (merge-tree --write-tree) and ruby (for YAML). Also run by
# `pnpm test:scripts` (scripts/sync-upstream.test.mjs).
#
#   bash scripts/test-sync-upstream.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/sync-upstream.yml"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m✖ %s\033[0m\n' "$*"; exit 1; }
section() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# --- The workflow ---------------------------------------------------------------------------------
ruby -ryaml -e '
  wf = YAML.load_file(ARGV[0])
  job = wf.fetch("jobs").fetch("sync")
  File.write(ARGV[1], job.fetch("if"))
  steps = job.fetch("steps")
  File.write(ARGV[2], steps.map { |s| s["run"] }.compact.join("\n"))
  File.write(ARGV[4], steps.map { |s| (s["env"] || {})["AUTO_MERGE"] }.compact.join)
  triggers = wf["on"] || wf[true] # YAML 1.1 reads the bare key `on` as true
  File.write(ARGV[3], triggers.keys.sort.join(","))
' "$WORKFLOW" "$work/job-if" "$work/sync.sh" "$work/triggers" "$work/auto-merge-env"

section "Workflow file"
[[ "$(cat "$work/triggers")" == "schedule,workflow_dispatch" ]] && pass "triggers: workflow_dispatch + schedule" \
  || fail "triggers are $(cat "$work/triggers")"
[[ "$(cat "$work/job-if")" == "github.repository != 'honeynjam/pantry'" ]] && pass "job skipped in honeynjam/pantry (job if)" \
  || fail "unexpected job if: $(cat "$work/job-if")"
[[ "$(cat "$work/auto-merge-env")" == '${{ vars.SYNC_AUTO_MERGE }}' ]] && pass "auto-merge comes from the SYNC_AUTO_MERGE variable" \
  || fail "AUTO_MERGE env is $(cat "$work/auto-merge-env")"
grep -q -- "--squash\|--rebase" "$work/sync.sh" && fail "updates must merge with a merge commit" || pass "merges only with merge commits"

ruby -ryaml -e '
  wf = YAML.load_file(ARGV[0])
  triggers = wf["on"] || wf[true]
  run = triggers.fetch("workflow_run")
  job = wf.fetch("jobs").fetch("merge")
  step = job.fetch("steps").find { |s| s["run"] }
  ok = run["workflows"] == ["CI"] && run["types"] == ["completed"] && triggers.keys == ["workflow_run"] &&
    job["if"].include?("github.repository != \x27honeynjam/pantry\x27") &&
    job["if"].include?("vars.SYNC_AUTO_MERGE == \x27true\x27") &&
    job["if"].include?("startsWith(github.event.workflow_run.head_branch, \x27sync-upstream/\x27)") &&
    step["env"]["GH_TOKEN"] == "${{ secrets.SYNC_UPSTREAM_TOKEN }}" && step["run"].include?("scripts/sync-self-merge.sh")
  exit(ok ? 0 : 1)
' "$ROOT/.github/workflows/sync-upstream-merge.yml" \
  && pass "sync-upstream-merge.yml: runs when CI completes on a sync-upstream branch, with the token, not upstream" \
  || fail "sync-upstream-merge.yml trigger or guards changed"

# --- Sandbox: git config, gh stub ------------------------------------------------------------------
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL="$work/gitconfig"
git config --global user.name "Test" && git config --global user.email "test@example.com"
git config --global init.defaultBranch main
git config --global advice.detachedHead false
# The workflow fetches https://github.com/honeynjam/pantry.git; point that at the local stand-in.
git config --global url."$work/upstream.git".insteadOf "https://github.com/honeynjam/pantry.git"

state="$work/gh-state"
mkdir -p "$work/bin" "$state/prs" "$state/notes" "$state/comments" "$state/ci"
: >"$state/calls.log"
cat >"$work/bin/gh" <<'STUB'
#!/usr/bin/env bash
# Minimal gh stand-in for the calls sync-upstream.yml and sync-self-merge.sh make. State in $GH_STUB_STATE:
#   latest            tag of the latest release (empty = none published)
#   notes/<tag>       release notes (missing = the release can't be read)
#   native            the repo's allow_auto_merge setting (true unless the file says false)
#   automerge-mode    what `gh pr merge --auto` does: ok | clean | not-allowed | merge-commits | forbidden
#   prs/<branch>      "STATE url" of the PR for a branch;  pr-<n>.md  title line;  pr-<n>.branch;  body-<n>.md
#   ci/<sha>          CI runs on a commit, one "status conclusion url" line each
#   mergeable-<n>     GitHub's mergeable answer (MERGEABLE unless set)
#   automerge-<n>     auto-merge is on for PR n;  comments/<n>  PR n's comments;  calls.log  merges, comments, edits
# The PR branches live in $ORIGIN_GIT, so a PR's head is whatever its branch points at there.
state="$GH_STUB_STATE"
pr_number() { printf '%s' "${1##*/}"; }
pr_head() { git --git-dir="$ORIGIN_GIT" rev-parse "refs/heads/$(cat "$state/pr-$1.branch")"; }
case "$1 $2" in
  "api repos/"*)
    if [[ "$2" == */releases/latest ]]; then
      [[ -s "$state/latest" ]] && cat "$state/latest" && exit 0
      echo "gh: Not Found (HTTP 404)" >&2; exit 1
    fi
    if [[ "$2" == */releases/tags/* ]]; then
      tag="${2##*/}"
      [[ -f "$state/notes/$tag" ]] && cat "$state/notes/$tag" && exit 0
      echo "gh: Not Found (HTTP 404)" >&2; exit 1
    fi
    if [[ "$2" == */commits/*/pulls ]]; then # open PRs whose head is this commit
      sha="${2%/pulls}"; sha="${sha##*/}"
      for f in "$state"/prs/*; do
        [[ -f "$f" ]] || continue
        read -r st url <"$f"
        [[ "$st" == OPEN ]] && [[ "$(pr_head "$(pr_number "$url")")" == "$sha" ]] && echo "$url" && break
      done
      exit 0
    fi
    if [[ "$2" == */actions/runs* ]]; then
      sha="${2##*head_sha=}"; sha="${sha%%&*}"
      cat "$state/ci/$sha" 2>/dev/null || true
      exit 0
    fi
    if [[ " $* " == *".allow_auto_merge"* ]]; then
      cat "$state/native" 2>/dev/null || echo true
      exit 0
    fi
    echo main ;;
  "pr list")
    head=""; while [[ $# -gt 0 ]]; do [[ "$1" == --head ]] && head="$2"; shift; done
    marker="$state/prs/${head//\//__}"
    [[ -f "$marker" ]] && cat "$marker"
    exit 0 ;;
  "pr create")
    shift 2; head=""; base=""; title=""; body=""
    while [[ $# -gt 0 ]]; do
      case "$1" in --head) head="$2";; --base) base="$2";; --title) title="$2";; --body-file) body="$2";; esac; shift
    done
    n=$(( $(ls "$state/prs" | wc -l) + 1 ))
    echo "base=$base head=$head title=$title" >"$state/pr-$n.md"
    printf '%s' "$head" >"$state/pr-$n.branch"
    cp "$body" "$state/body-$n.md"
    echo "OPEN https://github.com/$GITHUB_REPOSITORY/pull/$n" >"$state/prs/${head//\//__}"
    echo "https://github.com/$GITHUB_REPOSITORY/pull/$n" ;;
  "pr edit")
    n="$(pr_number "$3")"; file=""
    while [[ $# -gt 0 ]]; do [[ "$1" == --body-file ]] && file="$2"; shift; done
    cp "$file" "$state/body-$n.md"
    echo "edit $n" >>"$state/calls.log" ;;
  "pr view")
    n="$(pr_number "$3")"
    case " $* " in
      *" autoMergeRequest "*) [[ -f "$state/automerge-$n" ]] && echo true || echo false ;;
      *" headRefOid "*) pr_head "$n" ;;
      *" body "*) cat "$state/body-$n.md" ;;
      *" mergeable "*) cat "$state/mergeable-$n" 2>/dev/null || echo MERGEABLE ;;
      *" baseRefName "*) echo main ;;
      *) cat "$state/comments/$n" 2>/dev/null || true ;;
    esac ;;
  "pr comment")
    n="$(pr_number "$3")"; file=""
    while [[ $# -gt 0 ]]; do [[ "$1" == --body-file ]] && file="$2"; shift; done
    cat "$file" >>"$state/comments/$n"
    echo "comment $n" >>"$state/calls.log" ;;
  "pr merge")
    n="$(pr_number "$3")"
    if [[ " $* " == *" --auto "* ]]; then
      echo "merge --auto $n $*" >>"$state/calls.log"
      case "$(cat "$state/automerge-mode" 2>/dev/null || echo ok)" in
        ok) touch "$state/automerge-$n" ;;
        clean) echo "GraphQL: Pull request is in clean status (enablePullRequestAutoMerge)" >&2; exit 1 ;;
        not-allowed) echo "GraphQL: Pull request Auto merge is not allowed for this repository (enablePullRequestAutoMerge)" >&2; exit 1 ;;
        merge-commits) echo "GraphQL: Merge method merge commits are not allowed on this repository (enablePullRequestAutoMerge)" >&2; exit 1 ;;
        forbidden) echo "GraphQL: Resource not accessible by integration (enablePullRequestAutoMerge)" >&2; exit 1 ;;
      esac
    else
      echo "merge now $n $*" >>"$state/calls.log"
      branch="$(cat "$state/pr-$n.branch")"
      echo "MERGED $3" >"$state/prs/${branch//\//__}"
    fi ;;
  *) echo "gh stub: unexpected call: $*" >&2; exit 1 ;;
esac
STUB
chmod +x "$work/bin/gh"

# --- Repos ----------------------------------------------------------------------------------------
# Upstream: v0.1.0, then v0.2.0 (changes a file, adds one, deletes one, touches a workflow).
git init -q "$work/upstream-src"
(
  cd "$work/upstream-src"
  mkdir -p .github/workflows apps
  printf 'Pantry\n' >README.md
  printf 'web v1\n' >apps/web.txt
  printf 'old\n' >apps/legacy.txt
  printf 'ci v1\n' >.github/workflows/ci.yml
  git add -A && git commit -qm "Pantry 0.1.0" && git tag v0.1.0
  printf 'web v2\n' >apps/web.txt
  printf 'desktop\n' >apps/desktop.txt
  git rm -q apps/legacy.txt
  printf 'ci v2\n' >.github/workflows/ci.yml
  git add -A && git commit -qm "Pantry 0.2.0" && git tag v0.2.0
)
git clone -q --bare "$work/upstream-src" "$work/upstream.git"
printf '### Added\n\n- Things.\n' >"$state/notes/v0.1.0"
printf '### Added\n\n- More things.\n' >"$state/notes/v0.2.0"

# Self-hoster's copy: v0.1.0's files in a fresh repo with its own first commit (what Vercel's clone does).
git init -q "$work/copy-src"
(cd "$work/upstream-src" && git archive v0.1.0) | tar -x -C "$work/copy-src"
(cd "$work/copy-src" && git add -A && git commit -qm "Initial commit")
git clone -q --bare "$work/copy-src" "$work/origin.git"
git clone -q "$work/origin.git" "$work/owner" # the owner's own clone, for merging PRs and editing

export GH_STUB_STATE="$state" GH_TOKEN=dummy UPSTREAM_REPO=honeynjam/pantry ORIGIN_GIT="$work/origin.git"
AUTO=""     # the SYNC_AUTO_MERGE repo variable
TOKEN=true  # whether the SYNC_UPSTREAM_TOKEN secret is set
run_workflow() { # run_workflow <repo> <dry_run> [tag] → output in $work/out
  rm -rf "$work/checkout"
  git clone -q "$work/origin.git" "$work/checkout" # actions/checkout with fetch-depth: 0
  mkdir -p "$work/checkout/scripts" && cp "$ROOT/scripts/sync-self-merge.sh" "$work/checkout/scripts/" # in every copy
  (
    cd "$work/checkout"
    GITHUB_REPOSITORY="$1" DRY_RUN="$2" REQUESTED_TAG="${3:-}" AUTO_MERGE="$AUTO" HAS_SYNC_TOKEN="$TOKEN" \
      POLL_SECONDS=0 PATH="$work/bin:$PATH" \
      bash --noprofile --norc -eo pipefail "$work/sync.sh"
  ) >"$work/out" 2>&1 || { cat "$work/out"; fail "workflow script failed"; }
  sed 's/^/    │ /' "$work/out"
}
branches() { git --git-dir="$work/origin.git" for-each-ref --format='%(refname:short)' refs/heads; }
release() { # release <tag> <file> <content> [notes]: a new upstream release changing one file
  (
    cd "$work/upstream-src"
    printf '%s\n' "$3" >"$2"
    git add -A && git commit -qm "Pantry $1" && git tag "$1"
    git push -q "$work/upstream.git" main "$1"
  )
  printf '%s\n' "${4:-### Fixed

- Something.}" >"$state/notes/$1"
  printf '%s' "$1" >"$state/latest"
}
owner_merge() { # owner_merge <tag> [theirs]: the owner merges the PR with a merge commit
  (
    cd "$work/owner" && git pull -q origin main && git fetch -q origin
    if ! git merge -q --no-ff "origin/sync-upstream/$1" -m "Merge pull request: Update Pantry to $1" >/dev/null 2>&1; then
      [[ "${2:-}" == theirs ]] || exit 1
      git checkout -q --theirs . && git add -A && git commit -qm "Merge pull request: Update Pantry to $1"
    fi
    git push -q origin main
  ) || fail "owner couldn't merge $1"
}
owner_edit() { # owner_edit <file> <content>
  (cd "$work/owner" && git pull -q origin main && printf '%s\n' "$2" >"$1" && git commit -qam "Owner edit" && git push -q origin main)
}
calls_since() { tail -n +"$(($1 + 1))" "$state/calls.log"; }
ncalls() { wc -l <"$state/calls.log" | tr -d ' '; }
pr_body() { cat "$state/pr-$1.md" "$state/body-$1.md"; }
pr_count() { ls "$state/prs" | wc -l | tr -d ' '; }

# --- Scenarios ------------------------------------------------------------------------------------
section "1. In honeynjam/pantry itself (script guard, case-insensitive)"
printf 'v0.2.0' >"$state/latest"
run_workflow Honeynjam/pantry false
grep -q "nothing to sync" "$work/out" && [[ "$(branches)" == "main" ]] && [[ "$(pr_count)" == 0 ]] \
  && pass "does nothing: no branch, no PR" || fail "acted in the upstream repo"

section "2. No release published yet"
: >"$state/latest"
run_workflow kris/my-pantry false
grep -q "no published release yet" "$work/out" && [[ "$(branches)" == "main" ]] && pass "exits quietly" || fail "expected a no-release notice"

section "3. Dry run in a Deploy-button copy (unrelated history), latest release v0.2.0, auto-merge on"
printf 'v0.2.0' >"$state/latest"
AUTO=true
run_workflow kris/my-pantry true
grep -q "Dry run: would push sync-upstream/v0.2.0 and open a PR into main (first-update)" "$work/out" \
  && pass "would open the PR for v0.2.0" || fail "dry run didn't report the PR"
grep -q "would not auto-merge: it's the first update of this copy" "$work/out" \
  && pass "reports it won't auto-merge the first update" || fail "dry run didn't report the auto-merge decision"
[[ "$(branches)" == "main" ]] && [[ "$(pr_count)" == 0 ]] && pass "dry run pushed nothing, opened nothing" \
  || fail "dry run changed something"

section "4. Real run, auto-merge on: opens the first-update PR and never auto-merges it"
calls=$(ncalls)
run_workflow kris/my-pantry false
branches | grep -qx "sync-upstream/v0.2.0" && pass "pushed branch sync-upstream/v0.2.0 to the copy" || fail "no branch"
pr_body 1 | grep -q "base=main head=sync-upstream/v0.2.0 title=Update Pantry to v0.2.0" \
  && pass "gh pr create: base main, head sync-upstream/v0.2.0, title \"Update Pantry to v0.2.0\"" || fail "PR not created"
echo "    PR body:"
sed 's/^/    │ /' "$state/body-1.md"
[[ -z "$(calls_since "$calls")" ]] && pass "no merge or auto-merge call" || fail "touched merging: $(calls_since "$calls")"
pr_body 1 | grep -q "Not merging automatically:\*\* it's the first update of this copy" \
  && pass "the PR body says why it won't merge by itself" || fail "body doesn't explain"
g() { git --git-dir="$work/origin.git" "$@"; }
[[ "$(g rev-parse 'sync-upstream/v0.2.0^{tree}')" == "$(git --git-dir="$work/upstream.git" rev-parse 'v0.2.0^{tree}')" ]] \
  && pass "branch has exactly v0.2.0's files (legacy.txt removed, desktop.txt added)" || fail "branch tree differs from v0.2.0"
[[ "$(g rev-list --parents -n1 sync-upstream/v0.2.0 | wc -w | tr -d ' ')" == "3" ]] && g merge-base --is-ancestor main sync-upstream/v0.2.0 \
  && pass "commit has both histories as parents; PR diff is against main" || fail "parents wrong"
g log --format='%s' main | grep -q "Update Pantry" && fail "main changed: something merged" || pass "main untouched"

section "5. Run again while that PR exists"
run_workflow kris/my-pantry false
grep -q "already a PR for Pantry v0.2.0" "$work/out" && [[ "$(pr_count)" == 1 ]] && pass "no second PR" || fail "opened a duplicate PR"

section "6. Owner merges the PR, customises the app, then v0.3.0 with auto-merge off"
owner_merge v0.2.0
owner_edit README.md "Pantry

Our team tracker."
AUTO=""
release v0.3.0 apps/web.txt "web v3"
calls=$(ncalls)
run_workflow kris/my-pantry false
grep -q "merge, branch sync-upstream/v0.3.0" "$work/out" && pass "now a normal merge (histories are linked)" || fail "expected merge mode"
[[ -z "$(calls_since "$calls")" ]] && pass "auto-merge off: no merge call" || fail "merged without opt-in"
pr_body 2 | grep -q "Nothing changes until you merge" && pass "body: nothing changes until you merge" || fail "body wrong"
owner_merge v0.3.0
grep -q "Our team tracker" "$work/owner/README.md" && grep -q "web v3" "$work/owner/apps/web.txt" \
  && pass "merging the PR is clean and keeps the owner's README change" || fail "merge lost changes"

section "7. Up to date"
run_workflow kris/my-pantry false
grep -q "already includes Pantry v0.3.0" "$work/out" && pass "nothing to do" || fail "expected up-to-date notice"

section "8. Manual run for a specific tag"
run_workflow kris/my-pantry true v0.2.0
grep -q "already includes Pantry v0.2.0" "$work/out" && pass "respects the tag input" || fail "tag input ignored"

section "9. v0.4.0, auto-merge on, ordinary release: turns on auto-merge with a merge commit"
AUTO=true
release v0.4.0 apps/api.txt "api v4"
calls=$(ncalls)
run_workflow kris/my-pantry false
calls_since "$calls" | grep -q "^merge --auto 3 .*--auto --merge" && pass "gh pr merge --auto --merge on the new PR" \
  || fail "auto-merge not requested: $(calls_since "$calls")"
grep -q "Auto-merge is on for https://github.com/kris/my-pantry/pull/3" "$work/out" && pass "reports auto-merge on" || fail "no notice"
pr_body 3 | grep -q "GitHub.s auto-merge is on" && pass "the PR body says it merges by itself" || fail "body doesn't say"
run_workflow kris/my-pantry false
grep -q "Auto-merge is already on" "$work/out" && [[ "$(pr_count)" == 3 ]] && pass "a re-run changes nothing" || fail "re-run acted"
owner_merge v0.4.0

section "10. v0.5.0 marked \"Pantry-Review: manual\" in its release notes"
release v0.5.0 apps/api.txt "api v5" "Pantry-Review: manual

**Review this update before merging.** It moves your data.

### Changed

- Data."
calls=$(ncalls)
run_workflow kris/my-pantry false
[[ -z "$(calls_since "$calls")" ]] && pass "no auto-merge for a manual-review release" || fail "auto-merged: $(calls_since "$calls")"
pr_body 4 | grep -q "Review before merging.\*\* The Pantry maintainers marked this release for review" \
  && pr_body 4 | grep -q "Not merging automatically:\*\* the Pantry maintainers marked v0.5.0 for review" \
  && pass "the PR body says to review it, and why it won't merge by itself" || fail "body doesn't explain"
owner_merge v0.5.0

section "11. v0.6.0 conflicts with the owner's own change"
owner_edit apps/web.txt "web v3, ours"
release v0.6.0 apps/web.txt "web v6"
calls=$(ncalls)
run_workflow kris/my-pantry false
grep -q "Conflicts: true" "$work/out" && [[ -z "$(calls_since "$calls")" ]] && pass "detected the conflict; no auto-merge" \
  || fail "conflict not handled: $(calls_since "$calls")"
pr_body 5 | grep -q "Not merging automatically:\*\* it conflicts with changes in your repo" && pass "the PR body says why" || fail "body"
owner_merge v0.6.0 theirs

section "12. v0.7.0: GitHub refuses auto-merge (not allowed), so it falls back to merging after CI"
release v0.7.0 apps/api.txt "api v7"
printf 'not-allowed' >"$state/automerge-mode"
run_workflow kris/my-pantry false
v7="$(git --git-dir="$work/upstream.git" rev-parse 'v0.7.0^{commit}')"
grep -qF "<!-- pantry-sync:self-merge sha=$v7 -->" "$state/body-6.md" && pass "marked for self-merge on the bot's commit" || fail "no marker"
grep -q "Merges by itself once CI passes" "$state/body-6.md" && pass "the PR body says it merges once CI passes, and why" || fail "body"
[[ ! -f "$state/comments/6" ]] && ! grep -q "merge now 6" "$state/calls.log" && pass "no comment, no merge yet (CI hasn't run)" || fail "acted early"
printf 'ok' >"$state/automerge-mode"
run_workflow kris/my-pantry false
[[ -f "$state/automerge-6" ]] && [[ "$(pr_count)" == 6 ]] && grep -q "GitHub's auto-merge is on" "$state/body-6.md" \
  && pass "once allowed, a re-run switches the same PR to GitHub's auto-merge" || fail "existing PR not retried"
owner_merge v0.7.0

section "13. Other answers from GitHub"
try_mode() { # try_mode <tag> <automerge-mode>
  release "$1" apps/api.txt "api $1"
  printf '%s' "$2" >"$state/automerge-mode"
  run_workflow kris/my-pantry false
  owner_merge "$1"
}
try_mode v0.8.0 clean
grep -q "merge now 7" "$state/calls.log" && fail "merged before CI" || true
grep -q "no required status checks" "$state/body-7.md" && grep -q "pantry-sync:self-merge" "$state/body-7.md" \
  && pass "no required checks (\"clean status\"): waits for CI instead of merging untested" || fail "clean status not handled"
try_mode v0.9.0 merge-commits
grep -q "Allow merge commits" "$state/comments/8" && pass "merge commits not allowed: the comment says to allow them" || fail "no comment"
try_mode v0.10.0 forbidden
grep -q "SYNC_UPSTREAM_TOKEN" "$state/comments/9" && pass "token can't merge: the comment says which permissions" || fail "no comment"
printf 'ok' >"$state/automerge-mode"

section "14. Release notes that can't be read"
release v0.11.0 apps/api.txt "api v11"
rm "$state/notes/v0.11.0"
calls=$(ncalls)
run_workflow kris/my-pantry false
[[ -z "$(calls_since "$calls")" ]] && pr_body 10 | grep -q "release notes of v0.11.0 couldn't be read" \
  && pass "no auto-merge when it can't tell whether a review is needed" || fail "auto-merged blind"

section "15. An unmerged manual-review release is carried by the next one"
release v0.12.0 apps/api.txt "api v12" "Pantry-Review: manual

**Review this update before merging.**"
run_workflow kris/my-pantry false
release v0.13.0 apps/api.txt "api v13"
calls=$(ncalls)
run_workflow kris/my-pantry false
[[ -z "$(calls_since "$calls")" ]] && pass "v0.13.0 isn't auto-merged while it brings unmerged v0.12.0" \
  || fail "auto-merged past a manual-review release: $(calls_since "$calls")"
pr_body 12 | grep -q "This update includes \[Pantry v0.12.0\]" \
  && pr_body 12 | grep -q "marked v0.12.0, which this update includes, for review" && pass "the PR body names v0.12.0" || fail "body"
owner_merge v0.13.0
release v0.14.0 apps/api.txt "api v14"
calls=$(ncalls)
run_workflow kris/my-pantry false
calls_since "$calls" | grep -q "^merge --auto 13" && pass "once that's merged, v0.14.0 auto-merges again" || fail "still blocked"

# --- Self-merge (GitHub Free, private repo: no auto-merge, no required checks) ----------------------
self_merge() { # self_merge <repo> <sha> → output in $work/out (what sync-upstream-merge.yml runs)
  (GITHUB_REPOSITORY="$1" POLL_SECONDS=0 PATH="$work/bin:$PATH" bash "$ROOT/scripts/sync-self-merge.sh" "$2") \
    >"$work/out" 2>&1 || { cat "$work/out"; fail "sync-self-merge.sh failed"; }
  sed 's/^/    │ /' "$work/out"
}
ci() { # ci <sha> <lines...>: the CI runs GitHub reports on a commit
  local sha="$1"; shift
  printf '%s\n' "$@" >"$state/ci/$sha"
}
sha_of() { git --git-dir="$work/upstream.git" rev-parse "$1^{commit}"; }
printf 'false' >"$state/native"

section "16. Free plan, token set: marked to merge after CI; merges once both CI runs pass"
release v0.15.0 apps/api.txt "api v15"
calls=$(ncalls)
run_workflow kris/my-pantry false
sha="$(sha_of v0.15.0)"; n=14
calls_since "$calls" | grep -q "^merge --auto" && fail "tried GitHub's auto-merge where it's off" || pass "skips GitHub's auto-merge (allow_auto_merge is false)"
grep -qF "<!-- pantry-sync:self-merge sha=$sha -->" "$state/body-$n.md" \
  && grep -q "not available in this repo (on GitHub Free it isn't, for private repos)" "$state/body-$n.md" \
  && pass "PR body: merges once CI passes, says why, and carries the marker for $sha" || fail "body"
grep -q "CI hasn't started" "$work/out" && ! grep -q "merge now $n" "$state/calls.log" && pass "checked CI right away: not started, no merge" || fail "merged early"
ci "$sha" "completed success https://ci/1" "in_progress none https://ci/2"
self_merge kris/my-pantry "$sha"
grep -q "still running" "$work/out" && ! grep -q "merge now $n" "$state/calls.log" && pass "one CI run still going: waits" || fail "merged early"
ci "$sha" "completed success https://ci/1" "completed success https://ci/2"
self_merge kris/my-pantry "$sha"
grep -q "^merge now $n .*--merge --match-head-commit $sha" "$state/calls.log" \
  && pass "both runs passed: merges with a merge commit, pinned to $sha" || fail "didn't merge: $(cat "$work/out")"
self_merge kris/my-pantry "$sha"
grep -q "No open Sync upstream PR" "$work/out" && pass "the second CI run's trigger finds nothing left to do" || fail "merged twice"
owner_merge v0.15.0

section "17. CI already passed when Sync upstream runs (a re-run): merges straight away"
release v0.16.0 apps/api.txt "api v16"
sha="$(sha_of v0.16.0)"
ci "$sha" "completed success https://ci/3"
run_workflow kris/my-pantry false
grep -q "^merge now 15 .*--match-head-commit $sha" "$state/calls.log" && pass "merged in the same run" || fail "didn't merge"
owner_merge v0.16.0

section "18. CI fails: comment once, no merge"
release v0.17.0 apps/api.txt "api v17"
run_workflow kris/my-pantry false
sha="$(sha_of v0.17.0)"
ci "$sha" "completed success https://ci/4" "completed failure https://ci/5"
self_merge kris/my-pantry "$sha"
self_merge kris/my-pantry "$sha"
! grep -q "merge now 16" "$state/calls.log" && grep -q "CI didn't pass on this update (\[the run\](https://ci/5)" "$state/comments/16" \
  && [[ "$(grep -c "pantry-sync:ci-failed" "$state/comments/16")" == 1 ]] \
  && pass "left open, one comment linking the failed run" || fail "CI failure not handled"
owner_merge v0.17.0

section "19. No SYNC_UPSTREAM_TOKEN: comment that it's needed, no marker"
TOKEN=false
release v0.18.0 apps/api.txt "api v18"
run_workflow kris/my-pantry false
grep -q "needs the \`SYNC_UPSTREAM_TOKEN\` secret" "$state/comments/17" && ! grep -q "pantry-sync:self-merge" "$state/body-17.md" \
  && grep -q "SYNC_UPSTREAM_TOKEN\` isn't set" "$state/body-17.md" && pass "commented, body says so, not marked" || fail "no-token not handled"
sha="$(sha_of v0.18.0)"
ci "$sha" "completed success https://ci/6"
self_merge kris/my-pantry "$sha"
! grep -q "merge now 17" "$state/calls.log" && pass "never merged" || fail "merged without the token"
TOKEN=true
owner_merge v0.18.0

section "20. Someone pushes to the update branch after the bot"
release v0.19.0 apps/api.txt "api v19"
run_workflow kris/my-pantry false
(cd "$work/owner" && git fetch -q origin && git checkout -q -b fix "origin/sync-upstream/v0.19.0" \
  && printf 'tweak\n' >>apps/api.txt && git commit -qam "My tweak" && git push -q origin HEAD:sync-upstream/v0.19.0 \
  && git checkout -q main && git branch -q -D fix)
pushed="$(git --git-dir="$work/origin.git" rev-parse refs/heads/sync-upstream/v0.19.0)"
ci "$pushed" "completed success https://ci/7"
self_merge kris/my-pantry "$pushed"
! grep -q "merge now 18" "$state/calls.log" && grep -q "Someone pushed to this branch" "$state/comments/18" \
  && pass "CI passed on the human's commit, but it doesn't merge; says why" || fail "merged a human push"
run_workflow kris/my-pantry false
grep -q "Someone pushed to sync-upstream/v0.19.0" "$work/out" && pass "Sync upstream re-runs leave it alone too" || fail "re-run acted"
owner_merge v0.19.0

section "21. CI passed, but the PR conflicts by now"
release v0.20.0 apps/other.txt "other v20"
run_workflow kris/my-pantry false
sha="$(sha_of v0.20.0)"
ci "$sha" "completed success https://ci/8"
printf 'CONFLICTING' >"$state/mergeable-19"
self_merge kris/my-pantry "$sha"
! grep -q "merge now 19" "$state/calls.log" && grep -q "now conflicts with \`main\`" "$state/comments/19" \
  && pass "no merge, comment says to resolve" || fail "merged a conflict"
owner_merge v0.20.0

section "22. Free plan: the safety rules still hold (manual review, conflicts, first update)"
release v0.21.0 apps/api.txt "api v21" "Pantry-Review: manual

**Review this update before merging.**"
calls=$(ncalls)
run_workflow kris/my-pantry false
[[ -z "$(calls_since "$calls")" ]] && ! grep -q "pantry-sync:self-merge" "$state/body-20.md" && pass "manual-review release: not marked" || fail "marked"
owner_merge v0.21.0 theirs
owner_edit apps/api.txt "api, ours"
release v0.22.0 apps/api.txt "api v22"
calls=$(ncalls)
run_workflow kris/my-pantry false
[[ -z "$(calls_since "$calls")" ]] && ! grep -q "pantry-sync:self-merge" "$state/body-21.md" && pass "conflicting update: not marked" || fail "marked"
owner_merge v0.22.0 theirs
grep -q "pantry-sync:self-merge" "$state/body-1.md" && fail "first update marked" || pass "first update (scenario 4): never marked"
self_merge Honeynjam/pantry "$(sha_of v0.22.0)"
grep -q "nothing to merge" "$work/out" && pass "sync-self-merge.sh does nothing in honeynjam/pantry" || fail "acted upstream"

printf '\n\033[32mAll sync-upstream checks passed.\033[0m\n'
