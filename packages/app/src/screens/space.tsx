"use client";

import { motion } from "@pantry/ui/lib/motion";
import { api } from "@pantry/backend/api";
import type { Doc, Id } from "@pantry/backend/dataModel";
import type { Project } from "@pantry/backend/model";
import { Button } from "@pantry/ui/components/button";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { cn } from "@pantry/ui/lib/utils";
import { useQuery } from "convex/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { ChevronDownIcon, InboxIcon, LayersIcon, PlusIcon, SearchXIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { EntryGate } from "../entry";
import { useIssueActions } from "../issues/actions";
import { FilterBar, useIssueFilters } from "../issues/filter-bar";
import {
  applyFilters,
  EMPTY_FILTERS,
  hasFilters,
  parseGroup,
  serializeGroup,
  slug,
  type GroupBy,
} from "../issues/filters";
import { IssueRow } from "../issues/issue-row";
import { IssueContextMenu } from "../issues/issue-menu";
import {
  GroupDropIndicator,
  ListDragAndDrop,
  useGroupDrop,
  type DropGroup,
  type ListOrder,
} from "../issues/list-dnd";
import { RowPickers } from "../issues/pickers";
import { useIssueSelection } from "../issues/selection";
import { statusColor, useLookups, type Lookups, type ListIssue } from "../issues/lookups";
import type { NewIssueDefaults } from "../issues/new-issue-dialog";
import { useStable } from "../lib/stable";
import { useNavigation } from "../navigation";
import { useAppCommands } from "../shell/app-commands";
import { projectColor } from "../shell/space-color";
import { AppShell, type WorkspaceData } from "../shell/app-shell";
import { NotMemberScreen } from "./not-member";
import { SpaceNotFound, SpaceTitle } from "./space-chrome";

/** A space's issues as a list grouped by status or project (spec §4), live over Convex. */
export function SpacePage({ spaceKey }: { spaceKey: string }) {
  return (
    <EntryGate allow={["ready", "not-member"]}>
      {(state) =>
        state.kind === "not-member" ? (
          <NotMemberScreen />
        ) : (
          <AppShell title={(data) => <SpaceTitle data={data} spaceKey={spaceKey} view="list" />}>
            {(data) => {
              const space = data.spaces.find((row) => row.key === spaceKey);
              if (!space) return <SpaceNotFound spaceKey={spaceKey} />;
              return <SpaceIssues key={space._id} data={data} space={space} view="list" />;
            }}
          </AppShell>
        )
      }
    </EntryGate>
  );
}

export type SpaceIssuesView = "list" | "board";

/** Loads the space's issues and the toolbar (filters, grouping) for both views. */
export function SpaceIssues({
  data,
  space,
  view,
  renderBoard,
}: {
  data: WorkspaceData;
  space: Doc<"spaces">;
  view: SpaceIssuesView;
  renderBoard?: (props: BoardProps) => React.ReactNode;
}) {
  const [includeDone, setIncludeDone] = useState(false);
  const issues = useStable(useQuery(api.issues.listBySpace, { spaceId: space._id, includeDone }));
  const lookups = useLookups(data);
  const commands = useAppCommands();
  const { pathname, search, navigate } = useNavigation();
  const projects = lookups.projectsOf(space._id);
  const { filters, setFilters, setTitle } = useIssueFilters();
  const groupBy = parseGroup(search);
  const filtering = hasFilters(filters);
  const visible = useMemo(
    () =>
      issues === undefined
        ? undefined
        : applyFilters(issues, filters, {
            me: data.me._id,
            statuses: data.statuses,
            labels: data.labels,
            projects,
          }),
    [issues, filters, data.me._id, data.statuses, data.labels, projects],
  );
  // Filtered to exactly one project: new issues start in it.
  const onlyProject =
    filters.project.length === 1
      ? projects.find((project) => slug(project.name) === filters.project[0])
      : undefined;
  const newIssue = (defaults: NewIssueDefaults = {}) =>
    commands.newIssue({
      ...(onlyProject ? { projectId: onlyProject._id } : {}),
      ...defaults,
      space,
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-border flex min-h-10 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-1.5">
        <FilterBar
          filters={filters}
          setFilters={setFilters}
          setTitle={setTitle}
          lookups={lookups}
          facets={
            projects.length > 0 ? ["status", "assignee", "label", "priority", "project"] : undefined
          }
          projects={projects}
        />
        <span className="text-muted-foreground tabular ml-auto text-xs" aria-live="polite">
          {issueCount(issues, visible)}
        </span>
        <GroupMenu
          value={groupBy}
          onChange={(next) => navigate(pathname + serializeGroup(next, search), { replace: true })}
        />
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          aria-pressed={includeDone}
          onClick={() => setIncludeDone((value) => !value)}
          title="Done and canceled issues older than 14 days are hidden by default"
        >
          {includeDone ? "Hide older done" : "Show older done"}
        </Button>
        <Button size="sm" onClick={() => newIssue()} data-icon="inline-start">
          <PlusIcon />
          New issue
        </Button>
      </div>
      {issues === undefined || visible === undefined ? null : issues.length === 0 &&
        !includeDone ? (
        <EmptySpace space={space} onCreate={() => newIssue()} />
      ) : visible.length === 0 && filtering ? (
        <NoMatches onClear={() => setFilters(EMPTY_FILTERS)} />
      ) : view === "board" && renderBoard ? (
        renderBoard({ issues: visible, lookups, space, newIssue, groupBy })
      ) : (
        <IssueList
          issues={visible}
          lookups={lookups}
          newIssue={newIssue}
          groupBy={groupBy}
          projects={projects}
        />
      )}
    </div>
  );
}

/** "Group: Status / Project" for list and board. */
function GroupMenu({ value, onChange }: { value: GroupBy; onChange: (group: GroupBy) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            data-icon="inline-end"
          />
        }
        aria-label={`Group by ${value}. Change grouping`}
      >
        Group: {value === "project" ? "Project" : "Status"}
        <ChevronDownIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Group by</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as GroupBy)}>
            <DropdownMenuRadioItem value="status" closeOnClick>
              Status
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="project" closeOnClick>
              Project
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "12 issues", or "3 of 12 issues" while filtering. */
export function issueCount(
  all: ReadonlyArray<unknown> | undefined,
  shown: ReadonlyArray<unknown> | undefined,
): string {
  if (all === undefined || shown === undefined) return "Loading…";
  const noun = all.length === 1 ? "issue" : "issues";
  return shown.length === all.length
    ? `${all.length} ${noun}`
    : `${shown.length} of ${all.length} ${noun}`;
}

export function NoMatches({ onClear }: { onClear: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <SearchXIcon className="text-muted-foreground size-5" aria-hidden />
      <p className="text-foreground text-sm font-medium">No issues match these filters</p>
      <Button className="mt-1" variant="secondary" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

export type BoardProps = {
  issues: ListIssue[];
  lookups: Lookups;
  space: Doc<"spaces">;
  newIssue: (defaults?: NewIssueDefaults) => void;
  groupBy: GroupBy;
};

/** One list section or board lane: a status, or a project ("No project" when `project` is null). */
type Group =
  | { kind: "status"; id: string; status: Doc<"statuses">; issues: ListIssue[] }
  | { kind: "project"; id: string; project: Project | null; issues: ListIssue[] };

/**
 * Issues in sections. By status: one per status that has issues. By project: one per project of
 * the space that has issues, in the space's order, then "No project"; rows keep status order.
 */
export function groupIssues(
  issues: ListIssue[],
  groupBy: GroupBy,
  statuses: Doc<"statuses">[],
  projects: Project[],
): Group[] {
  if (groupBy === "status") {
    return statuses
      .map((status) => ({
        kind: "status" as const,
        id: status._id,
        status,
        issues: issues.filter((issue) => issue.statusId === status._id),
      }))
      .filter((group) => group.issues.length > 0);
  }
  const order = new Map(statuses.map((status, index) => [status._id, index]));
  const byStatus = (rows: ListIssue[]) =>
    [...rows].sort(
      (a, b) =>
        (order.get(a.statusId) ?? 0) - (order.get(b.statusId) ?? 0) || a.sortOrder - b.sortOrder,
    );
  const known = new Set(projects.map((project) => project._id));
  return [
    ...projects.map((project) => ({
      kind: "project" as const,
      id: project._id,
      project,
      issues: byStatus(issues.filter((issue) => issue.projectId === project._id)),
    })),
    {
      kind: "project" as const,
      id: "none",
      project: null,
      issues: byStatus(issues.filter((issue) => !issue.projectId || !known.has(issue.projectId))),
    },
  ].filter((group) => group.issues.length > 0);
}

/**
 * Parent keys and sub-issue lists, from the issues already loaded. The sub-issue lists keep their
 * identity while their issues don't change, so memoised parent rows and cards can skip.
 */
export function useIssueFamily(issues: ListIssue[]) {
  const family = useMemo(() => {
    const byId = new Map(issues.map((issue) => [issue._id, issue]));
    const children: Record<string, ListIssue[]> = {};
    for (const issue of issues) {
      if (issue.parentId) (children[issue.parentId] ??= []).push(issue);
    }
    return { byId, children };
  }, [issues]);
  const children = useStable(family.children);
  return useMemo(
    () => ({ byId: family.byId, children: { get: (id: Id<"issues">) => children[id] } }),
    [family.byId, children],
  );
}

export function IssueList({
  issues,
  lookups,
  newIssue,
  groupBy = "status",
  projects = [],
  order = "manual",
}: {
  issues: ListIssue[];
  lookups: Lookups;
  newIssue: (defaults?: NewIssueDefaults) => void;
  groupBy?: GroupBy;
  projects?: Project[];
  /** "updated" for My issues: dragging changes status only (see list-dnd.tsx). */
  order?: ListOrder;
}) {
  const actions = useIssueActions();
  const family = useIssueFamily(issues);
  const container = useRef<HTMLDivElement>(null);
  const groups = useMemo(
    () => groupIssues(issues, groupBy, lookups.data.statuses, projects),
    [issues, groupBy, lookups.data.statuses, projects],
  );
  const ordered = useMemo(() => groups.flatMap((group) => group.issues), [groups]);
  const selection = useIssueSelection({ ordered, lookups, actions, container });
  const { cursor, selected, setCursor, toggle } = selection.value;
  const dropGroups = useMemo<DropGroup[]>(
    () =>
      groups.map((group) =>
        group.kind === "status"
          ? { ...group, name: group.status.name }
          : {
              kind: "project",
              id: group.id,
              name: group.project?.name ?? "No project",
              projectId: group.project?._id ?? null,
              issues: group.issues,
            },
      ),
    [groups],
  );

  return (
    <RowPickers
      statuses={lookups.data.statuses}
      members={lookups.data.members}
      me={lookups.data.me}
    >
      <IssueContextMenu issues={ordered} selected={selected} lookups={lookups} actions={actions}>
        <ListDragAndDrop
          groups={dropGroups}
          ordered={ordered}
          selected={selected}
          order={order}
          lookups={lookups}
          actions={actions}
          container={container}
        >
          {/* layoutScroll: the cursor highlight measures rows correctly while the list is scrolled. */}
          <motion.div
            ref={container}
            layoutScroll
            data-any-selected={selected.size > 0 || undefined}
            className="group/list min-h-0 flex-1 overflow-y-auto"
          >
            {groups.map((group) => (
              <section
                key={group.id}
                aria-label={
                  group.kind === "status"
                    ? group.status.name
                    : (group.project?.name ?? "No project")
                }
                data-drop-group={group.id}
                className="relative"
              >
                <GroupHeader group={group} newIssue={newIssue} />
                {group.issues.map((issue) => (
                  <IssueRow
                    key={issue._id}
                    issue={issue}
                    lookups={lookups}
                    actions={actions}
                    parentKey={issue.parentId ? family.byId.get(issue.parentId)?.key : undefined}
                    subIssues={family.children.get(issue._id)}
                    isCursor={cursor === issue._id}
                    isSelected={selected.has(issue._id)}
                    onCursor={setCursor}
                    onToggle={toggle}
                  />
                ))}
                <GroupDropIndicator groupId={group.id} />
              </section>
            ))}
          </motion.div>
        </ListDragAndDrop>
      </IssueContextMenu>
      {selection.element}
    </RowPickers>
  );
}

/** A group's sticky header: what it is, how many, "+"; it lights up while a drag would drop here. */
function GroupHeader({
  group,
  newIssue,
}: {
  group: Group;
  newIssue: (defaults?: NewIssueDefaults) => void;
}) {
  const name = group.kind === "status" ? group.status.name : (group.project?.name ?? "No project");
  const drop = useGroupDrop(group.id);
  return (
    <div
      data-drop-header
      className={cn(
        "border-border bg-gray-2 sticky top-0 z-20 flex h-8 items-center gap-2 border-b px-3 transition-colors duration-(--duration-instant)",
        drop.over && "bg-gray-4",
      )}
    >
      {group.kind === "status" ? (
        <StatusGlyph category={group.status.category} color={statusColor(group.status)} />
      ) : group.project ? (
        <span
          className="size-2.5 rounded-[3px]"
          style={{ background: projectColor(group.project) }}
          aria-hidden
        />
      ) : (
        <LayersIcon className="text-muted-foreground size-3.5" aria-hidden />
      )}
      <h2 className="text-foreground font-sans text-sm font-medium tracking-normal">{name}</h2>
      <span className="text-muted-foreground tabular font-mono text-xs">{group.issues.length}</span>
      {drop.hint && <span className="text-muted-foreground text-xs">{drop.hint}</span>}
      <Button
        variant="ghost"
        size="icon-xs"
        className="ml-auto"
        aria-label={`New issue in ${name}`}
        onClick={() =>
          newIssue(
            group.kind === "status"
              ? { statusId: group.status._id }
              : group.project
                ? { projectId: group.project._id }
                : {},
          )
        }
      >
        <PlusIcon />
      </Button>
    </div>
  );
}

function EmptySpace({ space, onCreate }: { space: Doc<"spaces">; onCreate: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <InboxIcon className="text-muted-foreground size-5" aria-hidden />
      <p className="text-foreground text-sm font-medium">No issues in {space.name} yet</p>
      <p className="text-muted-foreground max-w-sm text-sm">
        Issues you create here, or that your agents create over MCP, show up grouped by status.
      </p>
      <Button className="mt-2" onClick={onCreate} data-icon="inline-start">
        <PlusIcon />
        New issue
      </Button>
    </div>
  );
}
