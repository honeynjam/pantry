import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { brand } from "./brand";
import { MAX_TOKEN_LENGTH, sha256Hex } from "./tokens";

type AnyCtx = QueryCtx | MutationCtx | ActionCtx;

/**
 * The signed-in Better Auth user id, or null. The one place that knows how a
 * Convex identity maps to a Better Auth user (the JWT subject is the user id),
 * so tests can use `t.withIdentity({ subject })` without the auth component.
 */
export async function getAuthUserId(ctx: AnyCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

/** The signed-in Better Auth user id; throws when signed out. */
export async function requireAuthUserId(ctx: AnyCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (!userId) {
    throw new ConvexError({ code: "UNAUTHENTICATED", message: "Sign in first." });
  }
  return userId;
}

/** The signed-in user's email (a claim in the Better Auth JWT), lower-cased; null when absent. */
export async function getAuthEmail(ctx: AnyCtx): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.email ? identity.email.trim().toLowerCase() : null;
}

/**
 * The caller's `members` row. Every public app function calls this first.
 * Throws when signed out or when the user isn't a member of this instance's workspace.
 */
export async function requireMember(ctx: QueryCtx | MutationCtx): Promise<Doc<"members">> {
  const userId = await requireAuthUserId(ctx);
  const member = await ctx.db
    .query("members")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (!member) {
    throw new ConvexError({
      code: "NOT_A_MEMBER",
      message: "You're not a member of this workspace.",
    });
  }
  return member;
}

/** The caller's `members` row, only if they own the workspace (invites are owner-only). */
export async function requireOwner(ctx: QueryCtx | MutationCtx): Promise<Doc<"members">> {
  const me = await requireMember(ctx);
  if (me.role !== "owner") {
    throw new ConvexError({ code: "OWNER_ONLY", message: "Only the workspace owner can do that." });
  }
  return me;
}

export type TokenOwner = { apiToken: Doc<"apiTokens">; member: Doc<"members"> };

/**
 * The API token behind an MCP call and the member it acts as. Every public MCP function calls this
 * first (spec §10b): the plain token is hashed and looked up; a revoked or unknown token, or one
 * whose member is gone, is rejected. Everything the caller touches is then resolved inside
 * `member.workspaceId`.
 */
export async function requireToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<TokenOwner> {
  const owner = await findToken(ctx, token);
  if (!owner) {
    throw new ConvexError({
      code: "INVALID_TOKEN",
      message: "This API token isn't valid or was revoked.",
    });
  }
  return owner;
}

/** `requireToken` without the throw: null for anything that isn't a live token. */
export async function findToken(
  ctx: QueryCtx | MutationCtx,
  token: string,
): Promise<TokenOwner | null> {
  const trimmed = token.trim();
  if (!trimmed.startsWith(brand.tokenPrefix) || trimmed.length > MAX_TOKEN_LENGTH) return null;
  const tokenHash = await sha256Hex(trimmed);
  const apiToken = await ctx.db
    .query("apiTokens")
    .withIndex("by_token_hash", (q) => q.eq("tokenHash", tokenHash))
    .first();
  if (!apiToken || apiToken.revokedAt !== undefined) return null;
  // OAuth access tokens expire (convex/oauth.ts); personal API tokens have no expiresAt. The MCP
  // route also checks `expiresAt` from mcp.verifyToken, since a cached query result can be stale.
  if (apiToken.expiresAt !== undefined && apiToken.expiresAt <= Date.now()) return null;
  const member = await ctx.db.get("members", apiToken.memberId);
  if (!member || member.workspaceId !== apiToken.workspaceId || member.userId !== apiToken.userId)
    return null;
  return { apiToken, member };
}
