import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { requireToken } from "./lib/auth";
import {
  ACCESS_TOKEN_TTL_MS,
  CODE_TTL_MS,
  MAX_ACTIVE_GRANTS,
  REFRESH_REUSE_GRACE_MS,
  REQUEST_TTL_MS,
} from "./lib/oauth";
import { sha256Base64Url } from "./lib/tokens";
import { setupTest, type TestConvex } from "./test.setup";

const owner = { subject: "user-owner", name: "Kris", email: "kris@example.com" };
const partner = { subject: "user-partner", name: "Partner", email: "partner@example.com" };
const ORIGIN = "https://pantry.example.com";
const RESOURCE = `${ORIGIN}/api/mcp`;
const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const VERIFIER = "a-pkce-verifier-that-is-long-enough-0123456789-abcdefgh";

async function setUp() {
  const t = setupTest();
  const created = await t
    .withIdentity(owner)
    .mutation(api.setup.createWorkspace, { workspaceName: "Home" });
  await t.run((ctx) =>
    ctx.db.insert("members", {
      workspaceId: created.workspaceId,
      userId: partner.subject,
      displayName: "Partner",
      role: "member",
    }),
  );
  return { t, ...created };
}

async function registerClaude(t: TestConvex) {
  const result = await t.action(api.oauth.register, {
    metadata: { client_name: "Claude", redirect_uris: [CLAUDE_CALLBACK] },
  });
  if (!result.ok) throw new Error(result.error_description);
  return result.client.client_id as string;
}

async function authorizeParams(clientId: string, extra: Record<string, string> = {}) {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_challenge: await sha256Base64Url(VERIFIER),
    code_challenge_method: "S256",
    state: "state-123",
    resource: RESOURCE,
    ...extra,
  };
}

const start = async (t: TestConvex, params: Record<string, string>) =>
  t.action(api.oauth.startAuthorization, { params, origin: ORIGIN });

/** register → /authorize → Allow: the code from the redirect. */
async function codeFor(t: TestConvex, clientId?: string, who = owner) {
  const id = clientId ?? (await registerClaude(t));
  const started = await start(t, await authorizeParams(id));
  if (started.kind !== "consent") throw new Error(JSON.stringify(started));
  const { redirectTo } = await t
    .withIdentity(who)
    .action(api.oauth.approve, { requestId: started.requestId });
  const url = new URL(redirectTo);
  return { clientId: id, code: url.searchParams.get("code")!, url };
}

const exchange = (t: TestConvex, params: Record<string, string>) =>
  t.action(api.oauth.token, { params, origin: ORIGIN });

async function connect(t: TestConvex, who = owner) {
  const { clientId, code } = await codeFor(t, undefined, who);
  const result = await exchange(t, {
    grant_type: "authorization_code",
    code,
    client_id: clientId,
    redirect_uri: CLAUDE_CALLBACK,
    code_verifier: VERIFIER,
    resource: RESOURCE,
  });
  if (!result.ok) throw new Error(result.error_description);
  return { clientId, code, ...result.tokens };
}

const refresh = (t: TestConvex, refreshToken: string, clientId?: string) =>
  exchange(t, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    ...(clientId ? { client_id: clientId } : {}),
  });

/** Whether a token works for MCP: the route's check and every tool's check. */
async function works(t: TestConvex, token: string) {
  const verified = await t.query(api.mcp.verifyToken, { token });
  const required = await t.run(async (ctx) => {
    try {
      return (await requireToken(ctx, token)).member.userId;
    } catch {
      return null;
    }
  });
  expect(verified === null).toBe(required === null);
  return verified;
}

describe("oauth", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("runs register → authorize → allow → token, and the token acts as the member", async () => {
    const { t, memberId, workspaceId } = await setUp();
    const clientId = await registerClaude(t);
    const started = await start(t, await authorizeParams(clientId));
    expect(started.kind).toBe("consent");
    if (started.kind !== "consent") return;

    // The consent screen needs a member, and shows who's asking and where you'll go.
    await expect(t.query(api.oauth.request, { requestId: started.requestId })).rejects.toThrow(
      /Sign in/,
    );
    expect(
      await t.withIdentity(owner).query(api.oauth.request, { requestId: started.requestId }),
    ).toMatchObject({
      clientName: "Claude",
      verifiedHost: null,
      redirectHost: "claude.ai",
      loopback: false,
      workspaceName: "Home",
      memberName: "Kris",
    });

    const { redirectTo } = await t
      .withIdentity(owner)
      .action(api.oauth.approve, { requestId: started.requestId });
    const url = new URL(redirectTo);
    expect(`${url.origin}${url.pathname}`).toBe(CLAUDE_CALLBACK);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
    const code = url.searchParams.get("code")!;
    expect(code).toBeTruthy();

    // The request is single use.
    await expect(
      t.withIdentity(owner).action(api.oauth.approve, { requestId: started.requestId }),
    ).rejects.toThrow(/expired/);

    const result = await exchange(t, {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: VERIFIER,
      resource: RESOURCE,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.tokens).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(result.tokens.access_token).toMatch(/^pan_[A-Za-z0-9_-]{43}$/);
    expect(result.tokens.refresh_token).toMatch(/^pan_rt_/);

    expect(await works(t, result.tokens.access_token)).toMatchObject({
      memberId,
      workspaceId,
      userId: owner.subject,
      resource: RESOURCE,
    });
    // The refresh token is not an access token.
    expect(await works(t, result.tokens.refresh_token)).toBeNull();

    // Nothing plain is stored.
    const dump = JSON.stringify(
      await t.run(async (ctx) => [
        await ctx.db.query("apiTokens").collect(),
        await ctx.db.query("oauthGrants").collect(),
        await ctx.db.query("oauthCodes").collect(),
      ]),
    );
    expect(dump).not.toContain(result.tokens.access_token);
    expect(dump).not.toContain(result.tokens.refresh_token);
    expect(dump).not.toContain(code);
  });

  it("an MCP tool works with the OAuth token, as the member, via MCP", async () => {
    const { t } = await setUp();
    const { access_token } = await connect(t);
    const workspace = await t.query(api.mcp.getWorkspace, { token: access_token });
    expect(workspace).toMatchObject({ workspace: "Home", you: "Kris" });
  });

  it("shows a bad client or redirect URI instead of redirecting", async () => {
    const { t } = await setUp();
    const clientId = await registerClaude(t);
    expect(await start(t, await authorizeParams("nope"))).toMatchObject({
      kind: "error",
      error: "invalid_client",
    });
    expect(
      await start(
        t,
        await authorizeParams(clientId, { redirect_uri: "https://evil.example.com/cb" }),
      ),
    ).toMatchObject({ kind: "error", error: "invalid_request" });
    // With one registered redirect URI, redirect_uri may be left out.
    const { redirect_uri: _omitted, ...withoutRedirect } = await authorizeParams(clientId);
    expect(await start(t, withoutRedirect)).toMatchObject({ kind: "consent" });
  });

  it("sends other problems back to the app with state and iss", async () => {
    const { t } = await setUp();
    const clientId = await registerClaude(t);
    const errorOf = async (extra: Record<string, string>) => {
      const params: Record<string, string> = await authorizeParams(clientId);
      for (const [key, value] of Object.entries(extra)) {
        if (value === "") delete params[key];
        else params[key] = value;
      }
      const result = await start(t, params);
      expect(result.kind).toBe("redirect");
      const url = new URL((result as { url: string }).url);
      expect(url.searchParams.get("state")).toBe("state-123");
      expect(url.searchParams.get("iss")).toBe(ORIGIN);
      return url.searchParams.get("error");
    };
    expect(await errorOf({ response_type: "token" })).toBe("unsupported_response_type");
    expect(await errorOf({ code_challenge: "" })).toBe("invalid_request");
    expect(await errorOf({ code_challenge_method: "plain" })).toBe("invalid_request");
    expect(await errorOf({ code_challenge: "too-short" })).toBe("invalid_request");
    expect(await errorOf({ resource: "https://other.example.com/api/mcp" })).toBe("invalid_target");
  });

  it("refuses a code with the wrong verifier, client or redirect, and a replayed code revokes", async () => {
    const { t } = await setUp();
    const { clientId, code } = await codeFor(t);
    const base = {
      grant_type: "authorization_code",
      code,
      client_id: clientId,
      redirect_uri: CLAUDE_CALLBACK,
      code_verifier: VERIFIER,
    };
    expect(await exchange(t, { ...base, code_verifier: `${VERIFIER}x` })).toMatchObject({
      ok: false,
      error: "invalid_grant",
    });
    expect(await exchange(t, { ...base, client_id: "other" })).toMatchObject({
      error: "invalid_grant",
    });
    expect(await exchange(t, { ...base, redirect_uri: `${CLAUDE_CALLBACK}/x` })).toMatchObject({
      error: "invalid_grant",
    });
    expect(await exchange(t, { ...base, resource: "https://x.example.com/api/mcp" })).toMatchObject(
      {
        error: "invalid_target",
      },
    );
    expect(await exchange(t, { ...base, code_verifier: "" })).toMatchObject({
      error: "invalid_request",
    });
    expect(await exchange(t, { ...base, grant_type: "password" })).toMatchObject({
      error: "unsupported_grant_type",
    });

    const first = await exchange(t, base);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(await works(t, first.tokens.access_token)).not.toBeNull();

    // Replay: refused, and what the code issued is revoked.
    expect(await exchange(t, base)).toMatchObject({ error: "invalid_grant" });
    expect(await works(t, first.tokens.access_token)).toBeNull();
    expect(await refresh(t, first.tokens.refresh_token)).toMatchObject({ error: "invalid_grant" });
  });

  it("codes and consent requests expire", async () => {
    const { t } = await setUp();
    vi.useFakeTimers({ now: Date.now() });
    const clientId = await registerClaude(t);
    const started = await start(t, await authorizeParams(clientId));
    if (started.kind !== "consent") throw new Error("no consent");
    vi.setSystemTime(Date.now() + REQUEST_TTL_MS + 1);
    expect(
      await t.withIdentity(owner).query(api.oauth.request, { requestId: started.requestId }),
    ).toBeNull();
    await expect(
      t.withIdentity(owner).action(api.oauth.approve, { requestId: started.requestId }),
    ).rejects.toThrow(/expired/);

    const { code } = await codeFor(t, clientId);
    vi.setSystemTime(Date.now() + CODE_TTL_MS + 1);
    expect(
      await exchange(t, {
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        redirect_uri: CLAUDE_CALLBACK,
        code_verifier: VERIFIER,
      }),
    ).toMatchObject({ error: "invalid_grant" });
  });

  it("access tokens expire after an hour; refresh rotates both tokens", async () => {
    const { t } = await setUp();
    const now = Date.now();
    vi.useFakeTimers({ now });
    const first = await connect(t);

    vi.setSystemTime(now + ACCESS_TOKEN_TTL_MS + 1);
    expect(await works(t, first.access_token)).toBeNull();

    const second = await refresh(t, first.refresh_token, first.clientId);
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.tokens.refresh_token).not.toBe(first.refresh_token);
    expect(await works(t, second.tokens.access_token)).not.toBeNull();

    // Refreshing again replaces the access token at once.
    const third = await refresh(t, second.tokens.refresh_token);
    if (!third.ok) throw new Error(third.error_description);
    expect(await works(t, second.tokens.access_token)).toBeNull();
    expect(await works(t, third.tokens.access_token)).not.toBeNull();

    // Another client can't use it.
    expect(await refresh(t, third.tokens.refresh_token, "someone-else")).toMatchObject({
      error: "invalid_grant",
    });
  });

  it("a just-rotated refresh token works once more within the grace; later reuse revokes", async () => {
    const { t } = await setUp();
    const now = Date.now();
    vi.useFakeTimers({ now });
    const first = await connect(t);
    const second = await refresh(t, first.refresh_token);
    if (!second.ok) throw new Error(second.error_description);

    // A retry with the old one inside the grace window (lost response) gets fresh tokens.
    vi.setSystemTime(now + 30_000);
    const retried = await refresh(t, first.refresh_token);
    if (!retried.ok) throw new Error(retried.error_description);
    expect(await works(t, retried.tokens.access_token)).not.toBeNull();

    // After the window, the old one is a leaked copy: the connection is revoked.
    vi.setSystemTime(now + REFRESH_REUSE_GRACE_MS + 1000);
    expect(await refresh(t, first.refresh_token)).toMatchObject({ error: "invalid_grant" });
    expect(await works(t, retried.tokens.access_token)).toBeNull();
    expect(await refresh(t, retried.tokens.refresh_token)).toMatchObject({
      error: "invalid_grant",
    });
  });

  it("deny goes back with access_denied", async () => {
    const { t } = await setUp();
    const started = await start(t, await authorizeParams(await registerClaude(t)));
    if (started.kind !== "consent") throw new Error("no consent");
    await expect(t.mutation(api.oauth.deny, { requestId: started.requestId })).rejects.toThrow();
    const { redirectTo } = await t
      .withIdentity(owner)
      .mutation(api.oauth.deny, { requestId: started.requestId });
    const url = new URL(redirectTo);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("lists connected apps apart from API tokens, and disconnecting kills both tokens", async () => {
    const { t } = await setUp();
    const app = await connect(t);
    await t.withIdentity(owner).action(api.tokens.create, { name: "Laptop" });

    const tokens = await t.withIdentity(owner).query(api.tokens.list, {});
    expect(tokens.map((token) => token.name)).toEqual(["Laptop"]);
    const apps = await t.withIdentity(owner).query(api.oauth.connections, {});
    expect(apps).toMatchObject([{ name: "Claude", host: "claude.ai", verified: false }]);
    expect(await t.withIdentity(partner).query(api.oauth.connections, {})).toEqual([]);

    // Someone else's connection is "not found"; an OAuth token can't be revoked as an API token.
    await expect(
      t.withIdentity(partner).mutation(api.oauth.disconnect, { grantId: apps[0]!._id }),
    ).rejects.toThrow(/not found/);
    const tokenId = await t.run(
      async (ctx) => (await ctx.db.get("oauthGrants", apps[0]!._id))!.tokenId!,
    );
    await expect(t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId })).rejects.toThrow(
      /not found/,
    );

    await t.withIdentity(owner).mutation(api.oauth.disconnect, { grantId: apps[0]!._id });
    expect(await works(t, app.access_token)).toBeNull();
    expect(await refresh(t, app.refresh_token)).toMatchObject({ error: "invalid_grant" });
    expect(await t.withIdentity(owner).query(api.oauth.connections, {})).toEqual([]);
  });

  it("the revocation endpoint revokes the connection from either token", async () => {
    const { t } = await setUp();
    const a = await connect(t);
    await t.mutation(api.oauth.revoke, { token: a.refresh_token });
    expect(await works(t, a.access_token)).toBeNull();

    const b = await connect(t);
    await t.mutation(api.oauth.revoke, { token: b.access_token });
    expect(await refresh(t, b.refresh_token)).toMatchObject({ error: "invalid_grant" });

    // A personal API token isn't revoked this way, and junk is ignored.
    const personal = await t.withIdentity(owner).action(api.tokens.create, { name: "Laptop" });
    await t.mutation(api.oauth.revoke, { token: personal.token });
    await t.mutation(api.oauth.revoke, { token: "junk" });
    expect(await works(t, personal.token)).not.toBeNull();
  });

  it("a removed member's connection stops working", async () => {
    const { t } = await setUp();
    const app = await connect(t, partner);
    await t.run(async (ctx) => {
      const member = await ctx.db
        .query("members")
        .withIndex("by_user", (q) => q.eq("userId", partner.subject))
        .first();
      await ctx.db.delete("members", member!._id);
    });
    expect(await works(t, app.access_token)).toBeNull();
    expect(await refresh(t, app.refresh_token)).toMatchObject({ error: "invalid_grant" });
  });

  it("caps connected apps per person", async () => {
    const { t } = await setUp();
    const clientId = await registerClaude(t);
    await t.run(async (ctx) => {
      const member = (await ctx.db.query("members").first())!;
      for (let i = 0; i < MAX_ACTIVE_GRANTS; i++) {
        await ctx.db.insert("oauthGrants", {
          clientId,
          clientName: "Claude",
          clientKind: "registered",
          redirectUri: CLAUDE_CALLBACK,
          userId: member.userId,
          workspaceId: member.workspaceId,
          memberId: member._id,
          resource: RESOURCE,
          refreshHash: `hash-${i}`,
          refreshExpiresAt: Date.now() + 60_000,
        });
      }
    });
    await expect(codeFor(t, clientId)).rejects.toThrow(/up to 25 connected apps/);
  });

  describe("client ID metadata documents", () => {
    const CHATGPT = "https://chatgpt.com/oauth/client.json";
    const CHATGPT_CALLBACK = "https://chatgpt.com/connector_platform_oauth_redirect";

    function stubDocument(doc: object, init: ResponseInit = {}) {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify(doc), {
            status: 200,
            headers: { "content-type": "application/json", ...init.headers },
          }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    }

    const params = async (extra: Record<string, string> = {}) =>
      authorizeParams(CHATGPT, { redirect_uri: CHATGPT_CALLBACK, ...extra });

    it("fetches the document, caches it, and shows its host as verified", async () => {
      const { t } = await setUp();
      const fetchMock = stubDocument({
        client_id: CHATGPT,
        client_name: "ChatGPT",
        redirect_uris: [CHATGPT_CALLBACK],
        token_endpoint_auth_method: "private_key_jwt",
      });
      const started = await start(t, await params());
      expect(started.kind).toBe("consent");
      if (started.kind !== "consent") return;
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0]).toMatchObject([CHATGPT, { redirect: "manual" }]);
      expect(
        await t.withIdentity(owner).query(api.oauth.request, { requestId: started.requestId }),
      ).toMatchObject({ clientName: "ChatGPT", verifiedHost: "chatgpt.com" });

      // Cached: the second request doesn't fetch again.
      await start(t, await params());
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The rest of the flow is the same as for a registered client.
      const { redirectTo } = await t
        .withIdentity(owner)
        .action(api.oauth.approve, { requestId: started.requestId });
      const result = await exchange(t, {
        grant_type: "authorization_code",
        code: new URL(redirectTo).searchParams.get("code")!,
        client_id: CHATGPT,
        redirect_uri: CHATGPT_CALLBACK,
        code_verifier: VERIFIER,
        resource: RESOURCE,
      });
      expect(result.ok).toBe(true);
      expect(await t.withIdentity(owner).query(api.oauth.connections, {})).toMatchObject([
        { name: "ChatGPT", host: "chatgpt.com", verified: true },
      ]);
    });

    it("forgets documents nobody allowed a day after their cache ran out", async () => {
      const { t } = await setUp();
      vi.useFakeTimers({ now: Date.now() });
      const other = "https://unused.example.com/client.json";
      stubDocument({ client_id: other, redirect_uris: [CHATGPT_CALLBACK] });
      await start(t, await authorizeParams(other, { redirect_uri: CHATGPT_CALLBACK }));
      vi.setSystemTime(Date.now() + 2 * 24 * 60 * 60 * 1000);
      stubDocument({ client_id: CHATGPT, redirect_uris: [CHATGPT_CALLBACK] });
      await start(t, await params());
      const ids = (await t.run((ctx) => ctx.db.query("oauthClients").collect())).map(
        (client) => client.clientId,
      );
      expect(ids).toEqual([CHATGPT]);
    });

    it("refuses a document whose client_id doesn't match, or that lacks the redirect URI", async () => {
      const { t } = await setUp();
      stubDocument({
        client_id: "https://evil.example.com/c.json",
        redirect_uris: [CHATGPT_CALLBACK],
      });
      expect(await start(t, await params())).toMatchObject({
        kind: "error",
        error: "invalid_client",
      });

      stubDocument({ client_id: CHATGPT, redirect_uris: ["https://chatgpt.com/other"] });
      expect(await start(t, await params())).toMatchObject({
        kind: "error",
        error: "invalid_request",
      });
    });

    it("never fetches private or non-https URLs, and handles fetch failures", async () => {
      const { t } = await setUp();
      const fetchMock = stubDocument({});
      for (const clientId of [
        "https://169.254.169.254/latest/meta-data",
        "https://localhost/c.json",
      ]) {
        expect(
          await start(t, await authorizeParams(clientId, { redirect_uri: CHATGPT_CALLBACK })),
        ).toMatchObject({ kind: "error", error: "invalid_client" });
      }
      expect(fetchMock).not.toHaveBeenCalled();

      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () => new Response(null, { status: 302, headers: { location: "https://x.y/z" } }),
        ),
      );
      expect(await start(t, await params())).toMatchObject({
        kind: "error",
        error: "invalid_client",
      });
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response("x".repeat(10_000), { status: 200 })),
      );
      expect(await start(t, await params())).toMatchObject({
        kind: "error",
        error: "invalid_client",
      });
    });
  });

  it("registration rejects bad metadata and cleans up unused clients", async () => {
    const { t } = await setUp();
    expect(
      await t.action(api.oauth.register, { metadata: { redirect_uris: ["http://evil.com/cb"] } }),
    ).toMatchObject({ ok: false, error: "invalid_redirect_uri" });

    vi.useFakeTimers({ now: Date.now() });
    const unused = await registerClaude(t);
    const used = await registerClaude(t);
    await codeFor(t, used);
    vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
    await registerClaude(t);
    const left = await t.run((ctx) => ctx.db.query("oauthClients").collect());
    expect(left.map((client) => client.clientId)).not.toContain(unused);
    expect(left.map((client) => client.clientId)).toContain(used);
  });
});
