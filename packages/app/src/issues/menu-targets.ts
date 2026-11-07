import type { Id } from "@pantry/backend/dataModel";

/**
 * What a right-click acts on. On a selected issue: the whole selection, in on-screen order (issues
 * selected but no longer on screen are left out). On any other issue: that issue alone, even while
 * others are selected. On an issue that isn't on screen: nothing.
 */
export function menuTargets(
  onScreen: ReadonlyArray<Id<"issues">>,
  clicked: Id<"issues">,
  selected: ReadonlySet<Id<"issues">> | undefined,
): Id<"issues">[] {
  if (!onScreen.includes(clicked)) return [];
  if (!selected?.has(clicked)) return [clicked];
  return onScreen.filter((id) => selected.has(id));
}
