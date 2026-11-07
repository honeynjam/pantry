"use client";

import type { Id } from "@pantry/backend/dataModel";
import { Checkbox } from "@pantry/ui/components/checkbox";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { LabelChip } from "@pantry/ui/components/label-chip";
import { ProjectChip } from "@pantry/ui/components/project-chip";
import { motion, spring, usePrefersReducedMotion } from "@pantry/ui/lib/motion";
import { cn } from "@pantry/ui/lib/utils";
import { CornerDownRightIcon } from "lucide-react";
import { memo } from "react";
import { routes, useNavigation } from "../navigation";
import type { IssueActions } from "./actions";
import { useRowDrag } from "./list-dnd";
import type { Lookups, ListIssue } from "./lookups";
import { AssigneePicker, DueDatePicker, PriorityPicker, StatusPicker } from "./pickers";
import { SubIssueProgress } from "./sub-issue-progress";

/**
 * One dense list row (32px): priority, key, status, title, parent / sub-issue progress, labels, due
 * date, assignee. The title is a stretched link so the whole row opens the issue; the pickers sit
 * above it and edit in place. Under a selection (J/K, X) the cursor's highlight glides between rows
 * on the morph spring and selected rows show a ticked box.
 *
 * Memoised: rows get the selection as plain flags and stable callbacks, and lists keep unchanged
 * issues' identity (`useStable`), so J/K or one changed issue re-renders one or two rows, not all.
 * Without `onToggle` the row has no selection (no checkbox, focus highlight instead of a cursor).
 * The whole row drags (list-dnd.tsx); it must render inside `ListDragAndDrop`.
 */
export const IssueRow = memo(function IssueRow({
  issue,
  lookups,
  actions,
  parentKey,
  subIssues,
  isCursor = false,
  isSelected = false,
  onCursor,
  onToggle,
}: {
  issue: ListIssue;
  lookups: Lookups;
  actions: IssueActions;
  parentKey?: string;
  subIssues?: ListIssue[];
  isCursor?: boolean;
  isSelected?: boolean;
  onCursor?: (id: Id<"issues">) => void;
  onToggle?: (id: Id<"issues">) => void;
}) {
  const { Link } = useNavigation();
  const { data } = lookups;
  // Reduced motion: no shared layoutId, so the highlight appears on the new row without travel.
  const reduceMotion = usePrefersReducedMotion();
  const selectable = onToggle !== undefined;
  const labels = issue.labelIds.map(lookups.label).filter((label) => label !== undefined);
  const project = lookups.project(issue.projectId);
  const drag = useRowDrag(issue._id);
  return (
    <div
      ref={drag.ref}
      {...drag.listeners}
      data-issue-id={issue._id}
      data-cursor={isCursor || undefined}
      data-selected={isSelected || undefined}
      onFocus={() => onCursor?.(issue._id)}
      className={cn(
        "group/row h-row border-border hover:bg-accent relative isolate flex items-center gap-2 border-b px-3 text-sm transition-colors duration-(--duration-instant) last:border-b-0",
        isSelected && "bg-gray-3",
        !selectable && "focus-within:bg-accent",
        // Right-clicked (its menu is open) and being dragged: set on the element, no re-render.
        "data-menu-open:bg-accent data-dragging:opacity-40",
      )}
    >
      {isCursor && (
        <motion.span
          layoutId={reduceMotion ? undefined : "issue-cursor"}
          transition={spring.morph}
          aria-hidden
          className="bg-selected pointer-events-none absolute inset-0 -z-10"
        />
      )}
      {selectable && (
        <span className="relative z-10 -mr-0.5 flex w-4 shrink-0 justify-center">
          <Checkbox
            checked={isSelected}
            onCheckedChange={() => onToggle(issue._id)}
            // Ticking a box never starts a drag.
            onMouseDown={(event) => event.stopPropagation()}
            tabIndex={-1}
            aria-label={`Select ${issue.key}`}
            className={cn(
              "transition-opacity duration-(--duration-instant)",
              // Every box shows once anything is selected: the list sets data-any-selected, so rows
              // don't re-render for it.
              !isSelected &&
                "opacity-0 group-hover/row:opacity-100 [[data-any-selected]_&]:opacity-100",
            )}
          />
        </span>
      )}
      <PriorityPicker
        value={issue.priority}
        onChange={(priority) => void actions.update(issue._id, { priority })}
      />
      <IssueKey value={issue.key} className="w-14 shrink-0" />
      <StatusPicker
        statuses={data.statuses}
        value={issue.statusId}
        onChange={(statusId) => void actions.move(issue._id, statusId)}
      />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        {parentKey && (
          <span
            className="text-muted-foreground flex shrink-0 items-center gap-0.5 text-xs"
            title={`Sub-issue of ${parentKey}`}
          >
            <CornerDownRightIcon className="size-3" aria-hidden />
            <span className="font-mono">{parentKey}</span>
          </span>
        )}
        <Link
          href={routes.issue(issue.key)}
          data-issue-focus
          draggable={false}
          {...drag.focusProps}
          className="text-foreground min-w-0 truncate outline-none after:absolute after:inset-0 after:content-[''] focus-visible:underline"
        >
          {issue.title}
        </Link>
        {subIssues && subIssues.length > 0 && <SubIssueProgress subIssues={subIssues} />}
      </span>
      <span className="relative z-10 hidden max-w-80 items-center gap-1 overflow-hidden md:flex">
        {project && (
          <ProjectChip
            name={project.name}
            color={project.color}
            title={`Project: ${project.name}`}
          />
        )}
        {labels.slice(0, 3).map((label) => (
          <LabelChip key={label._id} name={label.name} color={label.color} />
        ))}
        {labels.length > 3 && (
          <span className="text-muted-foreground text-xs">+{labels.length - 3}</span>
        )}
      </span>
      <span
        className={cn(
          "relative z-10 hidden lg:flex",
          !issue.dueDate && "invisible group-hover/row:visible",
        )}
      >
        <DueDatePicker
          value={issue.dueDate}
          onChange={(dueDate) => void actions.update(issue._id, { dueDate })}
          variant="icon"
        />
      </span>
      <AssigneePicker
        members={data.members}
        me={data.me}
        value={issue.assigneeId}
        onChange={(assigneeId) => void actions.update(issue._id, { assigneeId })}
      />
    </div>
  );
});
