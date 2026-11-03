import { describe, expect, it } from "vitest";
import { asana, ASANA_ONE_SPACE, parseAsanaCsv } from "./asana";
import { fixture, importedAll, run } from "./test-helpers";

const WEBSITE = fixture("asana-website-relaunch.csv");
const MARKETING = fixture("asana-marketing.csv");

describe("Asana CSV", () => {
  it("reads a project export with its BOM, sections, custom fields and the file's project", () => {
    const { issues, problems } = parseAsanaCsv([WEBSITE]);
    expect(problems).toEqual([]);
    expect(issues).toHaveLength(8);
    const plan = issues.find((issue) => issue.externalId === "1209000000000001")!;
    expect(plan).toMatchObject({
      team: "Website relaunch",
      title: "Plan the launch",
      status: "To do",
      priority: 2,
      priorityName: "High",
      labels: ["launch", "planning"],
      dueDate: "2026-11-20",
      assignee: "Ana Moreno <ana@example.com>",
      description: "Who does what on launch day.\nOne line per person.",
    });
    expect(plan.extras).toEqual([
      { field: "dates", label: "Start date", value: "2026-09-05" },
      { field: "relations", label: "Blocking", value: "Write the announcement" },
      { field: "custom", label: "Estimated time", value: "2:00" },
      { field: "custom", label: "Stage", value: "Planning" },
    ]);
  });

  it("derives status from Completed At and the section, and lets sections map to statuses", () => {
    const { summary, draft } = run(asana, [WEBSITE]);
    expect(summary.statuses.map((row) => row.name).sort()).toEqual(
      ["Completed", "Doing", "No section", "To do"].sort(),
    );
    expect(draft("1209000000000003")).toMatchObject({ statusId: "s-done" });
    expect(draft("1209000000000003").completedAt).toBe(Date.UTC(2026, 8, 20, 12));
    expect(draft("1209000000000002").statusId).toBe("s-progress");
    const moved = run(asana, [WEBSITE], { patch: { statuses: { doing: "s-review" } } });
    expect(moved.draft("1209000000000002").statusId).toBe("s-review");
  });

  it("finds parents by name, in the task's own project first, and leaves ambiguous ones top-level", () => {
    const { draft, parsed, plan } = run(asana, [WEBSITE, MARKETING]);
    // Subtask rows list no project or section: they go where their parent goes.
    expect(draft("1209000000000004").parentExternalId).toBe("1209000000000001");
    expect(draft("1209000000000005").parentExternalId).toBe("1209000000000002");
    // Two tasks called "Review" in Website relaunch: can't tell which.
    expect(draft("1209000000000007").parentExternalId).toBeUndefined();
    expect(draft("1209000000000007").description).toContain(
      `- Sub-issue of "Review" (several tasks have that name) in Asana`,
    );
    // One "Review" in Marketing: that one.
    expect(draft("1209000000000012").parentExternalId).toBe("1209000000000011");
    expect(parsed.warnings).toContain(
      "1 subtask's parent name is shared by several tasks, so it comes in as normal issues, with the parent's name in the note.",
    );
    expect(plan.counts).toMatchObject({ subIssues: 3, detached: 1 });
  });

  it("puts several projects in one space as projects, or each in its own space", () => {
    const together = run(asana, [WEBSITE, MARKETING]);
    expect(together.options.teams).toEqual({
      [ASANA_ONE_SPACE]: { kind: "new", name: "Asana", key: "ASA" },
    });
    expect(together.plan.teams[0]!.projects.map((project) => project.name)).toEqual([
      "Website relaunch",
      "Marketing",
    ]);
    // A task in both projects comes in once, in the first file's project, naming the other.
    expect(
      together.plan.drafts.filter((row) => row.externalId === "1209000000000002"),
    ).toHaveLength(1);
    expect(together.draft("1209000000000002").description).toContain(
      "- Also in Asana projects: Marketing",
    );
    const apart = run(asana, [WEBSITE, MARKETING], { toggles: { oneSpace: false } });
    expect(apart.options.teams).toEqual({
      "Website relaunch": { kind: "new", name: "Website relaunch", key: "WR" },
      Marketing: { kind: "new", name: "Marketing", key: "MAR" },
    });
    expect(apart.plan.teams.every((team) => team.projects.length === 0)).toBe(true);
  });

  it("matches assignees by the email column, keeps tags as labels and imports nothing twice", () => {
    const { draft, plan } = run(asana, [WEBSITE, MARKETING]);
    expect(draft("1209000000000003").assigneeId).toBe("m-kris");
    expect(draft("1209000000000001").assigneeId).toBe("m-ana"); // by name: Ana Moreno is a member
    expect(draft("1209000000000002").description).toContain(
      "- Assignee in Asana: Bo Lindqvist <bo@example.com>",
    );
    expect(plan.labels.sort()).toEqual(["copy", "launch", "planning", "social"]);
    const again = run(asana, [WEBSITE, MARKETING], { context: importedAll(plan) });
    expect(again.plan.counts).toMatchObject({ issues: 0, alreadyImported: 11 });
  });

  it("names a file's project after the file when no task lists one, and survives spreadsheet-mangled ids", () => {
    const text =
      "Task ID,Created At,Completed At,Name,Section/Column,Projects,Parent task\n1.20871E+15,11/7/2024,,Fix login,Doing,,\n";
    const { issues, warnings } = parseAsanaCsv([{ name: "Team_tasks.csv", text }]);
    expect(issues[0]).toMatchObject({ team: "Team tasks", title: "Fix login" });
    expect(issues[0]!.externalId).toMatch(/^name:/);
    expect(issues[0]!.createdAt).toBe(Date.UTC(2024, 10, 7, 12));
    expect(warnings?.[0]).toMatch(/changed by a spreadsheet app/);
    expect(() => parseAsanaCsv([{ name: "x.csv", text: "ID,Title\n1,a\n" }])).toThrow(
      /doesn't look like an Asana CSV export/,
    );
  });
});
