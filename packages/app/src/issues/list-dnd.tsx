"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type DropAnimation,
  type KeyboardCoordinateGetter,
  type Modifier,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import type { Doc, Id } from "@pantry/backend/dataModel";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { duration, ease, usePrefersReducedMotion } from "@pantry/ui/lib/motion";
import {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import type { IssueActions } from "./actions";
import { issueDrag } from "./drag-state";
import { statusColor, type ListIssue, type Lookups } from "./lookups";
import { plural } from "./quick-edit";
import {
  planColumnDrop,
  planProjectGroupDrop,
  slotIndex,
  type PlannedMove,
  type ProjectChange,
} from "./reorder";

/** A list section as the drag sees it: a status column, or a project's issues (by status). */
export type DropGroup =
  | { kind: "status"; id: string; name: string; status: Doc<"statuses">; issues: ListIssue[] }
  | {
      kind: "project";
      id: string;
      name: string;
      projectId: Id<"projects"> | null;
      issues: ListIssue[];
    };

/**
 * How the list is ordered. "manual": the space's own order (status, then the order people drag
 * into), so a drop lands exactly where the line shows. "updated": My issues, most recently updated
 * first, so there is no slot to drop into: dragging to another status group changes the status only.
 */
export type ListOrder = "manual" | "updated";

/** Where the dragged issues would land: a group and a slot among its other rows (manual order). */
type Target = {
  groupId: string;
  /** Null in "updated" order (the group, not a slot). */
  index: number | null;
  /** The indicator line's offset inside the group's section, in px. */
  top: number | null;
  /** Nothing would change (the issue's own place, or its own group in "updated" order). */
  same: boolean;
  /** Sub-issues that can't join the group's project (the drop explains why). */
  skipped: number;
};

type DropState = { target: Target | null; activeId: Id<"issues"> | null; order: ListOrder };

const DropContext = createContext<DropState>({ target: null, activeId: null, order: "manual" });

/** The row height (tokens: --row-height); keyboard drags move one row per arrow press. */
const ROW = 32;

/** Arrow keys move the lifted row a row at a time; Space picks it up and drops it, Esc cancels. */
const rowCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates }) => {
  if (event.code === KeyboardCode.Down) {
    event.preventDefault();
    return { ...currentCoordinates, y: currentCoordinates.y + ROW };
  }
  if (event.code === KeyboardCode.Up) {
    event.preventDefault();
    return { ...currentCoordinates, y: currentCoordinates.y - ROW };
  }
  return undefined;
};

/** Scroll the list only when the row nears its top or bottom edge. */
const AUTO_SCROLL = { threshold: { x: 0, y: 0.12 } };

/** Rows only move up and down: the lifted row stays in the list's column. */
const VERTICAL: Modifier[] = [({ transform }) => ({ ...transform, x: 0 })];

// Outside the component: useSensor memoises on the options object.
/** A few pixels of travel before a drag starts, so a click still opens the issue. */
const MOUSE_SENSOR = { activationConstraint: { distance: 5 } };
const KEYBOARD_SENSOR = {
  coordinateGetter: rowCoordinates,
  keyboardCodes: {
    start: [KeyboardCode.Space],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space, KeyboardCode.Enter],
  },
};

/**
 * Drag and drop for the issue list (spec §4): drag a row, or the selection, to reorder it inside
 * its status group or drop it on another group to change its status (grouped by status) or its
 * project (grouped by project). A line shows the slot; Esc cancels; Space picks the focused row up
 * from the keyboard and the arrows move it. Every change is an optimistic `issues.move` /
 * `issues.update`, rolled back if the server refuses.
 *
 * Touch keeps scrolling the list (and a long press opens the context menu), so only the mouse and
 * the keyboard drag.
 */
export function ListDragAndDrop({
  groups,
  ordered,
  selected,
  order,
  lookups,
  actions,
  container,
  children,
}: {
  groups: DropGroup[];
  ordered: ReadonlyArray<ListIssue>;
  selected: ReadonlySet<Id<"issues">>;
  order: ListOrder;
  lookups: Lookups;
  actions: IssueActions;
  container: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR),
  );
  const [activeId, setActiveId] = useState<Id<"issues"> | null>(null);
  const [count, setCount] = useState(1);
  const [target, setTarget] = useState<Target | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const moving = useRef<ListIssue[]>([]);
  const dragged = useRef<ListIssue | null>(null);
  const current = useRef<Target | null>(null);
  const dimmed = useRef<Element[]>([]);
  const statusOrder = useMemo(
    () => new Map(lookups.data.statuses.map((status, index) => [status._id, index])),
    [lookups.data.statuses],
  );

  const byId = (id: unknown) => ordered.find((issue) => issue._id === id);
  const groupById = (id: string) => groups.find((group) => group.id === id);
  const what = () =>
    moving.current.length === 1 ? moving.current[0]!.key : plural(moving.current.length, "issue");

  /** The plan for dropping the moving issues at `index` in `group` (manual order). */
  function plan(group: DropGroup, index: number) {
    if (group.kind === "status") {
      return {
        index,
        moves: planColumnDrop(group.issues, moving.current, group.status._id, index),
        changes: [] as ProjectChange[],
        skipped: 0,
      };
    }
    return planProjectGroupDrop(
      group.issues,
      moving.current,
      dragged.current ?? moving.current[0]!,
      group.projectId,
      index,
      statusOrder,
    );
  }

  /** The group and slot under the lifted row's centre, read from the DOM (rows are fixed height). */
  function locate(event: DragMoveEvent | DragEndEvent): Target | null {
    const rect = event.active.rect.current.translated;
    const root = container.current;
    if (!rect || !root) return null;
    // A keyboard step lands the centre exactly on a neighbour's midpoint: ties go the way it moves.
    const y = rect.top + rect.height / 2 + Math.sign(event.delta.y);
    const sections = [...root.querySelectorAll<HTMLElement>("[data-drop-group]")];
    if (sections.length === 0) return null;
    // The section under the point, else the nearest one (above the first, below the last).
    let section = sections.find((element) => {
      const box = element.getBoundingClientRect();
      return y >= box.top && y < box.bottom;
    });
    if (!section) {
      const first = sections[0]!.getBoundingClientRect();
      section = y < first.top ? sections[0]! : sections[sections.length - 1]!;
    }
    const group = groupById(section.dataset.dropGroup ?? "");
    if (!group) return null;

    const movingIds = new Set(moving.current.map((issue) => issue._id));
    if (order === "updated") {
      const same =
        group.kind === "status" &&
        moving.current.every((issue) => issue.statusId === group.status._id);
      return { groupId: group.id, index: null, top: null, same, skipped: 0 };
    }

    const rows = [...section.querySelectorAll<HTMLElement>("[data-issue-id]")].filter(
      (row) => !movingIds.has(row.dataset.issueId as Id<"issues">),
    );
    const raw = slotIndex(
      rows.map((row) => {
        const box = row.getBoundingClientRect();
        return box.top + box.height / 2;
      }),
      y,
    );
    const planned = plan(group, raw);
    const index = planned.index;
    // The line sits on the top edge of the row it goes before, or under the last row.
    const header = section.querySelector<HTMLElement>("[data-drop-header]");
    const top =
      index < rows.length
        ? rows[index]!.offsetTop
        : rows.length > 0
          ? rows[rows.length - 1]!.offsetTop + rows[rows.length - 1]!.offsetHeight
          : (header?.offsetHeight ?? 0);
    const same = planned.moves.length === 0 && planned.changes.length === 0;
    return { groupId: group.id, index, top, same, skipped: planned.skipped };
  }

  function onDragStart(event: DragStartEvent) {
    const id = event.active.id as Id<"issues">;
    const issue = byId(id);
    if (!issue) return;
    issueDrag.start();
    // A selected row carries the whole selection along, in list order.
    dragged.current = issue;
    moving.current = selected.has(id) ? ordered.filter((row) => selected.has(row._id)) : [issue];
    // The rows being moved fade in place (no list re-render).
    dimmed.current = moving.current
      .map((row) => container.current?.querySelector(`[data-issue-id="${row._id}"]`))
      .filter((element): element is Element => element !== null && element !== undefined);
    for (const element of dimmed.current) element.setAttribute("data-dragging", "");
    setActiveId(id);
    setCount(moving.current.length);
    setAnnouncement(
      `Picked up ${what()}. Use the arrow keys to move, Space to drop, Escape to cancel.`,
    );
  }

  function onDragMove(event: DragMoveEvent) {
    const next = locate(event);
    const previous = current.current;
    if (
      previous?.groupId === next?.groupId &&
      previous?.index === next?.index &&
      previous?.top === next?.top
    )
      return;
    current.current = next;
    setTarget(next);
    const group = next ? groupById(next.groupId) : undefined;
    if (group)
      setAnnouncement(
        next!.index === null
          ? `Over ${group.name}.`
          : `${group.name}, position ${next!.index + 1}.`,
      );
  }

  function finish() {
    for (const element of dimmed.current) element.removeAttribute("data-dragging");
    dimmed.current = [];
    current.current = null;
    setActiveId(null);
    setTarget(null);
    issueDrag.end();
  }

  function onDragEnd(event: DragEndEvent) {
    const drop = locate(event);
    const items = moving.current;
    finish();
    const group = drop ? groupById(drop.groupId) : undefined;
    if (drop?.same && drop.skipped > 0) {
      toast("Sub-issues are in their parent's project", {
        description: "Move the parent issue to another project instead.",
      });
      return;
    }
    if (!drop || !group || drop.same || items.length === 0) {
      setAnnouncement(`${what()} stayed where ${items.length === 1 ? "it was" : "they were"}.`);
      return;
    }

    if (order === "updated") {
      // My issues: only a status change, each landing on top of its new column.
      if (group.kind !== "status") return;
      const changing = items.filter((issue) => issue.statusId !== group.status._id);
      for (const issue of [...changing].reverse()) void actions.move(issue._id, group.status._id);
      if (changing.length > 1)
        toast(`Moved ${plural(changing.length, "issue")} to ${group.status.name}`);
      setAnnouncement(`Moved ${what()} to ${group.name}.`);
      return;
    }

    const planned = plan(group, drop.index ?? 0);
    apply(actions, planned.moves, planned.changes);
    if (planned.skipped > 0)
      toast("Sub-issues are in their parent's project", {
        description:
          planned.skipped === items.length
            ? "Move the parent issue to another project instead."
            : `${plural(planned.skipped, "sub-issue")} stayed with ${planned.skipped === 1 ? "its parent" : "their parents"}.`,
      });
    else if (items.length > 1 && group.kind === "status" && planned.moves.length > 0)
      toast(`Moved ${plural(items.length, "issue")} to ${group.name}`);
    setAnnouncement(`Dropped ${what()} in ${group.name}.`);
  }

  const dropAnimation: DropAnimation | null = reduceMotion
    ? null
    : {
        duration: duration.fast * 1000,
        easing: `cubic-bezier(${ease.out.join(", ")})`,
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
      };

  const active = activeId ? byId(activeId) : undefined;
  const state = useMemo(() => ({ target, activeId, order }), [target, activeId, order]);

  return (
    <DndContext
      sensors={sensors}
      modifiers={VERTICAL}
      autoScroll={AUTO_SCROLL}
      onDragStart={onDragStart}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        finish();
        setAnnouncement(`Moving ${what()} was cancelled.`);
      }}
      accessibility={{
        // Positions are announced from the live region below (the list has no drop zones).
        announcements: {
          onDragStart: () => undefined,
          onDragOver: () => undefined,
          onDragEnd: () => undefined,
          onDragCancel: () => undefined,
        },
        screenReaderInstructions: {
          draggable:
            order === "manual"
              ? "Press Space to pick the issue up, the arrow keys to move it and Space to drop it; Escape cancels. Selected issues move together."
              : "Press Space to pick the issue up, the arrow keys to move it to another status and Space to drop it; Escape cancels.",
        },
      }}
    >
      <DropContext value={state}>{children}</DropContext>
      <span className="sr-only" aria-live="assertive" role="status">
        {announcement}
      </span>
      <DragOverlay dropAnimation={dropAnimation}>
        {active ? <LiftedRow issue={active} count={count} lookups={lookups} /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function apply(actions: IssueActions, moves: PlannedMove[], changes: ProjectChange[]) {
  for (const change of changes)
    void actions.update(change.issueId, { projectId: change.projectId });
  for (const move of moves) void actions.move(move.issueId, move.statusId, move.placement);
}

/**
 * The row under the pointer: a raised copy (a shadow, no scale: rows are as wide as the list), with
 * the number of issues when it carries several.
 */
function LiftedRow({
  issue,
  count,
  lookups,
}: {
  issue: ListIssue;
  count: number;
  lookups: Lookups;
}) {
  const status = lookups.status(issue.statusId);
  return (
    <div className="relative cursor-grabbing">
      {count > 1 && (
        // The rest of the selection, as the edge of a stack under the row.
        <span
          aria-hidden
          className="bg-popover shadow-raised absolute inset-x-1.5 -bottom-1 h-full rounded-md"
        />
      )}
      <div className="bg-popover shadow-overlay text-foreground relative flex h-(--row-height) items-center gap-2 rounded-md px-3 text-sm">
        <PriorityGlyph priority={issue.priority} />
        <IssueKey value={issue.key} className="w-14 shrink-0" />
        {status && <StatusGlyph category={status.category} color={statusColor(status)} />}
        <span className="min-w-0 flex-1 truncate">{issue.title}</span>
        {count > 1 && (
          <span className="bg-primary text-primary-foreground tabular rounded-full px-1.5 font-mono text-xs leading-5">
            {count}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * A row's drag wiring: the whole row is the handle (5px of travel before it lifts, so clicks open
 * the issue). The row's link keeps the focus, so the keyboard description goes on it.
 */
export function useRowDrag(id: Id<"issues">) {
  const { setNodeRef, listeners, attributes } = useDraggable({ id });
  return {
    ref: setNodeRef,
    listeners,
    focusProps: {
      "aria-roledescription": "draggable issue",
      "aria-describedby": attributes["aria-describedby"],
    },
  };
}

/** The drop line inside a group's section (the section is `relative`). */
export function GroupDropIndicator({ groupId }: { groupId: string }) {
  const { target } = useContext(DropContext);
  if (target?.groupId !== groupId || target.top === null || target.same) return null;
  return (
    <div
      aria-hidden
      className="bg-foreground pointer-events-none absolute inset-x-2 z-30 h-0.5 -translate-y-1/2 rounded-full"
      style={{ top: target.top }}
    />
  );
}

/**
 * Whether a group is where the drag would drop, and the hint its header shows ("Drop to move to In
 * Progress" in My issues, where the group, not a slot, is the target).
 */
export function useGroupDrop(groupId: string): { over: boolean; hint: string | null } {
  const { target, activeId, order } = useContext(DropContext);
  const over = activeId !== null && target?.groupId === groupId && !target.same;
  return { over, hint: over && order === "updated" ? "Drop to move here" : null };
}
