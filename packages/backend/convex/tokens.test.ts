import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { requireToken } from "./lib/auth";
import { sha256Hex, shouldTouch, TOKEN_TOUCH_INTERVAL_MS } from "./lib/tokens";
import { MAX_ACTIVE_TOKENS } from "./tokens";
import { setupTest, type TestConvex } from "./test.setup";

const owner = { subject: "user-owner", name: "Kris", email: "kris@example.com" };
const partner = { subject: "user-partner", name: "Partner", email: "partner@example.com" };

async function setUp() {
  const t = setupTest();
  const created = await t
    .withIdentity(owner)
    .mutation(api.setup.createWorkspace, { workspaceName: "Home" });
  // A second member, added directly (invites have their own tests).
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

const createToken = (t: TestConvex, name = "Laptop", who = owner) =>
  t.withIdentity(who).action(api.tokens.create, { name });

/** Runs `requireToken` the way every MCP function does; resolves to the member id or the error message. */
const check = (t: TestConvex, token: string) =>
  t.run(async (ctx) => {
    try {
      return (await requireToken(ctx, token)).member._id;
    } catch (err) {
      return (err as { data?: { message?: string } }).data?.message ?? String(err);
    }
  });

describe("tokens", () => {
  afterEach(() => vi.useRealTimers());

  it("create returns the token once and stores only its hash and prefix", async () => {
    const { t, memberId } = await setUp();
    const created = await createToken(t, "  Claude   Code ");
    expect(created.token).toMatch(/^pan_[A-Za-z0-9_-]{43}$/);
    expect(created.tokenPrefix).toBe(created.token.slice(0, 8));
    expect(created.name).toBe("Claude Code");

    const stored = await t.run((ctx) => ctx.db.get("apiTokens", created.tokenId));
    expect(stored).toMatchObject({
      userId: owner.subject,
      memberId,
      name: "Claude Code",
      tokenPrefix: created.tokenPrefix,
    });
    expect(stored!.tokenHash).toBe(await sha256Hex(created.token));
    expect(JSON.stringify(stored)).not.toContain(created.token);

    const list = await t.withIdentity(owner).query(api.tokens.list, {});
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain(stored!.tokenHash);
    expect(list[0]).toMatchObject({ name: "Claude Code", tokenPrefix: created.tokenPrefix });
    expect(list[0]!.lastUsedAt).toBeUndefined();
  });

  it("needs a member and a name", async () => {
    const { t } = await setUp();
    await expect(t.action(api.tokens.create, { name: "x" })).rejects.toThrow(/Sign in/);
    await expect(
      createToken(t, "x", { subject: "stranger", name: "S", email: "s@example.com" }),
    ).rejects.toThrow(/not a member/);
    await expect(createToken(t, "   ")).rejects.toThrow(/can't be empty/);
  });

  it("lists only my own tokens, newest first", async () => {
    const { t } = await setUp();
    await createToken(t, "First");
    await createToken(t, "Second");
    await createToken(t, "Theirs", partner);
    const mine = await t.withIdentity(owner).query(api.tokens.list, {});
    expect(mine.map((row) => row.name)).toEqual(["Second", "First"]);
    expect(
      (await t.withIdentity(partner).query(api.tokens.list, {})).map((row) => row.name),
    ).toEqual(["Theirs"]);
  });

  it("a revoked token is rejected by requireToken", async () => {
    const { t, memberId } = await setUp();
    const { token, tokenId } = await createToken(t);
    expect(await check(t, token)).toBe(memberId);

    await t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId });
    expect(await check(t, token)).toMatch(/isn't valid or was revoked/);
    expect((await t.withIdentity(owner).query(api.tokens.list, {}))[0]!.revokedAt).toBeTypeOf(
      "number",
    );
    // Revoking twice is harmless.
    await t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId });
  });

  it("requireToken rejects unknown, malformed and orphaned tokens", async () => {
    const { t } = await setUp();
    const { token, tokenId } = await createToken(t);
    expect(await check(t, `${token}x`)).toMatch(/isn't valid/);
    expect(await check(t, "inv_" + token.slice(4))).toMatch(/isn't valid/);
    expect(await check(t, "")).toMatch(/isn't valid/);
    expect(await check(t, `pan_${"a".repeat(200)}`)).toMatch(/isn't valid/);
    // The member behind it is gone: the token stops working.
    await t.run(async (ctx) =>
      ctx.db.delete("members", (await ctx.db.get("apiTokens", tokenId))!.memberId),
    );
    expect(await check(t, token)).toMatch(/isn't valid/);
  });

  it("only the token's owner can revoke it", async () => {
    const { t } = await setUp();
    const { token, tokenId } = await createToken(t, "Partner's", partner);
    await expect(t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId })).rejects.toThrow(
      /Token not found/,
    );
    expect(await check(t, token)).not.toMatch(/isn't valid/);
  });

  it(`caps live tokens at ${MAX_ACTIVE_TOKENS} per person`, async () => {
    const { t } = await setUp();
    let last;
    for (let i = 0; i < MAX_ACTIVE_TOKENS; i++) last = await createToken(t, `T${i}`);
    await expect(createToken(t, "One more")).rejects.toThrow(/up to 25 tokens/);
    await t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId: last!.tokenId });
    await createToken(t, "One more");
  });
});

describe("lastUsedAt", () => {
  afterEach(() => vi.useRealTimers());

  it("shouldTouch: never used, or used 10 minutes ago or more", () => {
    const now = 1_000_000_000;
    expect(shouldTouch(undefined, now)).toBe(true);
    expect(shouldTouch(now - TOKEN_TOUCH_INTERVAL_MS + 1, now)).toBe(false);
    expect(shouldTouch(now - TOKEN_TOUCH_INTERVAL_MS, now)).toBe(true);
  });

  it("mcp.touchToken writes at most once per 10 minutes", async () => {
    const { t } = await setUp();
    const { token, tokenId } = await createToken(t);
    const lastUsed = () =>
      t.run(async (ctx) => (await ctx.db.get("apiTokens", tokenId))!.lastUsedAt);
    const start = Date.now() + 1000;
    vi.useFakeTimers({ now: start });

    expect(await t.mutation(api.mcp.touchToken, { token })).toBe(true);
    expect(await lastUsed()).toBe(start);

    vi.setSystemTime(start + 9 * 60 * 1000);
    expect(await t.mutation(api.mcp.touchToken, { token })).toBe(false);
    expect(await lastUsed()).toBe(start);

    vi.setSystemTime(start + TOKEN_TOUCH_INTERVAL_MS);
    expect(await t.mutation(api.mcp.touchToken, { token })).toBe(true);
    expect(await lastUsed()).toBe(start + TOKEN_TOUCH_INTERVAL_MS);

    // The list shows it; a bad token touches nothing.
    expect((await t.withIdentity(owner).query(api.tokens.list, {}))[0]!.lastUsedAt).toBe(
      start + TOKEN_TOUCH_INTERVAL_MS,
    );
    expect(await t.mutation(api.mcp.touchToken, { token: "pan_nope" })).toBe(false);
  });

  it("mcp.verifyToken answers who the token acts as, and null once revoked", async () => {
    const { t, memberId, workspaceId } = await setUp();
    const { token, tokenId } = await createToken(t);
    expect(await t.query(api.mcp.verifyToken, { token })).toEqual({
      tokenId,
      memberId,
      workspaceId,
      userId: owner.subject,
      displayName: "Kris",
      lastUsedAt: null,
      // Personal API tokens never expire and aren't bound to a resource (OAuth tokens are).
      expiresAt: null,
      resource: null,
    });
    await t.withIdentity(owner).mutation(api.tokens.revoke, { tokenId });
    expect(await t.query(api.mcp.verifyToken, { token })).toBeNull();
  });
});
