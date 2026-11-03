import { describe, expect, it } from "vitest";
import { parseShortcutCsv, shortcut, shortcutTime, taskLine } from "./shortcut";
import { fixture, importedAll, run } from "./test-helpers";

const STORIES = fixture("shortcut-sample.csv");

describe("Shortcut CSV", () => {
  it("reads stories with ;-separated lists and dates in the exporter's offset", () => {
    expect(shortcutTime("2026/09/01 10:00:00", "+01:00")).toBe(Date.parse("2026-09-01T09:00:00Z"));
    expect(shortcutTime("2026/09/01 10:00:00", "")).toBe(Date.parse("2026-09-01T10:00:00Z"));
    const { issues } = parseShortcutCsv([STORIES]);
    const signup = issues.find((issue) => issue.externalId === "101")!;
    expect(signup).toMatchObject({
      key: "sc-101",
      team: "Growth",
      typeLabel: "Feature",
      labels: ["auth", "web"],
      creator: "ana@example.com",
      assignee: "bo@example.com",
      projectRef: { id: "epic:501", name: "Onboarding" },
      status: "In Development",
    });
  });

  it("turns tasks into a Markdown checklist at the end of the description", () => {
    expect(taskLine("[x] Ship it")).toBe("- [x] Ship it");
    expect(taskLine("Write tests (complete)")).toBe("- [x] Write tests");
    expect(taskLine("Update docs (incomplete)")).toBe("- [ ] Update docs");
    expect(taskLine("Just a task")).toBe("- [ ] Just a task");
    const { issues } = parseShortcutCsv([STORIES]);
    expect(issues.find((issue) => issue.externalId === "101")!.description).toBe(
      [
        "Let people sign up without a social account.",
        "",
        "Keep the form short.",
        "",
        "**Tasks**",
        "",
        "- [x] Design the form",
        "- [ ] Send the confirmation email",
        "- [ ] Rate-limit sign-ups",
      ].join("\n"),
    );
  });

  it("maps workflow states, story types, epics and teams", () => {
    const { draft, options, plan } = run(shortcut, [STORIES]);
    expect(options.teams).toEqual({
      Growth: { kind: "new", name: "Growth", key: "GRO" },
      Platform: { kind: "new", name: "Platform", key: "PLA" },
    });
    expect(options.statuses).toEqual({
      "in development": "s-progress",
      completed: "s-done",
      unscheduled: "s-backlog",
      "ready for review": "s-review",
      "ready for development": "s-todo",
    });
    expect(draft("102")).toMatchObject({
      statusId: "s-done",
      priority: 1,
      labels: ["auth", "bug"],
    });
    expect(draft("103").dueDate).toBe("2026-12-01");
    expect(plan.teams.find((team) => team.team === "Growth")!.projects).toEqual([
      { externalId: "epic:501", name: "Onboarding" },
      { externalId: "epic:502", name: "Planning" },
    ]);
    // Archived stories are left out unless the review includes them.
    expect(plan.counts).toMatchObject({ issues: 5, archivedSkipped: 1 });
  });

  it("keeps other owners, iteration, objective and blockers in the note", () => {
    const { draft } = run(shortcut, [STORIES]);
    expect(draft("101").description).toContain(
      [
        "- Assignee in Shortcut: bo@example.com",
        "- Other owners: kris@example.com",
        "- Iteration: Sprint 12",
        "- Objective: Q4 activation",
        "- Estimate: 3",
      ].join("\n"),
    );
    expect(draft("102").description).toContain("- Blocks other stories: yes");
    expect(draft("106").assigneeId).toBe("m-kris");
  });

  it("puts everything in one space when teams aren't spaces, and re-imports nothing", () => {
    const one = run(shortcut, [STORIES], { toggles: { teamsAsSpaces: false } });
    expect(Object.keys(one.options.teams)).toEqual(["Shortcut"]);
    expect(one.draft("103").description).toContain("- Team: Platform");
    const { plan } = run(shortcut, [STORIES]);
    expect(run(shortcut, [STORIES], { context: importedAll(plan) }).plan.drafts).toEqual([]);
  });
});
