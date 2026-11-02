import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { notFound } from "./lib/errors";
import { reorderStatuses, updateStatus } from "./lib/organise";

/**
 * The six statuses are fixed in v0.1 (one per category): rename, recolour and reorder only. Names
 * stay unique, ignoring case, because agents set status by name over MCP.
 */
export const update = mutation({
  args: { statusId: v.id("statuses"), name: v.optional(v.string()), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const status = await ctx.db.get("statuses", args.statusId);
    if (!status || status.workspaceId !== me.workspaceId) return notFound("Status");
    await updateStatus(ctx, status, args);
  },
});

/** New order for all of the workspace's statuses: `statusIds` must list each exactly once. */
export const reorder = mutation({
  args: { statusIds: v.array(v.id("statuses")) },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    await reorderStatuses(ctx, me.workspaceId, args.statusIds);
  },
});
