The Deploy button copies Pantry into your account rather than forking it, so GitHub has no "Sync fork" button for
it. Your copy includes a **Sync upstream** workflow instead. Every Monday, or whenever you run it, it opens a pull
request in your repo that updates it to the latest Pantry release. **Merging the PR deploys the update.** Nothing
changes until you merge, unless you turn on [automatic updates](#automatic-updates-opt-in). To skip a release,
close its PR; it won't reopen.

## Set it up

1. **One-time setting:** in your repo, Settings → Actions → General → Workflow permissions, turn on **"Allow GitHub
   Actions to create and approve pull requests"**. Without it the workflow pushes its branch but can't open the PR.
   If the repo belongs to a GitHub organisation, the checkbox stays greyed out until an organisation owner allows
   it in the organisation's Settings → Actions → General → Workflow permissions.
2. **Run it now (optional):** Actions → Sync upstream → Run workflow. Leave "tag" empty for the latest release, or
   tick "dry run" to see what it would do without pushing anything.
3. **Review and merge** the "Update Pantry to vX.Y.Z" pull request. See the [changelog](/docs/changelog) for what's
   in it.

## Good to know

- **The first update replaces files.** Your copy and Pantry don't share git history yet, so the first PR takes the
  release's files as they are. If you edited files yourself, those edits show up as removed; put them back on the
  PR branch before merging. After that, updates are normal merges that keep your changes.
- **Some releases ask for a review.** When a release needs it (for example, one that moves data), its PR says
  "Review before merging" at the top. Read the release notes before you merge.
- **Releases that change `.github/workflows`.** GitHub won't let the built-in token push workflow changes, and the
  run fails saying so. Create a fine-grained personal access token for this repo only, with _Contents_, _Pull
  requests_ and _Workflows_ set to read and write, save it as the repository secret `SYNC_UPSTREAM_TOKEN`, and run
  the workflow again. (For automatic updates, give it _Actions_ read too: see below.)
- PRs opened with the built-in token don't trigger other workflows, so CI doesn't run on them. With
  `SYNC_UPSTREAM_TOKEN` set, CI runs on them like on any PR. Vercel deploys once you merge either way.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. Re-enable it on the Actions tab, or run
  it by hand.
- Prefer a real fork? Fork the repo first and import the fork into Vercel. The same workflow works there.

## Automatic updates (opt-in)

Turn this on and ordinary updates merge, and so deploy, by themselves once CI has passed on them. It works on any
GitHub plan, including private repos on GitHub Free. Sync upstream still opens the PR every Monday. It **never**
merges by itself:

- the first update of your copy (it replaces files wholesale; review that one PR yourself);
- a release the Pantry maintainers marked for review, or an update that brings one you haven't merged yet (the PR
  says why);
- a PR that conflicts with changes you made in your repo;
- a PR whose CI failed, or one somebody pushed to after Sync upstream opened it.

Those stay open for you, as before. Updates merge with a merge commit, never a squash, so the next update merges
cleanly. Setup, in your repo on GitHub:

1. **Actions can open PRs:** Settings → Actions → General → Workflow permissions → **Allow GitHub Actions to create
   and approve pull requests** (the one-time setting above). In an organisation, an owner allows it in the
   organisation's Settings → Actions → General first.
2. **A token**, so CI runs on update PRs and the merge starts your deploy. Create a fine-grained personal access
   token (GitHub → Settings → Developer settings → Fine-grained tokens). Resource owner: the account or organisation
   that owns your repo. Repository access: only this repo. Permissions: _Actions_ read; _Contents_, _Pull requests_
   and _Workflows_ read and write. Save it as the repository secret `SYNC_UPSTREAM_TOKEN` (Settings → Secrets and
   variables → Actions → Secrets). Organisations can require approval for fine-grained tokens: if yours does, an
   owner approves it under the organisation's Settings → Personal access tokens.
3. **Switch it on:** Settings → Secrets and variables → Actions → Variables → add the repository variable
   `SYNC_AUTO_MERGE` with the value `true`.

That's all. After opening the PR, Sync upstream marks it to merge once CI passes on that exact commit. When CI
finishes, the **Sync upstream merge** workflow (`.github/workflows/sync-upstream-merge.yml`) checks again: every CI
run on the commit passed, the branch still holds Sync upstream's commit, and the PR merges cleanly. Then it merges
the PR with the token. Nothing waits on a runner in between. If CI fails, it comments and leaves the PR open:
re-run CI from the PR, and it merges once CI is green.

Every update PR says how it will merge, or why it won't. To check your setup, run Actions → Sync upstream with "dry
run" ticked. To stop one update, close its PR. To turn the feature off, delete the variable or set it to `false`.

**Alternative: GitHub's own auto-merge** (public repos, or private repos on a paid plan). If Settings → General →
Pull Requests → **Allow auto-merge** is on (keep **Allow merge commits** on too), Sync upstream turns on GitHub's
auto-merge instead. That waits for the checks your branch rules require, so add a ruleset (Settings → Rules →
Rulesets) or branch protection on the default branch that requires **Typecheck, lint, test, build**. With no
required checks GitHub has nothing to wait for, so Sync upstream merges after CI itself, as above. If your rules
also require an approving review, every PR waits for you, the same as leaving automatic updates off.

## When an update doesn't deploy

The Vercel build pushes the new Convex functions and then runs the data migration. If the migration fails, the new
backend is live while Vercel keeps serving the previous web app. The **Watch update deploys** workflow catches
this: after an update PR merges, it watches the production deploy for the merge commit. If the deploy fails, or
hasn't finished after 30 minutes, it opens an issue "Pantry vX.Y.Z didn't deploy" with the link to the Vercel build
and [how to fix it](docs/MIGRATIONS.md#if-it-fails).

It's on by default and uses only the built-in token. Set the repository variable `PANTRY_DEPLOY_WATCH` to `false` to
turn it off, or `PANTRY_DEPLOY_WATCH_MINUTES` to change the time limit. A failed deploy is always caught. The
30-minute timeout only starts when the merge itself can start workflows: a merge by you or by `SYNC_UPSTREAM_TOKEN`,
not one by the built-in token. To check an update by hand, run Actions → Watch update deploys.
