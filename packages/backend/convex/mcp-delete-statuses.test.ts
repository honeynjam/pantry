import { describe, expect, it } from "vitest";
import { api } from "./_generated/api";
import { DEFAULT_STATUSES } from "./lib/defaults";
import {
  activityOf,
  issueRow,
  mcpIssue,
  messageOf,
  OTHER_TOKEN,
  setUp,
  type Setup,
} from "./mcp.fixtures";

const partnerToken = async (s: Setup) =>
  (
    await s.t
      .withIdentity({ subject: "user-partner", name: "Partner", email: "partner@example.com" })
      .action(api.tokens.create, { name: "Partner's agent" })
  ).token;

const statusNames = async (s: Setup) =>
  (await s.as.query(api.workspace.current, {})).statuses.map((status) => status.name);

describe("revoked tokens", () => {
  it("are refused by delete_issue, update_status, reorder_statuses and unarchive_project", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "x");
    await s.as.mutation(api.tokens.revoke, { tokenId: s.tokenId });
    const token = s.token;
    for (const call of [
      s.t.mutation(api.mcp.deleteIssue, { token, key, confirm: key }),
      s.t.mutation(api.mcp.updateStatus, { token, status: "Todo", name: "To do" }),
      s.t.mutation(api.mcp.reorderStatuses, { token, statuses: [] }),
      s.t.mutation(api.mcp.unarchiveProject, { token, space: "PAN", project: "Launch" }),
    ])
      expect(await messageOf(call)).toMatch(/isn't valid or was revoked/);
    expect(await issueRow(s.t, key)).not.toBeNull();
  });
});

describe("delete_issue", () => {
  async function withChildren(s: Setup) {
    const parent = await mcpIssue(s, "Parent to delete");
    const a = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key,
      title: "A",
    });
    const b = await s.t.mutation(api.mcp.createSubIssue, {
      token: s.token,
      parent: parent.key,
      title: "B",
    });
    await s.t.mutation(api.mcp.addComment, { token: s.token, key: parent.key, body: "one" });
    await s.t.mutation(api.mcp.addComment, { token: s.token, key: parent.key, body: "two" });
    await s.t.mutation(api.mcp.addComment, { token: s.token, key: a.key, body: "on a sub-issue" });
    return { parent: parent.key, a: a.key, b: b.key };
  }

  it("refuses a confirm that isn't the issue's key, and deletes nothing", async () => {
    const s = await setUp();
    const { parent, a } = await withChildren(s);
    for (const confirm of ["", "yes", a, "PAN-999"]) {
      expect(
        await messageOf(
          s.t.mutation(api.mcp.deleteIssue, { token: s.token, key: parent, confirm }),
        ),
      ).toBe(
        `Nothing deleted. To delete ${parent} ("Parent to delete"), pass confirm: "${parent}".`,
      );
    }
    expect(await issueRow(s.t, parent)).not.toBeNull();
    expect(await s.t.run((ctx) => ctx.db.query("comments").collect())).toHaveLength(3);
  });

  it("hard-deletes the issue with its sub-issues, comments and activity, like the app", async () => {
    const s = await setUp();
    const { parent, a, b } = await withChildren(s);
    const keep = await mcpIssue(s, "Keep me");
    const parentId = (await issueRow(s.t, parent))!._id;
    const result = await s.t.mutation(api.mcp.deleteIssue, {
      token: s.token,
      key: parent.toLowerCase(),
      confirm: ` ${parent.toLowerCase()} `,
    });
    expect(result).toEqual({
      deleted: parent,
      title: "Parent to delete",
      subIssues: [a, b],
      comments: 3,
    });
    for (const key of [parent, a, b]) expect(await issueRow(s.t, key)).toBeNull();
    expect(await s.t.run((ctx) => ctx.db.query("comments").collect())).toEqual([]);
    expect(await activityOf(s.t, parentId)).toEqual([]);
    expect(await issueRow(s.t, keep.key)).not.toBeNull();
    expect(await messageOf(s.t.query(api.mcp.getIssue, { token: s.token, key: parent }))).toBe(
      `No issue ${parent} in this workspace.`,
    );
  });

  it("can't reach another workspace's issue; any member can delete, as in the app", async () => {
    const s = await setUp();
    expect(
      await messageOf(
        s.t.mutation(api.mcp.deleteIssue, { token: s.token, key: "OTH-1", confirm: "OTH-1" }),
      ),
    ).toBe("No issue OTH-1 in this workspace.");
    expect(await s.t.run((ctx) => ctx.db.get("issues", s.other.issueId))).not.toBeNull();
    const { key } = await mcpIssue(s, "Kris's issue");
    const token = await partnerToken(s);
    expect((await s.t.mutation(api.mcp.deleteIssue, { token, key, confirm: key })).deleted).toBe(
      key,
    );
  });
});

describe("update_status", () => {
  it("renames and recolours the status definition; issues show the new name", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "In todo");
    expect(
      await s.t.mutation(api.mcp.updateStatus, {
        token: s.token,
        status: "todo",
        name: "To do",
        color: "Blue",
      }),
    ).toEqual({ name: "To do", category: "unstarted", color: "blue" });
    expect((await s.t.query(api.mcp.getIssue, { token: s.token, key })).status).toBe("To do");
    expect(await statusNames(s)).toContain("To do");
    // "default" puts the category's own colour back.
    const todoDefault = DEFAULT_STATUSES.find((row) => row.category === "unstarted")!.color;
    expect(
      await s.t.mutation(api.mcp.updateStatus, {
        token: s.token,
        status: "To do",
        color: "default",
      }),
    ).toMatchObject({
      color: todoDefault,
    });
  });

  it("explains bad input with the valid values", async () => {
    const s = await setUp();
    const update = (args: Record<string, unknown>) =>
      messageOf(s.t.mutation(api.mcp.updateStatus, { token: s.token, status: "Todo", ...args }));
    expect(await update({ status: "Doing", name: "x" })).toBe(
      'No status "Doing". Statuses: "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled".',
    );
    expect(await update({ name: "done" })).toBe("There's already a status called Done.");
    expect(await update({ color: "#123456" })).toMatch(/^No colour "#123456"\. Colours: gray, red/);
    expect(await update({})).toBe("Nothing to change: give name or color.");
    expect(await update({ status: "Secret status", name: "x" })).toMatch(
      /^No status "Secret status"/,
    );
  });

  it("is open to any member, as in the app, and never touches another workspace", async () => {
    const s = await setUp();
    await s.t.mutation(api.mcp.updateStatus, {
      token: await partnerToken(s),
      status: "Backlog",
      name: "Icebox",
    });
    expect(await statusNames(s)).toContain("Icebox");
    const theirs = await s.t.query(api.mcp.getWorkspace, { token: OTHER_TOKEN });
    expect(theirs.statuses.map((status) => status.name)).toEqual(["Secret status"]);
  });
});

describe("reorder_statuses", () => {
  const order = ["Todo", "Backlog", "In Progress", "In Review", "Done", "Canceled"];

  it("takes all six names in the new order; lists and boards follow", async () => {
    const s = await setUp();
    const result = await s.t.mutation(api.mcp.reorderStatuses, {
      token: s.token,
      statuses: order.map((name) => name.toUpperCase()),
    });
    expect(result.map((row) => row.name)).toEqual(order);
    expect(await statusNames(s)).toEqual(order);
  });

  it("needs each status exactly once, by name", async () => {
    const s = await setUp();
    const reorder = (statuses: string[]) =>
      messageOf(s.t.mutation(api.mcp.reorderStatuses, { token: s.token, statuses }));
    const listed = '"Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled"';
    expect(await reorder(order.slice(1))).toBe(
      `List each status exactly once, in the new order. Statuses: ${listed}.`,
    );
    expect(await reorder([...order.slice(1), "todo", "Todo"])).toMatch(
      /^List each status exactly once/,
    );
    expect(await reorder([...order.slice(1), "Secret status"])).toMatch(
      /^No status "Secret status"/,
    );
    expect(await statusNames(s)).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Canceled",
    ]);
  });
});

describe("unarchive_project", () => {
  it("restores an archived project; its old issues stay without one", async () => {
    const s = await setUp();
    const { key } = await mcpIssue(s, "In Launch", { project: "Launch" });
    await s.t.mutation(api.mcp.archiveProject, { token: s.token, space: "PAN", project: "Launch" });
    expect(
      await s.t.mutation(api.mcp.unarchiveProject, {
        token: s.token,
        space: "pan",
        project: "launch",
      }),
    ).toEqual({ space: "PAN", project: "Launch", color: null, archived: false });
    const pan = (await s.t.query(api.mcp.getWorkspace, { token: s.token })).spaces[0]!;
    expect(pan.projects.map((project) => project.name)).toEqual(["Launch"]);
    expect((await s.t.query(api.mcp.getIssue, { token: s.token, key })).project).toBeNull();
  });

  it("handles a name clash, with an optional new name", async () => {
    const s = await setUp();
    await s.t.mutation(api.mcp.archiveProject, { token: s.token, space: "PAN", project: "Launch" });
    await s.t.mutation(api.mcp.createProject, { token: s.token, space: "PAN", name: "Launch" });
    const unarchive = (args: Record<string, unknown> = {}) =>
      s.t.mutation(api.mcp.unarchiveProject, {
        token: s.token,
        space: "PAN",
        project: "Launch",
        ...args,
      });
    expect(await messageOf(unarchive())).toBe(
      "There's already an active project called Launch in Pantry. Rename one of them first, then restore.",
    );
    expect(await unarchive({ name: "Launch (old)" })).toMatchObject({ project: "Launch (old)" });
  });

  it("explains what can be restored, and can't reach another workspace", async () => {
    const s = await setUp();
    const unarchive = (space: string, project: string) =>
      messageOf(s.t.mutation(api.mcp.unarchiveProject, { token: s.token, space, project }));
    expect(await unarchive("PAN", "Launch")).toBe("Launch isn't archived.");
    expect(await unarchive("PAN", "Nope")).toBe("PAN has no archived projects.");
    await s.t.mutation(api.mcp.archiveProject, { token: s.token, space: "PAN", project: "Launch" });
    expect(await unarchive("PAN", "Nope")).toBe(
      'No archived project "Nope" in PAN. Archived: Launch.',
    );
    expect(await unarchive("WEB", "Launch")).toBe("WEB has no archived projects.");
    expect(await unarchive("OTH", "Secret")).toMatch(/^No space with the key "OTH"/);
  });
});
