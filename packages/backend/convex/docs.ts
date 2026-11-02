import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { notFound } from "./lib/errors";
import { saveSpaceContext } from "./lib/organise";
import { getSpace } from "./lib/spaces";

/** The space's context doc (agents read it first over MCP). */
export const getContext = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, { spaceId }) => {
    const me = await requireMember(ctx);
    const space = await ctx.db.get("spaces", spaceId);
    if (!space || space.workspaceId !== me.workspaceId) return notFound("Space");
    const doc = await ctx.db
      .query("docs")
      .withIndex("by_space_and_kind", (q) => q.eq("spaceId", spaceId).eq("kind", "space_context"))
      .first();
    if (!doc) return null;
    const editor = await ctx.db.get("members", doc.updatedBy);
    return {
      _id: doc._id,
      title: doc.title,
      body: doc.body,
      updatedAt: doc.updatedAt,
      updatedBy: editor ? { _id: editor._id, displayName: editor.displayName } : null,
    };
  },
});

/** Saves the markdown body (the editor saves on blur and Cmd/Ctrl+Enter, never per keystroke). */
export const saveContext = mutation({
  args: { spaceId: v.id("spaces"), body: v.string() },
  handler: async (ctx, { spaceId, body }) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, spaceId);
    await saveSpaceContext(ctx, me, space, body);
  },
});
