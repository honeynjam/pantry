import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { brand } from "./lib/brand";
import { fail, notFound } from "./lib/errors";
import { randomToken, sha256Hex, TOKEN_PREFIX_LENGTH } from "./lib/tokens";
import { cleanName } from "./lib/validate";

/** Live tokens per person; plenty for a few machines and agents, and a cap on runaway scripts. */
export const MAX_ACTIVE_TOKENS = 25;

/**
 * A personal API token for MCP clients (spec §6). Generated here (randomness belongs in actions);
 * only its SHA-256 hash and the first 8 characters are stored. The plain token is returned once.
 */
export const create = action({
  args: { name: v.string() },
  handler: async (
    ctx,
    { name },
  ): Promise<{ tokenId: Id<"apiTokens">; token: string; name: string; tokenPrefix: string }> => {
    const token = randomToken(brand.tokenPrefix);
    const tokenPrefix = token.slice(0, TOKEN_PREFIX_LENGTH);
    const tokenHash = await sha256Hex(token);
    const created = await ctx.runMutation(internal.tokens.insert, { name, tokenHash, tokenPrefix });
    return { ...created, token, tokenPrefix };
  },
});

/** Internal half of `create`: the member check and the write. Auth carries over from the action. */
export const insert = internalMutation({
  args: { name: v.string(), tokenHash: v.string(), tokenPrefix: v.string() },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const name = cleanName(args.name, "The token name", 60);
    const mine = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", me.userId))
      .collect();
    // OAuth access tokens (connected apps) have their own cap in convex/oauth.ts.
    const active = mine.filter((row) => row.revokedAt === undefined && row.grantId === undefined);
    if (active.length >= MAX_ACTIVE_TOKENS) {
      fail(
        "TOO_MANY_TOKENS",
        `You can have up to ${MAX_ACTIVE_TOKENS} tokens. Revoke one you no longer use first.`,
      );
    }
    const tokenId = await ctx.db.insert("apiTokens", {
      userId: me.userId,
      workspaceId: me.workspaceId,
      memberId: me._id,
      name,
      tokenPrefix: args.tokenPrefix,
      tokenHash: args.tokenHash,
    });
    return { tokenId, name };
  },
});

/** Revoke one of my tokens. The next MCP call with it gets a 401. */
export const revoke = mutation({
  args: { tokenId: v.id("apiTokens") },
  handler: async (ctx, { tokenId }) => {
    const me = await requireMember(ctx);
    const token = await ctx.db.get("apiTokens", tokenId);
    // Someone else's token is "not found": tokens are personal, even to the owner.
    if (
      !token ||
      token.userId !== me.userId ||
      token.workspaceId !== me.workspaceId ||
      token.grantId !== undefined
    )
      return notFound("Token");
    if (token.revokedAt === undefined)
      await ctx.db.patch("apiTokens", tokenId, { revokedAt: Date.now() });
  },
});

/** My tokens, newest first, without hashes: name, prefix, created, last used, revoked. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", me.userId))
      .order("desc")
      .take(100);
    // Connected apps' access tokens are listed by oauth.connections instead.
    return tokens
      .filter((token) => token.workspaceId === me.workspaceId && token.grantId === undefined)
      .map((token) => ({
        _id: token._id,
        _creationTime: token._creationTime,
        name: token.name,
        tokenPrefix: token.tokenPrefix,
        lastUsedAt: token.lastUsedAt,
        revokedAt: token.revokedAt,
      }));
  },
});
