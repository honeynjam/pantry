import { PALETTE } from "@pantry/backend/validate";
import { LABEL_COLORS } from "@pantry/ui/lib/issue-meta";
import { describe, expect, it } from "vitest";

describe("colour palette", () => {
  it("MCP accepts exactly the colours the app has swatches for", () => {
    expect([...PALETTE]).toEqual([...LABEL_COLORS]);
  });
});
