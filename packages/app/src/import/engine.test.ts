import { describe, expect, it } from "vitest";
import { guessDayOrder, parseDateTime, parseDay } from "./dates";
import {
  carryOptions,
  emailIn,
  MAX_COMMENTS,
  personResolver,
  planImport,
  shortKey,
  summarize,
  defaultOptions,
  toBatches,
  type Parsed,
  type SourceIssue,
} from "./engine";
import { detectSource } from "./sources";
import { emptyContext, fixture, workspace } from "./test-helpers";

const issue = (patch: Partial<SourceIssue>): SourceIssue => ({
  row: 1,
  externalId: "x1",
  key: "X-1",
  team: "T",
  prefix: "",
  title: "One",
  description: "",
  status: "Todo",
  priority: 0,
  priorityName: "No priority",
  creator: "",
  assignee: "",
  labels: [],
  extras: [],
  ...patch,
});

describe("dates", () => {
  it("reads the formats trackers export, in several languages", () => {
    const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
    expect(parseDateTime("03/Nov/26 10:15 AM")).toBe(local(2026, 11, 3, 10, 15));
    expect(parseDateTime("03/Nov/26 10:15 PM")).toBe(local(2026, 11, 3, 22, 15));
    expect(parseDateTime("03/Okt/26 10:15")).toBe(local(2026, 10, 3, 10, 15));
    expect(parseDateTime("3. Dez. 2026 09:00")).toBe(local(2026, 12, 3, 9, 0));
    expect(parseDateTime("17/sept./26 12:00 AM")).toBe(local(2026, 9, 17, 0, 0));
    expect(parseDateTime("Nov 3, 2026 10:15 am")).toBe(local(2026, 11, 3, 10, 15));
    expect(parseDateTime("22-12-2025 12.41")).toBe(local(2025, 12, 22, 12, 41));
    expect(parseDateTime("2026-11-03T10:15:00.000Z")).toBe(Date.parse("2026-11-03T10:15:00.000Z"));
    // A day alone is noon UTC, so it stays on that day in every time zone.
    expect(parseDateTime("2026-11-03")).toBe(Date.UTC(2026, 10, 3, 12));
    expect(parseDateTime("31/Feb/26")).toBeUndefined();
    expect(parseDateTime("someday")).toBeUndefined();
    expect(parseDateTime("03/Nov/26 25:00")).toBeUndefined();
  });

  it("tells day-first from month-first numeric dates", () => {
    expect(guessDayOrder(["03/11/2026", "25/11/2026"])).toBe("dmy");
    expect(guessDayOrder(["11/25/2026", "11/03/2026"])).toBe("mdy");
    expect(guessDayOrder(["01/02/2026"], "mdy")).toBe("mdy");
    expect(parseDay("03/11/2026", "dmy")).toBe("2026-11-03");
    expect(parseDay("03/11/2026", "mdy")).toBe("2026-03-11");
    expect(parseDay("25/11/26", "mdy")).toBe("2026-11-25"); // 25 can only be a day
    expect(parseDay("17/Sep/26 12:00 AM")).toBe("2026-09-17");
  });
});

describe("engine", () => {
  it("finds the source of a file from its headers", () => {
    expect(detectSource(fixture("linear-sample.csv").text)).toBe("linear");
    expect(detectSource(fixture("jira-sample.csv").text)).toBe("jira");
    expect(detectSource(fixture("asana-marketing.csv").text)).toBe("asana");
    expect(detectSource(fixture("shortcut-sample.csv").text)).toBe("shortcut");
    expect(detectSource(fixture("other-sample.csv").text)).toBe("csv");
    expect(detectSource("not, really\n")).toBe("csv");
  });

  it("matches people by email inside a name, else by unique display name", () => {
    expect(emailIn("Ana Moreno <Ana@Example.com>")).toBe("ana@example.com");
    const person = personResolver(workspace, emptyContext);
    expect(person("Kris <kris@example.com>")?._id).toBe("m-kris");
    expect(person("Ana Moreno <ana@other.example>")?._id).toBe("m-ana");
    expect(person("nobody@example.com")).toBeNull();
    expect(person("")).toBeNull();
  });

  it("suggests short free keys for sources without keys", () => {
    expect(shortKey("Growth", "X")).toBe("GRO");
    expect(shortKey("Web Shop", "X")).toBe("WS");
    expect(shortKey("!", "IMP")).toBe("IMP");
    const parsed: Parsed = {
      issues: [issue({ team: "Pantry", externalId: "a" }), issue({ team: "Panther", externalId: "b" })],
      problems: [],
      dropped: [],
    };
    const options = defaultOptions(parsed, summarize(parsed, []), workspace, emptyContext);
    // PAN is the workspace's, so the teams (in name order) get the next free ones.
    expect(options.teams).toEqual({
      Panther: { kind: "new", name: "Panther", key: "PAN2" },
      Pantry: { kind: "new", name: "Pantry", key: "PAN3" },
    });
  });

  it("keeps the owner's choices when the files or source settings change", () => {
    const parsed: Parsed = { issues: [issue({})], problems: [], dropped: [] };
    const first = defaultOptions(parsed, summarize(parsed, []), workspace, emptyContext);
    const changed = { ...first, statuses: { todo: "s-review" }, includeArchived: true };
    const more: Parsed = {
      issues: [issue({}), issue({ externalId: "x2", status: "Done", team: "U" })],
      problems: [],
      dropped: [],
    };
    const next = carryOptions(changed, defaultOptions(more, summarize(more, []), workspace, emptyContext));
    expect(next.statuses).toEqual({ todo: "s-review", done: "s-done" });
    expect(next.includeArchived).toBe(true);
    expect(Object.keys(next.teams)).toEqual(["T", "U"]);
  });

  it("maps priorities by the source's name, as the review sets them", () => {
    const parsed: Parsed = {
      issues: [issue({ priorityName: "P2", priority: 3 })],
      problems: [],
      dropped: [],
    };
    const summary = summarize(parsed, []);
    expect(summary.priorities).toEqual([{ key: "p2", name: "P2", priority: 3, count: 1 }]);
    const options = defaultOptions(parsed, summary, workspace, emptyContext);
    const plan = planImport(parsed, summary, { ...options, priorities: { p2: 1 } }, workspace, emptyContext, "X");
    expect(plan.drafts[0]!.priority).toBe(1);
  });

  it("keeps the newest comments up to the limit, says how many it left out, and batches by comments", () => {
    const comments = Array.from({ length: MAX_COMMENTS + 5 }, (_, index) => ({
      author: "Bo",
      body: `Comment ${index}`,
    }));
    const parsed: Parsed = { issues: [issue({ comments })], problems: [], dropped: [] };
    const summary = summarize(parsed, [{ id: "dates", label: "" }]);
    const options = defaultOptions(parsed, summary, workspace, emptyContext);
    const plan = planImport(parsed, summary, options, workspace, emptyContext, "Jira");
    const [draft] = plan.drafts;
    expect(draft!.comments).toHaveLength(MAX_COMMENTS);
    expect(draft!.comments![0]).toBe("*Bo in Jira:*\n\nComment 5");
    expect(draft!.description).toContain("- 5 older comments in Jira aren't imported");
    const drafts = Array.from({ length: 6 }, (_, index) => ({ ...draft!, externalId: `x${index}` }));
    const prepared = { teams: [{ team: "T", spaceId: "s", projects: {} }], labels: {} };
    expect(toBatches(drafts, prepared).map((batch) => batch.length)).toEqual([5, 1]);
  });
});
