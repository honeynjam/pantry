import { brand } from "@pantry/backend/brand";
import type { Id } from "@pantry/backend/dataModel";

/**
 * Which board columns show (the board, like Linear's, hides empty columns). A column someone hid or
 * showed stays that way (saved per space on this device); otherwise it shows while it has issues,
 * and once it has shown it stays for the visit, so a column doesn't vanish under the pointer when
 * its last card is dragged out.
 */
export type ColumnChoices = Partial<Record<Id<"statuses">, "shown" | "hidden">>;

export function hiddenColumns(
  statusIds: ReadonlyArray<Id<"statuses">>,
  counts: ReadonlyMap<Id<"statuses">, number>,
  choices: ColumnChoices,
  seen: ReadonlySet<Id<"statuses">>,
): Set<Id<"statuses">> {
  return new Set(
    statusIds.filter((id) => {
      const choice = choices[id];
      if (choice) return choice === "hidden";
      return (counts.get(id) ?? 0) === 0 && !seen.has(id);
    }),
  );
}

const storageKey = (spaceKey: string) => `${brand.name.toLowerCase()}-board-columns:${spaceKey}`;

export function readColumnChoices(spaceKey: string): ColumnChoices {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(storageKey(spaceKey)) ?? "{}");
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, choice]) => choice === "shown" || choice === "hidden"),
    ) as ColumnChoices;
  } catch {
    return {};
  }
}

export function saveColumnChoices(spaceKey: string, choices: ColumnChoices) {
  try {
    localStorage.setItem(storageKey(spaceKey), JSON.stringify(choices));
  } catch {
    // Private mode or full storage: the choice lasts for this visit.
  }
}
