import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "./_generated/api";
import { SAMPLE_CONTEXT_DOC } from "./lib/defaults";
import {
  activityOf,
  issueRow,
  mcpIssue,
  messageOf,
  OTHER_TOKEN,
  setUp,
  type Setup,
} from "./mcp.fixtures";

/** A token for the second member (role "member", not the owner). */
const partnerToken = async (s: Setup) =>
  (
    await s.t
      .withIdentity({ subject: "user-partner", name: "Partner", email: "partner@example.com" })
      .action(api.tokens.create, { name: "Partner's agent" })
  ).token;

const workspace = (s: Setup, token = s.token) => s.t.query(api.mcp.getWorkspace, { token });

describe("the new tools call requireToken first", () => {
  it("reject a revoked token", async () => {
    const s = await setUp();
    await s.as.mutation(api.tokens.revoke, { tokenId: s.tokenId });
    const token = s.token;
    const calls = [
      s.t.query(api.mcp.getWorkspace, { token }),
      s.t.query(api.mcp.searchIssues, { token, query: "x" }),
      s.t.mutation(api.mcp.createSpace, { token, name: "X", key: "XX" }),
      s.t.mutation(api.mcp.updateSpace, { token, space: "PAN", name: "X" }),
      s.t.mutation(api.mcp.updateSpaceContext, { token, space: "PAN", body: "x" }),
      s.t.mutation(api.mcp.createProject, { token, space: "PAN", name: "X" }),
      s.t.mutation(api.mcp.updateProject, { token, space: "PAN", project: "Launch", name: "X" }),
      s.t.mutation(api.mcp.archiveProject, { token, space: "PAN", project: "Launch" }),
      s.t.mutation(api.mcp.createLabel, { token, name: "X" }),
    ];
    for (const call of calls) expect(await messageOf(call)).toMatch(/isn't valid or was revoked/);
  });
});

describe("get_workspace", () => {
  it("returns spaces with projects, statuses, labels and members, never another workspace's", async () => {
    const s = await setUp();
    await s.as.mutation(api.spaces.create, { name: "Old", key: "OLD" });
    const oldId = (await s.as.query(api.workspace.current, {})).spaces.find(
      (sp) => sp.key === "OLD",
    )!._id;
    await s.as.mutation(api.projects.create, { spaceId: oldId, name: "Gone" });
    await s.as.mutation(api.spaces.archive, { spaceId: oldId });

    expect(await workspace(s)).toEqual({
      workspace: "Home",
      mode: "product", // never set: workspaces from before onboarding are product workspaces
      you: "Kris",
      spaces: [
        {
          key: "PAN",
          name: "Pantry",
          kind: "product",
          archived: false,
          projects: [{ name: "Launch", color: null }],
        },
        {
          key: "WEB",
          name: "Website",
          kind: "product",
          archived: false,
          projects: [{ name: "Docs", color: null }],
        },
        { key: "OLD", name: "Old", kind: "product", archived: true, projects: [] },
      ],
      statuses: [
        { name: "Backlog", category: "backlog" },
        { name: "Todo", category: "unstarted" },
        { name: "In Progress", category: "started" },
        { name: "In Review", category: "review" },
        { name: "Done", category: "done" },
        { name: "Canceled", category: "canceled" },
      ],
      labels: [
        { name: "Bug", color: "red" },
        { name: "Feature", color: "blue" },
      ],
      members: [
        { name: "Kris", role: "owner", me: true },
        { name: "Partner", role: "member", me: false },
      ],
    });
    // The mode the owner picked in onboarding comes through.
    await s.as.mutation(api.workspace.setMode, { mode: "both" });
    expect((await workspace(s)).mode).toBe("both");
    // The other workspace's token sees only its own.
    const theirs = await workspace(s, OTHER_TOKEN);
    expect(theirs.spaces.map((space) => space.key)).toEqual(["OTH"]);
    expect(theirs.labels.map((label) => label.name)).toEqual(["Secret label"]);
  });
});

describe("search_issues", () => {
  it("finds by exact key first, then by title, narrowed by space and project", async () => {
    const s = await setUp();
    const a = await mcpIssue(s, "Login button misaligned", { project: "Launch" });
    const b = await mcpIssue(s, "Login page copy");
    const c = await s.t.mutation(api.mcp.createIssue, {
      token: s.token,
      space: "WEB",
      title: "Login on the website",
    });
    const search = (args: Record<string, unknown>) =>
      s.t.query(api.mcp.searchIssues, { token: s.token, query: "login", ...args });

    expect((await search({})).map((row) => row.key).sort()).toEqual([a.key, b.key, c.key].sort());
    expect((await search({ space: "web" })).map((row) => row.key)).toEqual([c.key]);
    expect((await search({ space: "PAN", project: "launch" })).map((row) => row.key)).toEqual([
      a.key,
    ]);
    const byKey = await s.t.query(api.mcp.searchIssues, {
      token: s.token,
      query: b.key.toLowerCase(),
    });
    expect(byKey[0]).toMatchObject({
      key: b.key,
      title: "Login page copy",
      space: "PAN",
      status: "Todo",
    });
    expect(await messageOf(search({ project: "Launch" }))).toMatch(/give `space` too/);
  });

  it("never returns another workspace's issues", async () => {
    const s = await setUp();
    expect(await s.t.query(api.mcp.searchIssues, { token: s.token, query: "Theirs" })).toEqual([]);
    expect(await s.t.query(api.mcp.searchIssues, { token: s.token, query: "OTH-1" })).toEqual([]);
    expect(
      await messageOf(
        s.t.query(api.mcp.searchIssues, { token: s.token, query: "x", space: "OTH" }),
      ),
    ).toMatch(/^No space with the key "OTH"/);
  });
});

describe("create_space", () => {
  it("creates the space and its starter context doc, like the app", async () => {
    const s = await setUp();
    const created = await s.t.mutation(api.mcp.createSpace, {
      token: s.token,
      name: " Client  Acme ",
      key: "acme",
      kind: "client",
    });
    expect(created).toEqual({ key: "ACME", name: "Client Acme", kind: "client" });
    const context = await s.t.query(api.mcp.getSpaceContext, { token: s.token, space: "ACME" });
    expect(context).toMatchObject({
      space: { key: "ACME", kind: "client" },
      context: SAMPLE_CONTEXT_DOC,
      updatedBy: "Kris",
    });
    // The app shows it, and issues can go in it straight away.
    expect(
      (await s.as.query(api.workspace.current, {})).spaces.map((space) => space.key),
    ).toContain("ACME");
    expect((await mcpIssue(s, "First", { space: "ACME" })).key).toBe("ACME-1");
  });

  it("gives a space without a kind the workspace's default, and says which", async () => {
    const s = await setUp();
    expect(
      await s.t.mutation(api.mcp.createSpace, { token: s.token, name: "Tool", key: "TOOL" }),
    ).toEqual({ key: "TOOL", name: "Tool", kind: "product" });
    await s.as.mutation(api.workspace.setMode, { mode: "client" });
    expect(
      await s.t.mutation(api.mcp.createSpace, { token: s.token, name: "Acme", key: "ACME" }),
    ).toEqual({ key: "ACME", name: "Acme", kind: "client" });
  });

  it("follows the app's key rules", async () => {
    const s = await setUp();
    const create = (key: string) =>
      messageOf(s.t.mutation(api.mcp.createSpace, { token: s.token, name: "X", key }));
    expect(await create("P")).toMatch(/^Keys are 2–10 letters or digits/);
    expect(await create("1AB")).toMatch(/^Keys are 2–10/);
    expect(await create("pan")).toBe("PAN is already the key of Pantry.");
    const oldId = (await s.as.mutation(api.spaces.create, { name: "Old", key: "OLD" })).spaceId;
    await s.as.mutation(api.spaces.archive, { spaceId: oldId });
    expect(await create("OLD")).toBe("OLD belongs to an archived space (Old). Pick another key.");
    // Another workspace's key is free here: keys are per workspace.
    expect(
      (await s.t.mutation(api.mcp.createSpace, { token: s.token, name: "Mine", key: "OTH" })).key,
    ).toBe("OTH");
  });

  it("is open to any member, as in the app (not owner-only)", async () => {
    const s = await setUp();
    const token = await partnerToken(s);
    expect(
      (await s.t.mutation(api.mcp.createSpace, { token, name: "Partner's", key: "PTR" })).key,
    ).toBe("PTR");
    await s.t.mutation(api.mcp.createProject, { token, space: "PTR", name: "Theirs" });
    await s.t.mutation(api.mcp.createLabel, { token, name: "Partner label" });
    await s.t.mutation(api.mcp.updateSpaceContext, { token, space: "PTR", body: "# Partner" });
  });
});

describe("update_space", () => {
  it("renames and changes kind; the key stays", async () => {
    const s = await setUp();
    expect(
      await s.t.mutation(api.mcp.updateSpace, {
        token: s.token,
        space: "web",
        name: "Marketing site",
        kind: "client",
      }),
    ).toEqual({
      key: "WEB",
      name: "Marketing site",
      kind: "client",
    });
    expect(
      await messageOf(s.t.mutation(api.mcp.updateSpace, { token: s.token, space: "WEB" })),
    ).toMatch(/^Nothing to change/);
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateSpace, { token: s.token, space: "WEB", name: "  " }),
      ),
    ).toBe("Space name can't be empty.");
  });

  it("can't reach another workspace's space", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateSpace, { token: s.token, space: "OTH", name: "Mine" }),
      ),
    ).toBe('No space with the key "OTH". Spaces: PAN, WEB.');
  });
});

describe("update_space_context", () => {
  it("replaces the doc as the token's owner; the app reads the new body", async () => {
    const s = await setUp();
    const body = "# Pantry\n\n- Run `pnpm check` before In Review\n";
    const result = await s.t.mutation(api.mcp.updateSpaceContext, {
      token: s.token,
      space: "PAN",
      body,
    });
    expect(result).toMatchObject({ space: "PAN", updatedBy: "Kris" });
    expect((await s.as.query(api.docs.getContext, { spaceId: s.spaceId }))!.body).toBe(body);
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateSpaceContext, {
          token: s.token,
          space: "PAN",
          body: "x".repeat(100_001),
        }),
      ),
    ).toMatch(/at most 100,000 characters/);
  });

  it("can't write another workspace's doc", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.updateSpaceContext, { token: s.token, space: "OTH", body: "hi" }),
      ),
    ).toMatch(/^No space with the key "OTH"/);
    const theirs = await s.t.query(api.mcp.getSpaceContext, { token: OTHER_TOKEN, space: "OTH" });
    expect(theirs.context).toBe("secret context");
  });
});

describe("create_project", () => {
  it("adds a project at the end, with a palette colour", async () => {
    const s = await setUp();
    expect(
      await s.t.mutation(api.mcp.createProject, {
        token: s.token,
        space: "PAN",
        name: "Marketing",
      }),
    ).toEqual({
      space: "PAN",
      name: "Marketing",
      color: "orange", // the app's rotation: second project, palette minus gray
    });
    expect(
      await s.t.mutation(api.mcp.createProject, {
        token: s.token,
        space: "PAN",
        name: "Mobile",
        color: "Violet",
      }),
    ).toMatchObject({
      color: "violet",
    });
    const pan = (await workspace(s)).spaces.find((space) => space.key === "PAN")!;
    expect(pan.projects.map((project) => project.name)).toEqual(["Launch", "Marketing", "Mobile"]);
  });

  it("refuses a duplicate name, a bad colour and another workspace's space", async () => {
    const s = await setUp();
    const create = (args: Record<string, unknown>) =>
      messageOf(
        s.t.mutation(api.mcp.createProject, { token: s.token, space: "PAN", name: "X", ...args }),
      );
    expect(await create({ name: "LAUNCH" })).toBe(
      "There's already a project called Launch in this space.",
    );
    expect(await create({ color: "#ff0000" })).toBe(
      'No colour "#ff0000". Colours: gray, red, orange, yellow, lime, green, teal, blue, indigo, violet, pink.',
    );
    expect(await create({ space: "OTH" })).toMatch(/^No space with the key "OTH"/);
  });
});

describe("update_project", () => {
  it("renames and recolours by name", async () => {
    const s = await setUp();
    const update = (args: Record<string, unknown>) =>
      s.t.mutation(api.mcp.updateProject, {
        token: s.token,
        space: "PAN",
        project: "launch",
        ...args,
      });
    expect(await update({ name: "Launch v2", color: "green" })).toEqual({
      space: "PAN",
      name: "Launch v2",
      color: "green",
    });
    expect(
      await s.t.mutation(api.mcp.updateProject, {
        token: s.token,
        space: "PAN",
        project: "Launch v2",
        color: null,
      }),
    ).toMatchObject({
      color: null,
    });
    const app = (await s.as.query(api.workspace.current, {})).projects.find(
      (project) => project._id === s.launchId,
    )!;
    expect(app.name).toBe("Launch v2");
  });

  it("explains bad names and can't reach another workspace's project", async () => {
    const s = await setUp();
    const update = (project: string, args: Record<string, unknown> = { name: "Y" }) =>
      messageOf(
        s.t.mutation(api.mcp.updateProject, { token: s.token, space: "PAN", project, ...args }),
      );
    expect(await update("Nope")).toBe(
      'No project "Nope" in PAN. Projects in PAN: Launch (or "none").',
    );
    expect(await update("none")).toBe(`Name one of PAN's projects; "none" isn't one.`);
    expect(await update("Secret")).toMatch(/^No project "Secret" in PAN/);
    expect(await update("Launch", {})).toBe("Nothing to change: give name or color.");
    await s.t.mutation(api.mcp.createProject, { token: s.token, space: "PAN", name: "Other" });
    expect(await update("Other", { name: "launch" })).toBe(
      "There's already a project called Launch in this space.",
    );
  });
});

describe("archive_project", () => {
  it("leaves its issues (sub-issues too) in the space with no project, each change via MCP", async () => {
    const s = await setUp();
    const parent = await mcpIssue(s, "Parent", { project: "Launch" });
    const child = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key,
      title: "Child",
    });
    const outside = await mcpIssue(s, "Not in it");

    const result = await s.t.mutation(api.mcp.archiveProject, {
      token: s.token,
      space: "PAN",
      project: "launch",
    });
    expect(result).toEqual({ space: "PAN", project: "Launch", archived: true, issuesMoved: 2 });

    for (const key of [parent.key, child.key]) {
      const issue = (await issueRow(s.t, key))!;
      expect([issue.spaceId, issue.projectId]).toEqual([s.spaceId, undefined]);
      const changes = (await activityOf(s.t, issue._id)).filter(
        (row) => row.type === "project_changed",
      );
      expect(changes.map((row) => [row.from, row.to, row.via])).toEqual([
        ["Launch", undefined, "mcp"],
      ]);
    }
    expect(
      (await activityOf(s.t, (await issueRow(s.t, outside.key))!._id)).map((row) => row.type),
    ).toEqual(["created"]);
    expect((await workspace(s)).spaces[0]!.projects).toEqual([]);
    // It's gone for name lookups too, so issues can't be put back in it.
    expect(await messageOf(mcpIssue(s, "x", { project: "Launch" }))).toBe(
      'PAN has no projects yet. Use "none" or leave the project out.',
    );
  });

  it("can't reach another workspace's project", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.archiveProject, { token: s.token, space: "OTH", project: "Secret" }),
      ),
    ).toMatch(/^No space with the key "OTH"/);
    const theirs = await s.t.run((ctx) => ctx.db.query("projects").collect());
    expect(theirs.find((project) => project.name === "Secret")!.archivedAt).toBeUndefined();
  });
});

describe("create_label", () => {
  it("creates a label (gray unless told), usable by name straight away", async () => {
    const s = await setUp();
    expect(await s.t.mutation(api.mcp.createLabel, { token: s.token, name: "Docs" })).toEqual({
      name: "Docs",
      color: "gray",
    });
    expect(
      await s.t.mutation(api.mcp.createLabel, { token: s.token, name: "Perf", color: "TEAL" }),
    ).toEqual({ name: "Perf", color: "teal" });
    const { key } = await mcpIssue(s, "Faster lists", { labels: ["perf", "docs"] });
    expect((await s.t.query(api.mcp.getIssue, { token: s.token, key })).labels).toEqual([
      "Perf",
      "Docs",
    ]);
  });

  it("refuses duplicates (any case) and bad colours; labels are per workspace", async () => {
    const s = await setUp();
    expect(
      await messageOf(s.t.mutation(api.mcp.createLabel, { token: s.token, name: "bug" })),
    ).toBe("There's already a label called Bug.");
    expect(
      await messageOf(
        s.t.mutation(api.mcp.createLabel, { token: s.token, name: "X", color: "beige" }),
      ),
    ).toMatch(/^No colour "beige"\. Colours: gray, red/);
    // "Secret label" exists only in the other workspace, so it's free here.
    await s.t.mutation(api.mcp.createLabel, { token: s.token, name: "Secret label" });
    expect((await workspace(s, OTHER_TOKEN)).labels).toHaveLength(1);
  });
});

describe("update_issue: title, description and due date", () => {
  afterEach(() => vi.useRealTimers());

  it("changes each with one activity row via MCP, and clears the due date with null", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Old title", { dueDate: "2026-11-01" });
    const row = await s.t.mutation(api.mcp.updateIssue, {
      token: s.token,
      key,
      title: "New title",
      description: "## Steps\n\n1. Open it",
      dueDate: "2026-12-24",
    });
    expect(row).toMatchObject({ title: "New title", dueDate: "2026-12-24" });
    expect((await s.t.query(api.mcp.getIssue, { token: s.token, key })).description).toBe(
      "## Steps\n\n1. Open it",
    );
    await s.t.mutation(api.mcp.updateIssue, { token: s.token, key, dueDate: null });
    const issue = (await issueRow(s.t, key))!;
    expect(issue.dueDate).toBeUndefined();
    expect((await activityOf(s.t, issue._id)).map((a) => [a.type, a.from, a.to, a.via])).toEqual([
      ["created", undefined, "Todo", "mcp"],
      ["title_changed", "Old title", "New title", "mcp"],
      ["description_changed", undefined, undefined, "mcp"],
      ["due_date_changed", "2026-11-01", "2026-12-24", "mcp"],
      ["due_date_changed", "2026-12-24", undefined, "mcp"],
    ]);
  });

  it("validates like the app and changes nothing on a bad value", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "Keep");
    const update = (args: Record<string, unknown>) =>
      messageOf(s.t.mutation(api.mcp.updateIssue, { token: s.token, key, ...args }));
    expect(await update({ title: "  " })).toBe("Give the issue a title.");
    expect(await update({ title: "Changed", dueDate: "2026-02-30" })).toMatch(/calendar days/);
    expect((await issueRow(s.t, key))!.title).toBe("Keep");
  });
});
