import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import {
  OTHER_TOKEN,
  setUp,
  messageOf,
  issueRow,
  activityOf,
  mcpIssue,
  type Setup,
} from "./mcp.fixtures";

describe("every MCP function calls requireToken first", () => {
  it("rejects a revoked token on every tool", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Before revoke");
    await s.as.mutation(api.tokens.revoke, { tokenId: s.tokenId });
    const token = s.token;
    const calls = [
      s.t.query(api.mcp.getIssue, { token, key }),
      s.t.query(api.mcp.getSpaceContext, { token, space: "PAN" }),
      s.t.query(api.mcp.listIssues, { token }),
      s.t.mutation(api.mcp.createIssue, { token, space: "PAN", title: "x" }),
      s.t.mutation(api.mcp.createSubIssue, { token, parent: key, title: "x" }),
      s.t.mutation(api.mcp.addComment, { token, key, body: "x" }),
      s.t.mutation(api.mcp.updateIssue, { token, key, priority: 1 }),
      s.t.mutation(api.mcp.updateIssue, { token, key, title: "x" }),
    ];
    for (const call of calls) expect(await messageOf(call)).toMatch(/isn't valid or was revoked/);
    expect(await s.t.query(api.mcp.verifyToken, { token })).toBeNull();
  });
});

describe("get_issue", () => {
  it("returns the issue with names, sub-issues and comments", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Fix login", {
      project: "launch",
      description: "Steps…",
      priority: 2,
      assignee: "Partner",
      labels: ["bug"],
      dueDate: "2026-11-30",
    });
    const sub = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: key,
      title: "Write a test",
    });
    await s.t.mutation(api.mcp.addComment, { token: s.token, key, body: "On it." });

    const issue = await s.t.query(api.mcp.getIssue, { token: s.token, key: key.toLowerCase() });
    expect(issue).toMatchObject({
      key,
      title: "Fix login",
      description: "Steps…",
      space: "PAN",
      project: "Launch",
      status: "Todo",
      category: "unstarted",
      priority: "high",
      assignee: "Partner",
      labels: ["Bug"],
      parent: null,
      dueDate: "2026-11-30",
      creator: "Kris",
      completedAt: null,
      subIssues: [{ key: sub.key, title: "Write a test", status: "Todo", category: "unstarted" }],
      comments: [{ author: "Kris", body: "On it.", via: "mcp" }],
    });
    expect(issue.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect((await s.t.query(api.mcp.getIssue, { token: s.token, key: sub.key })).parent).toBe(key);
  });

  it("keeps the last 50 comments, oldest first", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Chatty");
    for (let i = 1; i <= 52; i++)
      await s.t.mutation(api.mcp.addComment, { token: s.token, key, body: `c${i}` });
    const { comments } = await s.t.query(api.mcp.getIssue, { token: s.token, key });
    expect(comments).toHaveLength(50);
    expect([comments[0]!.body, comments[49]!.body]).toEqual(["c3", "c52"]);
  });

  it("is not found for an unknown key or another workspace's issue", async () => {
    const s = await setUp();
    expect(await messageOf(s.t.query(api.mcp.getIssue, { token: s.token, key: "PAN-999" }))).toBe(
      "No issue PAN-999 in this workspace.",
    );
    expect(await messageOf(s.t.query(api.mcp.getIssue, { token: s.token, key: "OTH-1" }))).toBe(
      "No issue OTH-1 in this workspace.",
    );
    // The other workspace's own token sees it.
    expect((await s.t.query(api.mcp.getIssue, { token: OTHER_TOKEN, key: "OTH-1" })).title).toBe(
      "Theirs",
    );
  });
});

describe("get_space_context", () => {
  it("returns the space, its projects and its context doc", async () => {
    const s = await setUp();
    const context = await s.t.query(api.mcp.getSpaceContext, { token: s.token, space: "pan" });
    expect(context).toMatchObject({
      space: { key: "PAN", name: "Pantry", kind: "product" },
      projects: ["Launch"],
      context: "# PAN\n\nRun `pnpm test` before you finish.",
      updatedBy: "Kris",
    });
    expect(context.updatedAt).toMatch(/^\d{4}-/);
  });

  it("lists the valid keys for an unknown space, never another workspace's", async () => {
    const s = await setUp();
    const message = await messageOf(
      s.t.query(api.mcp.getSpaceContext, { token: s.token, space: "OTH" }),
    );
    expect(message).toBe('No space with the key "OTH". Spaces: PAN, WEB.');
  });
});

describe("list_issues", () => {
  afterEach(() => vi.useRealTimers());

  /** A, B, C a second apart, then B moves: newest first is B, C, A (OTH-1 is newer still, elsewhere). */
  async function seed(s: Setup) {
    let clock = Date.now();
    vi.useFakeTimers({ now: clock });
    const tick = () => vi.setSystemTime((clock += 1000));
    const a = await mcpIssue(s, "A", {
      project: "Launch",
      labels: ["Bug"],
      assignee: "me",
      priority: 1,
    });
    tick();
    const b = await mcpIssue(s, "B", { assignee: "Partner", priority: 3 });
    tick();
    const c = await s.t.mutation(api.mcp.createIssue, {
      token: s.token,
      space: "WEB",
      title: "C",
      project: "Docs",
    });
    tick();
    await s.t.mutation(api.mcp.updateIssue, { token: s.token, key: b.key, status: "In Progress" });
    vi.useRealTimers();
    return { a: a.key, b: b.key, c: c.key };
  }
  const keys = (rows: { key: string }[]) => rows.map((row) => row.key);

  it("filters by space, project, status, category, assignee, label and priority; newest first", async () => {
    const s = await setUp();
    const { a, b, c } = await seed(s);
    const list = (args: Record<string, unknown>) =>
      s.t.query(api.mcp.listIssues, { token: s.token, ...args });

    expect(keys(await list({}))).toEqual([b, c, a]);
    expect(keys(await list({ space: "PAN" }))).toEqual([b, a]);
    expect(keys(await list({ space: "PAN", project: "launch" }))).toEqual([a]);
    expect(keys(await list({ space: "PAN", project: "none" }))).toEqual([b]);
    expect(keys(await list({ status: "in progress" }))).toEqual([b]);
    expect(keys(await list({ category: "unstarted" }))).toEqual([c, a]);
    expect(keys(await list({ assignee: "me" }))).toEqual([a]);
    expect(keys(await list({ assignee: "none" }))).toEqual([c]);
    expect(keys(await list({ assignee: "partner" }))).toEqual([b]);
    expect(keys(await list({ space: "PAN", assignee: "partner" }))).toEqual([b]);
    expect(keys(await list({ space: "WEB", assignee: "me" }))).toEqual([]);
    expect(keys(await list({ label: "BUG" }))).toEqual([a]);
    expect(keys(await list({ priority: 3 }))).toEqual([b]);
    expect(keys(await list({ limit: 2 }))).toEqual([b, c]);
    expect((await list({ space: "WEB" }))[0]).toMatchObject({
      key: c,
      title: "C",
      space: "WEB",
      project: "Docs",
      status: "Todo",
      priority: "none",
      assignee: null,
      labels: [],
    });
  });

  it("explains bad filters with the valid values", async () => {
    const s = await setUp();
    const list = (args: Record<string, unknown>) =>
      messageOf(s.t.query(api.mcp.listIssues, { token: s.token, ...args }));
    expect(await list({ project: "Launch" })).toMatch(/give `space` too/);
    expect(await list({ space: "PAN", project: "Nope" })).toBe(
      'No project "Nope" in PAN. Projects in PAN: Launch (or "none").',
    );
    expect(await list({ status: "Doing" })).toBe(
      'No status "Doing". Statuses: "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled".',
    );
    expect(await list({ assignee: "Bob" })).toBe(
      'No member called "Bob". Use one of "me", "none", "Kris", "Partner".',
    );
    expect(await list({ label: "Secret label" })).toMatch(
      /^No label "Secret label"\. Labels: "Bug", "Feature"\./,
    );
  });

  it("never returns another workspace's issues", async () => {
    const s = await setUp();
    await seed(s);
    const all = await s.t.query(api.mcp.listIssues, { token: s.token, limit: 100 });
    expect(keys(all)).not.toContain("OTH-1");
    expect(
      await messageOf(s.t.query(api.mcp.listIssues, { token: s.token, space: "OTH" })),
    ).toMatch(/^No space with the key "OTH"/);
    expect(keys(await s.t.query(api.mcp.listIssues, { token: OTHER_TOKEN }))).toEqual(["OTH-1"]);
  });
});

describe("create_issue", () => {
  it("creates the issue as the token's owner, via MCP, in Todo by default", async () => {
    const s = await setUp();
    const result = await mcpIssue(s, "  New   thing ");
    expect(result).toEqual({ key: "PAN-1", space: "PAN", project: null });
    const issue = (await issueRow(s.t, "PAN-1"))!;
    expect(issue).toMatchObject({
      title: "New thing",
      creatorId: s.memberId,
      statusCategory: "unstarted",
      priority: 0,
    });
    expect(issue.projectId).toBeUndefined();
    const activity = await activityOf(s.t, issue._id);
    expect(activity.map((row) => [row.type, row.via, row.actorId])).toEqual([
      ["created", "mcp", s.memberId],
    ]);
  });

  it("takes project, status, priority, assignee, labels and due date by name", async () => {
    const s = await setUp();
    const { key, project } = await mcpIssue(s, "Full", {
      project: "LAUNCH",
      status: "backlog",
      priority: 4,
      assignee: "me",
      labels: ["bug", "Feature", "BUG"],
      dueDate: "2026-12-01",
    });
    expect(project).toBe("Launch");
    const issue = (await issueRow(s.t, key))!;
    expect(issue).toMatchObject({
      projectId: s.launchId,
      statusCategory: "backlog",
      priority: 4,
      assigneeId: s.memberId,
      dueDate: "2026-12-01",
    });
    expect(issue.labelIds).toHaveLength(2);
  });

  it("rejects unknown names with the valid values and creates nothing", async () => {
    const s = await setUp();
    const create = (args: Record<string, unknown>) => messageOf(mcpIssue(s, "Nope", args));
    expect(await create({ project: "Docs" })).toBe(
      'No project "Docs" in PAN. Projects in PAN: Launch (or "none").',
    );
    expect(await create({ labels: ["Bug", "Ideas"] })).toBe(
      'No label "Ideas". Labels: "Bug", "Feature". Labels aren\'t created automatically.',
    );
    expect(await create({ status: "Secret status" })).toMatch(
      /^No status "Secret status"\. Statuses: "Backlog"/,
    );
    expect(await create({ dueDate: "2026-02-30" })).toMatch(/calendar days/);
    expect(
      await messageOf(s.t.mutation(api.mcp.createIssue, { token: s.token, space: "", title: "x" })),
    ).toMatch(/^No space/);
    expect(await s.t.query(api.mcp.listIssues, { token: s.token })).toEqual([]);
    expect((await s.t.run((ctx) => ctx.db.get("spaces", s.spaceId)))!.nextIssueNumber).toBe(1);
  });

  it("can't reach another workspace's space, project, status or label", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.createIssue, { token: s.token, space: "OTH", title: "x" }),
      ),
    ).toBe('No space with the key "OTH". Spaces: PAN, WEB.');
    expect(await messageOf(mcpIssue(s, "x", { project: "Secret" }))).toMatch(
      /^No project "Secret" in PAN/,
    );
    expect(await messageOf(mcpIssue(s, "x", { labels: ["Secret label"] }))).toMatch(
      /^No label "Secret label"/,
    );
  });
});

describe("create_sub_issue", () => {
  it("inherits the parent's space and project, via MCP", async () => {
    const s = await setUp();
    const parent = await s.t.mutation(api.mcp.createIssue, {
      token: s.token,
      space: "WEB",
      title: "Parent",
      project: "docs",
    });
    const sub = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key.toLowerCase(),
      title: "Child",
      assignee: "partner",
      priority: 1,
    });
    expect(sub).toEqual({ key: "WEB-2", parent: "WEB-1", space: "WEB", project: "Docs" });
    const [parentRow, child] = [(await issueRow(s.t, "WEB-1"))!, (await issueRow(s.t, "WEB-2"))!];
    expect(child).toMatchObject({
      parentId: parentRow._id,
      spaceId: s.webId,
      projectId: parentRow.projectId,
      assigneeId: s.partnerId,
    });
    expect((await activityOf(s.t, child._id)).map((row) => [row.type, row.via])).toEqual([
      ["created", "mcp"],
    ]);

    // A parent with no project gives a sub-issue with no project.
    const plain = await mcpIssue(s, "Plain");
    const plainSub = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: plain.key,
      title: "Plain child",
    });
    expect(plainSub).toMatchObject({ space: "PAN", project: null });
  });

  it("follows the parent when the parent's project changes", async () => {
    const s = await setUp();
    const parent = await mcpIssue(s, "Parent");
    const sub = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key,
      title: "Child",
    });
    await s.t.mutation(api.mcp.updateIssue, { token: s.token, key: parent.key, project: "Launch" });
    expect((await issueRow(s.t, sub.key))!.projectId).toBe(s.launchId);
    // The sub-issue can't take a project of its own.
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateIssue, { token: s.token, key: sub.key, project: "none" }),
      ),
    ).toMatch(/always in its parent's project/);
  });

  it("refuses a sub-issue as parent, and another workspace's parent", async () => {
    const s = await setUp();
    const parent = await mcpIssue(s, "Parent");
    const sub = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key,
      title: "Child",
    });
    expect(
      await messageOf(
        s.t.mutation(api.mcp.createSubIssue, {
          token: s.token,
          parent: sub.key,
          title: "Grandchild",
        }),
      ),
    ).toBe(`${sub.key} is already a sub-issue; sub-issues are one level deep.`);
    expect(
      await messageOf(
        s.t.mutation(api.mcp.createSubIssue, { token: s.token, parent: "OTH-1", title: "x" }),
      ),
    ).toBe("No issue OTH-1 in this workspace.");
  });
});

describe("add_comment", () => {
  it("adds a comment by the token's owner, via MCP, as an issue write", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Commented");
    const before = (await issueRow(s.t, key))!;
    vi.useFakeTimers({ now: Date.now() + 5000 });
    const result = await s.t.mutation(api.mcp.addComment, {
      token: s.token,
      key,
      body: "**Done** with step 1.",
    });
    vi.useRealTimers();
    expect(result.key).toBe(key);
    const comment = await s.t.run((ctx) => ctx.db.get("comments", result.commentId));
    expect(comment).toMatchObject({
      authorId: s.memberId,
      body: "**Done** with step 1.",
      via: "mcp",
    });
    const after = (await issueRow(s.t, key))!;
    expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
    expect((await activityOf(s.t, after._id)).map((row) => [row.type, row.via])).toEqual([
      ["created", "mcp"],
      ["commented", "mcp"],
    ]);
    // The app reads it back with the tag.
    const viaApp = await s.as.query(api.issues.get, { key });
    expect(viaApp!.comments.map((row) => row.via)).toEqual(["mcp"]);
  });

  it("rejects an empty body and another workspace's issue", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "x");
    expect(
      await messageOf(s.t.mutation(api.mcp.addComment, { token: s.token, key, body: "  " })),
    ).toBe("Write something first.");
    expect(
      await messageOf(
        s.t.mutation(api.mcp.addComment, { token: s.token, key: "OTH-1", body: "hi" }),
      ),
    ).toBe("No issue OTH-1 in this workspace.");
    const theirs = await s.t.run((ctx) => ctx.db.query("comments").collect());
    expect(theirs).toEqual([]);
  });
});

describe("update_issue", () => {
  afterEach(() => vi.useRealTimers());

  it("moves status through the one status helper, via MCP", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Ship it");
    const row = await s.t.mutation(api.mcp.updateIssue, {
      token: s.token,
      key,
      status: "In Progress",
    });
    expect(row).toMatchObject({ key, status: "In Progress", category: "started" });
    await s.t.mutation(api.mcp.updateIssue, { token: s.token, key, status: "done" });
    const issue = (await issueRow(s.t, key))!;
    expect(issue.statusCategory).toBe("done");
    expect(issue.completedAt).toBeTypeOf("number");
    const moves = (await activityOf(s.t, issue._id)).filter((a) => a.type === "status_changed");
    expect(moves.map((a) => [a.from, a.to, a.via, a.actorId])).toEqual([
      ["Todo", "In Progress", "mcp", s.memberId],
      ["In Progress", "Done", "mcp", s.memberId],
    ]);
    // Same status again: nothing written.
    await s.t.mutation(api.mcp.updateIssue, { token: s.token, key, status: "Done" });
    expect(
      (await activityOf(s.t, issue._id)).filter((a) => a.type === "status_changed"),
    ).toHaveLength(2);
  });

  it("changes priority, assignee, labels and project, one activity row each", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Fields", { labels: ["Bug"] });
    const row = await s.t.mutation(api.mcp.updateIssue, {
      token: s.token,
      key,
      priority: 2,
      assignee: "me",
      addLabels: ["Feature"],
      removeLabels: ["bug"],
      project: "Launch",
    });
    expect(row).toMatchObject({
      priority: "high",
      assignee: "Kris",
      labels: ["Feature"],
      project: "Launch",
    });
    const issue = (await issueRow(s.t, key))!;
    const types = (await activityOf(s.t, issue._id)).map((a) => [a.type, a.via]);
    expect(types).toEqual([
      ["created", "mcp"],
      ["priority_changed", "mcp"],
      ["assigned", "mcp"],
      ["labels_changed", "mcp"],
      ["project_changed", "mcp"],
    ]);
    await s.t.mutation(api.mcp.updateIssue, {
      token: s.token,
      key,
      assignee: "none",
      project: "none",
    });
    expect(await s.t.query(api.mcp.getIssue, { token: s.token, key })).toMatchObject({
      assignee: null,
      project: null,
    });
  });

  it("needs at least one change, and a bad name changes nothing", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Strict");
    const update = (args: Record<string, unknown>) =>
      messageOf(s.t.mutation(api.mcp.updateIssue, { token: s.token, key, ...args }));
    expect(await update({})).toMatch(/^Nothing to change/);
    expect(await update({ priority: 1, status: "Shipped" })).toMatch(
      /^No status "Shipped"\. Statuses:/,
    );
    expect(await update({ priority: 1, project: "Docs" })).toBe(
      'No project "Docs" in PAN. Projects in PAN: Launch (or "none").',
    );
    expect(await update({ status: "Done", removeLabels: ["Secret label"] })).toMatch(
      /^No label "Secret label"/,
    );
    const issue = (await issueRow(s.t, key))!;
    expect(issue).toMatchObject({ priority: 0, statusCategory: "unstarted" });
    expect((await activityOf(s.t, issue._id)).map((a) => a.type)).toEqual(["created"]);
  });

  it("can't touch another workspace's issue", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateIssue, { token: s.token, key: "OTH-1", priority: 1 }),
      ),
    ).toBe("No issue OTH-1 in this workspace.");
    const theirs = await s.t.run((ctx) => ctx.db.get("issues", s.other.issueId));
    expect(theirs!.priority).toBe(0);
  });
});
