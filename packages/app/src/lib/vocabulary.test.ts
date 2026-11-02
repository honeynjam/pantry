import { describe, expect, it } from "vitest";
import { groupSpaces, modeOf, vocabulary } from "./vocabulary";

const space = (key: string, kind?: "product" | "client") => ({ key, ...(kind ? { kind } : {}) });
const keys = (
  groups: ReturnType<typeof groupSpaces<{ key: string; kind?: "product" | "client" }>>,
) => groups.map((group) => [group.heading, group.spaces.map((s) => s.key)]);

describe("vocabulary", () => {
  it("treats a workspace without a mode as a product workspace", () => {
    expect(modeOf({})).toBe("product");
    expect(modeOf(null)).toBe("product");
    expect(modeOf({ mode: "client" })).toBe("client");
  });

  it("names spaces after the mode and says when to ask the kind", () => {
    expect(vocabulary("product")).toMatchObject({
      many: "Products",
      newLabel: "New product",
      asksKind: false,
      defaultKind: "product",
    });
    expect(vocabulary("client")).toMatchObject({
      many: "Clients",
      newLabel: "New client",
      asksKind: false,
      defaultKind: "client",
    });
    expect(vocabulary("both")).toMatchObject({
      many: "Products and clients",
      newLabel: "New product or client",
      asksKind: true,
      defaultKind: "product",
    });
  });

  it("groups spaces under Products and Clients with both, kind-less ones as products", () => {
    const spaces = [space("PAN"), space("ACME", "client"), space("WEB", "product")];
    expect(keys(groupSpaces("both", spaces))).toEqual([
      ["Products", ["PAN", "WEB"]],
      ["Clients", ["ACME"]],
    ]);
    expect(keys(groupSpaces("both", [space("PAN")]))).toEqual([
      ["Products", ["PAN"]],
      ["Clients", []],
    ]);
  });

  it("shows one group for one kind, and keeps spaces of the other kind visible", () => {
    expect(keys(groupSpaces("product", [space("PAN"), space("WEB")]))).toEqual([
      ["Products", ["PAN", "WEB"]],
    ]);
    // Switched from both to product: the client stays a client, under its own heading.
    expect(keys(groupSpaces("product", [space("PAN"), space("ACME", "client")]))).toEqual([
      ["Products", ["PAN"]],
      ["Clients", ["ACME"]],
    ]);
    expect(keys(groupSpaces("client", []))).toEqual([["Clients", []]]);
  });
});
