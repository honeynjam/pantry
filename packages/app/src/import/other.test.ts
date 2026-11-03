import { describe, expect, it } from "vitest";
import { csvHeaders } from "./csv";
import { csvPriority, guessColumns, other, parseOtherCsv } from "./other";
import { fixture, importedAll, run } from "./test-helpers";

const CLICKUP = fixture("other-sample.csv");

describe("Other CSV", () => {
  it("guesses which column is which from the headers", () => {
    expect(guessColumns(csvHeaders(CLICKUP.text))).toEqual({
      title: "Task Name",
      description: "Task Content",
      status: "Status",
      priority: "Priority",
      labels: "Tags",
      assignee: "Assignees",
      dueDate: "Due Date",
      created: "Date Created",
      parent: "Parent ID",
      externalId: "Task ID",
      group: "Space Name",
      project: "",
    });
    expect(guessColumns(["Card Name", "Card ID", "List Name", "Labels", "Due Date"])).toMatchObject(
      {
        title: "Card Name",
        externalId: "Card ID",
        status: "List Name",
      },
    );
  });

  it("reads rows with the chosen columns: lists, priorities, dates and parents by id", () => {
    expect([
      csvPriority("Urgent"),
      csvPriority("P1"),
      csvPriority("normal"),
      csvPriority(""),
    ]).toEqual([1, 2, 3, 0]);
    const { draft, options, plan, parsed } = run(other, [CLICKUP]);
    expect(options.teams).toEqual({
      Marketing: { kind: "new", name: "Marketing", key: "MAR" },
      Website: { kind: "new", name: "Website", key: "WEB" },
    });
    expect(draft("86c0a1")).toMatchObject({
      title: "Set up the newsletter",
      statusId: "s-progress",
      priority: 2,
      labels: ["newsletter"],
      dueDate: "2026-11-28",
    });
    expect(draft("86c0a1").description).toContain(
      "- Other assignees: bo@example.com\n- Time Estimate: 2h",
    );
    expect(draft("86c0a2").parentExternalId).toBe(draft("86c0a1").externalId);
    expect(draft("86c0a3").statusId).toBe("s-done");
    expect(draft("86c0a4")).toMatchObject({ priority: 1, assigneeId: "m-kris" });
    expect(draft("86c0a4").dueDate).toBeUndefined();
    expect(parsed.warnings).toContain(
      `1 date couldn't be read and is left out: 86c0a4 "13/15/2026".`,
    );
    expect(plan.counts).toMatchObject({ issues: 4, subIssues: 1 });
  });

  it("scopes ids by the header row, matches by title without an id column, and re-imports nothing", () => {
    const { plan } = run(other, [CLICKUP]);
    expect(run(other, [CLICKUP], { context: importedAll(plan) }).plan.drafts).toEqual([]);
    const a = parseOtherCsv([{ name: "a.csv", text: "ID,Title\n1,One\n" }], {
      title: "Title",
      externalId: "ID",
    });
    const b = parseOtherCsv([{ name: "b.csv", text: "Key,Name\n1,One\n" }], {
      title: "Name",
      externalId: "Key",
    });
    expect(a.issues[0]!.externalId).not.toBe(b.issues[0]!.externalId);
    const untitled = parseOtherCsv([{ name: "c.csv", text: "Title,Notes\nOne,x\nOne,y\n" }], {
      title: "Title",
    });
    expect(new Set(untitled.issues.map((issue) => issue.externalId)).size).toBe(2);
    expect(untitled.warnings?.[0]).toMatch(/No ID column/);
    expect(untitled.issues[0]!.team).toBe("c");
  });

  it("keeps issue numbers when the ID column has keys like ABC-12", () => {
    const text = "Key,Summary,Status\nABC-12,One,Open\nABC-13,Two,Closed\n";
    const result = run(other, [{ name: "tracker.csv", text }], {
      patch: {},
    });
    expect(result.draft("ABC-12").sourceKey).toBe("ABC-12");
    expect(result.plan.teams[0]).toMatchObject({ prefix: "ABC", maxNumber: 13 });
    expect(() => parseOtherCsv([CLICKUP], { title: "" })).toThrow(/title/);
  });
});
