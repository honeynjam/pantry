import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { avatarValidator } from "./lib/avatar";
import { createSpace, updateSpace } from "./lib/organise";
import { getSpace } from "./lib/spaces";
import { spaceKind } from "./schema";

/**
 * New space (a product or a client) with its context doc. The key is unique per workspace,
 * archived spaces included (their issues keep their keys), and fixed after creation. The app sends a
 * random avatar the creator can change first; without one the space gets a look seeded from its key.
 */
export const create = mutation({
  args: {
    name: v.string(),
    key: v.string(),
    kind: v.optional(spaceKind),
    avatar: v.optional(avatarValidator),
  },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const { spaceId, key } = await createSpace(ctx, me, args);
    return { spaceId, key };
  },
});

/**
 * Rename or change kind; the key can change only while the space has never had an issue (onboarding
 * renames the untouched sample space this way). After that, issue keys and agents depend on it.
 */
export const update = mutation({
  args: {
    spaceId: v.id("spaces"),
    name: v.optional(v.string()),
    kind: v.optional(spaceKind),
    key: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    await updateSpace(ctx, space, args);
  },
});

/** Changes the space's avatar (shape, colour and eyes). */
export const setAvatar = mutation({
  args: { spaceId: v.id("spaces"), avatar: avatarValidator },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    await getSpace(ctx, me.workspaceId, args.spaceId);
    await ctx.db.patch("spaces", args.spaceId, { avatar: args.avatar });
  },
});

/** Hides the space from the sidebar and lists; its issues and key stay. */
export const archive = mutation({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    if (space.archivedAt === undefined)
      await ctx.db.patch("spaces", space._id, { archivedAt: Date.now() });
  },
});
