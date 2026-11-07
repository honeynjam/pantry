import type { Id } from "@pantry/backend/dataModel";
import { describe, expect, it } from "vitest";
import { planColumnDrop, planProjectChange, planProjectGroupDrop, slotIndex } from "./reorder";

const todo = "todo" as Id<"statuses">;
const doing = "doing" as Id<"statuses">;
const done = "done" as Id<"statuses">;
const web = "web" as Id<"projects">;
const app = "app" as Id<"projects">;
const order = new Map([
  [todo, 0],
  [doing, 1],
  [done, 2],
]);

type Issue = {
  _id: Id<"issues">;
  statusId: Id<"statuses">;
  projectId?: Id<"projects">;
  parentId?: Id<"issues">;
};
const issue = (id: string, statusId = todo, extra: Partial<Issue> = {}): Issue => ({
  _id: id as Id<"issues">,
  statusId,
  ...extra,
});
const id = (value: string) => value as Id<"issues">;

/**
 * Plays planned moves the way the server does (after `afterId`, else before `beforeId`, else top),
 * so tests check the resulting order rather than the arguments.
 */
function play(columns: Record<string, string[]>, moves: ReturnType<typeof planColumnDrop>) {
  const next = Object.fromEntries(Object.entries(columns).map(([key, ids]) => [key, [...ids]]));
  for (const move of moves) {
    for (const ids of Object.values(next)) {
      const at = ids.indexOf(move.issueId);
      if (at >= 0) ids.splice(at, 1);
    }
    const column = (next[move.statusId] ??= []);
    let index = -1;
    if (move.placement.afterId) {
      const at = column.indexOf(move.placement.afterId);
      if (at >= 0) index = at + 1;
    }
    if (index < 0 && move.placement.beforeId) index = column.indexOf(move.placement.beforeId);
    if (index < 0) index = 0;
    column.splice(index, 0, move.issueId);
  }
  return next;
}

describe("planColumnDrop", () => {
  const column = ["a", "b", "c", "d"].map((key) => issue(key));
  const columns = { todo: ["a", "b", "c", "d"], doing: ["x", "y"] };

  it("reorders one issue inside its column", () => {
    const moves = planColumnDrop(column, [issue("a")], todo, 2);
    expect(moves).toEqual([
      { issueId: id("a"), statusId: todo, placement: { afterId: id("c"), beforeId: id("d") } },
    ]);
    expect(play(columns, moves).todo).toEqual(["b", "c", "a", "d"]);
  });

  it("moves to the top and the bottom", () => {
    expect(play(columns, planColumnDrop(column, [issue("c")], todo, 0)).todo).toEqual([
      "c",
      "a",
      "b",
      "d",
    ]);
    expect(play(columns, planColumnDrop(column, [issue("a")], todo, 3)).todo).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
  });

  it("does nothing when the issue lands where it already is", () => {
    expect(planColumnDrop(column, [issue("b")], todo, 1)).toEqual([]);
    expect(planColumnDrop(column, [issue("a"), issue("b")], todo, 0)).toEqual([]);
  });

  it("changes status when dropped in another column, at the slot", () => {
    const target = [issue("x", doing), issue("y", doing)];
    const moves = planColumnDrop(target, [issue("b")], doing, 1);
    expect(moves).toEqual([
      { issueId: id("b"), statusId: doing, placement: { afterId: id("x"), beforeId: id("y") } },
    ]);
    expect(play(columns, moves)).toEqual({ todo: ["a", "c", "d"], doing: ["x", "b", "y"] });
  });

  it("moves into an empty column", () => {
    const moves = planColumnDrop([], [issue("a")], done, 0);
    expect(moves).toEqual([{ issueId: id("a"), statusId: done, placement: {} }]);
  });

  it("keeps a multi-selection together and in order", () => {
    const moving = [issue("a"), issue("c")];
    const moves = planColumnDrop(column, moving, todo, 2);
    expect(play(columns, moves).todo).toEqual(["b", "d", "a", "c"]);
    // The second follows the first.
    expect(moves[1]!.placement.afterId).toBe(id("a"));
  });

  it("gathers a selection from several columns into one", () => {
    const target = [issue("x", doing), issue("y", doing)];
    const moving = [issue("b"), issue("y", doing), issue("d")];
    const moves = planColumnDrop(target, moving, doing, 0);
    expect(play(columns, moves)).toEqual({ todo: ["a", "c"], doing: ["b", "y", "d", "x"] });
  });

  it("clamps the index to the column", () => {
    expect(play(columns, planColumnDrop(column, [issue("a")], todo, 99)).todo).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(play(columns, planColumnDrop(column, [issue("d")], todo, -3)).todo).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
  });
});

describe("planProjectChange", () => {
  it("moves top-level issues and skips sub-issues", () => {
    const moving = [
      issue("a", todo, { projectId: app }),
      issue("b", todo, { projectId: web }),
      issue("c", todo, { parentId: id("p") }),
    ];
    expect(planProjectChange(moving, web)).toEqual({
      changes: [{ issueId: id("a"), projectId: web }],
      skipped: 1,
    });
    expect(planProjectChange(moving, null)).toEqual({
      changes: [
        { issueId: id("a"), projectId: null },
        { issueId: id("b"), projectId: null },
      ],
      // The sub-issue already has no project.
      skipped: 0,
    });
  });
});

describe("planProjectGroupDrop", () => {
  // The Web group: two todo, two doing, one done.
  const group = [
    issue("t1", todo, { projectId: web }),
    issue("t2", todo, { projectId: web }),
    issue("d1", doing, { projectId: web }),
    issue("d2", doing, { projectId: web }),
    issue("x1", done, { projectId: web }),
  ];

  it("keeps the drop slot inside the dragged issue's status block", () => {
    const dragged = issue("n", doing, { projectId: app });
    // Pointer above every row: clamped to the top of the doing block (after t1, t2).
    const top = planProjectGroupDrop(group, [dragged], dragged, web, 0, order);
    expect(top.index).toBe(2);
    expect(top.moves).toEqual([
      { issueId: id("n"), statusId: doing, placement: { beforeId: id("d1") } },
    ]);
    expect(top.changes).toEqual([{ issueId: id("n"), projectId: web }]);
    // Pointer below every row: clamped to the end of the doing block (before x1).
    const bottom = planProjectGroupDrop(group, [dragged], dragged, web, 5, order);
    expect(bottom.index).toBe(4);
    expect(bottom.moves[0]!.placement).toEqual({ afterId: id("d2") });
  });

  it("reorders inside its own project without changing status or project", () => {
    const dragged = group[3]!;
    const plan = planProjectGroupDrop(group, [dragged], dragged, web, 2, order);
    expect(plan.changes).toEqual([]);
    expect(plan.moves).toEqual([
      { issueId: id("d2"), statusId: doing, placement: { beforeId: id("d1") } },
    ]);
  });

  it("changes only the project when the group has no issue of that status", () => {
    const small = [issue("t1", todo, { projectId: web })];
    const dragged = issue("n", done, { projectId: app });
    const plan = planProjectGroupDrop(small, [dragged], dragged, web, 0, order);
    expect(plan).toEqual({
      index: 1,
      moves: [],
      changes: [{ issueId: id("n"), projectId: web }],
      skipped: 0,
    });
  });

  it("places selected issues of the dragged status and re-projects the rest", () => {
    const dragged = issue("n", doing, { projectId: app });
    const other = issue("m", todo, { projectId: app });
    const plan = planProjectGroupDrop(group, [other, dragged], dragged, web, 3, order);
    expect(plan.changes.map((change) => change.issueId)).toEqual([id("m"), id("n")]);
    expect(plan.moves).toEqual([
      { issueId: id("n"), statusId: doing, placement: { afterId: id("d1"), beforeId: id("d2") } },
    ]);
  });

  it("doesn't place a sub-issue that can't join the project", () => {
    const dragged = issue("s", doing, { projectId: app, parentId: id("p") });
    const plan = planProjectGroupDrop(group, [dragged], dragged, web, 3, order);
    expect(plan).toMatchObject({ moves: [], changes: [], skipped: 1 });
  });
});

describe("slotIndex", () => {
  it("finds the gap a point falls in", () => {
    expect(slotIndex([10, 30, 50], 0)).toBe(0);
    expect(slotIndex([10, 30, 50], 20)).toBe(1);
    expect(slotIndex([10, 30, 50], 60)).toBe(3);
    expect(slotIndex([], 5)).toBe(0);
  });
});
