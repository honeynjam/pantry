import { describe, expect, it } from "vitest";
import { parseCsvGrid } from "./csv";
import { jira, parseJiraCsv, splitJiraComment } from "./jira";
import { jiraToMarkdown } from "./jira-markup";
import { fixture, importedAll, run } from "./test-helpers";

const FIRST = fixture("jira-sample.csv");
const SECOND = fixture("jira-sample-2.csv");

describe("Jira CSV", () => {
  it("reads repeated columns by position: every label, sprint, watcher and comment", () => {
    const { headers } = parseCsvGrid(FIRST.text);
    expect(headers.filter((header) => header === "Labels")).toHaveLength(3);
    expect(headers.filter((header) => header === "Comment")).toHaveLength(3);
    const { issues } = parseJiraCsv([FIRST]);
    const card = issues.find((issue) => issue.key === "WEB-2")!;
    expect(card.labels).toEqual(["checkout", "frontend"]);
    expect(card.extras).toContainEqual({ field: "sprint", label: "Sprints", value: "WEB Sprint 4, WEB Sprint 5" });
    expect(card.comments).toHaveLength(2);
  });

  it("keeps quoted multi-line descriptions and turns wiki markup into Markdown", () => {
    const { issues } = parseJiraCsv([FIRST]);
    const card = issues.find((issue) => issue.key === "WEB-2")!;
    expect(card.description).toBe(
      [
        "When a card number is wrong, say **which** digit group.",
        "",
        "```js",
        "validate(card);",
        "```",
        "",
        "See [the spec](https://example.com/spec) and ask @Bo Lindqvist.",
      ].join("\n"),
    );
    expect(jiraToMarkdown("h1. Title\n* one\n** two\n# first\n{{code}} and _soft_ and -gone-\n{quote}said{quote}")).toBe(
      ["# Title", "- one", "  - two", "1. first", "`code` and *soft* and ~~gone~~", "> said"].join("\n"),
    );
  });

  it("reads the site's date format, and lists dates it can't read", () => {
    const { issues, warnings } = parseJiraCsv([FIRST]);
    const card = issues.find((issue) => issue.key === "WEB-2")!;
    expect(new Date(card.createdAt!).getFullYear()).toBe(2026);
    expect(new Date(card.createdAt!).getMonth()).toBe(8);
    expect(new Date(card.createdAt!).getHours()).toBe(10);
    expect(card.dueDate).toBe("2026-11-30");
    expect(warnings).toContain(
      `1 date in jira-sample.csv couldn't be read and is left out: WEB-5 Due date "someday".`,
    );
  });

  it("maps status with resolution, the status category, priorities and issue types", () => {
    const { plan, draft, summary } = run(jira, [FIRST]);
    expect(summary.statuses.map((row) => row.name)).toContain("Done · Won't Do");
    expect(draft("WEB-4")).toMatchObject({ statusId: "s-canceled", priority: 1 });
    expect(draft("WEB-4").completedAt).toBeDefined();
    expect(draft("WEB-3")).toMatchObject({ statusId: "s-done", priority: 4 });
    // "Selected for Development" says "develop", but Jira's category says To Do.
    expect(draft("OPS-7").statusId).toBe("s-todo");
    expect(draft("OPS-8")).toMatchObject({ statusId: "s-backlog", priority: 0 });
    expect(draft("WEB-5").priority).toBe(4); // Lowest → Low
    expect(draft("WEB-2").labels).toEqual(["checkout", "frontend", "story"]);
    // A sub-task is a sub-issue already, not a label.
    expect(draft("WEB-3").labels).toEqual([]);
    expect(plan.labels).toEqual(expect.arrayContaining(["Story", "Bug", "Task"]));
  });

  it("keeps the project key as the space key, so issues keep their numbers", () => {
    const { options, plan } = run(jira, [FIRST]);
    expect(options.teams).toEqual({
      "Web Shop": { kind: "new", name: "Web Shop", key: "WEB" },
      "Ops Desk": { kind: "new", name: "Ops Desk", key: "OPS" },
    });
    expect(plan.teams.find((team) => team.team === "Web Shop")).toMatchObject({ prefix: "WEB", maxNumber: 5 });
    expect(plan.drafts.every((row) => /^(WEB|OPS)-\d+$/.test(row.sourceKey))).toBe(true);
  });

  it("makes epics projects, sub-tasks sub-issues, and uses the parent's summary for an epic not in the file", () => {
    const { plan, draft } = run(jira, [FIRST]);
    expect(plan.drafts.map((row) => row.sourceKey)).not.toContain("WEB-1");
    expect(plan.teams[0]!.projects).toEqual([
      { externalId: "epic:10001", name: "Checkout redesign" },
      { externalId: "epic:10009", name: "Accounts revamp" },
    ]);
    expect(draft("WEB-2")).toMatchObject({ projectExternalId: "epic:10001" });
    expect(draft("WEB-2").parentExternalId).toBeUndefined();
    expect(draft("WEB-3").parentExternalId).toBe("10002");
    expect(draft("WEB-5").projectExternalId).toBe("epic:10009");
    expect(plan.counts).toMatchObject({ issues: 6, subIssues: 1, detached: 0 });
  });

  it("brings epics in as issues when that's switched off", () => {
    const { plan, draft } = run(jira, [FIRST], { toggles: { epicsAsProjects: false } });
    expect(draft("WEB-1").labels).toEqual(["checkout", "epic"]);
    expect(draft("WEB-2").parentExternalId).toBe("10001");
    // One level deep: a sub-task of a story of an epic hangs off the epic.
    expect(draft("WEB-3").parentExternalId).toBe("10001");
    // The epic isn't in the file: the story comes in top-level, saying whose it was.
    expect(draft("WEB-5").description).toContain("- Sub-issue of WEB-9 (Accounts revamp) in Jira");
    expect(plan.teams[0]!.projects).toEqual([]);
  });

  it("imports comments under their Jira author's name and date, with semicolons and line breaks", () => {
    expect(splitJiraComment("04/Sep/26 2:30 PM;712020:abc;One; two\nthree")).toEqual({
      date: "04/Sep/26 2:30 PM",
      author: "712020:abc",
      body: "One; two\nthree",
    });
    const { draft, plan } = run(jira, [FIRST]);
    expect(draft("WEB-2").comments).toEqual([
      "*Bo Lindqvist in Jira on 2026-09-04:*\n\nLooks good; one thing:\nthe error text is cut off on mobile.",
      "*Ana Moreno in Jira on 2026-09-05:*\n\nFixed in the next build, thanks @Bo Lindqvist.",
    ]);
    // Only an account id, matched through the Assignee Id column.
    expect(draft("WEB-4").comments![0]).toMatch(/^\*Cy Okafor in Jira/);
    expect(plan.comments).toBe(3);
    expect(run(jira, [FIRST], { patch: { comments: false } }).draft("WEB-2").comments).toBeUndefined();
  });

  it("folds links, sprints, story points and attachments into the note, and matches people by display name", () => {
    const { draft, plan } = run(jira, [FIRST]);
    expect(draft("WEB-2").description).toContain(
      [
        "---",
        "Imported from Jira: WEB-2, created 2026-09-03",
        "",
        "- Sprints: WEB Sprint 4, WEB Sprint 5",
        "- Story points: 5",
        "- Blocked by: WEB-4",
        "- Start date: 2026-09-01",
      ].join("\n"),
    );
    // Ana Moreno is a member (by display name), so they're the assignee and creator, not in the note.
    expect(draft("WEB-2")).toMatchObject({ assigneeId: "m-ana", creatorId: "m-ana" });
    expect(draft("WEB-4").description).toContain("created 2026-09-10 by Bo Lindqvist");
    expect(draft("WEB-4").description).toContain("- Blocks: WEB-2\n- Related to: OPS-7");
    expect(draft("WEB-4").description).toContain(
      "- Attachments: [trace.txt](https://example.atlassian.net/rest/api/3/attachment/content/20001)",
    );
    expect(draft("OPS-7").assigneeId).toBe("m-kris");
    expect(plan.people.find((row) => row.value === "Cy Okafor")?.member).toBeNull();
  });

  it("takes several files, each issue once, and a re-import of both plans nothing", () => {
    const { plan, parsed } = run(jira, [FIRST, SECOND]);
    expect(parsed.warnings).toContain("1 issue is in more than one file; each comes in once.");
    expect(plan.drafts.map((row) => row.sourceKey).sort()).toEqual(
      ["OPS-7", "OPS-8", "WEB-2", "WEB-3", "WEB-4", "WEB-5", "WEB-6", "WEB-7"].sort(),
    );
    // A sub-task in the second file attaches to its parent in the first.
    expect(plan.drafts.find((row) => row.sourceKey === "WEB-7")!.parentExternalId).toBe("10002");
    const again = run(jira, [FIRST, SECOND], { context: importedAll(plan) });
    expect(again.plan.drafts).toEqual([]);
    expect(again.plan.counts.alreadyImported).toBe(8);
  });

  it("warns when a file stops at Jira's export limit, and rejects files that aren't Jira's", () => {
    const head = "Summary,Issue key,Issue id,Issue Type,Status\n";
    const rows = Array.from({ length: 1000 }, (_, index) => `Task ${index},ENG-${index + 1},${index + 1},Task,To Do`).join("\n");
    const { warnings } = parseJiraCsv([{ name: "big.csv", text: head + rows }]);
    expect(warnings?.some((warning) => warning.includes("exactly 1,000 rows"))).toBe(true);
    expect(() => parseJiraCsv([{ name: "x.csv", text: "Name,Email\nA,b@example.com\n" }])).toThrow(
      /doesn't look like a Jira CSV export/,
    );
  });
});
