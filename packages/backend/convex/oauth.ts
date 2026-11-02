import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type ActionCtx,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { requireMember } from "./lib/auth";
import { brand } from "./lib/brand";
import { fail, notFound } from "./lib/errors";
import {
  ACCESS_TOKEN_TTL_MS,
  authorizationResponseUrl,
  checkMetadataDocumentUrl,
  CIMD_FETCH_TIMEOUT_MS,
  CIMD_MAX_BYTES,
  CODE_TTL_MS,
  displayHost,
  isLoopbackRedirect,
  isMetadataDocumentClientId,
  isOurResource,
  isValidCodeChallenge,
  issuerFor,
  MAX_ACTIVE_GRANTS,
  MAX_SCOPE_LENGTH,
  MAX_STATE_LENGTH,
  MAX_UNUSED_CLIENTS,
  metadataCacheMs,
  oauthError,
  parseMetadataDocument,
  parseRegistrationRequest,
  redirectUriMatches,
  REFRESH_REUSE_GRACE_MS,
  REFRESH_TOKEN_TTL_MS,
  REQUEST_TTL_MS,
  resourceFor,
  UNUSED_CLIENT_TTL_MS,
  verifyPkce,
  type ClientMetadata,
  type OAuthError,
} from "./lib/oauth";
import { randomToken, sha256Hex, TOKEN_PREFIX_LENGTH } from "./lib/tokens";

/**
 * MCP authorization server (OAuth 2.1 + PKCE, MCP spec 2026-07-28): what lets Claude and ChatGPT
 * connect with just the URL. Design notes and the reason it isn't a Better Auth plugin are at the top
 * of convex/lib/oauth.ts. The HTTP endpoints (metadata, /authorize, /token, /register, /revoke) are
 * thin adapters in packages/mcp/src/oauth.ts; the consent screen is packages/app's oauth-consent.
 *
 * An access token is an `apiTokens` row (with `grantId` and `expiresAt`), so MCP calls go through
 * `mcp.verifyToken` and `requireToken` exactly like a personal API token: same member, same
 * workspace, same tools. Revoking the connection revokes that row and the refresh token together.
 *
 * Public functions that don't call requireMember: `register`, `startAuthorization`, `token` and
 * `revoke`. They are the OAuth protocol endpoints, called by apps that have no Pantry session yet;
 * each says next to it what authenticates the call instead.
 */

type Outcome<T> = ({ ok: true } & T) | ({ ok: false } & OAuthError);
const failWith = (error: OAuthError): { ok: false } & OAuthError => ({ ok: false, ...error });

const REFRESH_TOKEN_PREFIX = `${brand.tokenPrefix}rt_`;

// ---------------------------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------------------------

/**
 * Dynamic Client Registration (RFC 7591). Unauthenticated on purpose: open registration is how MCP
 * clients without a Client ID Metadata Document get a client_id. A registration grants nothing; a
 * person still has to sign in and press Allow. Unused registrations are deleted after a day, and
 * new ones are refused while too many are pending.
 */
export const register = action({
  args: { metadata: v.any() },
  handler: async (ctx, { metadata }): Promise<Outcome<{ client: Record<string, unknown> }>> => {
    const parsed = parseRegistrationRequest(metadata);
    if (!parsed.ok) return failWith(parsed.error);
    const clientId = randomToken("");
    const inserted = await ctx.runMutation(internal.oauth.insertClient, {
      clientId,
      ...parsed.client,
    });
    if (!inserted.ok) return inserted;
    return {
      ok: true,
      client: {
        client_id: clientId,
        client_id_issued_at: Math.floor(inserted.createdAt / 1000),
        client_name: parsed.client.name,
        redirect_uris: parsed.client.redirectUris,
        ...(parsed.client.clientUri ? { client_uri: parsed.client.clientUri } : {}),
        ...(parsed.client.logoUri ? { logo_uri: parsed.client.logoUri } : {}),
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      },
    };
  },
});

export const insertClient = internalMutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    redirectUris: v.array(v.string()),
    clientUri: v.optional(v.string()),
    logoUri: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<Outcome<{ createdAt: number }>> => {
    const now = Date.now();
    const unused = () =>
      ctx.db
        .query("oauthClients")
        .withIndex("by_kind_and_used", (q) => q.eq("kind", "registered").eq("usedAt", undefined));
    for (const stale of await unused().take(50)) {
      if (stale._creationTime < now - UNUSED_CLIENT_TTL_MS)
        await ctx.db.delete("oauthClients", stale._id);
    }
    if ((await unused().take(MAX_UNUSED_CLIENTS + 1)).length > MAX_UNUSED_CLIENTS) {
      return failWith(
        oauthError("temporarily_unavailable", "Too many pending registrations. Try again later."),
      );
    }
    await ctx.db.insert("oauthClients", { ...args, kind: "registered" });
    return { ok: true, createdAt: now };
  },
});

export const getClient = internalQuery({
  args: { clientId: v.string() },
  handler: (ctx, { clientId }) => clientById(ctx, clientId),
});

export const saveMetadataDocument = internalMutation({
  args: {
    clientId: v.string(),
    name: v.string(),
    redirectUris: v.array(v.string()),
    clientUri: v.optional(v.string()),
    logoUri: v.optional(v.string()),
    cacheUntil: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await clientById(ctx, args.clientId);
    const fields = {
      name: args.name,
      redirectUris: args.redirectUris,
      clientUri: args.clientUri,
      logoUri: args.logoUri,
      cacheUntil: args.cacheUntil,
    };
    if (existing) await ctx.db.patch("oauthClients", existing._id, fields);
    else
      await ctx.db.insert("oauthClients", {
        ...fields,
        clientId: args.clientId,
        kind: "metadata_document",
      });
  },
});

function clientById(ctx: { db: QueryDb }, clientId: string) {
  return ctx.db
    .query("oauthClients")
    .withIndex("by_client_id", (q) => q.eq("clientId", clientId))
    .first();
}
type QueryDb = QueryCtx["db"];

/**
 * The client behind a client_id: one we registered, or a Client ID Metadata Document fetched from
 * its https URL (cached for its max-age, 5 minutes to a day). Null with a reason when unusable.
 */
async function resolveClient(
  ctx: ActionCtx,
  clientId: string,
): Promise<{ client: ClientMetadata; kind: Doc<"oauthClients">["kind"] } | { problem: string }> {
  const cached = await ctx.runQuery(internal.oauth.getClient, { clientId });
  if (!isMetadataDocumentClientId(clientId)) {
    return cached
      ? { client: cached, kind: cached.kind }
      : { problem: "This app isn't registered." };
  }
  if (cached && (cached.cacheUntil ?? 0) > Date.now()) return { client: cached, kind: cached.kind };
  const problem = checkMetadataDocumentUrl(clientId);
  if (problem) return { problem };
  const fetched = await fetchMetadataDocument(clientId);
  if ("problem" in fetched) return fetched;
  const parsed = parseMetadataDocument(clientId, fetched.body);
  if (!parsed.ok) return { problem: parsed.reason };
  await ctx.runMutation(internal.oauth.saveMetadataDocument, {
    clientId,
    ...parsed.client,
    cacheUntil: Date.now() + metadataCacheMs(fetched.cacheControl),
  });
  return { client: parsed.client, kind: "metadata_document" };
}

/** GET the metadata document: no redirects, 5 s, 5 KB, JSON. */
async function fetchMetadataDocument(
  url: string,
): Promise<{ body: unknown; cacheControl: string | null } | { problem: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CIMD_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal: controller.signal,
    });
    if (res.status !== 200) {
      return { problem: `Couldn't read the app's metadata document (HTTP ${res.status}).` };
    }
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > CIMD_MAX_BYTES) return { problem: "The app's metadata document is too large." };
    const text = await res.text();
    if (text.length > CIMD_MAX_BYTES)
      return { problem: "The app's metadata document is too large." };
    return { body: JSON.parse(text), cacheControl: res.headers.get("cache-control") };
  } catch {
    return { problem: "Couldn't read the app's metadata document." };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------------------------
// Authorization: /authorize → consent screen → Allow or Deny
// ---------------------------------------------------------------------------------------------

export type AuthorizationStart =
  | { kind: "consent"; requestId: string }
  | { kind: "redirect"; url: string }
  | ({ kind: "error" } & OAuthError);

/**
 * The authorization endpoint's checks (OAuth 2.1 §4.1.1, MCP authorization). Unauthenticated on
 * purpose: the browser arrives here before anyone signs in. It only validates and parks the request
 * for the consent screen; nothing is granted until a signed-in member presses Allow.
 *
 * A bad client_id or redirect_uri is shown, never redirected to (we can't trust the URI). Anything
 * else goes back to the app's redirect URI as an OAuth error, with `state` and `iss` (RFC 9207).
 * `origin` is the web app's public origin: it fixes the issuer and the only resource we accept.
 */
export const startAuthorization = action({
  args: { params: v.record(v.string(), v.string()), origin: v.string() },
  handler: async (ctx, { params, origin }): Promise<AuthorizationStart> => {
    const issuer = issuerFor(origin);
    const show = (error: OAuthError): AuthorizationStart => ({ kind: "error", ...error });

    const clientId = params.client_id;
    if (!clientId) return show(oauthError("invalid_request", "The request has no client_id."));
    const resolved = await resolveClient(ctx, clientId);
    if ("problem" in resolved) return show(oauthError("invalid_client", resolved.problem));
    const { client } = resolved;

    const redirectUri =
      params.redirect_uri ??
      (client.redirectUris.length === 1 ? client.redirectUris[0] : undefined);
    if (!redirectUri)
      return show(oauthError("invalid_request", "The request has no redirect_uri."));
    if (!redirectUriMatches(redirectUri, client.redirectUris)) {
      return show(
        oauthError(
          "invalid_request",
          `${client.name} asked to send you to ${displayHost(redirectUri)}, which it didn't register.`,
        ),
      );
    }

    const state = params.state;
    const back = (error: OAuthError): AuthorizationStart => ({
      kind: "redirect",
      url: authorizationResponseUrl(redirectUri, {
        ...error,
        state: state && state.length <= MAX_STATE_LENGTH ? state : undefined,
        iss: issuer,
      }),
    });
    if (params.response_type !== "code") {
      return back(oauthError("unsupported_response_type", "Only response_type=code is supported."));
    }
    if (state && state.length > MAX_STATE_LENGTH) {
      return back(oauthError("invalid_request", "state is too long."));
    }
    if (params.code_challenge_method !== "S256" || !params.code_challenge) {
      return back(
        oauthError("invalid_request", "PKCE with code_challenge_method=S256 is required."),
      );
    }
    if (!isValidCodeChallenge(params.code_challenge)) {
      return back(oauthError("invalid_request", "code_challenge isn't a valid S256 challenge."));
    }
    const resource = resourceFor(origin);
    if (params.resource !== undefined && !isOurResource(params.resource, resource)) {
      return back(oauthError("invalid_target", `This server only issues tokens for ${resource}.`));
    }
    if (params.scope && params.scope.length > MAX_SCOPE_LENGTH) {
      return back(oauthError("invalid_scope", "scope is too long."));
    }

    const requestId = randomToken("");
    await ctx.runMutation(internal.oauth.insertRequest, {
      requestId,
      clientId,
      redirectUri,
      state,
      codeChallenge: params.code_challenge,
      resource,
      scope: params.scope || undefined,
      issuer,
    });
    return { kind: "consent", requestId };
  },
});

export const insertRequest = internalMutation({
  args: {
    requestId: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    state: v.optional(v.string()),
    codeChallenge: v.string(),
    resource: v.string(),
    scope: v.optional(v.string()),
    issuer: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await sweepExpired(ctx, now);
    await ctx.db.insert("oauthRequests", { ...args, expiresAt: now + REQUEST_TTL_MS });
  },
});

/** Deletes a few expired requests and codes; called on writes, so no cron is needed. */
async function sweepExpired(ctx: MutationCtx, now: number) {
  const requests = await ctx.db
    .query("oauthRequests")
    .withIndex("by_expires", (q) => q.lt("expiresAt", now))
    .take(20);
  for (const row of requests) await ctx.db.delete("oauthRequests", row._id);
  const codes = await ctx.db
    .query("oauthCodes")
    .withIndex("by_expires", (q) => q.lt("expiresAt", now))
    .take(20);
  for (const row of codes) await ctx.db.delete("oauthCodes", row._id);
}

async function pendingRequest(ctx: { db: QueryDb }, requestId: string) {
  const request = await ctx.db
    .query("oauthRequests")
    .withIndex("by_request_id", (q) => q.eq("requestId", requestId))
    .first();
  return request && request.expiresAt > Date.now() ? request : null;
}

/** What the consent screen shows: who's asking, where you'll be sent, and as whom. */
export const request = query({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    const me = await requireMember(ctx);
    const pending = await pendingRequest(ctx, requestId);
    if (!pending) return null;
    const client = await clientById(ctx, pending.clientId);
    if (!client) return null;
    const workspace = await ctx.db.get("workspaces", me.workspaceId);
    return {
      clientName: client.name,
      // For a metadata document the host of its URL is verified (we fetched it from there);
      // a registered app's name is only what it said about itself.
      verifiedHost: client.kind === "metadata_document" ? displayHost(client.clientId) : null,
      redirectHost: displayHost(pending.redirectUri),
      loopback: isLoopbackRedirect(pending.redirectUri),
      workspaceName: workspace?.name ?? "",
      memberName: me.displayName,
      expiresAt: pending.expiresAt,
    };
  },
});

/** Allow: a single-use code for the app, then the browser goes back to it. */
export const approve = action({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }): Promise<{ redirectTo: string }> => {
    const code = randomToken("");
    const issued = await ctx.runMutation(internal.oauth.issueCode, {
      requestId,
      codeHash: await sha256Hex(code),
    });
    return {
      redirectTo: authorizationResponseUrl(issued.redirectUri, {
        code,
        state: issued.state,
        iss: issued.issuer,
      }),
    };
  },
});

/** Internal half of `approve`. Auth carries over from the action: the member is the one who allowed. */
export const issueCode = internalMutation({
  args: { requestId: v.string(), codeHash: v.string() },
  handler: async (ctx, { requestId, codeHash }) => {
    const me = await requireMember(ctx);
    const now = Date.now();
    const pending = await pendingRequest(ctx, requestId);
    if (!pending)
      fail("REQUEST_EXPIRED", "This request expired. Start connecting again from the app.");
    if ((await activeGrants(ctx, me)).length >= MAX_ACTIVE_GRANTS) {
      fail(
        "TOO_MANY_CONNECTIONS",
        `You can have up to ${MAX_ACTIVE_GRANTS} connected apps. Disconnect one in Settings → API tokens first.`,
      );
    }
    await ctx.db.delete("oauthRequests", pending._id);
    const client = await clientById(ctx, pending.clientId);
    if (!client) fail("REQUEST_EXPIRED", "This app is no longer registered. Connect it again.");
    if (client.usedAt === undefined)
      await ctx.db.patch("oauthClients", client._id, { usedAt: now });
    await ctx.db.insert("oauthCodes", {
      codeHash,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      resource: pending.resource,
      scope: pending.scope,
      userId: me.userId,
      workspaceId: me.workspaceId,
      memberId: me._id,
      expiresAt: now + CODE_TTL_MS,
    });
    await sweepExpired(ctx, now);
    return { redirectUri: pending.redirectUri, state: pending.state, issuer: pending.issuer };
  },
});

/** Deny: back to the app with `access_denied`. */
export const deny = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, { requestId }) => {
    await requireMember(ctx);
    const pending = await pendingRequest(ctx, requestId);
    if (!pending)
      fail("REQUEST_EXPIRED", "This request expired. Start connecting again from the app.");
    await ctx.db.delete("oauthRequests", pending._id);
    return {
      redirectTo: authorizationResponseUrl(pending.redirectUri, {
        error: "access_denied",
        error_description: "The request was denied.",
        state: pending.state,
        iss: pending.issuer,
      }),
    };
  },
});

// ---------------------------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------------------------

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
};

/**
 * The token endpoint (OAuth 2.1 §3.2): `authorization_code` with PKCE, and `refresh_token` with
 * rotation. Unauthenticated on purpose: the code + PKCE verifier, or the refresh token, is the
 * credential (every client is public). Tokens are generated here and only their hashes stored.
 */
export const token = action({
  args: { params: v.record(v.string(), v.string()), origin: v.string() },
  handler: async (ctx, { params, origin }): Promise<Outcome<{ tokens: TokenResponse }>> => {
    const accessToken = randomToken(brand.tokenPrefix);
    const refreshToken = randomToken(REFRESH_TOKEN_PREFIX);
    const fresh = {
      accessHash: await sha256Hex(accessToken),
      accessPrefix: accessToken.slice(0, TOKEN_PREFIX_LENGTH),
      refreshHash: await sha256Hex(refreshToken),
    };
    const resource = resourceFor(origin);
    if (params.resource !== undefined && !isOurResource(params.resource, resource)) {
      return failWith(
        oauthError("invalid_target", `This server only issues tokens for ${resource}.`),
      );
    }

    let result: Outcome<object>;
    if (params.grant_type === "authorization_code") {
      const missing = ["code", "redirect_uri", "client_id", "code_verifier"].find(
        (k) => !params[k],
      );
      if (missing) return failWith(oauthError("invalid_request", `${missing} is missing.`));
      result = await ctx.runMutation(internal.oauth.redeemCode, {
        codeHash: await sha256Hex(params.code!),
        clientId: params.client_id!,
        redirectUri: params.redirect_uri!,
        codeVerifier: params.code_verifier!,
        ...fresh,
      });
    } else if (params.grant_type === "refresh_token") {
      if (!params.refresh_token)
        return failWith(oauthError("invalid_request", "refresh_token is missing."));
      result = await ctx.runMutation(internal.oauth.rotateRefresh, {
        presentedHash: await sha256Hex(params.refresh_token),
        clientId: params.client_id,
        ...fresh,
      });
    } else {
      return failWith(
        oauthError("unsupported_grant_type", "Use grant_type authorization_code or refresh_token."),
      );
    }
    if (!result.ok) return result;
    return {
      ok: true,
      tokens: {
        access_token: accessToken,
        token_type: "Bearer",
        expires_in: ACCESS_TOKEN_TTL_MS / 1000,
        refresh_token: refreshToken,
      },
    };
  },
});

const freshTokenArgs = {
  accessHash: v.string(),
  accessPrefix: v.string(),
  refreshHash: v.string(),
};
const invalidGrant = (why: string) => failWith(oauthError("invalid_grant", why));

/**
 * Exchanges a code for the connection's first tokens. Errors are returned, not thrown, so a replayed
 * code's revocation (RFC 6749 §4.1.2: revoke what the code issued) is committed.
 */
export const redeemCode = internalMutation({
  args: {
    codeHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeVerifier: v.string(),
    ...freshTokenArgs,
  },
  handler: async (ctx, args): Promise<Outcome<object>> => {
    const now = Date.now();
    const code = await ctx.db
      .query("oauthCodes")
      .withIndex("by_code_hash", (q) => q.eq("codeHash", args.codeHash))
      .first();
    if (!code) return invalidGrant("The authorization code isn't valid.");
    if (code.usedAt !== undefined) {
      if (code.grantId) await revokeGrant(ctx, code.grantId, now);
      return invalidGrant("The authorization code was already used.");
    }
    if (code.expiresAt <= now) return invalidGrant("The authorization code expired.");
    if (code.clientId !== args.clientId)
      return invalidGrant("The code was issued to another client.");
    if (code.redirectUri !== args.redirectUri) return invalidGrant("redirect_uri doesn't match.");
    if (!(await verifyPkce(args.codeVerifier, code.codeChallenge))) {
      return invalidGrant("code_verifier doesn't match the code_challenge.");
    }
    const member = await ctx.db.get("members", code.memberId);
    if (!member || member.userId !== code.userId || member.workspaceId !== code.workspaceId) {
      return invalidGrant("The person who allowed this is no longer a member.");
    }
    const client = await clientById(ctx, code.clientId);
    if (!client) return invalidGrant("This app is no longer registered.");

    const tokenId = await ctx.db.insert("apiTokens", {
      userId: member.userId,
      workspaceId: member.workspaceId,
      memberId: member._id,
      name: client.name,
      tokenPrefix: args.accessPrefix,
      tokenHash: args.accessHash,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
    });
    const grantId = await ctx.db.insert("oauthGrants", {
      clientId: client.clientId,
      clientName: client.name,
      clientKind: client.kind,
      redirectUri: code.redirectUri,
      userId: member.userId,
      workspaceId: member.workspaceId,
      memberId: member._id,
      resource: code.resource,
      scope: code.scope,
      tokenId,
      refreshHash: args.refreshHash,
      refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
    });
    await ctx.db.patch("apiTokens", tokenId, { grantId });
    await ctx.db.patch("oauthCodes", code._id, { usedAt: now, grantId });
    return { ok: true };
  },
});

/**
 * Refresh with rotation: the presented refresh token is replaced, and so is the access token (the
 * old one stops working). The token just replaced is honoured for REFRESH_REUSE_GRACE_MS so a
 * retried request works; presenting it later means a copy leaked, and the connection is revoked.
 */
export const rotateRefresh = internalMutation({
  args: { presentedHash: v.string(), clientId: v.optional(v.string()), ...freshTokenArgs },
  handler: async (ctx, args): Promise<Outcome<object>> => {
    const now = Date.now();
    let grant = await ctx.db
      .query("oauthGrants")
      .withIndex("by_refresh_hash", (q) => q.eq("refreshHash", args.presentedHash))
      .first();
    if (!grant) {
      const previous = await ctx.db
        .query("oauthGrants")
        .withIndex("by_previous_refresh_hash", (q) =>
          q.eq("previousRefreshHash", args.presentedHash),
        )
        .first();
      if (!previous) return invalidGrant("The refresh token isn't valid.");
      if (
        previous.revokedAt === undefined &&
        now - (previous.rotatedAt ?? 0) > REFRESH_REUSE_GRACE_MS
      ) {
        await revokeGrant(ctx, previous._id, now);
        return invalidGrant("The refresh token was already used; the connection was revoked.");
      }
      grant = previous;
    }
    if (grant.revokedAt !== undefined) return invalidGrant("This connection was revoked.");
    if (grant.refreshExpiresAt <= now) return invalidGrant("The refresh token expired.");
    if (args.clientId !== undefined && args.clientId !== grant.clientId) {
      return invalidGrant("The refresh token was issued to another client.");
    }
    const member = await ctx.db.get("members", grant.memberId);
    if (!member || member.userId !== grant.userId || member.workspaceId !== grant.workspaceId) {
      await revokeGrant(ctx, grant._id, now);
      return invalidGrant("The person who allowed this is no longer a member.");
    }

    const accessFields = {
      tokenHash: args.accessHash,
      tokenPrefix: args.accessPrefix,
      expiresAt: now + ACCESS_TOKEN_TTL_MS,
    };
    const current = grant.tokenId ? await ctx.db.get("apiTokens", grant.tokenId) : null;
    let tokenId = current?._id;
    if (current && current.revokedAt === undefined) {
      await ctx.db.patch("apiTokens", current._id, accessFields);
    } else {
      tokenId = await ctx.db.insert("apiTokens", {
        userId: member.userId,
        workspaceId: member.workspaceId,
        memberId: member._id,
        name: grant.clientName,
        grantId: grant._id,
        ...accessFields,
      });
    }
    const inGrace = grant.refreshHash !== args.presentedHash;
    await ctx.db.patch("oauthGrants", grant._id, {
      tokenId,
      refreshHash: args.refreshHash,
      refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      // A retry inside the grace window keeps the original rotation time, so the window can't be
      // stretched by reusing the old token again and again.
      ...(inGrace ? {} : { previousRefreshHash: args.presentedHash, rotatedAt: now }),
    });
    return { ok: true };
  },
});

// ---------------------------------------------------------------------------------------------
// Revocation and connected apps
// ---------------------------------------------------------------------------------------------

async function revokeGrant(ctx: MutationCtx, grantId: Id<"oauthGrants">, now: number) {
  const grant = await ctx.db.get("oauthGrants", grantId);
  if (!grant) return;
  if (grant.revokedAt === undefined) await ctx.db.patch("oauthGrants", grantId, { revokedAt: now });
  const access = grant.tokenId ? await ctx.db.get("apiTokens", grant.tokenId) : null;
  if (access && access.revokedAt === undefined) {
    await ctx.db.patch("apiTokens", access._id, { revokedAt: now });
  }
}

/**
 * Token revocation (RFC 7009) for an app disconnecting itself. Unauthenticated on purpose: holding
 * the access or refresh token is the authority to revoke it. Revokes the whole connection. Personal
 * API tokens aren't revoked here (only in Settings). Always succeeds, so it reveals nothing.
 */
export const revoke = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (token.length > 256) return null;
    const hash = await sha256Hex(token.trim());
    const access = await ctx.db
      .query("apiTokens")
      .withIndex("by_token_hash", (q) => q.eq("tokenHash", hash))
      .first();
    if (access?.grantId) await revokeGrant(ctx, access.grantId, Date.now());
    const grant = await ctx.db
      .query("oauthGrants")
      .withIndex("by_refresh_hash", (q) => q.eq("refreshHash", hash))
      .first();
    if (grant) await revokeGrant(ctx, grant._id, Date.now());
    return null;
  },
});

async function activeGrants(ctx: { db: QueryDb }, me: Doc<"members">) {
  const now = Date.now();
  const grants = await ctx.db
    .query("oauthGrants")
    .withIndex("by_user", (q) => q.eq("userId", me.userId))
    .order("desc")
    .take(200);
  return grants.filter(
    (grant) =>
      grant.workspaceId === me.workspaceId &&
      grant.revokedAt === undefined &&
      grant.refreshExpiresAt > now,
  );
}

/** My connected apps (Settings → API tokens): name, verified host or redirect host, used when. */
export const connections = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const grants = await activeGrants(ctx, me);
    return Promise.all(
      grants.map(async (grant) => {
        const access = grant.tokenId ? await ctx.db.get("apiTokens", grant.tokenId) : null;
        const verified = grant.clientKind === "metadata_document";
        return {
          _id: grant._id,
          _creationTime: grant._creationTime,
          name: grant.clientName,
          host: displayHost(verified ? grant.clientId : grant.redirectUri),
          verified,
          lastUsedAt: access?.lastUsedAt,
        };
      }),
    );
  },
});

/** Disconnect one of my apps: its access and refresh tokens stop working at once. */
export const disconnect = mutation({
  args: { grantId: v.id("oauthGrants") },
  handler: async (ctx, { grantId }) => {
    const me = await requireMember(ctx);
    const grant = await ctx.db.get("oauthGrants", grantId);
    if (!grant || grant.userId !== me.userId || grant.workspaceId !== me.workspaceId) {
      return notFound("Connection");
    }
    await revokeGrant(ctx, grantId, Date.now());
  },
});
