import type { Id } from "@pantry/backend/dataModel";
import { describe, expect, it } from "vitest";
import { menuTargets } from "./menu-targets";

const ids = ["a", "b", "c", "d"] as Id<"issues">[];
const [a, b, c, d] = ids as [Id<"issues">, Id<"issues">, Id<"issues">, Id<"issues">];

describe("menuTargets", () => {
  it("acts on the right-clicked issue when nothing is selected", () => {
    expect(menuTargets(ids, b, undefined)).toEqual([b]);
    expect(menuTargets(ids, b, new Set())).toEqual([b]);
  });

  it("acts on the whole selection, in on-screen order, when a selected issue is right-clicked", () => {
    expect(menuTargets(ids, c, new Set([d, a, c]))).toEqual([a, c, d]);
  });

  it("acts on an unselected issue alone, even while others are selected", () => {
    expect(menuTargets(ids, b, new Set([a, c]))).toEqual([b]);
  });

  it("leaves out selected issues that are no longer on screen", () => {
    expect(menuTargets([a, b], a, new Set([a, c]))).toEqual([a]);
  });

  it("does nothing for an issue that isn't on screen", () => {
    expect(menuTargets([a, b], c, new Set([c]))).toEqual([]);
  });
});
