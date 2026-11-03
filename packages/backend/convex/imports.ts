import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { requireOwner } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  importedIssue,
  importIssue,
  linkedSpace,
  MAX_COMMENTS_PER_BATCH,
  MAX_ISSUES_PER_BATCH,
  MAX_TEAMS,
  prepareImport,
  type ImportIssueInput,
  type ImportIssueResult,
  type ImportSource,
  type TeamPlan,
} from "./lib/imports";
import { workspaceMembers } from "./lib/names";
import { importSource, priority } from "./schema";

/**
 * Import from another tracker (Settings → Import and Export): Linear, Asana, Shortcut, Jira or any
 * other CSV. The app reads the export in the browser and shows a review; nothing is written until the
 * owner presses Import. Then `prepare` makes the spaces, projects and labels and `importIssues` brings
 * the issues in, in batches. Owner only: an import creates spaces and labels for everyone. Every row
 * it makes is linked to the source's own id (`importLinks`, per source), so the same file imported
 * again skips what's there and finishes what an interrupted import didn't.
 *
 * `linearContext`, `prepareLinear` and `importLinearIssues` are the 0.1.31 names, kept so an app
 * from that release keeps working against a newer backend; they're the same with `source: "linear"`.
 */

const MAX_LOOKUPS = 2_000;
const MAX_EMAILS = 1_000;

const contextArgs = {
  teams: v.array(v.string()),
  emails: v.array(v.string()),
  externalIds: v.array(v.string()),
};

/**
 * What the review needs from the workspace: the space each team went to last time (if any), the
 * member behind each email (matched on their sign-in email) and which source issues are already in.
 */
async function importContext(
  ctx: QueryCtx,
  source: ImportSource,
  args: { teams: string[]; emails: string[]; externalIds: string[] },
) {
  const me = await requireOwner(ctx);
  if (args.teams.length > MAX_TEAMS || args.emails.length > MAX_EMAILS)
    fail("TOO_MANY", "That file has more teams or people than an import can take.");
  if (args.externalIds.length > MAX_LOOKUPS)
    fail("TOO_MANY", `Look up at most ${MAX_LOOKUPS} issues at a time.`);

  const teams: Record<string, { spaceId: Id<"spaces">; key: string; name: string } | null> = {};
  for (const team of args.teams) {
    const space = await linkedSpace(ctx, me.workspaceId, source, `team:${team}`);
    teams[team] = space ? { spaceId: space._id, key: space.key, name: space.name } : null;
  }

  const members = await workspaceMembers(ctx, me.workspaceId);
  const people: Record<string, { memberId: Id<"members">; displayName: string } | null> = {};
  for (const raw of args.emails) {
    const email = raw.trim().toLowerCase();
    if (!email || email in people) continue;
    const user = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: "user",
      where: [{ field: "email", value: email }],
    });
    const member = user ? members.find((row) => row.userId === String(user._id)) : undefined;
    people[email] = member ? { memberId: member._id, displayName: member.displayName } : null;
  }

  const imported: Record<string, string> = {};
  for (const externalId of args.externalIds) {
    const issue = await importedIssue(ctx, me.workspaceId, source, externalId);
    if (issue) imported[externalId] = issue.key;
  }
  return { teams, people, imported };
}

export const context = query({
  args: { source: importSource, ...contextArgs },
  handler: (ctx, { source, ...args }) => importContext(ctx, source, args),
});

export const linearContext = query({
  args: contextArgs,
  handler: (ctx, args) => importContext(ctx, "linear", args),
});

const prepareArgs = {
  teams: v.array(
    v.object({
      team: v.string(),
      prefix: v.string(),
      maxNumber: v.number(),
      target: v.union(
        v.object({ spaceId: v.id("spaces") }),
        v.object({ name: v.string(), key: v.string() }),
      ),
      projects: v.array(v.object({ externalId: v.string(), name: v.string() })),
    }),
  ),
  labels: v.array(v.string()),
};

async function prepareFor(
  ctx: MutationCtx,
  source: ImportSource,
  args: { teams: TeamPlan[]; labels: string[] },
) {
  const me = await requireOwner(ctx);
  return prepareImport(ctx, me, source, args.teams, args.labels);
}

/**
 * Step 1: each team's space (new or existing), its projects, and the labels (reused by name). Safe to
 * run again: it finds what it made before.
 */
export const prepare = mutation({
  args: { source: importSource, ...prepareArgs },
  handler: (ctx, { source, ...args }) => prepareFor(ctx, source, args),
});

export const prepareLinear = mutation({
  args: prepareArgs,
  handler: (ctx, args) => prepareFor(ctx, "linear", args),
});

const issueInput = v.object({
  externalId: v.string(),
  sourceKey: v.string(),
  spaceId: v.id("spaces"),
  projectId: v.optional(v.id("projects")),
  parentExternalId: v.optional(v.string()),
  title: v.string(),
  description: v.string(),
  statusId: v.id("statuses"),
  priority,
  assigneeId: v.optional(v.id("members")),
  creatorId: v.optional(v.id("members")),
  labelIds: v.array(v.id("labels")),
  dueDate: v.optional(v.string()),
  completedAt: v.optional(v.number()),
  comments: v.optional(v.array(v.string())),
});

async function importBatch(
  ctx: MutationCtx,
  source: ImportSource,
  issues: ImportIssueInput[],
): Promise<ImportIssueResult[]> {
  const me = await requireOwner(ctx);
  if (issues.length > MAX_ISSUES_PER_BATCH)
    fail("TOO_MANY", `Send at most ${MAX_ISSUES_PER_BATCH} issues per batch.`);
  if (
    issues.reduce((sum, issue) => sum + (issue.comments?.length ?? 0), 0) > MAX_COMMENTS_PER_BATCH
  )
    fail("TOO_MANY", `Send at most ${MAX_COMMENTS_PER_BATCH} comments per batch.`);
  const results: ImportIssueResult[] = [];
  for (const issue of issues) results.push(await importIssue(ctx, me, source, issue));
  return results;
}

/**
 * Step 2: one batch of issues (at most MAX_ISSUES_PER_BATCH), parents before their sub-issues. Each
 * is created or, when an earlier import made it, skipped. A batch is one transaction: if anything in
 * it fails, none of it is written, and importing again picks up from the first issue not yet in.
 */
export const importIssues = mutation({
  args: { source: importSource, issues: v.array(issueInput) },
  handler: (ctx, args) => importBatch(ctx, args.source, args.issues),
});

export const importLinearIssues = mutation({
  args: { issues: v.array(issueInput) },
  handler: (ctx, args) => importBatch(ctx, "linear", args.issues),
});
