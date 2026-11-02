import { v } from "convex/values";
import { components } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireOwner } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  importedIssue,
  importIssue,
  linkedSpace,
  MAX_ISSUES_PER_BATCH,
  MAX_TEAMS,
  prepareImport,
  type ImportIssueResult,
} from "./lib/imports";
import { workspaceMembers } from "./lib/names";
import { priority } from "./schema";

/**
 * Import from Linear (Settings → Import and Export). The app parses Linear's CSV export in the
 * browser and shows a review; nothing is written until the owner presses Import. Then `prepareLinear`
 * makes the spaces, projects and labels and `importLinearIssues` brings the issues in, in batches.
 * Owner only: an import creates spaces and labels for everyone. Every row it makes is linked to its
 * Linear id (`importLinks`), so the same file imported again skips what's there and finishes what an
 * interrupted import didn't.
 */

const MAX_LOOKUPS = 2_000;
const MAX_EMAILS = 1_000;

/**
 * What the review needs from the workspace: the space each team went to last time (if any), the
 * member behind each email (matched on their sign-in email) and which Linear issues are already in.
 */
export const linearContext = query({
  args: {
    teams: v.array(v.string()),
    emails: v.array(v.string()),
    externalIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx);
    if (args.teams.length > MAX_TEAMS || args.emails.length > MAX_EMAILS)
      fail("TOO_MANY", "That file has more teams or people than an import can take.");
    if (args.externalIds.length > MAX_LOOKUPS)
      fail("TOO_MANY", `Look up at most ${MAX_LOOKUPS} issues at a time.`);

    const teams: Record<string, { spaceId: Id<"spaces">; key: string; name: string } | null> = {};
    for (const team of args.teams) {
      const space = await linkedSpace(ctx, me.workspaceId, "linear", `team:${team}`);
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
      const issue = await importedIssue(ctx, me.workspaceId, "linear", externalId);
      if (issue) imported[externalId] = issue.key;
    }
    return { teams, people, imported };
  },
});

/**
 * Step 1: each team's space (new or existing), its projects, and the labels (reused by name). Safe to
 * run again: it finds what it made before.
 */
export const prepareLinear = mutation({
  args: {
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
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx);
    return prepareImport(ctx, me, "linear", args.teams, args.labels);
  },
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
});

/**
 * Step 2: one batch of issues (at most MAX_ISSUES_PER_BATCH), parents before their sub-issues. Each
 * is created or, when an earlier import made it, skipped. A batch is one transaction: if anything in
 * it fails, none of it is written, and importing again picks up from the first issue not yet in.
 */
export const importLinearIssues = mutation({
  args: { issues: v.array(issueInput) },
  handler: async (ctx, args): Promise<ImportIssueResult[]> => {
    const me = await requireOwner(ctx);
    if (args.issues.length > MAX_ISSUES_PER_BATCH)
      fail("TOO_MANY", `Send at most ${MAX_ISSUES_PER_BATCH} issues per batch.`);
    const results: ImportIssueResult[] = [];
    for (const issue of args.issues) results.push(await importIssue(ctx, me, "linear", issue));
    return results;
  },
});
