// @vitest-environment happy-dom
import type { Id } from "@pantry/backend/dataModel";
import { describe, expect, it } from "vitest";
import { hiddenColumns, readColumnChoices, saveColumnChoices } from "./board-columns";

const [backlog, todo, done] = ["backlog", "todo", "done"] as Id<"statuses">[];
const all = [backlog!, todo!, done!];

describe("hiddenColumns", () => {
  it("hides empty columns by default", () => {
    const counts = new Map([[todo!, 3]]);
    expect([...hiddenColumns(all, counts, {}, new Set())]).toEqual([backlog, done]);
  });

  it("keeps a column that has shown during this visit, even once it's empty", () => {
    expect([...hiddenColumns(all, new Map(), {}, new Set([todo!]))]).toEqual([backlog, done]);
  });

  it("follows what the person chose over the default", () => {
    const counts = new Map([[todo!, 3]]);
    const hidden = hiddenColumns(all, counts, { [todo!]: "hidden", [done!]: "shown" }, new Set());
    expect([...hidden]).toEqual([backlog, todo]);
  });
});

describe("column choices", () => {
  it("round-trip per space and ignore junk", () => {
    saveColumnChoices("ATL", { [todo!]: "hidden" });
    expect(readColumnChoices("ATL")).toEqual({ todo: "hidden" });
    expect(readColumnChoices("HBR")).toEqual({});
    localStorage.setItem("pantry-board-columns:BAD", '{"todo":"maybe","done":"shown"}');
    expect(readColumnChoices("BAD")).toEqual({ done: "shown" });
    localStorage.setItem("pantry-board-columns:BROKEN", "{");
    expect(readColumnChoices("BROKEN")).toEqual({});
  });
});
