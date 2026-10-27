# Changelog

All notable changes to Pantry are listed here, newest first.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Pantry uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). The version is the one `GET /api/instance` reports as
`serverVersion`.

## [Unreleased]

### Fixed

- The Deploy button now sets Vercel's Root Directory to `apps/web`, so the first build works without changing
  any settings.
- The Vercel build no longer logs `npm warn Unknown env config "cache-dir"`: the build scripts run the Convex CLI
  with `pnpm exec` instead of `npx`.

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

[Unreleased]: https://github.com/honeynjam/pantry/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/honeynjam/pantry/releases/tag/v0.0.1
