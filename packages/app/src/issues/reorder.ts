import type { Id } from "@pantry/backend/dataModel";

/**
 * Drag-and-drop ordering for the list and the board (spec §10b ordering). Issues are ordered inside
 * their status column by `sortOrder`; `issues.move` places an issue right after `afterId` (or right
 * before `beforeId`) and changes its status when the column is another one. These pure planners turn
 * "drop these issues here" into those calls, so list and board share one model.
 */

type Row = { _id: Id<"issues">; statusId: Id<"statuses"> };
type ProjectRow = Row & { projectId?: Id<"projects">; parentId?: Id<"issues"> };

export type Placement = { afterId?: Id<"issues">; beforeId?: Id<"issues"> };
export type PlannedMove = { issueId: Id<"issues">; statusId: Id<"statuses">; placement: Placement };
export type ProjectChange = { issueId: Id<"issues">; projectId: Id<"projects"> | null };

const placement = (afterId?: Id<"issues">, beforeId?: Id<"issues">): Placement => ({
  ...(afterId ? { afterId } : {}),
  ...(beforeId ? { beforeId } : {}),
});

/**
 * Put `moving` (in this order) into a status column at `index`, counted among the column's issues
 * that aren't moving. `column` is the column as shown, top to bottom; it may already hold some of
 * the moving issues. The first lands between its new neighbours, each next one right after the one
 * before, so a multi-selection stays together and in order (Convex runs one client's mutations in
 * order, and each optimistic move sees the previous one). Returns no moves when nothing would change.
 */
export function planColumnDrop(
  column: ReadonlyArray<Row>,
  moving: ReadonlyArray<Row>,
  statusId: Id<"statuses">,
  index: number,
): PlannedMove[] {
  if (moving.length === 0) return [];
  const ids = new Set(moving.map((issue) => issue._id));
  const others = column.filter((issue) => !ids.has(issue._id));
  const at = Math.max(0, Math.min(index, others.length));
  const result = [...others.slice(0, at), ...moving, ...others.slice(at)];
  const unchanged =
    moving.every((issue) => issue.statusId === statusId) &&
    result.length === column.length &&
    result.every((issue, position) => issue._id === column[position]!._id);
  if (unchanged) return [];
  const before = others[at]?._id;
  return moving.map((issue, position) => ({
    issueId: issue._id,
    statusId,
    placement:
      position === 0
        ? placement(others[at - 1]?._id, before)
        : placement(moving[position - 1]!._id, before),
  }));
}

/**
 * A drop on a project group (the list grouped by project, or a board lane): the issues join that
 * project. Sub-issues can't (they follow their parent), so they're skipped and counted.
 */
export function planProjectChange(
  moving: ReadonlyArray<ProjectRow>,
  projectId: Id<"projects"> | null,
): { changes: ProjectChange[]; skipped: number } {
  const differs = moving.filter((issue) => (issue.projectId ?? null) !== projectId);
  const changes = differs
    .filter((issue) => issue.parentId === undefined)
    .map((issue) => ({ issueId: issue._id, projectId }));
  return { changes, skipped: differs.length - changes.length };
}

/**
 * The list grouped by project shows each project's issues by status, then manual order. Dragging
 * there changes the project, never the status: the drop slot is kept inside the dragged issue's
 * status block in the target group (`index` and the returned `index` count the group's issues that
 * aren't moving). Moving issues of that status are placed at the slot; the others keep their place
 * in their own columns.
 */
export function planProjectGroupDrop(
  group: ReadonlyArray<ProjectRow>,
  moving: ReadonlyArray<ProjectRow>,
  dragged: ProjectRow,
  projectId: Id<"projects"> | null,
  index: number,
  statusOrder: ReadonlyMap<Id<"statuses">, number>,
): { index: number; moves: PlannedMove[]; changes: ProjectChange[]; skipped: number } {
  const ids = new Set(moving.map((issue) => issue._id));
  const others = group.filter((issue) => !ids.has(issue._id));
  const rank = (issue: Row) => statusOrder.get(issue.statusId) ?? 0;
  const status = dragged.statusId;
  const lo = others.filter((issue) => rank(issue) < rank(dragged)).length;
  const hi = lo + others.filter((issue) => issue.statusId === status).length;
  const at = Math.max(lo, Math.min(index, hi));
  const { changes, skipped } = planProjectChange(moving, projectId);
  // Only the issues that end up in this group are placed among its rows.
  const changing = new Set(changes.map((change) => change.issueId));
  const arriving = moving.filter(
    (issue) =>
      issue.statusId === status &&
      ((issue.projectId ?? null) === projectId || changing.has(issue._id)),
  );
  const column = group.filter((issue) => issue.statusId === status);
  // No issue of that status in the group: there's no neighbour to place against, so the order stays.
  const moves = hi > lo ? planColumnDrop(column, arriving, status, at - lo) : [];
  return { index: at, moves, changes, skipped };
}

/** The index of the slot a point falls in, given the midpoints of the rows in order. */
export function slotIndex(midpoints: ReadonlyArray<number>, y: number): number {
  const index = midpoints.findIndex((mid) => y < mid);
  return index < 0 ? midpoints.length : index;
}
