# Changelog

All notable changes to Pantry are listed here, newest first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Pantry uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is the one `GET /api/instance` reports as
`serverVersion`.

## [Unreleased]

## [0.1.32] - 2026-11-03

### Added

- **Import from Asana, Shortcut, Jira or any CSV.** Settings → Import and Export now lists five sources, each with
  where to find its export. Asana (one CSV per project, several at once; sections become statuses, subtasks
  sub-issues), Shortcut (teams become spaces, epics projects, tasks a checklist) and Jira (keeps issue numbers,
  epics become projects, sub-tasks sub-issues, comments come along, several files for exports past Jira's limit)
  are marked Beta. **Other CSV** takes ClickUp, Trello, Notion or spreadsheet exports: you pick which column is
  the title, status, assignee and so on. Every source gets the same review, editable status and priority mapping,
  and safe re-imports. A file dropped on the wrong source is recognised, with a switch to the right one.

## [0.1.31] - 2026-11-02

### Added

- **Import from Linear, and export.** Settings → Import and Export takes Linear's CSV export: each team becomes a
  space (keeping its issue numbers when the key matches), with its projects, labels, statuses, sub-issues, due
  dates and assignees matched by email. You review everything before it's written, and importing the same file
  again skips what's already there. Linear fields Pantry doesn't have (milestones, initiatives, relations…) go into
  a note at the end of each description. Any member can download the workspace as JSON (everything) or the issues
  as CSV.

## [0.1.30] - 2026-11-02

### Added

- **Connect Claude and ChatGPT with just the URL.** Claude (claude.ai, Desktop, mobile) and ChatGPT can't send an
  API token, so they couldn't connect before. Now you add a custom connector with `https://<your-app>/api/mcp`, sign
  in to Pantry in the window that opens and press Allow. The app acts as you, exactly like an API token. Settings →
  API tokens has the steps for each, and lists your **Connected apps** with a Disconnect button. Claude Code and
  Cursor keep working with API tokens as before.

### Fixed

- The Vercel build no longer logs `npm warn Unknown env config "cache-dir"`: the build scripts run the Convex CLI
  with `pnpm exec` instead of `npx`.

## [0.1.21] - 2026-10-30

### Fixed

- **The docs link check no longer times out in CI.** It rendered every docs page with syntax highlighting just to
  read the links, which took over 60 seconds on a slow GitHub runner and failed update PRs. It now skips the
  highlighting and runs in well under a second.
- When `SYNC_UPSTREAM_TOKEN` lacks _Actions: Read_, an update PR that should merge by itself now says so in a comment
  ("add Actions: Read, then re-run CI") instead of failing with a bare HTTP 403 in the workflow log.

## [0.1.2] - 2026-10-30

### Fixed

- **CI no longer fails at random on update PRs.** Tests had vitest's 5-second limit, which GitHub's shared runners
  sometimes exceed on healthy tests, so an update PR could fail CI for no real reason and, with
  `SYNC_AUTO_MERGE=true`, wait for you instead of merging. Every test package now allows 30 seconds.

## [0.1.1] - 2026-10-30

Automatic updates now work on every GitHub plan, including private repos on GitHub Free. This update changes files
under `.github/workflows`, so Sync upstream needs the `SYNC_UPSTREAM_TOKEN` secret to push it
([Updating your instance](https://github.com/honeynjam/pantry#updating-your-instance)).

### Changed

- **Automatic updates work on any GitHub plan.** Private repos on GitHub Free can't use GitHub's auto-merge or
  require status checks, so `SYNC_AUTO_MERGE` didn't merge anything there. Now, when GitHub's auto-merge isn't
  available, Sync upstream merges the update PR itself once CI has passed on it, using `SYNC_UPSTREAM_TOKEN`, so
  the merge deploys and is watched like one of yours. Setup is the token (with _Actions_ read added) plus
  `SYNC_AUTO_MERGE=true`; no repo settings needed. The same rules hold: never the first update, a release marked
  for review, a conflicting PR, a PR whose CI failed (it comments) or one someone else pushed to. Without the
  token it comments on the PR saying it's needed. Where GitHub's auto-merge is available it's still used. See
  [Automatic updates](https://github.com/honeynjam/pantry#automatic-updates-opt-in).
- With GitHub's auto-merge allowed but no required checks, update PRs no longer merge the moment they open: they
  now wait for CI as above.

## [0.1.0] - 2026-10-29

Pantry-Review: manual

**Review this update before merging.** For most copies it's the first update, which replaces files wholesale:
if you edited files in your repo, put your changes back on the PR branch first. If your copy is older than 0.0.1
(from before spaces), the deploy also moves your data to spaces; watch the Vercel build, and see
[docs/MIGRATIONS.md](https://github.com/honeynjam/pantry/blob/main/docs/MIGRATIONS.md#if-it-fails) if it stops. This update adds files under `.github/workflows`, so Sync
upstream needs the `SYNC_UPSTREAM_TOKEN` secret to push it
([Updating your instance](https://github.com/honeynjam/pantry#updating-your-instance)).

Onboarding and products or clients for new and existing workspaces, agents that can organise your work over MCP
(20 tools in all), and updates that can merge and deploy themselves if you want them to.

### Added

- **Onboarding.** Right after setup, a short full-screen walk-through: what you work on (products, clients or
  both), your first products or clients (the unused sample space can be renamed, key included, and each can
  take one line for its context doc), invites, connecting your agent, theme and the keys to know. Invited
  members get a shorter version on first sign-in. Existing owners and members see it once after updating.
  Settings → General → **Run setup again** and the user menu's **Show onboarding** bring it back.
- **Products, clients or both.** The workspace's work type sets the words: "Products" or "Clients" in the
  sidebar, settings, Home and the palette, and new spaces start as that kind. With both, the sidebar and Home
  group them and the new-space dialog asks which. Owners change it in Settings → General; existing spaces keep
  their kind. `get_workspace` over MCP now returns the `mode`.
- A space's key can now change while the space has never had an issue (`spaces.update`; onboarding uses it to
  rename the sample). Once the first issue exists, the key is fixed as before.
- **Agents can organise work over MCP**, not just work single issues: `get_workspace` to see spaces, projects,
  statuses, labels and people in one call; `search_issues`; `create_space` and `update_space`;
  `update_space_context` to rewrite a space's context doc; `create_project`, `update_project` and
  `archive_project`; `create_label`. `update_issue` can now also change the title, description and due date.
  Everything shows under your name, tagged "via MCP". Deleting spaces, comments or labels, archiving spaces,
  adding or removing statuses, invites, members and tokens stay app-only.
- **Restore archived projects.** Space settings → Projects has an Archived list with Restore, and agents can use
  `unarchive_project`. A restored project goes to the end of the list; issues that were in it when it was
  archived stay without a project. If an active project has the same name, rename one of them first.
- **Agents can delete issues and edit statuses over MCP:** `delete_issue` (only when `confirm` repeats the
  issue's key; sub-issues and comments go too), `update_status` (rename or recolour) and `reorder_statuses`.
- **Automatic updates (opt-in).** Set the repository variable `SYNC_AUTO_MERGE` to `true` and Sync upstream
  turns on GitHub's auto-merge for its update PRs, so ordinary updates merge, and deploy, by themselves: after
  your required checks pass, or straight away if there are none. It never auto-merges the first update of your
  copy, a release marked for review, or a PR that conflicts with your own changes. If GitHub refuses (auto-merge
  not allowed, for example), it comments on the PR with the setting to change. Setup:
  [Automatic updates](https://github.com/honeynjam/pantry#automatic-updates-opt-in).
- **Releases can ask for a review.** When a release's notes say so, its update PR opens with "Review before
  merging", and it's never merged automatically.
- **Hear about updates that didn't deploy.** A new "Watch update deploys" workflow watches Vercel's production
  deploy after an update PR merges. If it fails (for example, the data migration stopped) or hasn't finished in 30
  minutes, it opens an issue "Pantry vX.Y.Z didn't deploy" with the build link and the fix. On by default; set
  the repository variable `PANTRY_DEPLOY_WATCH` to `false` to turn it off.

### Fixed

- The Deploy button now sets Vercel's Root Directory to `apps/web`, so the first build works without changing
  any settings.

## [0.0.1] - 2026-10-27

The first release. Pantry runs on your own Vercel and Convex accounts, for one to three people, and your agents
work on its issues over MCP. The Mac app is not in this release yet.

### Added

- **Deploy your own** with the "Deploy with Vercel" button. Vercel copies the repo into your GitHub account, the
  Convex integration creates your backend, and one build deploys both. Only production deploys run: preview builds
  are skipped, so they never touch your data. If the build stops (for example, Root Directory isn't `apps/web`),
  its message says how to fix it.
- **Setup screen.** On a new instance you create your account and workspace and become its owner. From then on
  sign-up is invite-only. If the deploy couldn't set the auth secret, the screen shows the one command that fixes
  it.
- **Invites.** The owner creates an invite link for an email address in Settings → Members and sends it themselves
  (nothing is emailed). A link works once, for that address, for 7 days, and can be revoked. The sign-up page
  pre-fills the invited email, and says so plainly when a link has expired, been revoked or already been used.
- **Spaces and projects.** A space is a product or a client: it has its own issue key (`PAN-1`, `PAN-2`, …), a
  Markdown context doc for your agents to read, and its issues. Projects are optional workstreams inside a space.
  Every space gets a felt-card pantry avatar (toast, a jam jar, a cookie…) picked at random; change it when you
  create the space or later in its settings. Spaces and projects can be archived.
- **Issues** with a title, Markdown description, status, priority, assignee, labels, due date and comments.
  Sub-issues go one level deep and always stay in their parent's space and project. Each issue keeps a timeline of every
  change.
- **List and board views.** The list groups a space's or project's issues by status. On the board you drag cards between and
  within columns, with the mouse or the keyboard. Changes show up for everyone in the workspace straight away,
  without a reload.
- **Keyboard first.** Press `?` for every shortcut. ⌘K opens the command palette to jump to any issue, space or
  action. In lists and on the board, J/K moves, X selects, and S/A/I/L/P/D change status, assignee, priority,
  labels, project and due date for one issue or the whole selection. `[` folds the sidebar.
- **My issues** shows everything assigned to you across spaces, and lists filter by status, assignee, priority
  and label, with the filters kept in the URL so you can share or bookmark them.
- **Instant edits.** Status, field and comment changes show at once and sync in the background.
- **Connect your agents over MCP.** Create an API token in Settings → API tokens and paste the ready-made snippet
  into Claude Code, Cursor or another MCP client. Agents can read an issue and its space's context doc, list,
  create and update issues, add sub-issues and comment. They act as you, inside your workspace only, and their
  changes are tagged "via MCP". Revoking a token stops it at once. See
  [Connect your agents (MCP)](README.md#connect-your-agents-mcp).
- **Fast with real data.** Lists and boards with thousands of issues load only what they show and re-render only
  the rows that change, and each page loads its own screen rather than the whole app.
- **Labels and statuses.** Add, rename, recolour and delete labels. The six default statuses (Backlog, Todo,
  In Progress, In Review, Done, Canceled) can be renamed, recoloured and reordered.
- **A Markdown editor that keeps your agents' Markdown as written.** Tables, HTML, task lists and links survive a
  round trip, and blocks you don't edit are saved exactly as they were.
- **Light and dark mode**, or follow the system setting.
- **Updates for your instance.** Your copy includes a "Sync upstream" workflow that opens a pull request in your
  repo for each new Pantry release, every Monday or when you run it. Merging the PR deploys the update; the workflow
  never merges by itself. See [Updating your instance](README.md#updating-your-instance).
- **Push to instance** (optional, off by default). If you develop in one repo and deploy from another, this
  workflow pushes `main` to the repo your instance deploys from after CI passes.
- **`GET /api/instance`**, a quick health check: your instance's name, Convex URLs, server version, the oldest Mac
  app it supports, and whether the auth secret is still missing.

[Unreleased]: https://github.com/honeynjam/pantry/compare/v0.1.32...HEAD
[0.1.32]: https://github.com/honeynjam/pantry/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/honeynjam/pantry/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/honeynjam/pantry/compare/v0.1.21...v0.1.30
[0.1.21]: https://github.com/honeynjam/pantry/compare/v0.1.2...v0.1.21
[0.1.2]: https://github.com/honeynjam/pantry/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/honeynjam/pantry/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/honeynjam/pantry/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/honeynjam/pantry/releases/tag/v0.0.1
