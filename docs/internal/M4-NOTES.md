# M4 notes ("MCP", tasks 1–4; task 5 is Kris's)

Built 26 Oct 2026 on branch `m4/mcp`, based on `main` at `9b690d1` (M1–M3 plus Spaces). Local only, not pushed.
Source of truth: `docs/PANTRY-SPEC.md` §6 and §10b.

| Task | Commit |
|---|---|
| 1. Tokens: `tokens.create/revoke/list`, `requireToken`, the API tokens screen | `5f23279` |
| 2. `convex/mcp.ts`: `verifyToken` + one function per tool | `3a3c69f` |
| 3. `packages/mcp` + `/api/mcp` | `0899a90` |
| 4. "via MCP" and the `lastUsedAt` throttle | `e0e6edf` |
| Snippet wrapping fix and screenshots | `2e2521a` |
| 5. Real-client run on your instance | pending with Kris: `docs/spikes/mcp-clients.md` |

## What exists now

- **Tokens** (`convex/tokens.ts`). `create` is an action: a random `pan_` token, with its SHA-256 hash and the
  first 8 characters stored by an internal mutation, and the plain token returned once. `revoke` and `list` cover
  the caller's own tokens. `requireToken` / `findToken` live in `convex/lib/auth.ts`: they hash the token, then
  reject unknown, revoked or malformed tokens, and tokens whose member is gone.
- **Settings → Account → API tokens** (`packages/app/src/screens/settings/tokens.tsx`): create, then the token
  shown once with a copy button, tabs with the Claude Code and Cursor snippets (built in `mcp-snippets.ts` from
  `brand`), the list with "Used …"/"Never used", revoke behind a confirm dialog, and recent revoked tokens. Also
  in the user menu and the palette.
- **`convex/mcp.ts`**: `verifyToken`, `touchToken`, and `getIssue`, `getSpaceContext`, `listIssues`,
  `createIssue`, `createSubIssue`, `addComment`, `updateIssue`. Each calls `requireToken` first and resolves
  everything inside the token's workspace. By-name lookups: spaces and projects in `lib/spaces.ts` (already there),
  statuses, labels and members in the new `lib/names.ts`. Writes go through the app's helpers with
  `via: "mcp"`: `createIssue` (sub-issues inherit space and project), `changeStatus`, `updateIssue`, and
  `lib/comments.ts`'s `addComment`, which `comments.add` now uses too.
- **`packages/mcp`**: `registerTools` (seven tools with `z.object` inputs, read/write annotations, server
  instructions), `createVerifyToken` (asks `mcp.verifyToken`, then calls `mcp.touchToken` only when `lastUsedAt`
  is at least 10 minutes old; the mutation checks again) and `convexBackend` (a ConvexHttpClient). A ConvexError
  from Convex becomes `isError: true` with its message. Any other error becomes a generic `isError` message,
  logged on the server.
- **`apps/web/app/api/mcp/route.ts`**: `withMcpAuth(createMcpHandler(registerTools), verifyToken, { required: true })`
  for GET, POST and DELETE. It answers 503 when the build has no Convex URL. Links in results use the request's
  public origin.
- Comments carry `id="comment-<id>"`, so the link `add_comment` returns scrolls to the comment.
- Spec §6/§10b tool tables now list exactly what the tools return; README has "Connect your agents (MCP)".

## Decisions for Kris

Each one is built this way and easy to change.

1. **Where tokens live:** there's no separate "User settings" page, so Settings gets an **Account** group under
   Workspace with **API tokens**. It's also in the user menu and the palette.
2. **Tokens are personal, even to the owner.** The owner can't see or revoke the partner's tokens. If a partner's
   token leaks, only the partner can revoke it. An owner "revoke all tokens for this member" could come later.
3. **25 live tokens per person** (`MAX_ACTIVE_TOKENS`), to cap runaway scripts.
4. **Priority over MCP** is a name (`none`, `urgent`, `high`, `medium`, `low`) or 0–4, and results show the name.
   The spec didn't say.
5. **Results are JSON text** (names, not ids; ISO times; a `url` per issue). There's no `outputSchema` or
   `structuredContent`. Convex returns objects with sorted keys, so `get_issue`'s fields come back
   alphabetically.
6. **`get_space_context`** returns the space, its active project names and the doc, as specified. It doesn't list
   statuses, labels or members; the error messages list those when needed. Easy to add if agents ask a lot.
7. **401 wording:** for a revoked token, mcp-handler's 401 says "No authorization provided". If Convex is
   unreachable, `withMcpAuth` answers 401 "Invalid token" rather than 503, because it catches `verifyToken`
   errors. Wrapping the route to tell those apart is a small change if you want it.
8. **`list_issues`** walks the workspace's issues newest first (`by_workspace_and_updated`), filters them in the
   function and stops at `limit`. That's fine at v0.1 sizes. A very selective filter over thousands of issues
   would scan more; add an index then.
9. **Snippet URL** is the page's own origin (`window.location.origin` + `/api/mcp`). That's right on the web. The
   Mac app (M5) will need to pass the server URL instead.
10. **Cursor snippet** reads `PANTRY_TOKEN` from the environment, per the spec. The guide explains that Dock-launched
    macOS apps don't see `~/.zshrc`. If that turns out to be too fiddly, the alternative is pasting the token
    into `mcp.json` directly.

## How it was verified

- `pnpm turbo typecheck lint test`: 17/17 tasks. Tests per package: ui 22, backend 130 (new: 10 tokens
  + 3 `lastUsedAt`, 22 MCP), app 57 (new: 3 snippet tests), mcp 17 (new: 12 handler + 5 `verifyToken`), web 8 (new: 4
  route tests). `pnpm --filter @pantry/web build` passes.
  - Backend: per-tool `convex-test`; a cross-workspace "not found" check for every tool (spaces, projects,
    statuses, labels and issues of a second workspace); sub-issue space and project inheritance (and following a
    parent's project change); project lookup by name with the valid-names error; a revoked token rejected by all
    seven functions; the 10-minute throttle with fake timers.
  - Handler tests: the real `createMcpHandler` + `withMcpAuth` with a stub `authInfo`, driven by the MCP client
    SDK over an in-process fetch. Route tests: 401 with no token or a revoked one, 200 with a live one, 503 with
    no Convex URL.
- **End to end, locally:** `next build && next start` on :3300 against a fresh anonymous Convex backend on
  :3330/:3331 (`SITE_URL=http://localhost:3300`).
  1. Set up the owner in the browser (Playwright), created PAN-1 with the New issue dialog, and created a token
     in Settings → API tokens (read from the page).
  2. **MCP client SDK (2.4.0) script** with that token, all OK: tools/list showed the 7 tools; `get_issue PAN-1`;
     `get_space_context PAN`; `update_issue` → In Progress; `add_comment` (markdown); `create_sub_issue` → PAN-2
     (space PAN, parent PAN-1); `update_issue` → In Review. Extras: `status: "Doing"` came back as `isError` with
     the six status names, and `list_issues` worked.
  3. **Real Claude Code (2.1.310):** `claude mcp add --scope project --transport http pantry … --header
     "Authorization: Bearer …"` in a scratch folder. Project-scoped servers need interactive approval, so the run
     was `claude -p … --mcp-config <that .mcp.json> --strict-mcp-config --tools "" --model claude-haiku-5-5`,
     limited to the Pantry tools. On PAN-3 (created through `issues.create`), it read the issue, read the context
     doc, moved PAN-3 to In Progress, commented its plan, created sub-issue PAN-4 and moved PAN-3 to In Review.
  4. **Browser:** PAN-1 and PAN-3 show each status change and the comment under "Kris", tagged **via MCP**. The
     creation, done in the app, has no tag. The `activity` table has `via: "mcp"` on every MCP write
     (status changes, comments, sub-issue `created`) and `app` on the app's creations. The comment link scrolls
     to the comment. The token list showed "Used 2 min. ago".
  5. **Revoke:** revoked the token in the UI (confirm dialog). The next raw POST got **401**, and the SDK client
     failed with 401.
- Screenshots (2×, `docs/screenshots/`): `m4-tokens-claude-code-{light,dark}`, `m4-tokens-cursor-{light,dark}`,
  `m4-tokens-revoke-dark`, `m4-issue-via-mcp-{light,dark}`, `m4-issue-via-mcp-timeline-{light,dark}`. The tokens
  shown in them came from the throwaway local backend and were revoked straight away. That backend's data was
  then deleted.

## M4 acceptance criteria

| Criterion | Status |
|---|---|
| Create, name, revoke and list tokens | ✔ UI and tests |
| A revoked token gets 401 on the next call | ✔ locally (route test and a live server) |
| The seven tools pass `convex-test` and handler tests | ✔ |
| Claude Code, using the snippet, completes the script on a real issue; each step shows "via MCP" under your name | ✔ locally (headless Claude Code, local backend). **Pending on your instance: task 5** |

## Not verified

- Anything on your instance (`pantry-teal-kappa.vercel.app`): the deploy, Claude Code there, Cursor at all.
- An interactive Claude Code session with `claude mcp add` at the default local scope. Locally I used project
  scope plus `--mcp-config`; it's the same transport and header.
- MCP clients on the 2026-07-28 protocol revision. The SDK client negotiated 2025-11-25; I didn't log which
  revision Claude Code used. mcp-handler serves both.
- Behaviour on Vercel's runtime (only `next start` locally) and under concurrent agents.

## After M4: agents organise work too (27 Oct 2026, branch `mcp/more-tools`)

Kris asked for "the MCP so it can do more things, e.g. add/update projects, create spaces". Agents can now do
what a member does in the app's settings screens, through the same helpers and permission checks.

| Commit | What |
|---|---|
| `c58377e` | `lib/organise.ts` and `lib/search.ts`: the app's space, context-doc, project, label and search logic lifted out of the mutations (no behaviour change; all 136 backend tests unchanged) |
| `308eec0` | `convex/mcp.ts`: `getWorkspace`, `searchIssues`, `createSpace`, `updateSpace`, `updateSpaceContext`, `createProject`, `updateProject`, `archiveProject`, `createLabel`; `updateIssue` takes title, description and due date |
| `7688258` | `packages/mcp`: the nine tools with zod inputs, `destructiveHint` on `archive_project`, links to spaces, server instructions |
| `4e25aa7` | Spec §6/§10b, README, `docs/spikes/mcp-clients.md`, these notes, screenshots `mcp-more-*` |

**The 16 tools:** issue work (`get_issue`, `list_issues`, `search_issues`, `create_issue`, `create_sub_issue`,
`add_comment`, `update_issue`), orientation and context (`get_workspace`, `get_space_context`,
`update_space_context`) and organising (`create_space`, `update_space`, `create_project`, `update_project`,
`archive_project`, `create_label`).

### Decisions for Kris

1. **Not exposed over MCP, on purpose:** deleting spaces, comments or labels; adding or removing statuses;
   invites, members and API tokens. They're destructive or account-level, and a leaked token shouldn't be able to
   do them. The server instructions and `update_space`'s description tell agents to ask a person. Easy to revisit
   tool by tool. **Reversed by Kris on 27 Oct 2026:** deleting issues (`delete_issue`) and editing the status
   definitions (`update_status`, `reorder_statuses`) are now exposed; see "Delete issues, edit statuses,
   un-archive projects" below.
2. **No `archive_space`.** The app has `spaces.archive` but no un-archive, and an archived space's key stays
   taken, so it isn't reversible. Skipped until the app can restore a space.
3. **`archive_project`** clears the project from its issues (each change logged "via MCP"). Since 27 Oct 2026 it's
   reversible (`unarchive_project`, and Restore in Space settings), so it's no longer marked destructive; the
   issues still don't move back.
4. **Permissions match the app: any member's token** can create spaces, projects and labels and rewrite context
   docs (none of these is owner-only in the app; invites are, and stay off MCP). Tested with the partner's token.
5. **`get_workspace` replaces `list_spaces` / `list_projects`.** The tables are small (it reads spaces, projects,
   statuses, labels and members through indexes), so one call orients an agent. Projects of archived spaces
   aren't listed; the space is, flagged `archived: true`.
6. **`create_issue` gets no `parent`:** that would duplicate `create_sub_issue`. It already took labels and due
   dates.
7. **Colours over MCP are palette names only** (`gray` … `pink`, the app's swatches; a test keeps the two lists
   equal). The app's mutations also accept hex for statuses; agents can't store a colour the app has no swatch
   for. Defaults: a new project gets the next colour in the app's rotation (palette minus gray), a label gray.
8. **Context docs record who and when** (`updatedBy`, `updatedAt`, as in the app) but carry no "via MCP" tag:
   docs have no `via` field, and adding one would be a schema change. The settings page shows "Edited … by Kris".

### How it was verified

- `pnpm check` (format, typecheck, lint, tests, script tests, web build): passes. Backend 157 tests (21 new in
  `mcp-organise.test.ts`: every new tool, a revoked token on each, cross-workspace "not found" for spaces,
  projects, labels, context docs and search, key rules, palette errors, partner-token parity, archive leaving
  issues and sub-issues in the space with `project_changed` rows via MCP, title/description/due-date rows);
  `packages/mcp` 27 handler tests (16 tools listed, pass-through per new tool, zod refusals before Convex);
  app 65 (palette parity).
- End to end: production build on :3300, fresh anonymous backend on :3330/:3331, owner and token created in the
  browser, then the MCP client SDK: `get_workspace` → `create_space` ACME (client) → `update_space_context` →
  `create_project` Website (red, the rotation) and Launch (violet) → `create_label` Content, Bug →
  `create_issue` ×3 across both projects with labels and due dates → `update_project` Website → "Marketing site",
  teal → `update_issue` ACME-1 to Launch with a new title and due date → `create_issue` with label "Ideas" (error
  listing "Content", "Bug") → `archive_project` Launch (2 issues moved) → `search_issues` "launch" and "acme-2"
  → `get_workspace` and `get_issue` confirming the state. In the browser: ACME in the sidebar with "Marketing
  site" only, the list with label chips and due dates, the settings page with kind Client, the teal project and
  the new context doc ("Edited just now by Kris"), and ACME-1's activity: created, renamed, due date set, moved
  from Marketing site to Launch, removed from Launch, each "via MCP". Screenshots
  `docs/screenshots/mcp-more-{space,issue,space-settings}-{light,dark}.png`.
- Not verified: a real Claude Code or Cursor session using the new tools (only the SDK client this time), and
  anything on a deployed instance.

## Delete issues, edit statuses, un-archive projects (27 Oct 2026, branch `feat/delete-statuses-unarchive`)

Kris reversed two "not exposed" decisions (deleting issues, editing statuses) and asked for un-archiving projects
in the app and over MCP. 20 tools now.

| Commit | What |
|---|---|
| `77ce5a4` | Backend: `mcp.deleteIssue`, `mcp.updateStatus`, `mcp.reorderStatuses`, `mcp.unarchiveProject`; `lib/organise.ts` gains `restoreProject`, `archivedProjects`, `updateStatus`, `reorderStatuses` (the app's `statuses.update/reorder` now call them); `projects.restore` and `projects.listArchived`; `deleteIssue` reports what it removed |
| `f133cd3` | `packages/mcp`: the four tools; `archive_project` no longer `destructiveHint` |
| `19eb5cf` | Space settings → Projects → Archived (collapsed, count) with Restore; screenshots `unarchive-*` |

**New tools**
- `delete_issue { key, confirm }`: the app's hard delete (sub-issues, comments and activity go too), through the
  same helper. `confirm` must repeat the key, else "Nothing deleted…". Returns `{ deleted, title, subIssues,
  comments }`. `destructiveHint: true`; the description says it can't be undone and to ask first unless the
  person asked for this delete, and suggests a done/canceled status instead.
- `update_status { status, name?, color? }`: rename or recolour a status definition. Colours: palette names or
  `"default"` (the category's own colour, the app picker's "Default" swatch).
- `reorder_statuses { statuses }`: every status name once, in the new order.
- `unarchive_project { space, project, name? }`: restore; `name` restores under a new name.
- Descriptions of `update_issue`, `update_status` and `reorder_statuses` point at each other: moving one issue vs
  changing the definitions.

**Un-archive behaviour.** A restored project goes to the end of the space's project list and shows in the sidebar
and pickers again (live). Issues that lost it when it was archived stay without a project: archiving cleared
them and nothing records which they were, so nothing is reconstructed; the UI and tool descriptions say so.
Refused in an archived space.

**Name clash (decision for Kris).** Names are unique among a space's active projects, so restoring "Website" while
an active "Website" exists is refused: "There's already an active project called Website in Pantry. Rename one of
them first, then restore." I picked refuse-and-rename over a "restore as…" dialog because Space settings already
renames projects inline: archived rows keep an editable name, so the fix is rename, then Restore, with no new
dialog. `projects.restore` and `unarchive_project` also take an optional `name` to restore under a new name in
one step. With two archived projects of the same name, MCP restores the most recently archived one.

**Permissions.** As in the app, any member (not owner-only): tested with the partner's token / identity.

### How it was verified

- `pnpm check` passes. Backend 174 tests (17 new: `projects-restore.test.ts` for order, issues staying
  project-less, the clash and rename paths, archived space, member parity, cross-workspace; and
  `mcp-delete-statuses.test.ts` for revoked tokens, the confirm guard, sub-issues/comments/activity removed,
  cross-workspace, status rename/recolour/"default"/clash/palette errors, reorder validation, unarchive with and
  without a clash). `packages/mcp` 31 handler tests (20 tools listed, pass-through and zod refusals for the four).
- End to end (production build :3300, fresh anonymous backend :3330/:3331, token from the UI, MCP client SDK):
  - Status definitions: with the list, board and Settings → Statuses open in a browser, `update_status` In Review
    → "Needs review" (pink) and Todo → "Up next" (blue), a bad name and an incomplete reorder refused with the
    valid names, then `reorder_statuses` [Up next, In Progress, Needs review, Backlog, Done, Canceled]. Without a
    reload, list groups, board columns and the settings rows all showed the new names and order.
  - `delete_issue` PAN-3 (two sub-issues, two comments): `confirm: "yes"` and `confirm: "PAN-4"` refused, nothing
    deleted; `confirm: "PAN-3"` → `{ subIssues: [PAN-4, PAN-5], comments: 2 }`; `get_issue PAN-4` → not found.
  - `archive_project` Launch → PAN-2 lost its project → `unarchive_project` → project back, PAN-2 still without
    one (as designed) → a second unarchive says "Launch isn't archived".
  - Browser: archived Website and Launch from Space settings, opened Archived (Enter on the toggle), restored
    Launch (sidebar updated live); added an active "Website", Restore on the archived one showed the clash
    message and left it archived; renamed it inline to "Website (2025)", Restore worked; sidebar and the list's
    Project filter showed Launch, Website and Website (2025).
- Not verified: Safari/Firefox, a real Claude Code or Cursor session with these tools, anything on a deployed
  instance.
