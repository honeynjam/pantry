import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { CONTEXT_DOC_PLACEHOLDER, SAMPLE_CONTEXT_DOC, SAMPLE_SPACE } from "./lib/defaults";
import { fail } from "./lib/errors";
import { modeOf, saveSpaceContext } from "./lib/organise";
import { getSpace } from "./lib/spaces";

/**
 * Onboarding (spec §10 "First run"): the owner's walk-through after setup, and the shorter one for
 * invited members. It writes only through the shared helpers (spaces.*, invites.create,
 * tokens.create, workspace.setMode); these functions cover what's specific to it. Completion is per
 * member (`members.onboardedAt`), read by the app from workspace.current, so finished members cost
 * no extra reads.
 */

const MAX_SUMMARY = 300;

/**
 * Setup's sample space, if nobody has used it yet: still named and keyed as setup made it, never
 * had an issue or a project, and its context doc is the untouched template. Onboarding offers to
 * turn it into the owner's first space instead of leaving a demo around.
 */
async function untouchedSample(ctx: QueryCtx, spaces: Doc<"spaces">[]) {
  const sample = spaces.find(
    (space) =>
      space.archivedAt === undefined &&
      space.key === SAMPLE_SPACE.key &&
      space.name === SAMPLE_SPACE.name &&
      space.nextIssueNumber === 1,
  );
  if (!sample) return null;
  const [project, doc] = await Promise.all([
    ctx.db
      .query("projects")
      .withIndex("by_space", (q) => q.eq("spaceId", sample._id))
      .first(),
    ctx.db
      .query("docs")
      .withIndex("by_space_and_kind", (q) =>
        q.eq("spaceId", sample._id).eq("kind", "space_context"),
      )
      .first(),
  ]);
  if (project || (doc && doc.body !== SAMPLE_CONTEXT_DOC)) return null;
  return { spaceId: sample._id, name: sample.name, key: sample.key };
}

/** What the onboarding screens start from: run once per visit to /welcome, not on hot paths. */
export const state = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const workspace = await ctx.db.get("workspaces", me.workspaceId);
    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", me.workspaceId))
      .collect();
    return {
      isOwner: me.role === "owner",
      mode: modeOf(workspace),
      /** Set when the member has finished onboarding before (a re-run). */
      onboardedAt: me.onboardedAt ?? null,
      sample: me.role === "owner" ? await untouchedSample(ctx, spaces) : null,
    };
  },
});

/**
 * A one-line summary for a space, written into the "What this space is" placeholder of its context
 * doc. A doc someone has already written is left alone (`written: false`), so re-running onboarding
 * never overwrites it.
 */
export const describeSpace = mutation({
  args: { spaceId: v.id("spaces"), summary: v.string() },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    const summary = args.summary.trim().replace(/\s+/g, " ");
    if (!summary) return { written: false };
    if (summary.length > MAX_SUMMARY) {
      fail("TOO_LONG", `Keep it to one line (at most ${MAX_SUMMARY} characters).`);
    }
    const doc = await ctx.db
      .query("docs")
      .withIndex("by_space_and_kind", (q) => q.eq("spaceId", space._id).eq("kind", "space_context"))
      .first();
    const body = doc?.body ?? SAMPLE_CONTEXT_DOC;
    if (!body.includes(CONTEXT_DOC_PLACEHOLDER)) return { written: false };
    await saveSpaceContext(ctx, me, space, body.replace(CONTEXT_DOC_PLACEHOLDER, summary));
    return { written: true };
  },
});

/** Finished (or skipped): the app stops sending this member to onboarding. Safe to call again. */
export const complete = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    await ctx.db.patch("members", me._id, { onboardedAt: Date.now() });
  },
});
