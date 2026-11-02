# Data migrations

Pantry instances live in their owners' Convex deployments and upgrade through sync-upstream, so a schema
change has to deploy onto whatever data an instance already holds. Convex checks every existing row against
the new schema when functions are pushed, and refuses the push if any row doesn't fit. So every change goes
**widen → migrate → narrow** (CLAUDE.md), across releases:

1. **Widen** (release N): the schema accepts the old and the new shape. `convex deploy` succeeds on old data.
2. **Migrate** (release N, automatically): `migrations:run` moves the old rows, right after the deploy.
3. **Narrow** (release N+1 or later): the schema accepts only the new shape. Shipped only when every
   instance has run step 2, and guarded so it can't be deployed onto unmigrated data.

## Import and Export (unreleased): additive only, no migration

One new table, `importLinks` (what an import made from which Linear id, so a re-import skips it), and one wider
union: `activity.via` also accepts `"import"` (the `created` row of an imported issue). `comments.via` is
unchanged. Existing rows fit the new schema as they are, so `convex deploy` succeeds on any instance and
`migrations:run` has nothing to do. Nothing will be narrowed: older rows simply never say "import".

## MCP OAuth (0.1.30): additive only, no migration

Four new tables (`oauthClients`, `oauthRequests`, `oauthCodes`, `oauthGrants`) and two optional fields on
`apiTokens` (`grantId`, `expiresAt`). Existing rows fit the new schema as they are, so `convex deploy` succeeds on
any instance and `migrations:run` has nothing to do. Nothing will ever be narrowed here: personal API tokens keep
both fields unset.

## M2 → Spaces (the Spaces release, branch `spaces/model`)

M2 kept products in the `projects` table (key, issue counter) and pointed issues (`projectId`) and the context
doc (`projectId`, kind `project_context`) at them. The Spaces release moves products to `spaces` and reuses
`projects` for workstreams inside a space.

### The transitional schema (`packages/backend/convex/schema.ts`, marked TRANSITIONAL)

| Table | Accepts | Why |
|---|---|---|
| `projects` | a union: the workstream shape (`spaceId`, `sortOrder`, …) **or** the M2 shape (`key`, `nextIssueNumber`, …) | M2 rows stay valid until they're moved |
| `projects` indexes | `by_workspace` (transitional), `by_space`, `by_space_and_name` | `by_workspace` finds a workspace's M2 rows |
| `issues.spaceId` | optional | M2 issues have none yet; on them `projectId` means "the M2 project" |
| `docs.kind` / `docs.projectId` | `space_context` or `project_context`; optional `projectId`; transitional `by_project` index | the M2 context doc |

Code never reads these rows raw. `convex/lib/model.ts` has the narrow types (`Project`, `LegacyProject`,
`SpacedIssue`) and guards (`isProject`, `hasSpace`, `issueSpaceId`), and every function reads through them. So:
- an M2 row is never taken for a workstream (`getProject` returns "not found" for it);
- during the seconds between `convex deploy` and the migration, `workspace.current` reports `upgrading: true`,
  and the app shows "Finishing an upgrade" instead of half the data. The page comes back by itself when the
  migration ends, because the query is live;
- MCP's `resolveSpaceByKey` answers "This workspace is finishing an upgrade" for a key that's still an M2
  project. Writes to an unmigrated issue fail with the same message.

### The migration (`packages/backend/convex/migrations.ts`)

`migrations:run` (an internal action) runs four steps in order. Each step is an internal mutation over one batch
(100 rows by default, `{ batchSize }` to change it), so it stays inside Convex's per-transaction limits for any
number of issues:

1. `migrateSpaces`: a space for every M2 project (same name, key, `nextIssueNumber`, archived state). Spaces are
   matched to M2 projects by workspace + key (unique per workspace), so a re-run finds the space it made, and a
   counter is only ever raised, never lowered.
2. `migrateIssues`: every issue gets `spaceId`. An M2 issue's `projectId` is cleared; a `projectId` that points
   at a real workstream is kept; one pointing at a deleted row is cleared. An issue with no space whose project
   row is gone can't be placed: it's reported, never guessed.
3. `migrateDocs`: `project_context` docs become `space_context` docs on the space, with the same body and
   `updatedAt`.
4. `removeLegacyProjects`: deletes the M2 project rows once nothing points at them and their space exists.

Nothing else is touched. Comments, activity, members, invites and labels refer to issues and members, not
projects. Issue ids, keys, numbers, parents, sort orders and timestamps don't change.

It logs one line and returns counts:

```
Spaces migration: 2 spaces created (0 already there), 33 issues moved to their space (0 already done,
0 dangling project refs cleared), 2 context docs moved (0 already done), 2 M2 project rows deleted.
```

It's idempotent: a second run moves nothing. If some rows can't be placed, it migrates everything else and then
throws, listing them, so the deploy fails loudly.

`migrations:status` counts what's left, and `migrations:assertMigrated` throws while anything is left. Both
use indexes only, so they're cheap at any size.

### How it runs

- **Vercel** (`scripts/vercel-build.sh`): after `convex deploy`, step 4 runs `bash scripts/migrate.sh --prod`,
  with the same `CONVEX_DEPLOY_KEY`, so the same deployment. The script runs `migrations:run`, then
  `migrations:assertMigrated`; either failing fails the build. (`convex deploy` builds the web app before it
  pushes functions, so the migration can only run after both. If it fails, the new backend is live while
  Vercel keeps serving the previous frontend. See "If it fails".)
- **Local dev**: `pnpm dev` runs `convex dev --run migrations:run`, so every start migrates (a no-op once
  done). By hand: `pnpm --filter @pantry/backend migrate` (= `bash scripts/migrate.sh`).
- **Self-hosters on sync-upstream**: nothing to do. Merging the sync PR redeploys, and the build migrates.

### If it fails

The error names the rows it couldn't place. Fix or delete them (Convex dashboard → Data), then re-run:
`bash scripts/migrate.sh --prod` from a clone with `CONVEX_DEPLOY_KEY` set, or redeploy. Re-running is always
safe.

### Proven on M2 data (26 Oct 2026)

On a local anonymous deployment created by `main` (M2): setup through the UI, a second member through a real
invite link, and data through the M2 functions. Then `spaces/model` was pushed onto the **same** deployment,
and `scripts/migrate.sh` ran as the build runs it.

| | Before (M2) | After |
|---|---|---|
| `projects` rows | 2 (PAN next=31, WEB next=4) | 0 |
| `spaces` rows | – | 2 (PAN next=31, WEB next=4) |
| issues | 33 (PAN-1…30 incl. 10 sub-issues, WEB-1…3) | 33, every field identical except `spaceId` set and the M2 `projectId` cleared |
| comments / activity | 8 / 52 | 8 / 52, identical |
| docs | 2 `project_context` | 2 `space_context`, bodies and `updatedAt` identical |
| members / invites / labels | 2 / 1 / 3 | unchanged |

- The push succeeded on the M2 rows.
- The app showed "Finishing an upgrade" until the migration ran (1.2 s), then came back without a reload.
- A re-run (both `scripts/migrate.sh` and `convex dev --run`) changed nothing.
- In a production build: both members signed in with their M2 passwords; list, board, palette and My issues
  showed the M2 data; the next issue created was PAN-31.

Backend tests (`convex/migrations.test.ts`) cover:
- mixed M2 and new rows in batches of 7;
- a crashed half-run (a space already made);
- a dangling project ref;
- a re-run changing nothing;
- a no-op on fresh data;
- rows that can't be placed, which fail the run loudly after everything else has moved.

## Narrowing (a later release, not this one)

**When:** only after every instance you care about has deployed the Spaces release, and
`bash scripts/migrate.sh --check-only --prod` passes against it. For the public repo: at least one release
later, and never in the same release as the Spaces migration. Self-hosters who skip releases go through the
guard below.

**Guard (put it in the narrowing release's `scripts/vercel-build.sh`, before `npx convex deploy`):**

```bash
# Refuse to narrow while old rows remain. On an instance still on M2 the function doesn't exist yet,
# which fails too: deploy the Spaces release first.
bash "$ROOT/scripts/migrate.sh" --check-only --prod
```

Convex is the second line of defence: it refuses to push a narrowed schema while non-matching rows exist.
The guard just fails earlier, with a message that says what to do.

**The narrowing change itself:**
1. `schema.ts`:
   - `projects: defineTable(projectFields)`: drop the union, `legacyProjectFields` and the `by_workspace` index;
   - `issues.spaceId: v.id("spaces")` (required);
   - `docs.kind: v.literal("space_context")`: drop `docs.projectId` and the `docs.by_project` index;
   - remove the TRANSITIONAL comments.
2. `lib/model.ts`: `Project` becomes `Doc<"projects">`. Remove `LegacyProject`, `isLegacyProject`, `hasSpace`
   and `UPGRADING_MESSAGE`, and let `issueSpaceId` simply return `issue.spaceId` (or inline it).
3. Remove the upgrade window:
   - `upgradePending` and the `resolveSpaceByKey` fallback in `lib/spaces.ts`;
   - `upgrading` in `workspace.current`;
   - the `Upgrading` screen in `packages/app/src/shell/app-shell.tsx`;
   - the `issue.spaceId` checks in the app (`lookups.projectsOf`, the parent picker).
4. `migrations.ts`: delete the four steps and `run`. Keep `status` and `assertMigrated` for one more release
   (other instances' guards may still call them), then delete them too. Adjust `scripts/migrate.sh` and the
   `pnpm dev` script (`--run migrations:run`) to match.
5. Tests: drop `migrations.test.ts`'s M2 seeding along with the code, and keep a test that `assertMigrated`
   passes on fresh data.
