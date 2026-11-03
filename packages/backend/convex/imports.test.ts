import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, components } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { setupTest, stubAuthEnv, TEST_SITE_URL, type TestConvex } from "./test.setup";

const owner = { subject: "user-owner", name: "Kris", email: "kris@example.com" };
const partner = { subject: "user-partner", name: "Partner", email: "partner@example.com" };
const outsider = { subject: "user-outsider", name: "Out", email: "out@example.com" };

async function setUp() {
  const t = setupTest();
  const created = await t
    .withIdentity(owner)
    .mutation(api.setup.createWorkspace, { workspaceName: "Home" });
  const as = t.withIdentity(owner);
  const statuses = await t.run((ctx) =>
    ctx.db
      .query("statuses")
      .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", created.workspaceId))
      .collect(),
  );
  const status = (name: string) => statuses.find((row) => row.name === name)!._id;
  return { t, as, status, ...created };
}

async function addPartner(t: TestConvex, workspaceId: Id<"workspaces">) {
  return t.run((ctx) =>
    ctx.db.insert("members", {
      workspaceId,
      userId: partner.subject,
      displayName: "Partner",
      role: "member",
    }),
  );
}

function team(
  overrides: {
    target?: { spaceId: Id<"spaces"> } | { name: string; key: string };
    projects?: { externalId: string; name: string }[];
    maxNumber?: number;
  } = {},
) {
  return {
    team: "Acme",
    prefix: "ACME",
    maxNumber: overrides.maxNumber ?? 30,
    target: overrides.target ?? { name: "Acme", key: "ACME" },
    projects: overrides.projects ?? [
      { externalId: "p-1", name: "Launch" },
      { externalId: "p-2", name: "Extension" },
    ],
  };
}

type IssueArg = ReturnType<typeof issue>;
type IssueFields = Parameters<typeof issue>[0];
function issue(fields: {
  externalId: string;
  sourceKey: string;
  spaceId: Id<"spaces">;
  statusId: Id<"statuses">;
  title?: string;
  projectId?: Id<"projects">;
  parentExternalId?: string;
  labelIds?: Id<"labels">[];
  completedAt?: number;
  assigneeId?: Id<"members">;
  creatorId?: Id<"members">;
  dueDate?: string;
}) {
  return {
    title: `Issue ${fields.sourceKey}`,
    description: "Body",
    priority: 2 as const,
    labelIds: [],
    ...fields,
  };
}

async function issues(t: TestConvex, spaceId: Id<"spaces">) {
  return t.run((ctx) =>
    ctx.db
      .query("issues")
      .withIndex("by_space_and_updated", (q) => q.eq("spaceId", spaceId))
      .collect(),
  );
}

describe("imports: owner only", () => {
  it("refuses members, outsiders and signed-out callers", async () => {
    const { t, workspaceId, spaceId, status } = await setUp();
    await addPartner(t, workspaceId);
    const callers = [t.withIdentity(partner), t.withIdentity(outsider), t];
    for (const caller of callers) {
      await expect(
        caller.mutation(api.imports.prepareLinear, { teams: [team()], labels: [] }),
      ).rejects.toThrow(/owner|member|Sign in/);
      await expect(
        caller.mutation(api.imports.importLinearIssues, {
          issues: [
            issue({ externalId: "u1", sourceKey: "PAN-1", spaceId, statusId: status("Todo") }),
          ],
        }),
      ).rejects.toThrow(/owner|member|Sign in/);
      await expect(
        caller.query(api.imports.linearContext, { teams: [], emails: [], externalIds: [] }),
      ).rejects.toThrow(/owner|member|Sign in/);
    }
    expect(await issues(t, spaceId)).toHaveLength(0);
  });
});

describe("imports.prepareLinear", () => {
  it("creates the space, its projects and the labels once; a second run finds them", async () => {
    const { t, as, workspaceId } = await setUp();
    const bug = await as.mutation(api.labels.create, { name: "Bug", color: "red" });

    const first = await as.mutation(api.imports.prepareLinear, {
      teams: [team()],
      labels: ["bug", "Backend", "backend"],
    });
    expect(first.created).toEqual({ spaces: 1, projects: 2, labels: 1 });
    const [prepared] = first.teams;
    expect(prepared).toMatchObject({
      key: "ACME",
      name: "Acme",
      createdSpace: true,
      keepsNumbers: true,
    });
    expect(first.labels.bug).toBe(bug);
    expect(first.labels.backend).toBeDefined();

    const space = await t.run((ctx) => ctx.db.get("spaces", prepared!.spaceId));
    expect(space!.nextIssueNumber).toBe(31); // past the file's highest number
    const doc = await t.run((ctx) =>
      ctx.db
        .query("docs")
        .withIndex("by_space_and_kind", (q) =>
          q.eq("spaceId", prepared!.spaceId).eq("kind", "space_context"),
        )
        .first(),
    );
    expect(doc).not.toBeNull();

    // Again, even though the review says "new space" again: the link finds the same space.
    const second = await as.mutation(api.imports.prepareLinear, {
      teams: [team()],
      labels: ["Bug", "backend"],
    });
    expect(second.created).toEqual({ spaces: 0, projects: 0, labels: 0 });
    expect(second.teams[0]!.spaceId).toBe(prepared!.spaceId);
    expect(second.teams[0]!.projects).toEqual(prepared!.projects);
    const labels = await t.run((ctx) =>
      ctx.db
        .query("labels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    );
    expect(labels.map((label) => label.name).sort()).toEqual(["Backend", "Bug"]);
  });

  it("reuses a project of an existing space by name and keeps a renamed one by its link", async () => {
    const { t, as, spaceId } = await setUp();
    const existing = await as.mutation(api.projects.create, { spaceId, name: "launch" });
    const first = await as.mutation(api.imports.prepareLinear, {
      teams: [team({ target: { spaceId } })],
      labels: [],
    });
    expect(first.teams[0]).toMatchObject({ key: "PAN", keepsNumbers: false, createdSpace: false });
    expect(first.teams[0]!.projects["p-1"]).toBe(existing);
    expect(first.created.projects).toBe(1);

    await as.mutation(api.projects.update, {
      projectId: first.teams[0]!.projects["p-2"]!,
      name: "Browser extension",
    });
    const second = await as.mutation(api.imports.prepareLinear, {
      teams: [team({ target: { spaceId } })],
      labels: [],
    });
    expect(second.created.projects).toBe(0);
    expect(second.teams[0]!.projects).toEqual(first.teams[0]!.projects);
    // The space's counter isn't touched when its key isn't the team's prefix.
    const space = await t.run((ctx) => ctx.db.get("spaces", spaceId));
    expect(space!.nextIssueNumber).toBe(1);
  });

  it("refuses a key that's taken and a space of another workspace", async () => {
    const { t, as } = await setUp();
    await expect(
      as.mutation(api.imports.prepareLinear, {
        teams: [team({ target: { name: "Again", key: "PAN" } })],
        labels: [],
      }),
    ).rejects.toThrow(/already the key/);
    const other = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "O",
        slug: "o",
        createdBy: "x",
      });
      return ctx.db.insert("spaces", { workspaceId, name: "O", key: "OTH", nextIssueNumber: 1 });
    });
    await expect(
      as.mutation(api.imports.prepareLinear, {
        teams: [team({ target: { spaceId: other } })],
        labels: [],
      }),
    ).rejects.toThrow(/Space not found/);
  });
});

describe("imports.importLinearIssues", () => {
  async function prepared() {
    const base = await setUp();
    const result = await base.as.mutation(api.imports.prepareLinear, {
      teams: [team()],
      labels: ["Bug"],
    });
    const { spaceId, projects } = result.teams[0]!;
    return { ...base, acme: spaceId, projects, bug: result.labels.bug! };
  }

  it("keeps Linear's numbers, attaches sub-issues and logs one created row via import", async () => {
    const { t, as, acme, projects, bug, status, memberId } = await prepared();
    const done = Date.UTC(2026, 9, 1);
    const batch: IssueArg[] = [
      issue({
        externalId: "u28",
        sourceKey: "ACME-28",
        spaceId: acme,
        statusId: status("Done"),
        projectId: projects["p-1"],
        labelIds: [bug, bug],
        completedAt: done,
        dueDate: "2026-10-19",
      }),
      issue({
        externalId: "u29",
        sourceKey: "ACME-29",
        spaceId: acme,
        statusId: status("Todo"),
        parentExternalId: "u28",
        // A different project in Linear: a sub-issue always takes its parent's.
        projectId: projects["p-2"],
      }),
    ];
    const results = await as.mutation(api.imports.importLinearIssues, { issues: batch });
    expect(results).toEqual([
      { externalId: "u28", key: "ACME-28", outcome: "created" },
      { externalId: "u29", key: "ACME-29", outcome: "created" },
    ]);

    const rows = await issues(t, acme);
    const parent = rows.find((row) => row.key === "ACME-28")!;
    const child = rows.find((row) => row.key === "ACME-29")!;
    expect(parent).toMatchObject({
      number: 28,
      projectId: projects["p-1"],
      labelIds: [bug],
      completedAt: done,
      statusCategory: "done",
      dueDate: "2026-10-19",
      creatorId: memberId,
    });
    expect(child).toMatchObject({ parentId: parent._id, projectId: projects["p-1"] });
    expect(child.completedAt).toBeUndefined();

    const activity = await t.run((ctx) =>
      ctx.db
        .query("activity")
        .withIndex("by_issue", (q) => q.eq("issueId", parent._id))
        .collect(),
    );
    expect(activity).toHaveLength(1);
    expect(activity[0]).toMatchObject({
      type: "created",
      via: "import",
      from: "Linear",
      to: "Done",
      actorId: memberId,
    });

    // The counter stays past the file's highest number (30), so new issues don't collide.
    const created = await as.mutation(api.issues.create, { spaceId: acme, title: "New" });
    expect(created.key).toBe("ACME-31");
  });

  it("skips what's already imported, so a second run creates nothing", async () => {
    const { t, as, acme, status } = await prepared();
    const batch = [1, 2, 3].map((n) =>
      issue({
        externalId: `u${n}`,
        sourceKey: `ACME-${n}`,
        spaceId: acme,
        statusId: status("Backlog"),
      }),
    );
    await as.mutation(api.imports.importLinearIssues, { issues: batch });
    const again = await as.mutation(api.imports.importLinearIssues, { issues: batch });
    expect(again.map((row) => row.outcome)).toEqual(["skipped", "skipped", "skipped"]);
    expect(again.map((row) => row.key)).toEqual(["ACME-1", "ACME-2", "ACME-3"]);
    expect(await issues(t, acme)).toHaveLength(3);
    const activity = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity).toHaveLength(3);
  });

  it("carries on after an import that stopped halfway", async () => {
    const { t, as, acme, status } = await prepared();
    const all = [1, 2, 3, 4].map((n) =>
      issue({
        externalId: `u${n}`,
        sourceKey: `ACME-${n}`,
        spaceId: acme,
        statusId: status("Todo"),
        ...(n === 4 ? { parentExternalId: "u1" } : {}),
      }),
    );
    await as.mutation(api.imports.importLinearIssues, { issues: all.slice(0, 2) });
    // A batch that fails is rolled back whole: nothing of it is written.
    await expect(
      as.mutation(api.imports.importLinearIssues, {
        issues: [all[2]!, { ...all[3]!, title: "   " }],
      }),
    ).rejects.toThrow(/title/);
    expect(await issues(t, acme)).toHaveLength(2);

    const rerun = await as.mutation(api.imports.importLinearIssues, { issues: all });
    expect(rerun.map((row) => row.outcome)).toEqual(["skipped", "skipped", "created", "created"]);
    const rows = await issues(t, acme);
    expect(rows).toHaveLength(4);
    expect(rows.find((row) => row.key === "ACME-4")!.parentId).toBe(
      rows.find((row) => row.key === "ACME-1")!._id,
    );
  });

  it("gives the next free number when the key is taken, and new numbers in a space with another key", async () => {
    const { t, as, acme, spaceId: pan, status } = await prepared();
    // ACME-5 already exists in Pantry (made by hand, not by the import).
    await t.run(async (ctx) => {
      const space = (await ctx.db.get("spaces", acme))!;
      await ctx.db.insert("issues", {
        workspaceId: space.workspaceId,
        spaceId: acme,
        number: 5,
        key: "ACME-5",
        title: "Hand made",
        description: "",
        statusId: status("Todo"),
        statusCategory: "unstarted",
        priority: 0,
        creatorId: (await ctx.db.query("members").first())!._id,
        labelIds: [],
        sortOrder: 1,
        updatedAt: 1,
      });
    });
    const results = await as.mutation(api.imports.importLinearIssues, {
      issues: [
        issue({ externalId: "u5", sourceKey: "ACME-5", spaceId: acme, statusId: status("Todo") }),
        issue({ externalId: "h1", sourceKey: "HJ-1", spaceId: pan, statusId: status("Todo") }),
      ],
    });
    expect(results).toEqual([
      { externalId: "u5", key: "ACME-31", outcome: "created", renumbered: true },
      { externalId: "h1", key: "PAN-1", outcome: "created" },
    ]);
  });

  it("brings a sub-issue in as top-level when its parent wasn't imported", async () => {
    const { t, as, acme, status } = await prepared();
    const [result] = await as.mutation(api.imports.importLinearIssues, {
      issues: [
        issue({
          externalId: "child",
          sourceKey: "ACME-2",
          spaceId: acme,
          statusId: status("Todo"),
          parentExternalId: "archived-parent",
        }),
      ],
    });
    expect(result).toMatchObject({ outcome: "created", parentMissing: true });
    const [row] = await issues(t, acme);
    expect(row!.parentId).toBeUndefined();
  });

  it("imports again an issue that was deleted after the import", async () => {
    const { t, as, acme, status } = await prepared();
    const batch = [
      issue({ externalId: "u1", sourceKey: "ACME-1", spaceId: acme, statusId: status("Todo") }),
    ];
    const [first] = await as.mutation(api.imports.importLinearIssues, { issues: batch });
    const row = (await issues(t, acme))[0]!;
    await as.mutation(api.issues.remove, { issueId: row._id });
    const [second] = await as.mutation(api.imports.importLinearIssues, { issues: batch });
    expect(second).toMatchObject({ outcome: "created", key: first!.key });
    const links = await t.run((ctx) => ctx.db.query("importLinks").collect());
    expect(links.filter((link) => link.externalId === "u1")).toHaveLength(1);
  });

  it("resolves members, labels, statuses and projects inside the caller's workspace only", async () => {
    const { t, as, acme, status } = await prepared();
    const other = await t.run(async (ctx) => {
      const workspaceId = await ctx.db.insert("workspaces", {
        name: "O",
        slug: "o",
        createdBy: "x",
      });
      const memberId = await ctx.db.insert("members", {
        workspaceId,
        userId: outsider.subject,
        displayName: "Out",
        role: "owner",
      });
      const labelId = await ctx.db.insert("labels", { workspaceId, name: "Theirs", color: "red" });
      const statusId = await ctx.db.insert("statuses", {
        workspaceId,
        name: "Todo",
        category: "unstarted",
        order: 0,
        color: "#000000",
      });
      const spaceId = await ctx.db.insert("spaces", {
        workspaceId,
        name: "O",
        key: "OTH",
        nextIssueNumber: 1,
      });
      return { memberId, labelId, statusId, spaceId };
    });
    const base = {
      externalId: "x",
      sourceKey: "ACME-1",
      spaceId: acme,
      statusId: status("Todo"),
    };
    const attempts: [Partial<IssueFields>, RegExp][] = [
      [{ assigneeId: other.memberId }, /Member not found/],
      [{ creatorId: other.memberId }, /Member not found/],
      [{ labelIds: [other.labelId] }, /Label not found/],
      [{ statusId: other.statusId }, /Status not found/],
      [{ spaceId: other.spaceId }, /Space not found/],
    ];
    for (const [patch, error] of attempts) {
      await expect(
        as.mutation(api.imports.importLinearIssues, { issues: [issue({ ...base, ...patch })] }),
      ).rejects.toThrow(error);
    }
    expect(await issues(t, acme)).toHaveLength(0);
  });

  it("refuses batches that are too big", async () => {
    const { as, acme, status } = await prepared();
    const batch = Array.from({ length: 101 }, (_, n) =>
      issue({
        externalId: `u${n}`,
        sourceKey: `ACME-${n + 1}`,
        spaceId: acme,
        statusId: status("Todo"),
      }),
    );
    await expect(as.mutation(api.imports.importLinearIssues, { issues: batch })).rejects.toThrow(
      /at most 100/,
    );
  });
});

describe("imports.linearContext", () => {
  beforeEach(() => stubAuthEnv());
  afterEach(() => vi.unstubAllEnvs());

  it("finds last time's spaces, members by sign-in email and issues already in", async () => {
    const t = setupTest({ withAuth: true });
    const res = await t.fetch("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin: TEST_SITE_URL },
      body: JSON.stringify({ email: owner.email, password: "correct-horse-battery", name: "Kris" }),
    });
    expect(res.status).toBe(200);
    const user = await t.run((ctx) =>
      ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: "user",
        where: [{ field: "email", value: owner.email }],
      }),
    );
    const as = t.withIdentity({ ...owner, subject: String(user!._id) });
    const { memberId } = await as.mutation(api.setup.createWorkspace, {});
    const prepared = await as.mutation(api.imports.prepareLinear, { teams: [team()], labels: [] });
    const statusId = (await t.run((ctx) => ctx.db.query("statuses").first()))!._id;
    await as.mutation(api.imports.importLinearIssues, {
      issues: [
        issue({
          externalId: "u1",
          sourceKey: "ACME-1",
          spaceId: prepared.teams[0]!.spaceId,
          statusId,
        }),
      ],
    });

    const context = await as.query(api.imports.linearContext, {
      teams: ["Acme", "Other team"],
      emails: ["KRIS@example.com", "nobody@example.com"],
      externalIds: ["u1", "u2"],
    });
    expect(context.teams).toEqual({
      Acme: { spaceId: prepared.teams[0]!.spaceId, key: "ACME", name: "Acme" },
      "Other team": null,
    });
    expect(context.people).toEqual({
      "kris@example.com": { memberId, displayName: "Kris" },
      "nobody@example.com": null,
    });
    expect(context.imported).toEqual({ u1: "ACME-1" });
  });
});

describe("imports from other sources (Asana, Shortcut, Jira, other CSV)", () => {
  it("are owner only too", async () => {
    const { t, workspaceId } = await setUp();
    await addPartner(t, workspaceId);
    const member = t.withIdentity(partner);
    await expect(
      member.mutation(api.imports.prepare, { source: "jira", teams: [team()], labels: [] }),
    ).rejects.toThrow(/owner/i);
    await expect(
      member.query(api.imports.context, {
        source: "asana",
        teams: [],
        emails: [],
        externalIds: [],
      }),
    ).rejects.toThrow(/owner/i);
    await expect(
      t
        .withIdentity(outsider)
        .mutation(api.imports.importIssues, { source: "shortcut", issues: [] }),
    ).rejects.toThrow();
  });

  it("keep each source's links apart: the same id from Jira and Linear are two issues", async () => {
    const { t, as, status } = await setUp();
    const jira = await as.mutation(api.imports.prepare, {
      source: "jira",
      teams: [
        {
          ...team(),
          team: "Web Shop",
          prefix: "WEB",
          maxNumber: 4,
          projects: [],
          target: { name: "Web", key: "WEB" },
        },
      ],
      labels: [],
    });
    const web = jira.teams[0]!.spaceId;
    const one = issue({
      externalId: "10001",
      sourceKey: "WEB-1",
      spaceId: web,
      statusId: status("Todo"),
    });
    const [first] = await as.mutation(api.imports.importIssues, { source: "jira", issues: [one] });
    expect(first).toMatchObject({ key: "WEB-1", outcome: "created" });
    const [again] = await as.mutation(api.imports.importIssues, { source: "jira", issues: [one] });
    expect(again).toMatchObject({ key: "WEB-1", outcome: "skipped" });
    // Linear's link for "10001" is a different link: it creates (with the next free number).
    const [linear] = await as.mutation(api.imports.importLinearIssues, { issues: [one] });
    expect(linear).toMatchObject({ key: "WEB-5", outcome: "created", renumbered: true });
    // The space Jira made is found again for Jira, not for Linear.
    const context = await as.query(api.imports.context, {
      source: "jira",
      teams: ["Web Shop"],
      emails: [],
      externalIds: ["10001"],
    });
    expect(context).toMatchObject({
      teams: { "Web Shop": { spaceId: web } },
      imported: { "10001": "WEB-1" },
    });
    const other = await as.query(api.imports.context, {
      source: "asana",
      teams: ["Web Shop"],
      emails: [],
      externalIds: ["10001"],
    });
    expect(other).toMatchObject({ teams: { "Web Shop": null }, imported: {} });
    const activity = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity.map((row) => row.from).sort()).toEqual(["Jira", "Linear"]);
  });

  it("numbers issues without keys from the space's counter", async () => {
    const { as, status } = await setUp();
    const prepared = await as.mutation(api.imports.prepare, {
      source: "asana",
      teams: [
        {
          team: "Website",
          prefix: "",
          maxNumber: 0,
          projects: [],
          target: { name: "Website", key: "WR" },
        },
      ],
      labels: [],
    });
    const spaceId = prepared.teams[0]!.spaceId;
    expect(prepared.teams[0]!.keepsNumbers).toBe(false);
    const results = await as.mutation(api.imports.importIssues, {
      source: "asana",
      issues: ["1209000000000001", "1209000000000002"].map((externalId) =>
        issue({ externalId, sourceKey: "", spaceId, statusId: status("Todo") }),
      ),
    });
    expect(results.map((row) => row.key)).toEqual(["WR-1", "WR-2"]);
  });

  it("brings comments in under the importer's name, tagged via import, only when the issue is created", async () => {
    const { t, as, status, memberId } = await setUp();
    const prepared = await as.mutation(api.imports.prepare, {
      source: "jira",
      teams: [{ ...team(), projects: [] }],
      labels: [],
    });
    const spaceId = prepared.teams[0]!.spaceId;
    const withComments = {
      ...issue({ externalId: "10002", sourceKey: "ACME-2", spaceId, statusId: status("Todo") }),
      comments: ["*Bo in Jira on 2026-09-04:*\n\nLooks good.", "   ", "*Ana in Jira:*\n\nFixed."],
    };
    await as.mutation(api.imports.importIssues, { source: "jira", issues: [withComments] });
    await as.mutation(api.imports.importIssues, { source: "jira", issues: [withComments] });
    const comments = await t.run((ctx) => ctx.db.query("comments").collect());
    expect(comments.map((row) => row.body)).toEqual([
      "*Bo in Jira on 2026-09-04:*\n\nLooks good.",
      "*Ana in Jira:*\n\nFixed.",
    ]);
    expect(comments.every((row) => row.via === "import" && row.authorId === memberId)).toBe(true);
    // One activity row for the import, not one per comment.
    const activity = await t.run((ctx) => ctx.db.query("activity").collect());
    expect(activity).toHaveLength(1);

    const tooMany = {
      ...issue({ externalId: "10003", sourceKey: "ACME-3", spaceId, statusId: status("Todo") }),
      comments: Array.from({ length: 101 }, (_, index) => `Comment ${index}`),
    };
    await expect(
      as.mutation(api.imports.importIssues, { source: "jira", issues: [tooMany] }),
    ).rejects.toThrow(/at most 100 comments/);
    const tooLong = { ...tooMany, comments: ["x".repeat(20_001)] };
    await expect(
      as.mutation(api.imports.importIssues, { source: "jira", issues: [tooLong] }),
    ).rejects.toThrow(/at most 20,000 characters/);
    const batch = Array.from({ length: 11 }, (_, index) => ({
      ...issue({ externalId: `b${index}`, sourceKey: "", spaceId, statusId: status("Todo") }),
      comments: Array.from({ length: 100 }, () => "c"),
    }));
    await expect(
      as.mutation(api.imports.importIssues, { source: "jira", issues: batch }),
    ).rejects.toThrow(/at most 1000 comments per batch/);
  });
});

describe("exports", () => {
  it("lets any member export the workspace, issues with comments and activity, page by page", async () => {
    const { t, as, workspaceId, spaceId } = await setUp();
    await addPartner(t, workspaceId);
    const made: string[] = [];
    for (let n = 0; n < 5; n++) {
      const { issueId } = await as.mutation(api.issues.create, { spaceId, title: `Issue ${n}` });
      made.push(issueId);
    }
    await as.mutation(api.comments.add, { issueId: made[0] as Id<"issues">, body: "Hello" });

    const reader = t.withIdentity(partner);
    const meta = await reader.query(api.exports.workspace, {});
    expect(meta.workspace.name).toBe("Home");
    expect(meta.members).toHaveLength(2);
    expect(meta.statuses).toHaveLength(6);
    expect(meta.spaces.map((space) => space.key)).toEqual(["PAN"]);
    expect(meta.docs).toHaveLength(1);

    const seen: (Doc<"issues"> & { comments: Doc<"comments">[] })[] = [];
    let cursor: string | null = null;
    for (;;) {
      const page: Awaited<ReturnType<typeof reader.query<typeof api.exports.issues>>> =
        await reader.query(api.exports.issues, { paginationOpts: { numItems: 2, cursor } });
      seen.push(...page.page);
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(seen.map((row) => row._id).sort()).toEqual([...made].sort());
    expect(seen.find((row) => row._id === made[0])!.comments.map((c) => c.body)).toEqual(["Hello"]);

    const activity = await reader.query(api.exports.activity, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(activity.page.length).toBeGreaterThanOrEqual(6);

    await expect(t.withIdentity(outsider).query(api.exports.workspace, {})).rejects.toThrow(
      /not a member/,
    );
  });
});
