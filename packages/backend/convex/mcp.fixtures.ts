/** Shared fixtures for the MCP function tests (`mcp*.test.ts`). Not a Convex module (two dots). */
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { sha256Hex } from "./lib/tokens";
import { setupTest, type TestConvex } from "./test.setup";

export const owner = { subject: "user-owner", name: "Kris", email: "kris@example.com" };
export const outsider = { subject: "user-outsider" };
export const OTHER_TOKEN = "pan_other-workspace-token-0123456789abcdefghijk";

/**
 * A workspace (PAN with a context doc and a Launch project, WEB with a Docs project, labels Bug and
 * Feature, a second member) and its owner's token; plus a second workspace with a token, a space,
 * a project, a label and an issue of its own, which no call with the first token may ever see.
 */
export async function setUp() {
  const t = setupTest();
  const as = t.withIdentity(owner);
  const { workspaceId, memberId, spaceId } = await as.mutation(api.setup.createWorkspace, {
    workspaceName: "Home",
  });
  const partnerId = await t.run((ctx) =>
    ctx.db.insert("members", {
      workspaceId,
      userId: "user-partner",
      displayName: "Partner",
      role: "member",
    }),
  );
  const web = await as.mutation(api.spaces.create, { name: "Website", key: "WEB" });
  const launchId = await as.mutation(api.projects.create, { spaceId, name: "Launch" });
  await as.mutation(api.projects.create, { spaceId: web.spaceId, name: "Docs" });
  const bugId = await as.mutation(api.labels.create, { name: "Bug", color: "red" });
  await as.mutation(api.labels.create, { name: "Feature", color: "blue" });
  await as.mutation(api.docs.saveContext, {
    spaceId,
    body: "# PAN\n\nRun `pnpm test` before you finish.",
  });
  const { token, tokenId } = await as.action(api.tokens.create, { name: "Claude Code" });
  const other = await otherWorkspace(t);
  return {
    t,
    as,
    token,
    tokenId,
    workspaceId,
    memberId,
    partnerId,
    spaceId,
    webId: web.spaceId,
    launchId,
    bugId,
    other,
  };
}

export async function otherWorkspace(t: TestConvex) {
  const tokenHash = await sha256Hex(OTHER_TOKEN);
  return t.run(async (ctx) => {
    const workspaceId = await ctx.db.insert("workspaces", {
      name: "Other",
      slug: "other",
      createdBy: outsider.subject,
    });
    const memberId = await ctx.db.insert("members", {
      workspaceId,
      userId: outsider.subject,
      displayName: "Out",
      role: "owner",
    });
    const spaceId = await ctx.db.insert("spaces", {
      workspaceId,
      name: "Other",
      key: "OTH",
      nextIssueNumber: 2,
    });
    const projectId = await ctx.db.insert("projects", {
      workspaceId,
      spaceId,
      name: "Secret",
      sortOrder: 1,
    });
    const statusId = await ctx.db.insert("statuses", {
      workspaceId,
      name: "Secret status",
      category: "started",
      order: 0,
      color: "gray",
    });
    const labelId = await ctx.db.insert("labels", {
      workspaceId,
      name: "Secret label",
      color: "gray",
    });
    await ctx.db.insert("docs", {
      workspaceId,
      spaceId,
      kind: "space_context",
      title: "Other context",
      body: "secret context",
      updatedBy: memberId,
      updatedAt: 0,
    });
    const issueId = await ctx.db.insert("issues", {
      workspaceId,
      spaceId,
      projectId,
      number: 1,
      key: "OTH-1",
      title: "Theirs",
      description: "",
      statusId,
      statusCategory: "started",
      priority: 0,
      creatorId: memberId,
      labelIds: [labelId],
      sortOrder: 1,
      updatedAt: Date.now() + 60_000, // newest in the whole deployment
    });
    await ctx.db.insert("apiTokens", {
      userId: outsider.subject,
      workspaceId,
      memberId,
      name: "Theirs",
      tokenPrefix: OTHER_TOKEN.slice(0, 8),
      tokenHash,
    });
    return { workspaceId, issueId };
  });
}

export type Setup = Awaited<ReturnType<typeof setUp>>;

/** The user-facing message of a ConvexError (what packages/mcp shows the agent with isError). */
export async function messageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return (err as { data?: { message?: string } }).data?.message ?? String(err);
  }
  throw new Error("expected an error");
}

export const issueRow = (t: TestConvex, key: string) =>
  t.run(
    async (ctx) =>
      (await ctx.db.query("issues").collect()).find((issue) => issue.key === key) ?? null,
  );
export const activityOf = (t: TestConvex, issueId: Id<"issues">) =>
  t.run((ctx) =>
    ctx.db
      .query("activity")
      .withIndex("by_issue", (q) => q.eq("issueId", issueId))
      .collect(),
  );

/** Creates an issue in PAN as the token's owner over MCP. */
export const mcpIssue = (s: Setup, title: string, extra: Record<string, unknown> = {}) =>
  s.t.mutation(api.mcp.createIssue, { token: s.token, space: "PAN", title, ...extra });
