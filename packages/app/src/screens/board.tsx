"use client";

import {
  closestCenter,
  defaultDropAnimationSideEffects,
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import type { Doc, Id } from "@pantry/backend/dataModel";
import type { Project } from "@pantry/backend/model";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { Button } from "@pantry/ui/components/button";
import { Checkbox } from "@pantry/ui/components/checkbox";
import { IssueKey } from "@pantry/ui/components/issue-key";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { PRIORITY_LABEL, resolveLabelColor } from "@pantry/ui/lib/issue-meta";
import { duration, ease, motion, spring, usePrefersReducedMotion } from "@pantry/ui/lib/motion";
import { cn } from "@pantry/ui/lib/utils";
import {
  CalendarIcon,
  CornerDownRightIcon,
  EyeOffIcon,
  LayersIcon,
  MoreHorizontalIcon,
  PlusIcon,
} from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { EntryGate } from "../entry";
import { useIssueActions } from "../issues/actions";
import {
  hiddenColumns,
  readColumnChoices,
  saveColumnChoices,
  type ColumnChoices,
} from "../issues/board-columns";
import { issueDrag } from "../issues/drag-state";
import { IssueContextMenu } from "../issues/issue-menu";
import { statusColor, type Lookups, type ListIssue } from "../issues/lookups";
import { plural } from "../issues/quick-edit";
import { planColumnDrop, planProjectChange, type PlannedMove } from "../issues/reorder";
import { useIssueSelection } from "../issues/selection";
import { SubIssueProgress } from "../issues/sub-issue-progress";
import { formatDay, today } from "../lib/format";
import { routes, useNavigation } from "../navigation";
import { AppShell } from "../shell/app-shell";
import { projectColor } from "../shell/space-color";
import { NotMemberScreen } from "./not-member";
import { SpaceIssues, useIssueFamily, type BoardProps } from "./space";
import { SpaceNotFound, SpaceTitle } from "./space-chrome";

/** A space's board (spec §4): a column per status, drag to move; optional project swimlanes. */
export function BoardPage({ spaceKey }: { spaceKey: string }) {
  return (
    <EntryGate allow={["ready", "not-member"]}>
      {(state) =>
        state.kind === "not-member" ? (
          <NotMemberScreen />
        ) : (
          <AppShell title={(data) => <SpaceTitle data={data} spaceKey={spaceKey} view="board" />}>
            {(data) => {
              const space = data.spaces.find((row) => row.key === spaceKey);
              if (!space) return <SpaceNotFound spaceKey={spaceKey} />;
              return (
                <SpaceIssues
                  key={space._id}
                  data={data}
                  space={space}
                  view="board"
                  renderBoard={(props) => <Board {...props} />}
                />
              );
            }}
          </AppShell>
        )
      }
    </EntryGate>
  );
}

/**
 * A swimlane: one per project of the space plus "none" when grouped by project, else one "all".
 * Every column and card carries its lane, so a drop knows its project as well as its status.
 */
type Lane = { id: string; project: Project | null | undefined };

/** Where a dragged card would land: a lane, a status column and an index among the other cards. */
type Target = { lane: string; statusId: Id<"statuses">; index: number; hidden?: boolean };
type DropData = { lane: string; statusId: Id<"statuses">; hidden?: boolean };

const columnId = (lane: string, statusId: Id<"statuses">) => `column:${lane}:${statusId}`;
const hiddenId = (statusId: Id<"statuses">) => `hidden:${statusId}`;
const cellKey = (lane: string, statusId: Id<"statuses">) => `${lane}:${statusId}`;

/**
 * The card (or hidden column) under the pointer wins over the column that contains it
 * (pointerWithin returns both, in no useful order); the column alone means the empty space below
 * its cards. The keyboard sensor has no pointer, so it falls back to the nearest centre.
 */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const cards = hits.filter((hit) => !String(hit.id).startsWith("column:"));
  if (cards.length > 0) return cards;
  return hits.length > 0 ? hits : closestCenter(args);
};

/**
 * Scroll only when the card is near an edge (dnd-kit's default starts a fifth of the way in, so the
 * board slid away while you aimed at a column in the middle).
 */
const AUTO_SCROLL = { threshold: { x: 0.08, y: 0.12 } };

// Sensor options live outside the component: useSensor memoises on the options object, and new
// sensors on every render would change dnd-kit's context and re-render every card.
/** A few pixels of travel before a drag starts, so clicks still open the issue. */
const MOUSE_SENSOR = { activationConstraint: { distance: 5 } };
/** On touch, hold a moment to lift a card; a plain swipe still scrolls the board. */
const TOUCH_SENSOR = { activationConstraint: { delay: 250, tolerance: 6 } };
/** Space picks a card up and drops it; Enter stays free to open the issue. */
const KEYBOARD_SENSOR = {
  keyboardCodes: {
    start: [KeyboardCode.Space],
    cancel: [KeyboardCode.Esc],
    end: [KeyboardCode.Space, KeyboardCode.Enter],
  },
};

/** Hidden and shown columns, per space, saved on this device (board-columns.ts). */
function useColumns(
  spaceKey: string,
  statuses: Doc<"statuses">[],
  counts: Map<Id<"statuses">, number>,
) {
  const [choices, setChoices] = useState<ColumnChoices>(() => readColumnChoices(spaceKey));
  // Columns that have had cards during this visit stay put when they empty.
  const [seen] = useState(() => new Set<Id<"statuses">>());
  for (const [id, count] of counts) if (count > 0) seen.add(id);
  const hidden = hiddenColumns(
    statuses.map((status) => status._id),
    counts,
    choices,
    seen,
  );
  const choose = (statusId: Id<"statuses">, choice: "shown" | "hidden") =>
    setChoices((current) => {
      const next = { ...current, [statusId]: choice };
      saveColumnChoices(spaceKey, next);
      return next;
    });
  return { hidden, choose };
}

function Board({ issues, lookups, space, newIssue, groupBy }: BoardProps) {
  const actions = useIssueActions();
  const family = useIssueFamily(issues);
  const reduceMotion = usePrefersReducedMotion();
  const statuses = lookups.data.statuses;
  const [activeId, setActiveId] = useState<Id<"issues"> | null>(null);
  const [moving, setMoving] = useState<ReadonlySet<Id<"issues">>>(new Set());
  const [target, setTarget] = useState<Target | null>(null);
  const justDropped = useRef(0);
  const container = useRef<HTMLDivElement>(null);

  const projects = lookups.projectsOf(space._id);
  const lanes = useMemo<Lane[]>(
    () =>
      groupBy === "project"
        ? [
            ...projects.map((project) => ({ id: project._id as string, project })),
            { id: "none", project: null },
          ]
        : [{ id: "all", project: undefined }],
    [groupBy, projects],
  );
  const laneOf = useCallback(
    (issue: ListIssue) =>
      groupBy !== "project"
        ? "all"
        : issue.projectId && projects.some((p) => p._id === issue.projectId)
          ? issue.projectId
          : "none",
    [groupBy, projects],
  );

  // Cells in list order. A drop shows at once: issues.move/update are optimistic, so `issues`
  // already has the card in its new place (and Convex puts it back if the server refuses).
  const columns = useMemo(() => {
    const cells = new Map<string, ListIssue[]>();
    for (const lane of lanes)
      for (const status of statuses) cells.set(cellKey(lane.id, status._id), []);
    for (const issue of issues) cells.get(cellKey(laneOf(issue), issue.statusId))?.push(issue);
    return cells;
  }, [issues, statuses, lanes, laneOf]);
  const cell = (lane: string, statusId: Id<"statuses">) =>
    columns.get(cellKey(lane, statusId)) ?? [];
  const counts = useMemo(() => {
    const result = new Map<Id<"statuses">, number>();
    for (const issue of issues) result.set(issue.statusId, (result.get(issue.statusId) ?? 0) + 1);
    return result;
  }, [issues]);
  const { hidden, choose } = useColumns(space.key, statuses, counts);
  const shown = statuses.filter((status) => !hidden.has(status._id));
  const hiddenStatuses = statuses.filter((status) => hidden.has(status._id));
  // Same set, same identity: `ordered` (and the selection) only change when the hidden columns do.
  const hiddenKey = [...hidden].join();
  const hiddenIds = useMemo(
    () => new Set(hiddenKey ? (hiddenKey.split(",") as Id<"statuses">[]) : []),
    [hiddenKey],
  );

  // J/K walk the board lane by lane, column by column, top to bottom (hidden columns are skipped).
  const ordered = useMemo(
    () =>
      lanes.flatMap((lane) =>
        statuses
          .filter((status) => !hiddenIds.has(status._id))
          .flatMap((status) => columns.get(cellKey(lane.id, status._id)) ?? []),
      ),
    [lanes, statuses, columns, hiddenIds],
  );
  const selection = useIssueSelection({ ordered, lookups, actions, container });
  const { cursor, selected, setCursor, toggle } = selection.value;

  const sensors = useSensors(
    useSensor(MouseSensor, MOUSE_SENSOR),
    useSensor(TouchSensor, TOUCH_SENSOR),
    useSensor(KeyboardSensor, KEYBOARD_SENSOR),
  );

  const issueById = (id: unknown) => issues.find((issue) => issue._id === id);
  const statusName = (id: Id<"statuses"> | undefined) =>
    statuses.find((status) => status._id === id)?.name ?? "";

  /** Column + index for the dragged card's current position (its centre against the card under it). */
  function locate(event: DragMoveEvent | DragOverEvent | DragEndEvent): Target | null {
    const { active, over } = event;
    if (!over) return null;
    const overData = over.data.current as DropData | undefined;
    if (!overData) return null;
    const dragged = issueById(active.id);
    // A hidden column: to the top of it, in the card's own lane.
    if (overData.hidden)
      return {
        lane: dragged ? laneOf(dragged) : "all",
        statusId: overData.statusId,
        index: 0,
        hidden: true,
      };
    const rect = active.rect.current.translated;
    const centerY = rect ? rect.top + rect.height / 2 : 0;
    const { lane, statusId } = overData;
    const others = cell(lane, statusId).filter((issue) => !moving.has(issue._id));
    // Over its own slot (or another moving card): stay put.
    if (moving.has(over.id as Id<"issues">)) {
      const column = cell(lane, statusId);
      const at = column.findIndex((issue) => issue._id === over.id);
      return {
        lane,
        statusId,
        index: column.slice(0, at).filter((issue) => !moving.has(issue._id)).length,
      };
    }
    if (String(over.id).startsWith("column:")) return { lane, statusId, index: others.length };
    const index = others.findIndex((issue) => issue._id === over.id);
    if (index < 0) return { lane, statusId, index: others.length };
    const below = centerY > over.rect.top + over.rect.height / 2;
    return { lane, statusId, index: index + (below ? 1 : 0) };
  }

  function onDragStart(event: DragStartEvent) {
    const id = event.active.id as Id<"issues">;
    issueDrag.start();
    // A selected card carries the whole selection along, in board order.
    setMoving(
      new Set(
        selected.has(id)
          ? ordered.filter((row) => selected.has(row._id)).map((row) => row._id)
          : [id],
      ),
    );
    setActiveId(id);
  }

  // `over` on move events can lag a step behind the pointer, so over-changes update it too and the
  // drop is located again from the final event.
  function onDragMove(event: DragMoveEvent | DragOverEvent) {
    const next = locate(event);
    setTarget((current) =>
      current?.lane === next?.lane &&
      current?.statusId === next?.statusId &&
      current?.index === next?.index &&
      current?.hidden === next?.hidden
        ? current
        : next,
    );
  }

  function finish() {
    setActiveId(null);
    setMoving(new Set());
    setTarget(null);
    issueDrag.end();
  }

  function onDragEnd(event: DragEndEvent) {
    // Dropped outside every column: nothing moves.
    const drop = event.over ? locate(event) : null;
    const items = ordered.filter((issue) => moving.has(issue._id));
    const single = items.length === 1;
    finish();
    justDropped.current = Date.now();
    if (!drop || items.length === 0) return;

    // Into another project's lane: the project changes too. Sub-issues follow their parent.
    const project = lanes.find((lane) => lane.id === drop.lane)?.project;
    const changes =
      project === undefined || drop.hidden
        ? { changes: [], skipped: 0 }
        : planProjectChange(items, project?._id ?? null);
    const changing = new Set(changes.changes.map((change) => change.issueId));
    // The cards that end up in the target lane are placed there; any that can't change lane still
    // take the new status, at the top of their own column.
    const arriving = items.filter(
      (issue) => laneOf(issue) === drop.lane || changing.has(issue._id) || drop.hidden,
    );
    const staying = items.filter((issue) => !arriving.includes(issue));
    if (single && changes.skipped > 0) {
      toast("Sub-issues are in their parent's project", {
        description: "Move the parent issue to another project instead.",
      });
      return;
    }
    const moves: PlannedMove[] = drop.hidden
      ? arriving
          .filter((issue) => issue.statusId !== drop.statusId)
          .reverse()
          .map((issue) => ({ issueId: issue._id, statusId: drop.statusId, placement: {} }))
      : planColumnDrop(cell(drop.lane, drop.statusId), arriving, drop.statusId, drop.index);
    for (const issue of [...staying].reverse())
      if (issue.statusId !== drop.statusId)
        moves.push({ issueId: issue._id, statusId: drop.statusId, placement: {} });

    for (const change of changes.changes)
      void actions.update(change.issueId, { projectId: change.projectId });
    for (const move of moves) void actions.move(move.issueId, move.statusId, move.placement);

    if (changes.skipped > 0)
      toast(
        `${plural(changes.skipped, "sub-issue")} stayed with ${changes.skipped === 1 ? "its parent" : "their parents"}`,
        {
          description: "Sub-issues are in their parent's project.",
        },
      );
    else if (!single && (moves.length > 0 || changes.changes.length > 0))
      toast(`Moved ${plural(items.length, "issue")} to ${statusName(drop.statusId)}`);
    else if (drop.hidden && moves.length > 0)
      toast(`Moved ${items[0]!.key} to ${statusName(drop.statusId)}`, {
        description: "That column is hidden. Show it from Hidden columns.",
      });
  }

  const place = (data: unknown) => {
    const { lane, statusId } = data as DropData;
    const project = lanes.find((row) => row.id === lane)?.project;
    return project === undefined
      ? statusName(statusId)
      : `${statusName(statusId)}, ${project?.name ?? "no project"}`;
  };
  const what = (id: unknown) =>
    moving.size > 1 ? plural(moving.size, "issue") : (issueById(id)?.key ?? "issue");
  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${what(active.id)}.`,
    onDragOver: ({ active, over }) =>
      over ? `${what(active.id)} is over ${place(over.data.current)}.` : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `Dropped ${what(active.id)} in ${place(over.data.current)}.`
        : `Dropped ${what(active.id)}.`,
    onDragCancel: ({ active }) => `Moving ${what(active.id)} was cancelled.`,
  };

  // The lifted card settles into its slot on the standard duration and entrance ease; with reduced
  // motion it's placed at once.
  const dropAnimation: DropAnimation | null = reduceMotion
    ? null
    : {
        duration: duration.standard * 1000,
        easing: `cubic-bezier(${ease.out.join(", ")})`,
        sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0" } } }),
      };

  const active = activeId ? issueById(activeId) : undefined;
  const renderCard = (lane: string) =>
    function render(issue: ListIssue) {
      return (
        <Card
          issue={issue}
          lane={lane}
          lookups={lookups}
          parentKey={issue.parentId ? family.byId.get(issue.parentId)?.key : undefined}
          subIssues={family.children.get(issue._id)}
          placeholder={moving.has(issue._id)}
          justDropped={justDropped}
          isCursor={cursor === issue._id}
          isSelected={selected.has(issue._id)}
          anySelected={selected.size > 0}
          onCursor={setCursor}
          onToggle={toggle}
        />
      );
    };
  const hiddenRail = hiddenStatuses.length > 0 && (
    <HiddenColumns
      statuses={hiddenStatuses}
      counts={counts}
      dragging={activeId !== null}
      over={target?.hidden ? target.statusId : null}
      onShow={(statusId) => choose(statusId, "shown")}
    />
  );

  return (
    <IssueContextMenu issues={ordered} selected={selected} lookups={lookups} actions={actions}>
      <DndContext
        sensors={sensors}
        autoScroll={AUTO_SCROLL}
        collisionDetection={collision}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragOver={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Press Space to pick the issue up, the arrow keys to move it and Space to drop it; Escape cancels. Selected issues move together. Enter opens the issue.",
          },
        }}
      >
        {groupBy === "project" ? (
          <div
            ref={container}
            className="min-h-0 flex-1 overflow-auto overscroll-x-contain px-4 pb-3"
          >
            {/* Status headers once, above every lane. */}
            <div className="bg-background sticky top-0 z-20 flex w-max items-start gap-4 pt-2 pb-1">
              {shown.map((status) => (
                <ColumnHeader
                  key={status._id}
                  status={status}
                  count={counts.get(status._id) ?? 0}
                  onNewIssue={() => newIssue({ statusId: status._id })}
                  onHide={() => choose(status._id, "hidden")}
                  className="w-72"
                />
              ))}
              {hiddenRail}
            </div>
            {lanes.map((lane) => {
              const name = lane.project?.name ?? "No project";
              const count = statuses.reduce(
                (sum, status) => sum + cell(lane.id, status._id).length,
                0,
              );
              return (
                <section key={lane.id} aria-label={name} className="mt-3">
                  <div className="group/lane sticky left-0 flex h-8 w-fit items-center gap-2 px-1">
                    {lane.project ? (
                      <span
                        className="size-2.5 rounded-[3px]"
                        style={{ background: projectColor(lane.project) }}
                        aria-hidden
                      />
                    ) : (
                      <LayersIcon className="text-muted-foreground size-3.5" aria-hidden />
                    )}
                    <h2 className="text-foreground font-sans text-sm font-medium tracking-normal">
                      {name}
                    </h2>
                    <span className="text-muted-foreground tabular font-mono text-xs">{count}</span>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`New issue in ${name}`}
                      onClick={() => newIssue(lane.project ? { projectId: lane.project._id } : {})}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                  <div className="flex w-max gap-4">
                    {shown.map((status) => (
                      <Column
                        key={status._id}
                        lane={lane.id}
                        laneName={name}
                        status={status}
                        issues={cell(lane.id, status._id)}
                        moving={moving}
                        indicator={
                          target?.lane === lane.id &&
                          target.statusId === status._id &&
                          !target.hidden
                            ? target.index
                            : null
                        }
                        onNewIssue={() =>
                          newIssue({
                            statusId: status._id,
                            ...(lane.project ? { projectId: lane.project._id } : {}),
                          })
                        }
                        header={false}
                      >
                        {renderCard(lane.id)}
                      </Column>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        ) : (
          <div
            ref={container}
            className="flex min-h-0 flex-1 gap-4 overflow-x-auto overscroll-x-contain px-4 pt-2 pb-3"
          >
            {shown.map((status) => (
              <Column
                key={status._id}
                lane="all"
                status={status}
                issues={cell("all", status._id)}
                moving={moving}
                indicator={target?.statusId === status._id && !target.hidden ? target.index : null}
                onNewIssue={() => newIssue({ statusId: status._id })}
                onHide={() => choose(status._id, "hidden")}
              >
                {renderCard("all")}
              </Column>
            ))}
            {hiddenRail}
          </div>
        )}
        <DragOverlay dropAnimation={dropAnimation}>
          {active ? (
            <motion.div
              initial={reduceMotion ? false : { scale: 1, rotate: 0 }}
              animate={reduceMotion ? undefined : { scale: 1.02, rotate: -1 }}
              transition={spring.snappy}
              className="relative cursor-grabbing"
            >
              {moving.size > 1 && (
                // The rest of the selection: edges of a stack under the lifted card.
                <span
                  aria-hidden
                  className="border-border bg-popover dark:bg-gray-2 absolute inset-x-1.5 -bottom-1.5 h-full rounded-md border"
                />
              )}
              <CardBody
                issue={active}
                lookups={lookups}
                parentKey={active.parentId ? family.byId.get(active.parentId)?.key : undefined}
                subIssues={family.children.get(active._id)}
                lifted
              />
              {moving.size > 1 && (
                <span className="bg-primary text-primary-foreground tabular absolute -top-2 -right-2 rounded-full px-1.5 font-mono text-xs leading-5">
                  {moving.size}
                </span>
              )}
            </motion.div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {selection.element}
    </IssueContextMenu>
  );
}

/**
 * A column's header, Linear-style: one quiet line (status glyph, name, muted count). "+" and "…"
 * (hide the column) appear on hover, on keyboard focus, or while the menu is open.
 */
function ColumnHeader({
  status,
  count,
  onNewIssue,
  onHide,
  className,
}: {
  status: Doc<"statuses">;
  count: number;
  onNewIssue: () => void;
  onHide?: () => void;
  className?: string;
}) {
  const reveal =
    "opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100 transition-opacity duration-(--duration-instant)";
  return (
    <div className={cn("group/header flex h-9 shrink-0 items-center gap-2 px-1", className)}>
      <StatusGlyph category={status.category} color={statusColor(status)} />
      <h2 className="text-foreground truncate font-sans text-sm font-medium tracking-normal">
        {status.name}
      </h2>
      <span className="text-muted-foreground tabular text-sm">{count}</span>
      <span className="ml-auto flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-xs"
          className={cn("text-muted-foreground", reveal)}
          aria-label={`New issue in ${status.name}`}
          title="New issue"
          onClick={onNewIssue}
        >
          <PlusIcon />
        </Button>
        {onHide && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className={cn("text-muted-foreground", reveal)}
                  aria-label={`${status.name} column actions`}
                />
              }
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={onNewIssue}>
                <PlusIcon />
                New issue
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onHide}>
                <EyeOffIcon />
                Hide column
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </span>
    </div>
  );
}

function Column({
  lane,
  laneName,
  status,
  issues,
  moving,
  indicator,
  onNewIssue,
  onHide,
  header = true,
  children,
}: {
  lane: string;
  laneName?: string;
  status: Doc<"statuses">;
  issues: ListIssue[];
  moving: ReadonlySet<Id<"issues">>;
  indicator: number | null;
  onNewIssue: () => void;
  onHide?: () => void;
  /** Swimlanes show the status headers once, above the lanes. */
  header?: boolean;
  children: (issue: ListIssue) => ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: columnId(lane, status._id),
    data: { lane, statusId: status._id },
  });
  // The indicator index counts the other cards, so skip the moving ones when placing it.
  const others = issues.filter((issue) => !moving.has(issue._id));
  const indicatorBefore = indicator !== null ? (others[indicator]?._id ?? "end") : null;
  return (
    // No box around the column: the cards are the surface. A drag over it tints it faintly.
    <section
      aria-label={laneName ? `${laneName}, ${status.name}` : status.name}
      className={cn(
        "group/column -mx-1 flex w-72 shrink-0 flex-col rounded-lg px-1 transition-colors duration-(--duration-instant)",
        header && "max-h-full",
        isOver && "bg-gray-2 dark:bg-gray-2",
      )}
    >
      {header && (
        <ColumnHeader
          status={status}
          count={issues.length}
          onNewIssue={onNewIssue}
          onHide={onHide}
        />
      )}
      <div
        ref={setNodeRef}
        className={cn(
          "flex flex-col gap-1.5 pb-2",
          header ? "min-h-24 flex-1 overflow-y-auto" : "min-h-14 pt-1",
        )}
      >
        {issues.map((issue) => (
          <div key={issue._id} className="relative">
            {indicatorBefore === issue._id && <DropIndicator />}
            {children(issue)}
          </div>
        ))}
        {indicatorBefore === "end" && (
          <div className="relative">
            <DropIndicator />
          </div>
        )}
        {issues.length === 0 && (
          <button
            type="button"
            onClick={onNewIssue}
            // Quiet until you point at the empty column (or tab to it).
            className="text-muted-foreground hover:bg-gray-2 flex h-8 cursor-default items-center justify-center gap-1.5 rounded-md text-xs opacity-0 transition-[opacity,background-color] duration-(--duration-instant) group-hover/column:opacity-100 focus-visible:opacity-100"
          >
            <PlusIcon className="size-3.5" aria-hidden />
            New issue
          </button>
        )}
      </div>
    </section>
  );
}

/** Where the card will land: a line in the gap above the card, so nothing shifts while you drag. */
function DropIndicator() {
  return (
    <div
      aria-hidden
      className="bg-foreground pointer-events-none absolute inset-x-0 -top-1 z-10 h-0.5 rounded-full"
    />
  );
}

/**
 * Hidden columns (empty ones start here, like Linear's board): a narrow list at the end of the
 * board. Click one to show it again; drop a card on one to move it there.
 */
function HiddenColumns({
  statuses,
  counts,
  dragging,
  over,
  onShow,
}: {
  statuses: Doc<"statuses">[];
  counts: Map<Id<"statuses">, number>;
  dragging: boolean;
  over: Id<"statuses"> | null;
  onShow: (statusId: Id<"statuses">) => void;
}) {
  return (
    <section aria-label="Hidden columns" className="flex w-56 shrink-0 flex-col gap-0.5 self-start">
      <h2 className="text-muted-foreground flex h-9 items-center px-2 font-sans text-sm font-medium tracking-normal">
        Hidden columns
      </h2>
      {statuses.map((status) => (
        <HiddenColumn
          key={status._id}
          status={status}
          count={counts.get(status._id) ?? 0}
          dragging={dragging}
          over={over === status._id}
          onShow={() => onShow(status._id)}
        />
      ))}
    </section>
  );
}

function HiddenColumn({
  status,
  count,
  dragging,
  over,
  onShow,
}: {
  status: Doc<"statuses">;
  count: number;
  dragging: boolean;
  over: boolean;
  onShow: () => void;
}) {
  const { setNodeRef } = useDroppable({
    id: hiddenId(status._id),
    data: { lane: "", statusId: status._id, hidden: true } satisfies DropData,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onShow}
      title={`Show ${status.name}`}
      aria-label={`${status.name}, ${count} ${count === 1 ? "issue" : "issues"}. Show column`}
      className={cn(
        "text-muted-foreground hover:bg-gray-2 hover:text-foreground flex h-8 cursor-default items-center gap-2 rounded-md border border-transparent px-2 text-sm transition-colors duration-(--duration-instant)",
        dragging && "border-border border-dashed",
        over && "bg-gray-3 text-foreground border-border-strong",
      )}
    >
      <StatusGlyph category={status.category} color={statusColor(status)} />
      <span className="truncate">{status.name}</span>
      <span className="tabular ml-auto text-xs">{count}</span>
    </button>
  );
}

/** Memoised like list rows: J/K and one changed issue re-render one or two cards, not the board. */
const Card = memo(function Card({
  issue,
  lane,
  lookups,
  parentKey,
  subIssues,
  placeholder,
  justDropped,
  isCursor,
  isSelected,
  anySelected,
  onCursor,
  onToggle,
}: {
  issue: ListIssue;
  lane: string;
  lookups: Lookups;
  parentKey?: string;
  subIssues?: ListIssue[];
  /** Being dragged: its slot stays as an outline until the drop. */
  placeholder: boolean;
  justDropped: React.RefObject<number>;
  isCursor: boolean;
  isSelected: boolean;
  anySelected: boolean;
  onCursor: (id: Id<"issues">) => void;
  onToggle: (id: Id<"issues">) => void;
}) {
  const { Link, navigate } = useNavigation();
  const reduceMotion = usePrefersReducedMotion();
  const draggable = useDraggable({ id: issue._id, data: { lane, statusId: issue.statusId } });
  const { onKeyDown, ...listeners } = draggable.listeners ?? {};
  const droppable = useDroppable({ id: issue._id, data: { lane, statusId: issue.statusId } });
  return (
    <motion.div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      // Cards slide to their new place when the order changes (here or in another browser).
      layout={reduceMotion ? false : "position"}
      transition={spring.smooth}
      data-issue-id={issue._id}
      data-cursor={isCursor || undefined}
      data-selected={isSelected || undefined}
      className={cn(
        "group/card rounded-md select-none",
        // Off-screen cards skip layout and paint, so long columns stay fast.
        "[contain-intrinsic-size:auto_4.75rem] [content-visibility:auto]",
        // The cursor's ring follows J/K and Tab: shown for keyboard focus, or for the cursor while
        // focus is elsewhere (a picker), never for a mouse click.
        "outline-ring outline-offset-1 outline-solid focus-visible:outline-2",
        isCursor ? "not-focus:outline-2 focus:not-focus-visible:outline-0" : "outline-0",
        placeholder && "border-border-strong rounded-md border border-dashed",
      )}
      {...draggable.attributes}
      {...listeners}
      // Keyboard focus (Tab, J/K) moves the cursor; a click or right-click doesn't, so no ring.
      onFocus={(event) => {
        if (event.currentTarget.matches(":focus-visible")) onCursor(issue._id);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key === "Enter" && !event.defaultPrevented && !draggable.isDragging)
          navigate(routes.issue(issue.key));
      }}
      aria-roledescription="draggable issue"
      aria-label={`${issue.key} ${issue.title}`}
    >
      <CardBody
        issue={issue}
        lookups={lookups}
        parentKey={parentKey}
        subIssues={subIssues}
        selected={isSelected}
        className={cn(placeholder && "invisible")}
        // Cards are dense: the box only takes room once something is selected (X starts it).
        select={
          anySelected ? (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => onToggle(issue._id)}
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onTouchStart={(event) => event.stopPropagation()}
              tabIndex={-1}
              aria-label={`Select ${issue.key}`}
              className="relative z-10 -my-0.5"
            />
          ) : null
        }
      >
        <Link
          href={routes.issue(issue.key)}
          tabIndex={-1}
          aria-hidden
          draggable={false}
          onClick={(event) => {
            // A drop ends with a click on whatever is under the pointer: don't open it.
            if (Date.now() - justDropped.current < 250) event.preventDefault();
          }}
          className="absolute inset-0 rounded-md"
        />
      </CardBody>
    </motion.div>
  );
});

/**
 * A card, like Linear's: a flat surface one step off the board (white with a hairline in light, a
 * hair lighter than the board in dark) and a fixed rhythm: key and assignee, the title (two lines
 * at most), then one line of metadata. Nothing on that line is boxed: priority is a bare glyph,
 * the due date and project are glyph + text, labels are small hairline pills. What doesn't fit is
 * counted ("+2") or truncated, never wrapped.
 */
function CardBody({
  issue,
  lookups,
  parentKey,
  subIssues,
  lifted = false,
  selected = false,
  select,
  className,
  children,
}: {
  issue: ListIssue;
  lookups: Lookups;
  parentKey?: string;
  subIssues?: ListIssue[];
  lifted?: boolean;
  selected?: boolean;
  /** The multi-select checkbox, before the key. */
  select?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const assignee = lookups.member(issue.assigneeId);
  const labels = issue.labelIds.map(lookups.label).filter((label) => label !== undefined);
  const project = lookups.project(issue.projectId);
  const overdue = issue.dueDate !== undefined && issue.dueDate < today();
  // Room on the line: two labels when it's otherwise short, one when it carries a project and a date.
  const shownLabels = labels.slice(0, project && issue.dueDate ? 1 : 2);
  const moreLabels = labels.length - shownLabels.length;
  const meta =
    issue.priority !== 0 ||
    project !== undefined ||
    labels.length > 0 ||
    issue.dueDate !== undefined ||
    (subIssues?.length ?? 0) > 0;
  return (
    <div
      className={cn(
        "relative flex cursor-default flex-col gap-1 rounded-md border px-2.5 pt-2 pb-2",
        "border-border/70 bg-popover dark:bg-gray-2 dark:border-border/60",
        "transition-colors duration-(--duration-instant)",
        // Hover and right-click (its menu is open; set on the wrapper, no re-render): a shade up.
        "hover:border-border-strong dark:hover:bg-gray-3",
        "[[data-menu-open]_&]:border-border-strong dark:[[data-menu-open]_&]:bg-gray-3",
        selected && "bg-gray-3 dark:bg-gray-4",
        lifted && "border-border-strong shadow-overlay",
        className,
      )}
    >
      {children}
      <div className="flex h-4 items-center gap-1.5">
        {select}
        <IssueKey value={issue.key} />
        {parentKey && (
          <span
            className="text-faint-foreground flex min-w-0 items-center gap-0.5 text-xs"
            title={`Sub-issue of ${parentKey}`}
          >
            <CornerDownRightIcon className="size-3 shrink-0" aria-hidden />
            <span className="truncate font-mono tracking-tight">{parentKey}</span>
          </span>
        )}
        <span className="ml-auto flex">
          {assignee ? (
            <PersonAvatar
              person={{ name: assignee.displayName, avatarUrl: assignee.avatarUrl }}
              size="xs"
            />
          ) : (
            <span
              className="border-gray-8 block size-4 rounded-full border border-dashed"
              aria-label="Unassigned"
            />
          )}
        </span>
      </div>
      <span className="text-foreground line-clamp-2 text-sm leading-5 font-medium">
        {issue.title}
      </span>
      {meta && (
        <div className="text-muted-foreground mt-0.5 flex h-5 min-w-0 items-center gap-2 overflow-hidden text-xs whitespace-nowrap">
          {issue.priority !== 0 && (
            <PriorityGlyph
              priority={issue.priority}
              size={14}
              title={`Priority: ${PRIORITY_LABEL[issue.priority]}`}
              className="shrink-0"
            />
          )}
          {subIssues && subIssues.length > 0 && <SubIssueProgress subIssues={subIssues} />}
          {issue.dueDate && (
            <span
              className={cn(
                "tabular flex shrink-0 items-center gap-1",
                overdue && "text-destructive",
              )}
              title={
                overdue ? `Overdue: ${formatDay(issue.dueDate)}` : `Due ${formatDay(issue.dueDate)}`
              }
            >
              <CalendarIcon className="size-3" aria-hidden />
              {formatDay(issue.dueDate)}
            </span>
          )}
          {project && (
            <span
              className="flex min-w-0 shrink items-center gap-1.5"
              title={`Project: ${project.name}`}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-[2px]"
                style={{ background: projectColor(project) }}
              />
              <span className="max-w-24 truncate">{project.name}</span>
            </span>
          )}
          {shownLabels.map((label) => (
            <span
              key={label._id}
              className="border-border flex h-4.5 min-w-0 shrink items-center gap-1 rounded-full border pr-1.5 pl-1"
              title={label.name}
            >
              <span
                aria-hidden
                className="size-1.5 shrink-0 rounded-full"
                style={{ background: resolveLabelColor(label.color) }}
              />
              <span className="truncate">{label.name}</span>
            </span>
          ))}
          {moreLabels > 0 && (
            <span
              className="tabular shrink-0"
              title={labels
                .slice(shownLabels.length)
                .map((label) => label.name)
                .join(", ")}
            >
              +{moreLabels}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
