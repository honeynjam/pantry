import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";
import {
  defaultOptions,
  guessStatus,
  linearDay,
  parseLinearCsv,
  planImport,
  suggestKey,
  summarizeLinear,
  toBatches,
  type ImportContext,
  type Prepared,
  type WorkspaceInfo,
} from "./linear";

// Synthetic data with the columns of Linear's CSV export (never real exports: they hold people's emails).
const SAMPLE = readFileSync(new URL("./fixtures/linear-sample.csv", import.meta.url), "utf8");

const workspace: WorkspaceInfo = {
  statuses: [
    { _id: "s-backlog", name: "Backlog", category: "backlog" },
    { _id: "s-todo", name: "Todo", category: "unstarted" },
    { _id: "s-progress", name: "In Progress", category: "started" },
    { _id: "s-review", name: "In Review", category: "review" },
    { _id: "s-done", name: "Done", category: "done" },
    { _id: "s-canceled", name: "Canceled", category: "canceled" },
  ],
  spaces: [{ _id: "space-pan", key: "PAN", name: "Pantry" }],
  labels: [{ name: "Bug" }],
  projects: [],
  members: [
    { _id: "m-kris", displayName: "Kris" },
    { _id: "m-ana", displayName: "Ana" },
  ],
};

const context: ImportContext = {
  teams: {},
  people: {
    "kris@example.com": { memberId: "m-kris", displayName: "Kris" },
    "ana@example.com": null,
    "bo@example.com": null,
  },
  imported: {},
};

function plan(overrides: Partial<ImportContext> = {}, includeArchived = false) {
  const parsed = parseLinearCsv(SAMPLE);
  const summary = summarizeLinear(parsed);
  const ctx = { ...context, ...overrides };
  const options = { ...defaultOptions(parsed, summary, workspace, ctx), includeArchived };
  return { parsed, summary, options, plan: planImport(parsed, summary, options, workspace, ctx) };
}

describe("parseCsv", () => {
  it("reads quoted fields with commas, quotes and line breaks, and drops a BOM", () => {
    const text = '﻿"ID","Description"\r\n"A-1","one, ""two""\r\nthree"\r\n\r\n"A-2",""\r\n';
    const { headers, rows } = parseCsv(text);
    expect(headers).toEqual(["ID", "Description"]);
    expect(rows).toEqual([
      { ID: "A-1", Description: 'one, "two"\r\nthree' },
      { ID: "A-2", Description: "" },
    ]);
  });

  it("round-trips what toCsv writes", () => {
    const text = toCsv(
      ["Key", "Title"],
      [
        ["PAN-1", 'Say "hi",\nthen leave'],
        ["PAN-2", null],
      ],
    );
    expect(parseCsv(text).rows).toEqual([
      { Key: "PAN-1", Title: 'Say "hi",\nthen leave' },
      { Key: "PAN-2", Title: "" },
    ]);
  });
});

describe("parseLinearCsv", () => {
  it("reads every row of the export", () => {
    const { issues, problems } = parseLinearCsv(SAMPLE);
    expect(problems).toEqual([]);
    expect(issues.map((issue) => issue.key)).toEqual([
      "ACME-3",
      "ACME-2",
      "ACME-1",
      "ACME-4",
      "ACME-5",
      "OPS-1",
    ]);
    const launch = issues.find((issue) => issue.key === "ACME-2")!;
    expect(launch).toMatchObject({
      prefix: "ACME",
      number: 2,
      team: "Acme Web",
      priority: 2,
      labels: ["web", "Feature"],
      dueDate: "2026-10-19",
      related: ["ACME-1", "OPS-1"],
      blockedBy: ["ACME-1"],
      milestone: "Beta",
      initiatives: "Grow",
      externalId: "aaaaaaaa-0000-4000-8000-000000000002",
    });
    expect(launch.description).toBe(
      '## Plan\n\nShip the page, then "announce" it.\n\n- one, two\n- three',
    );
    // Windows line breaks inside a quoted description become \n.
    expect(issues.find((issue) => issue.key === "ACME-1")!.description).toBe(
      'Steps:\n1. Sign in\n2. See "error, again"',
    );
    expect(issues.find((issue) => issue.key === "ACME-3")!.parentKey).toBe("ACME-2");
  });

  it("rejects a file that isn't a Linear export and lists rows it can't use", () => {
    expect(() => parseLinearCsv("Name,Email\nA,b@example.com\n")).toThrow(/Linear CSV export/);
    const text =
      '"ID","Team","Title","Status","UUID"\n"","T","No id","Todo","u0"\n"T-1","T","One","Todo","u1"\n"T-1","T","Again","Todo","u1"\n';
    const { issues, problems } = parseLinearCsv(text);
    expect(issues).toHaveLength(1);
    expect(problems).toEqual([
      "Row 1 has no issue ID like ENG-12, so it's left out.",
      "T-1 appears twice; the second copy is left out.",
    ]);
  });

  it("counts the columns that aren't imported", () => {
    const summary = summarizeLinear(parseLinearCsv(SAMPLE));
    expect(summary.dropped.find((row) => row.column === "Time in status (minutes)")?.count).toBe(6);
    expect(summary.folded).toMatchObject({
      milestone: 1,
      initiatives: 1,
      cycle: 1,
      estimate: 1,
      relations: 2,
    });
    expect(summary.archived).toBe(1);
  });
});

describe("mapping", () => {
  it("turns due dates exported as local midnight into the calendar day", () => {
    expect(linearDay("2026-10-18T23:00:00.000Z")).toBe("2026-10-19"); // London (BST)
    expect(linearDay("2026-10-19T05:00:00.000Z")).toBe("2026-10-19"); // New York
    expect(linearDay("2026-10-18T13:00:00.000Z")).toBe("2026-10-19"); // Auckland
    expect(linearDay("2026-10-19")).toBe("2026-10-19");
    expect(linearDay("")).toBeUndefined();
  });

  it("maps statuses by name, then meaning, then the issues' dates", () => {
    const { issues } = parseLinearCsv(SAMPLE);
    expect(guessStatus("todo", issues, workspace.statuses)).toBe("s-todo");
    expect(guessStatus("Duplicate", issues, workspace.statuses)).toBe("s-canceled");
    expect(guessStatus("Shipped", issues, workspace.statuses)).toBe("s-done");
    expect(guessStatus("QA", issues, workspace.statuses)).toBe("s-review");
    expect(guessStatus("Mystery", issues, workspace.statuses)).toBe("s-backlog");
  });

  it("suggests valid space keys", () => {
    expect(suggestKey("ENG", "acme.design")).toBe("ENG");
    expect(suggestKey("X", "Honey & Jam")).toBe("HJ");
    expect(suggestKey("1", "q")).toBe("LIN");
  });

  it("starts each team in a new space with its prefix as key, or in the space it went to before", () => {
    const { options } = plan();
    expect(options.teams).toEqual({
      "Acme Web": { kind: "new", name: "Acme Web", key: "ACME" },
      "Ops & Support": { kind: "new", name: "Ops & Support", key: "OPS" },
    });
    const again = plan({
      teams: { "Acme Web": { spaceId: "space-pan", key: "PAN", name: "Pantry" } },
    });
    expect(again.options.teams["Acme Web"]).toEqual({ kind: "existing", spaceId: "space-pan" });
  });
});

describe("planImport", () => {
  it("counts what Import will do and leaves archived issues out by default", () => {
    const { plan: result } = plan();
    expect(result.counts).toEqual({
      newSpaces: 2,
      existingSpaces: 0,
      newProjects: 2,
      newLabels: 4, // web, Feature, backend, Security ("Bug" and "bug" are the existing Bug)
      issues: 5,
      subIssues: 1,
      archivedSkipped: 1,
      alreadyImported: 0,
      detached: 0,
    });
    expect(result.labels.map((label) => label.toLowerCase()).sort()).toEqual([
      "backend",
      "bug",
      "feature",
      "security",
      "web",
    ]);
    expect(plan({}, true).plan.counts).toMatchObject({ issues: 6, archivedSkipped: 0 });
  });

  it("puts parents before their sub-issues, even when the file lists the child first", () => {
    const { plan: result } = plan();
    const keys = result.drafts.map((draft) => draft.sourceKey);
    expect(keys.indexOf("ACME-2")).toBeLessThan(keys.indexOf("ACME-3"));
    const child = result.drafts.find((draft) => draft.sourceKey === "ACME-3")!;
    expect(child.parentExternalId).toBe("aaaaaaaa-0000-4000-8000-000000000002");
    // A sub-issue takes its parent's project, so it doesn't ask for one.
    expect(child.projectExternalId).toBeUndefined();
  });

  it("matches people by email and keeps the others in the description", () => {
    const { plan: result } = plan();
    const launch = result.drafts.find((draft) => draft.sourceKey === "ACME-2")!;
    expect(launch.creatorId).toBe("m-kris");
    expect(launch.assigneeId).toBeUndefined();
    expect(launch.description).toContain("- Assignee in Linear: ana@example.com");
    expect(launch.description).not.toContain("by kris@example.com");
    const ops = result.drafts.find((draft) => draft.sourceKey === "OPS-1")!;
    expect(ops.creatorId).toBeUndefined();
    expect(ops.description).toBe(
      [
        "---",
        "Imported from Linear: OPS-1, created 2026-07-01 by bo@example.com",
        "",
        "- Cycle: 4 · Autumn",
        "- Estimate: 3",
      ].join("\n"),
    );
    expect(result.people.find((row) => row.value === "ana@example.com")).toMatchObject({
      member: null,
      count: 3,
    });
  });

  it("folds milestones, initiatives and relations into a note after the description", () => {
    const { plan: result } = plan();
    const launch = result.drafts.find((draft) => draft.sourceKey === "ACME-2")!;
    expect(launch.description).toBe(
      [
        "## Plan",
        "",
        'Ship the page, then "announce" it.',
        "",
        "- one, two",
        "- three",
        "",
        "---",
        "Imported from Linear: ACME-2, created 2026-09-01",
        "",
        "- Assignee in Linear: ana@example.com",
        "- Milestone: Beta",
        "- Initiatives: Grow",
        "- Related to: ACME-1, OPS-1",
        "- Blocked by: ACME-1",
      ].join("\n"),
    );
    expect(launch).toMatchObject({ statusId: "s-progress", priority: 2, dueDate: "2026-10-19" });
    const duplicate = result.drafts.find((draft) => draft.sourceKey === "ACME-4")!;
    expect(duplicate).toMatchObject({
      statusId: "s-canceled",
      completedAt: Date.parse("2026-08-03T09:00:00.000Z"),
    });
    expect(duplicate.description).toContain("- Duplicate of: ACME-1");
  });

  it("leaves the note out when every field is switched off", () => {
    const parsed = parseLinearCsv(SAMPLE);
    const summary = summarizeLinear(parsed);
    const options = defaultOptions(parsed, summary, workspace, context);
    const off = Object.fromEntries(
      Object.keys(options.fold).map((key) => [key, false]),
    ) as typeof options.fold;
    const result = planImport(parsed, summary, { ...options, fold: off }, workspace, context);
    expect(result.drafts.find((draft) => draft.sourceKey === "OPS-1")!.description).toBe("");
  });

  it("brings a sub-issue in top-level when its parent is left out", () => {
    const parsed = parseLinearCsv(SAMPLE);
    // ACME-3's parent is archived and left out:
    parsed.issues.find((issue) => issue.key === "ACME-2")!.archivedAt = Date.parse(
      "2026-10-01T00:00:00.000Z",
    );
    const summary = summarizeLinear(parsed);
    const options = defaultOptions(parsed, summary, workspace, context);
    const result = planImport(parsed, summary, options, workspace, context);
    const child = result.drafts.find((draft) => draft.sourceKey === "ACME-3")!;
    expect(child.parentExternalId).toBeUndefined();
    expect(child.projectExternalId).toBe("11111111-1111-4111-8111-111111111111");
    expect(child.description).toContain("- Sub-issue of ACME-2 in Linear");
    expect(result.counts.detached).toBe(1);
  });

  it("hangs a sub-issue of a sub-issue off the top-level issue and survives parent loops", () => {
    const head = SAMPLE.split("\n")[0]!;
    const cols = head.split(",").length;
    const line = (values: Record<number, string>) =>
      Array.from({ length: cols }, (_, index) => `"${values[index] ?? ""}"`).join(",");
    // ID 0, Team 1, Title 2, Status 4, Parent issue 24, UUID 29
    const text = [
      head,
      line({ 0: "T-1", 1: "T", 2: "Top", 4: "Todo", 29: "u1" }),
      line({ 0: "T-2", 1: "T", 2: "Middle", 4: "Todo", 24: "T-1", 29: "u2" }),
      line({ 0: "T-3", 1: "T", 2: "Bottom", 4: "Todo", 24: "T-2", 29: "u3" }),
      line({ 0: "T-4", 1: "T", 2: "Loop a", 4: "Todo", 24: "T-5", 29: "u4" }),
      line({ 0: "T-5", 1: "T", 2: "Loop b", 4: "Todo", 24: "T-4", 29: "u5" }),
    ].join("\n");
    const parsed = parseLinearCsv(text);
    const summary = summarizeLinear(parsed);
    const result = planImport(
      parsed,
      summary,
      defaultOptions(parsed, summary, workspace, context),
      workspace,
      context,
    );
    const parentOf = (key: string) =>
      result.drafts.find((draft) => draft.sourceKey === key)!.parentExternalId;
    expect(parentOf("T-2")).toBe("u1");
    expect(parentOf("T-3")).toBe("u1");
    expect(parentOf("T-4")).toBeUndefined();
    expect(parentOf("T-5")).toBeUndefined();
  });

  it("leaves out what an earlier import brought in, so a re-import plans nothing new", () => {
    const first = plan();
    const imported = Object.fromEntries(
      first.plan.drafts.map((draft) => [draft.externalId, draft.sourceKey]),
    );
    const second = plan({
      imported,
      teams: {
        "Acme Web": { spaceId: "space-acme", key: "ACME", name: "Acme Web" },
        "Ops & Support": { spaceId: "space-ops", key: "OPS", name: "Ops & Support" },
      },
    });
    expect(second.plan.drafts).toEqual([]);
    expect(second.plan.counts).toMatchObject({ issues: 0, alreadyImported: 5 });
    // Sub-issues of already-imported parents still attach to them.
    const partial = plan({ imported: { "aaaaaaaa-0000-4000-8000-000000000002": "ACME-2" } });
    expect(
      partial.plan.drafts.find((draft) => draft.sourceKey === "ACME-3")!.parentExternalId,
    ).toBe("aaaaaaaa-0000-4000-8000-000000000002");
  });

  it("refuses new spaces whose key is taken, invalid or shared", () => {
    const parsed = parseLinearCsv(SAMPLE);
    const summary = summarizeLinear(parsed);
    const options = defaultOptions(parsed, summary, workspace, context);
    options.teams["Acme Web"] = { kind: "new", name: "Acme", key: "PAN" };
    options.teams["Ops & Support"] = { kind: "new", name: "Ops", key: "x" };
    expect(planImport(parsed, summary, options, workspace, context).problems).toEqual([
      "Acme Web: PAN is already a space's key. Pick another, or import into that space.",
      "Ops & Support: keys are 2–10 letters or digits and start with a letter.",
    ]);
    options.teams["Ops & Support"] = { kind: "new", name: "Ops", key: "acme" };
    options.teams["Acme Web"] = { kind: "new", name: "Acme", key: "ACME" };
    expect(planImport(parsed, summary, options, workspace, context).problems).toEqual([
      "Ops & Support and Acme Web can't both get the key ACME.",
    ]);
  });
});

describe("toBatches", () => {
  const prepared: Prepared = {
    teams: [
      {
        team: "Acme Web",
        spaceId: "space-acme",
        projects: {
          "11111111-1111-4111-8111-111111111111": "p-launch",
          "22222222-2222-4222-8222-222222222222": "p-ext",
        },
      },
      { team: "Ops & Support", spaceId: "space-ops", projects: {} },
    ],
    labels: {
      web: "l-web",
      feature: "l-feature",
      bug: "l-bug",
      backend: "l-backend",
      security: "l-sec",
    },
  };

  it("fills in the prepared ids", () => {
    const batches = toBatches(plan().plan.drafts, prepared);
    expect(batches).toHaveLength(1);
    const launch = batches[0]!.find((args) => args.sourceKey === "ACME-2")!;
    expect(launch).toMatchObject({
      spaceId: "space-acme",
      projectId: "p-launch",
      labelIds: ["l-web", "l-feature"],
    });
    const login = batches[0]!.find((args) => args.sourceKey === "ACME-1")!;
    expect(login.labelIds).toEqual(["l-bug", "l-backend"]);
  });

  it("splits by count and by size", () => {
    const drafts = plan().plan.drafts;
    expect(toBatches(drafts, prepared, 2).map((batch) => batch.length)).toEqual([2, 2, 1]);
    expect(toBatches(drafts, prepared, 50, 1).map((batch) => batch.length)).toEqual([
      1, 1, 1, 1, 1,
    ]);
  });
});
