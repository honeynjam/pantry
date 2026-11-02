import type { Doc } from "@pantry/backend/dataModel";

/**
 * The words the app uses for spaces, from the workspace's mode (onboarding step 1). The one place
 * this copy lives, so the sidebar, dialogs, settings, Home and the palette never disagree.
 * MCP keeps the neutral "space"; this is UI only.
 *
 * - product: "Products"; new spaces are products; no kind picker.
 * - client: "Clients"; new spaces are clients; no kind picker.
 * - both: spaces grouped under "Products" and "Clients"; the new-space dialog asks which.
 */
export type Mode = "product" | "client" | "both";
export type Kind = "product" | "client";

export type Vocabulary = {
  mode: Mode;
  /** "product" / "client" / "product or client" (sentence-middle, lower case). */
  one: string;
  /** "Products" / "Clients" / "Products and clients" (headings, nav). */
  many: string;
  /** "New product" / "New client" / "New product or client". */
  newLabel: string;
  /** Whether to ask a new space's kind. */
  asksKind: boolean;
  /** The kind a new space starts with. */
  defaultKind: Kind;
};

export const modeOf = (workspace: Pick<Doc<"workspaces">, "mode"> | null | undefined): Mode =>
  workspace?.mode ?? "product";

export const kindOf = (space: Pick<Doc<"spaces">, "kind">): Kind => space.kind ?? "product";

export const KIND_LABEL: Record<Kind, { one: string; many: string }> = {
  product: { one: "Product", many: "Products" },
  client: { one: "Client", many: "Clients" },
};

export function vocabulary(mode: Mode): Vocabulary {
  if (mode === "both") {
    return {
      mode,
      one: "product or client",
      many: "Products and clients",
      newLabel: "New product or client",
      asksKind: true,
      defaultKind: "product",
    };
  }
  const label = KIND_LABEL[mode];
  return {
    mode,
    one: label.one.toLowerCase(),
    many: label.many,
    newLabel: `New ${label.one.toLowerCase()}`,
    asksKind: false,
    defaultKind: mode,
  };
}

export type SpaceGroup<S> = { kind: Kind; heading: string; spaces: S[] };

/**
 * Spaces as the sidebar and Home show them. With "both", one group per kind (spaces without a kind
 * are products). With one kind, a single group under that heading, plus a second group only if
 * spaces of the other kind exist (they keep their kind when the mode changes). Empty groups are
 * dropped, except the mode's own, so there's always somewhere to add the first one.
 */
export function groupSpaces<S extends Pick<Doc<"spaces">, "kind">>(
  mode: Mode,
  spaces: readonly S[],
): SpaceGroup<S>[] {
  const of = (kind: Kind) => spaces.filter((space) => kindOf(space) === kind);
  const group = (kind: Kind): SpaceGroup<S> => ({
    kind,
    heading: KIND_LABEL[kind].many,
    spaces: of(kind),
  });
  if (mode === "both") return [group("product"), group("client")];
  const other: Kind = mode === "product" ? "client" : "product";
  return [group(mode), group(other)].filter((g) => g.kind === mode || g.spaces.length > 0);
}
