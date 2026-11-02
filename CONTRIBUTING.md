# Contributing

Pantry is early, and it has a tiny maintainer team, so small and focused lands much faster than large and
ambitious. Bug reports, fixes, tests and docs are genuinely welcome.

Pantry is deliberately small: an issue tracker for one to three people and their AI coding agents. Much of what
makes it useful is what it leaves out, so please read [What we won't merge](#what-we-wont-merge) before you build
a feature.

## Get it running

Follow [Develop locally](README.md#develop-locally) in the README. You need Node 24 and pnpm 10; no Convex
account. The Mac app in `apps/desktop` also needs Rust and isn't part of the default checks.

## Where things live

| Path                      | What                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `packages/backend/convex` | Convex schema and functions, Better Auth. All business logic lives here                 |
| `packages/app`            | The React screens, shared by the web app and the Mac app. Client-only                   |
| `packages/ui`             | Design system: tokens, theme, shadcn/ui on Base UI, motion, Markdown editor             |
| `packages/mcp`            | MCP tool definitions (M4)                                                               |
| `apps/web`                | The Next.js app on Vercel: `packages/app` plus `/api/auth` and `/api/instance`          |
| `apps/desktop`            | The Tauri v2 Mac app (M5)                                                               |
| `scripts/`                | The Vercel build, `set-version` and `release-notes`, and the Sync upstream test harness |
| `.github/workflows`       | CI, Release, Sync upstream and Push to instance                                         |
| `docs/`                   | The spec (`PANTRY-SPEC.md`) and deploy checklist; old build notes in `docs/internal/`   |

A few rules hold the codebase together. Reviews check them, and the scoped `AGENTS.md` files spell out the details
for each package:

- **Business logic belongs in Convex functions.** `apps/*` and `packages/mcp` are thin adapters that call them.
- **`packages/app` is client-only.** No `next/*` imports and no server components: the same code has to build
  statically for the Mac app.
- **Every public Convex function checks who's calling first**, with `requireMember(ctx)` (the app) or
  `requireToken(ctx, token)` (MCP). An MCP call only ever sees its token's workspace.
- **Every issue change leaves a trace:** it updates `updatedAt` and adds one activity row. Status changes, from the
  app or MCP, go through the one helper behind `issues.move`.
- **Tokens are stored as SHA-256 hashes**, never in plain text.
- **Schema changes are backward compatible:** add an optional field, migrate, then tighten. Self-hosted instances
  update by merging a PR, so a deploy must never fail on existing data.
- **The product name, issue key and token prefix come from `packages/backend/convex/lib/brand.ts`.** Don't
  hard-code "Pantry" or "PAN".
- **UI is built from `packages/ui`**, styled with its tokens, and animated only with its motion tokens. Every
  animation has a reduced-motion version.
- **Keyboard shortcuts go through the shortcut registry** in `packages/app`, which also builds the `?` help.

The full product spec is [docs/PANTRY-SPEC.md](docs/PANTRY-SPEC.md). [AGENTS.md](AGENTS.md) has the same rules
in the form coding agents read; it applies to people too.

## Before you push

```bash
pnpm check
```

That runs what CI runs. If it's green locally it should be green on GitHub. If you changed anything in
`scripts/`, also run `node --test "scripts/*.test.mjs"`.

Convex tests run in memory with `convex-test`, so you don't need a backend for them. If you change the UI, check
it in light and dark mode, and with reduced motion turned on.

## What we won't merge

Some of these are permanent decisions; a few may come later, but the maintainers will build those themselves.
A PR for any of them will be closed, however good the work is:

- GitHub pull request integration of any kind: PR links, branch or commit parsing, automatic status changes.
- Agents as members or assignees, agents claiming work, or agents running inside the app. Agents stay outside and
  use MCP as the person whose token they hold.
- A public REST API or webhooks. MCP is the integration surface.
- Saved views, cycles, or AI helpers (summaries, issue splitting, duplicate detection and so on).
- Client/Product workspace modes, appearance themes beyond light and dark, or a local mode.
- A hosted plan, billing, or a Cloudflare deploy.
- Anything on the spec's ["Never" list](docs/PANTRY-SPEC.md#never-cut-from-linear--permanent-not-planned):
  teams, triage, insights, initiatives, estimates, custom workflows per team, granular permissions and guests,
  customer requests, SAML/SCIM/audit logs, and time tracking.

If you think one of these should change, open an issue and make the case. Please don't send the code first.

## Pull requests

Keep a PR to one thing, and say what changed and why. The
[PR template](.github/pull_request_template.md) covers the rest. If it changes the UI, before and after
screenshots help a lot.

For anything that changes direction (a new screen, a new MCP tool, a schema change, a refactor that changes the
shape of the app), open an issue first. That isn't gatekeeping: it's better to hear "that's already half done" or
"that's on the won't-merge list" before you write it than after.

We might close a PR, ask you to shrink it, or end up building the idea differently. That's a call about scope and
timing, not about you or the quality of your work.

Be kind: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Security reports go through [SECURITY.md](SECURITY.md), not
public issues.

## Releasing

For maintainers. A release is a tag on `main`; the [Release workflow](.github/workflows/release.yml) does the rest,
and never deploys anything.

1. In [CHANGELOG.md](CHANGELOG.md), move the `[Unreleased]` entries into a new `## [X.Y.Z] - YYYY-MM-DD` section,
   written for people running Pantry, and update the links at the bottom. Leave `[Unreleased]` empty.
   If owners should look at this update before it goes live (it migrates data, needs a setting changed, or is
   risky to deploy untested), mark it for review: see "Review before merging" below.
2. Run `pnpm set-version X.Y.Z`. It sets the version in every `package.json`, the Mac app's config and
   `SERVER_VERSION` in `packages/backend/convex/lib/version.ts`, and fails if it can't find one of them. Raise
   `MIN_APP_VERSION` in the same file by hand only if this server no longer works with older Mac apps.
3. Run `pnpm check`, commit ("Release X.Y.Z") and push `main`.
4. Tag that commit and push the tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.

The workflow checks that the tag matches every version file and that the changelog has a dated section for it,
runs the CI checks, and creates the GitHub Release with that section as its notes. Self-hosted copies get an
update PR from their Sync upstream workflow the next Monday, or as soon as their owners run it.

### Review before merging

Self-hosters can let Sync upstream merge updates by themselves (`SYNC_AUTO_MERGE`, README → Automatic updates).
To stop that for one release, put this line on its own, as the first line of the version's changelog section:

```md
## [X.Y.Z] - YYYY-MM-DD

Pantry-Review: manual

**Review this update before merging.** One or two sentences: what changes for owners and what to check.
```

The section becomes the release notes, so the line ends up in the GitHub Release. Sync upstream reads it from
there: it then never auto-merges that release, and its PR opens with "Review before merging" and a link to the
notes. The match is exact: `Pantry-Review: manual` alone on a line, any case, no other text. If Sync upstream can't
read a release's notes, it doesn't auto-merge either. A later release is held back too while it would bring a
marked release the owner hasn't merged yet, so there's no need to mark the next one as well. Use it sparingly:
every marked release waits for each owner to merge it by hand.

A version with a pre-release part (`1.0.0-rc.1`) becomes a GitHub pre-release, which Sync upstream ignores. If
the workflow fails, fix the problem on `main`, then move the tag: `git tag -d vX.Y.Z`,
`git push origin :refs/tags/vX.Y.Z`, and tag again.
