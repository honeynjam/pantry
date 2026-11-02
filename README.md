# Pantry

A fast, keyboard-first, open-source (MIT) issue tracker for 1–3 person teams working with AI coding agents.
Your agents read and update issues over MCP; your data lives in your own Vercel and Convex accounts.

> Status: early development (milestone M3: shortcuts, command palette, optimistic updates, My issues and filters, on spaces with optional projects). The Deploy button below is
> being tested on a fresh account.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fhoneynjam%2Fpantry&project-name=pantry&repository-name=pantry&root-directory=apps%2Fweb&products=%5B%7B%22type%22%3A%22integration%22%2C%22integrationSlug%22%3A%22convex%22%2C%22productSlug%22%3A%22convex%22%2C%22protocol%22%3A%22storage%22%7D%5D)

## Deploy your own (about 5 minutes)

You need a GitHub account. Vercel and Convex accounts are created along the way (both free for personal use;
Vercel Hobby is for non-commercial use).

1. **Click "Deploy with Vercel"** above and sign in to Vercel with GitHub.
2. **Repository:** Vercel copies this repo into your GitHub account (a clone, not a fork). Keep the name or change it.
3. **Root Directory** is already set to `apps/web` by the button; leave it, and leave the build and install
   settings alone (`apps/web/vercel.json` provides the build command). If the form shows the repo root instead,
   click **Edit** next to Root Directory and pick `apps/web`. If it's missed, the first build stops with a
   message telling you how to fix it in Settings.
4. **Add the Convex integration** when Vercel asks (it's pre-selected by the button): accept the terms and create a
   new Convex project. Keep both **Production** and **Preview** enabled and leave **Custom Prefix** empty.
   This gives the build a `CONVEX_DEPLOY_KEY`.
5. **Deploy.** The build deploys your Convex functions, creates a `BETTER_AUTH_SECRET` on your Convex deployment
   (once; it survives redeploys), points Convex `SITE_URL` at your production URL, and builds the web app.
6. **Open your production URL** (`https://<project>.vercel.app`). You'll see the setup screen: create your
   account and workspace. You become the owner; from then on sign-up is invite-only.
7. **Onboarding** starts right after: say whether you work on products, clients or both (the sidebar and the
   new-space dialog follow; change it later in Settings → General), name your first products or clients (the
   sample `PAN` space can be renamed while it's unused), invite people, connect your agent, and pick a theme.
   Everything but the first step can be skipped. Settings → General → **Run setup again** walks it again.
8. **Invite your partner** (in onboarding, or later in Settings → Members): enter their email → **Create invite
   link**, and send the link yourself (nothing is emailed). It works once, for that email address, for 7 days.
   They create their account from the link (or sign in, if they already have one on this instance) and get a
   short onboarding of their own.

If the setup screen says **"One more step"**, the deploy key wasn't allowed to set environment variables. Copy the
one-line command it shows (run it from `packages/backend` in a clone, with `--prod`), or add `BETTER_AUTH_SECRET`
in the Convex dashboard → Settings → Environment Variables, then reload.

Only production deploys run (preview builds are skipped by `ignoreCommand` in `apps/web/vercel.json`), so previews
never touch your Convex data. Every push to your repo's production branch redeploys web + Convex together.

### Connect your agents (MCP)

1. In the app, open **Settings → API tokens** (or the user menu → API tokens), name a token after where it will
   live ("Claude Code on my laptop") and create it. You see it once.
2. Paste the snippet the screen shows. Claude Code:
   `claude mcp add --transport http pantry https://<your-app>/api/mcp --header "Authorization: Bearer <token>"`.
   Cursor: the `mcp.json` snippet, which reads the token from `PANTRY_TOKEN`.
3. Tell the agent "work on PAN-12". It reads the issue and the space's context doc, moves the issue itself, comments
   and adds sub-issues. Everything shows under your name, tagged "via MCP".

4. Agents can also organise work: "set up a space for Acme with Website and Launch projects and file these
   issues" works too. They call `get_workspace` first to see what exists.

The agent acts as you, inside your workspace only, and can do what a member can in the app, except deleting
spaces, comments or labels, archiving spaces, adding or removing statuses, and invites, members or tokens. It can
delete an issue only by repeating its key (`delete_issue { key, confirm }`), and is told to ask you first.
Revoking a token on the same screen stops it at once (the next call gets a 401). Tools (spec §10b):

- Issues: `get_issue`, `list_issues`, `search_issues`, `create_issue`, `create_sub_issue`, `add_comment`,
  `update_issue`, `delete_issue`
- Orientation and context: `get_workspace`, `get_space_context`, `update_space_context`
- Organising: `create_space`, `update_space`, `create_project`, `update_project`, `archive_project`,
  `unarchive_project`, `create_label`, `update_status`, `reorder_statuses`

Archived projects can be restored in Space settings → Projects → Archived (or with `unarchive_project`). Issues
that were in a project when it was archived stay without one.

### Troubleshooting

| Symptom                                                                                                                                                          | Fix                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Build log: `CONVEX_DEPLOY_KEY is not set`                                                                                                                        | Connect the Convex integration to the project for Production and Preview, with no Custom Prefix, then redeploy.                          |
| Build fails with "Pantry must be built from apps/web", "No Output Directory named public", "No Next.js version detected" or can't find `scripts/vercel-build.sh` | Root Directory isn't `apps/web`. Project → Settings → Build and Deployment → Root Directory → `apps/web`, then redeploy.                 |
| App is blank or says "This app has no Convex address"                                                                                                            | `NEXT_PUBLIC_CONVEX_URL` wasn't injected: the build command must be `bash ../../scripts/vercel-build.sh` (from `apps/web/vercel.json`).  |
| Sign-in fails with an origin or URL error                                                                                                                        | Convex `SITE_URL` must match the URL you opened. Use the production URL, not a deployment-specific one; after adding a domain, redeploy. |
| Setup screen: "One more step"                                                                                                                                    | See above: set `BETTER_AUTH_SECRET` once. `GET /api/instance` shows `"needsSecret": false` when it's fixed.                              |
| Vercel can't connect the repo                                                                                                                                    | Hobby can't use repos owned by a GitHub organisation; clone into a personal account.                                                     |
| An MCP client says 401 / unauthorized                                                                                                                            | The token was revoked or mistyped: create a new one in Settings → API tokens and update the client's header.                             |
| You hit a Convex free-plan limit                                                                                                                                 | Convex dashboard → Usage. A runaway agent loop is the usual cause; revoke its token.                                                     |

`GET https://<your-app>/api/instance` returns `{ name, convexUrl, convexSiteUrl, serverVersion, minAppVersion,
needsSecret }`; it's the quickest health check.

### Updating your instance

The Deploy button copies this repo into your account; it doesn't fork it, so GitHub has no "Sync fork" button for
it. Your copy includes a **Sync upstream** workflow (`.github/workflows/sync-upstream.yml`) for that. Every Monday,
or whenever you run it, it opens a pull request in your repo that updates it to the latest Pantry release.
**Merging the PR deploys the update** (Vercel rebuilds the web app and pushes the new Convex functions). Nothing
changes until you merge: the workflow never merges by itself unless you turn on
[automatic updates](#automatic-updates-opt-in). To skip a release, close its PR; the workflow won't reopen it.

1. **One-time setting:** in your repo, Settings → Actions → General → Workflow permissions, turn on **"Allow GitHub
   Actions to create and approve pull requests"**. Without it the workflow pushes its branch but can't open the PR.
   If the repo belongs to a GitHub organisation, the checkbox is greyed out until an organisation owner allows it
   first: the organisation's Settings → Actions → General → Workflow permissions, same checkbox.
2. **Run it now (optional):** Actions → Sync upstream → Run workflow. Leave "tag" empty for the latest release, or
   tick "dry run" to see what it would do without pushing anything.
3. **Review and merge** the "Update Pantry to vX.Y.Z" PR.

Good to know:

- **The first update replaces files.** Your copy and Pantry don't share git history, so the first PR takes the
  release's files as they are. If you edited files yourself, those edits show up in its diff as removed; put
  them back on the PR branch before merging. After that the histories are linked, and later updates are normal
  merges that keep your changes (GitHub shows any conflicts in the PR).
- **Releases that change `.github/workflows`.** GitHub won't let the built-in token push changes to workflow
  files, and the run then fails with an error that says so. Fix: create a fine-grained personal access token for
  this repo only, with _Contents_, _Pull requests_ and _Workflows_ set to read and write. Save it as the repository
  secret `SYNC_UPSTREAM_TOKEN` and run the workflow again; it uses that token whenever the secret exists. (For
  automatic updates, give it _Actions_ read too: see below.)
- PRs opened with the built-in token don't trigger other workflows, so CI doesn't run on them. Vercel still
  deploys once you merge. With `SYNC_UPSTREAM_TOKEN` set, CI runs on them like on any PR.
- **Some releases ask for a review.** When a release's notes say so (for example, one that moves data), the PR
  says "Review before merging" at the top. Read the release notes before you merge it.
- GitHub pauses scheduled workflows in repos with no activity for 60 days. Re-enable it on the Actions tab, or
  just run it by hand.
- Prefer a real fork? Fork the repo first and import the fork into Vercel. The same workflow works there too.
- In `honeynjam/pantry` itself the workflow does nothing.

#### Automatic updates (opt-in)

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

#### When an update doesn't deploy

The Vercel build pushes the new Convex functions and then runs the data migration. If the migration fails, the
new backend is live while Vercel keeps serving the previous web app. The **Watch update deploys** workflow
(`.github/workflows/deploy-watch.yml`) catches this. After an update PR merges, it watches the production deploy
Vercel reports on the merge commit. If the deploy fails, or hasn't finished after 30 minutes, it opens an issue
"Pantry vX.Y.Z didn't deploy" with the link to the Vercel build and the fix
([docs/MIGRATIONS.md → If it fails](docs/MIGRATIONS.md#if-it-fails)).

It's on by default and uses only the built-in token. To turn it off, set the repository variable
`PANTRY_DEPLOY_WATCH` to `false`; `PANTRY_DEPLOY_WATCH_MINUTES` changes the time limit. A failed deploy is always
caught, because Vercel reports it to GitHub. The 30-minute timeout check only starts when the merge itself can start
workflows: a merge by you, or by `SYNC_UPSTREAM_TOKEN`, but not one done by the built-in token. To check an update
by hand, run Actions → Watch update deploys.

Maintainers can test both workflows locally (no Docker; throwaway repos and a stub `gh`):
`bash scripts/test-sync-upstream.sh` and `node --test scripts/deploy-watch.test.mjs`. `pnpm check` runs both.

## Develop locally

Requirements: Node 24 (`nvm use`), pnpm 10 (`corepack enable` or `npm i -g pnpm@10`). No Convex account needed.

```bash
pnpm i
pnpm dev                       # local Convex backend (no login) + web on http://localhost:3000
```

The first time, give the local Convex deployment its two auth settings (local deployment only):

```bash
cd packages/backend
npx convex env set SITE_URL http://localhost:3000
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
```

Then open http://localhost:3000: the setup screen creates your account and workspace.

- `pnpm dev` runs `convex dev` with `CONVEX_AGENT_MODE=anonymous` (a local backend on 127.0.0.1:3210/3211). Set
  `CONVEX_AGENT_MODE=` (empty) to use your own Convex dev deployment instead. If those ports are taken (another
  local Convex project), run it on others from `packages/backend`:
  `CONVEX_AGENT_MODE=anonymous npx convex dev --local-cloud-port 3260 --local-site-port 3261`.
- Data migrations run by themselves: `pnpm dev` runs `migrations:run` when it starts, and every Vercel deploy runs it
  right after `convex deploy`. To run them by hand: `pnpm --filter @pantry/backend migrate`. How schema changes and
  migrations work (and how to recover if one fails): [docs/MIGRATIONS.md](docs/MIGRATIONS.md).
- The web app reads the Convex URLs that `convex dev` writes to `packages/backend/.env.local` (`CONVEX_URL` or, when
  it finds Vite installed, `VITE_CONVEX_URL`), so there's nothing to copy. `apps/web/.env.local` overrides them.
- To run a second web dev server from the same folder (Next allows one per build directory), give it its own
  directory: `NEXT_DIST_DIR=.next-2 pnpm --filter @pantry/web exec next dev --port 3001`. If you sign in there,
  set `SITE_URL` to that origin.

### Checks (what CI runs)

```bash
pnpm check   # format check, typecheck, lint, tests, web build
pnpm fix     # format and auto-fix lint
```

### Design system review page

`packages/ui` holds the tokens, theme provider, motion tokens and components. A dev-only page shows all of them in
light and dark: open http://localhost:3000/design while `pnpm dev` runs. Production builds return 404 for `/design`
unless `PANTRY_DESIGN_PAGE=1` is set at build time.

### Landing site

`apps/site` is the marketing site and the docs (`/docs`, written in `apps/site/content/docs`; the MCP tool
reference, keyboard shortcuts and changelog pages are generated from the code). It's the one-page marketing site (http://localhost:3002 while `pnpm dev` runs). All copy lives in
`apps/site/lib/content.ts`. It's deployed as its own Vercel project, separate from any Pantry instance:
import this repo again, set **Root Directory** to `apps/site`, don't add Convex, then add the domain under
Settings → Domains. Set `NEXT_PUBLIC_SITE_URL` (e.g. `https://pantry.dev`) for canonical URLs and social cards; without
it the site uses Vercel's production URL. `apps/site/vercel.json` skips builds when nothing the site depends on changed.

## Repo layout

| Path                                          | What                                                                                                                                                      |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web`                                    | Next.js App Router web app (Vercel): renders `packages/app`, `/api/auth`, `/api/instance`, `/api/mcp`                                                     |
| `apps/site`                                   | One-page landing site (Next.js, its own Vercel project; see Landing site above)                                                                           |
| `apps/desktop`                                | Tauri v2 Mac app. For now the M2 sign-in spike: see [`docs/spikes/tauri-auth.md`](docs/spikes/tauri-auth.md) (needs Rust; not part of the default checks) |
| `packages/backend`                            | Convex functions, schema and Better Auth (`convex/`). All business logic lives here                                                                       |
| `packages/app`                                | Client-only React screens (shared by web and the Mac app)                                                                                                 |
| `packages/ui`                                 | Design system: tokens, theme, shadcn/ui components on Base UI, motion tokens, `MarkdownEditor` (Tiptap 3)                                                 |
| `packages/mcp`                                | MCP tools (zod inputs, token check, Convex calls) behind `/api/mcp`                                                                                       |
| `packages/tsconfig`, `packages/eslint-config` | Shared config                                                                                                                                             |
| `scripts/vercel-build.sh`                     | The Vercel build: Convex env, `convex deploy`, web build                                                                                                  |
| `.github/workflows`                           | CI (typecheck, lint, test), Release (GitHub Release from a version tag) and Sync upstream (update PRs for self-hosted copies)                             |
| `docs/`                                       | Spec (`PANTRY-SPEC.md`), deploy test checklist, Tauri spike notes; build plans and milestone notes in `docs/internal/`                                    |

## Contributing

Bug reports and small, focused PRs are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: it covers setup,
the checks, and [what Pantry won't build](CONTRIBUTING.md#what-we-wont-merge).

## Security

Please report vulnerabilities privately, not in a public issue: see [SECURITY.md](SECURITY.md).

## Changelog

What changed in each release: [CHANGELOG.md](CHANGELOG.md).

## Licence

MIT, see [LICENSE](LICENSE).
