import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { brand } from "./lib/brand";
import { CONTEXT_DOC_PLACEHOLDER, SAMPLE_CONTEXT_DOC } from "./lib/defaults";
import { setupTest } from "./test.setup";

const owner = { subject: "user-owner", name: "Kris", email: "kris@example.com" };
const partner = { subject: "user-partner", name: "Partner", email: "partner@example.com" };

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
  return { t, ...created, as: t.withIdentity(owner), them: t.withIdentity(partner) };
}

describe("workspace mode", () => {
  it("is product until the owner sets it, and only the owner can", async () => {
    const { as, them } = await setUp();
    expect((await as.query(api.onboarding.state, {})).mode).toBe("product");
    expect((await as.query(api.workspace.current, {})).workspace.mode).toBeUndefined();

    await as.mutation(api.workspace.setMode, { mode: "both" });
    expect((await as.query(api.onboarding.state, {})).mode).toBe("both");
    await as.mutation(api.workspace.setMode, { mode: "client" });
    expect((await as.query(api.workspace.current, {})).workspace.mode).toBe("client");

    await expect(them.mutation(api.workspace.setMode, { mode: "product" })).rejects.toThrow(
      /Only the workspace owner/,
    );
  });

  it("decides the kind of new spaces that don't say, and existing spaces keep theirs", async () => {
    const { as } = await setUp();
    const product = await as.mutation(api.spaces.create, { name: "App", key: "APP" });
    await as.mutation(api.workspace.setMode, { mode: "client" });
    const client = await as.mutation(api.spaces.create, { name: "Acme", key: "ACME" });
    const explicit = await as.mutation(api.spaces.create, {
      name: "Side project",
      key: "SIDE",
      kind: "product",
    });
    await as.mutation(api.workspace.setMode, { mode: "both" });
    const both = await as.mutation(api.spaces.create, { name: "Tool", key: "TOOL" });

    const kinds = Object.fromEntries(
      (await as.query(api.workspace.current, {})).spaces.map((space) => [
        space.key,
        space.kind ?? "product",
      ]),
    );
    expect(kinds).toEqual({
      [brand.defaultKey]: "product",
      [product.key]: "product",
      [client.key]: "client",
      [explicit.key]: "product",
      [both.key]: "product",
    });
  });
});

describe("onboarding completion", () => {
  it("is tracked per member and can be repeated", async () => {
    const { t, as, them } = await setUp();
    expect((await as.query(api.workspace.current, {})).me.onboardedAt).toBeUndefined();
    await as.mutation(api.onboarding.complete, {});
    const first = (await as.query(api.workspace.current, {})).me.onboardedAt;
    expect(first).toBeTypeOf("number");
    // The partner hasn't finished just because the owner did.
    expect((await them.query(api.workspace.current, {})).me.onboardedAt).toBeUndefined();
    expect((await them.query(api.onboarding.state, {})).onboardedAt).toBeNull();

    // A re-run completes again without creating anything.
    const before = await t.run(async (ctx) => ({
      spaces: (await ctx.db.query("spaces").collect()).length,
      docs: (await ctx.db.query("docs").collect()).length,
      members: (await ctx.db.query("members").collect()).length,
    }));
    await as.mutation(api.onboarding.complete, {});
    expect((await as.query(api.onboarding.state, {})).onboardedAt).toBeGreaterThanOrEqual(first!);
    expect(
      await t.run(async (ctx) => ({
        spaces: (await ctx.db.query("spaces").collect()).length,
        docs: (await ctx.db.query("docs").collect()).length,
        members: (await ctx.db.query("members").collect()).length,
      })),
    ).toEqual(before);
  });

  it("needs a member", async () => {
    const { t } = await setUp();
    await expect(t.mutation(api.onboarding.complete, {})).rejects.toThrow(/Sign in first/);
    await expect(
      t.withIdentity({ subject: "stranger" }).query(api.onboarding.state, {}),
    ).rejects.toThrow(/not a member/);
  });

  it("keeps the invite step owner-only", async () => {
    const { them } = await setUp();
    await expect(them.action(api.invites.create, { email: "friend@example.com" })).rejects.toThrow(
      /Only the workspace owner/,
    );
    expect((await them.query(api.onboarding.state, {})).isOwner).toBe(false);
  });
});

describe("the sample space", () => {
  it("is offered for renaming while untouched, then renamed in place (name and key)", async () => {
    const { t, as, them, spaceId } = await setUp();
    expect((await as.query(api.onboarding.state, {})).sample).toEqual({
      spaceId,
      name: brand.name,
      key: brand.defaultKey,
    });
    // Members don't get the offer: it's the owner's setup.
    expect((await them.query(api.onboarding.state, {})).sample).toBeNull();

    await as.mutation(api.spaces.update, { spaceId, name: "Honeyjam", key: "hny" });
    const space = await t.run((ctx) => ctx.db.get("spaces", spaceId));
    expect(space).toMatchObject({ name: "Honeyjam", key: "HNY", nextIssueNumber: 1 });
    expect((await as.query(api.onboarding.state, {})).sample).toBeNull();
    // Still one space: renamed, not replaced.
    expect((await as.query(api.workspace.current, {})).spaces).toHaveLength(1);
    const created = await as.mutation(api.issues.create, { spaceId, title: "First" });
    expect(created.key).toBe("HNY-1");
  });

  it("isn't offered once it has been used", async () => {
    const used = await setUp();
    await used.as.mutation(api.issues.create, { spaceId: used.spaceId, title: "Real work" });
    expect((await used.as.query(api.onboarding.state, {})).sample).toBeNull();

    const edited = await setUp();
    await edited.as.mutation(api.docs.saveContext, {
      spaceId: edited.spaceId,
      body: "# Ours\n",
    });
    expect((await edited.as.query(api.onboarding.state, {})).sample).toBeNull();

    const withProject = await setUp();
    await withProject.as.mutation(api.projects.create, {
      spaceId: withProject.spaceId,
      name: "Launch",
    });
    expect((await withProject.as.query(api.onboarding.state, {})).sample).toBeNull();
  });
});

describe("space keys", () => {
  it("are validated like everywhere else, and fixed once a space has issues", async () => {
    const { as, spaceId } = await setUp();
    await expect(as.mutation(api.spaces.update, { spaceId, key: "1AB" })).rejects.toThrow(
      /Keys are 2–10 letters or digits/,
    );
    await expect(as.mutation(api.spaces.update, { spaceId, key: "A" })).rejects.toThrow(
      /Keys are 2–10/,
    );
    const web = await as.mutation(api.spaces.create, { name: "Web", key: "WEB" });
    await expect(as.mutation(api.spaces.update, { spaceId, key: "web" })).rejects.toThrow(
      /WEB is already the key of Web/,
    );
    await expect(
      as.mutation(api.spaces.create, { name: "Clash", key: brand.defaultKey }),
    ).rejects.toThrow(/already the key/);
    // Same key again is a no-op, not a clash with itself.
    await as.mutation(api.spaces.update, { spaceId, key: brand.defaultKey });

    await as.mutation(api.issues.create, { spaceId: web.spaceId, title: "Live" });
    await expect(
      as.mutation(api.spaces.update, { spaceId: web.spaceId, key: "SITE" }),
    ).rejects.toThrow(/WEB has issues, so its key can't change/);
  });
});

describe("describing a space", () => {
  it("fills the starter doc's placeholder once and never overwrites a written doc", async () => {
    const { as, spaceId } = await setUp();
    expect(await as.mutation(api.onboarding.describeSpace, { spaceId, summary: "  " })).toEqual({
      written: false,
    });
    expect(
      await as.mutation(api.onboarding.describeSpace, {
        spaceId,
        summary: "An issue tracker for small teams   with agents.",
      }),
    ).toEqual({ written: true });
    const doc = await as.query(api.docs.getContext, { spaceId });
    expect(doc?.body).toBe(
      SAMPLE_CONTEXT_DOC.replace(
        CONTEXT_DOC_PLACEHOLDER,
        "An issue tracker for small teams with agents.",
      ),
    );

    // A re-run doesn't stack a second summary or clobber the first.
    expect(
      await as.mutation(api.onboarding.describeSpace, { spaceId, summary: "Something else" }),
    ).toEqual({ written: false });
    expect((await as.query(api.docs.getContext, { spaceId }))?.body).toBe(doc?.body);

    await expect(
      as.mutation(api.onboarding.describeSpace, { spaceId, summary: "x".repeat(301) }),
    ).rejects.toThrow(/one line/);
  });

  it("stays inside the caller's workspace", async () => {
    const { t, spaceId } = await setUp();
    await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "Other",
        slug: "other",
        createdBy: "x",
      });
      await ctx.db.insert("members", {
        workspaceId,
        userId: "stranger",
        displayName: "S",
        role: "owner",
      });
    });
    const stranger = t.withIdentity({ subject: "stranger" });
    await expect(
      stranger.mutation(api.onboarding.describeSpace, { spaceId, summary: "Mine now" }),
    ).rejects.toThrow(/Space not found/);
    await expect(stranger.mutation(api.spaces.update, { spaceId, key: "MINE" })).rejects.toThrow(
      /Space not found/,
    );
  });
});
