"use client";

import { api } from "@pantry/backend/api";
import type { Id } from "@pantry/backend/dataModel";
import type { Project } from "@pantry/backend/model";
import {
  ContextMenu,
  ContextMenuArea,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@pantry/ui/components/context-menu";
import { Keycap } from "@pantry/ui/components/keycap";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import {
  CalendarIcon,
  CircleDotIcon,
  CopyIcon,
  ExternalLinkIcon,
  LayersIcon,
  LinkIcon,
  MinusIcon,
  PlusIcon,
  SignalIcon,
  TagIcon,
  TextIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { useMutation } from "convex/react";
import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog";
import { absoluteUrl, copyText, openInNewTab } from "../lib/clipboard";
import { routes } from "../navigation";
import { describeError } from "../screens/form-error";
import { useAppCommands } from "../shell/app-commands";
import { projectColor } from "../shell/space-color";
import { shortcut, type ShortcutId } from "../shortcuts";
import { useShortcutScope } from "../use-shortcuts";
import type { IssueActions } from "./actions";
import { statusColor, type ListIssue, type Lookups } from "./lookups";
import {
  assignToMe,
  buildOptions,
  plural,
  useQuickEdit,
  type QuickEditKind,
  type QuickEditOption,
} from "./quick-edit";
import { menuTargets } from "./menu-targets";

/** The property submenus, in menu order, with the key that edits the same property in a list. */
const PROPERTIES: { kind: QuickEditKind; label: string; icon: ReactNode }[] = [
  { kind: "status", label: "Status", icon: <CircleDotIcon /> },
  { kind: "priority", label: "Priority", icon: <SignalIcon /> },
  { kind: "assignee", label: "Assignee", icon: <UserRoundIcon /> },
  { kind: "labels", label: "Labels", icon: <TagIcon /> },
];

/** Status and priority show the targets' current value when they share one, like Linear. */
function propertyIcon(kind: QuickEditKind, targets: ReadonlyArray<ListIssue>, lookups: Lookups) {
  const first = targets[0]!;
  if (kind === "status" && targets.every((issue) => issue.statusId === first.statusId)) {
    const status = lookups.status(first.statusId);
    if (status) return <StatusGlyph category={status.category} color={statusColor(status)} />;
  }
  if (kind === "priority" && targets.every((issue) => issue.priority === first.priority))
    return <PriorityGlyph priority={first.priority} />;
  return PROPERTIES.find((property) => property.kind === kind)!.icon;
}

/** Letter keys inside the open menu do what they do in the list: open that property's picker. */
const LETTERS: Record<string, QuickEditKind | "assignToMe" | "newSubIssue"> = {
  s: "status",
  p: "priority",
  a: "assignee",
  l: "labels",
  d: "dueDate",
  i: "assignToMe",
  C: "newSubIssue",
};

function Shortcut({ id }: { id: ShortcutId }) {
  return (
    <ContextMenuShortcut>
      <Keycap keys={shortcut(id).display} />
    </ContextMenuShortcut>
  );
}

/**
 * The right-click menu for issues (list rows, board cards, sub-issue rows, My issues). One menu
 * serves every row inside it: rows carry `data-issue-id`, and the row under the pointer decides the
 * targets. Right-clicking a selected row acts on the whole selection ("3 issues"); any other row acts
 * on that row alone. Every change goes through `actions` (optimistic, like the pickers).
 */
export function IssueContextMenu({
  issues,
  selected,
  lookups,
  actions,
  children,
}: {
  /** The issues on screen, in on-screen order (a multi-selection keeps that order). */
  issues: ReadonlyArray<ListIssue>;
  selected?: ReadonlySet<Id<"issues">>;
  lookups: Lookups;
  actions: IssueActions;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [ids, setIds] = useState<Id<"issues">[]>([]);
  const [deleting, setDeleting] = useState<Id<"issues">[] | null>(null);
  const highlighted = useRef<Element[]>([]);
  const area = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const quickEdit = useQuickEdit(lookups, actions, issues);
  useShortcutScope("overlay", open);

  // The latest copy of each target, so ticks follow changes while a submenu is open.
  const targets = useMemo(() => {
    const byId = new Map(issues.map((issue) => [issue._id, issue]));
    return ids.map((id) => byId.get(id)).filter((issue) => issue !== undefined);
  }, [ids, issues]);

  const unhighlight = () => {
    for (const element of highlighted.current) element.removeAttribute("data-menu-open");
    highlighted.current = [];
  };

  function onContextMenu(event: React.MouseEvent) {
    const row = (event.target as Element).closest<HTMLElement>("[data-issue-id]");
    if (!row || !area.current?.contains(row)) return false;
    const next = menuTargets(
      issues.map((issue) => issue._id),
      row.dataset.issueId as Id<"issues">,
      selected,
    );
    if (next.length === 0) return false;
    unhighlight();
    // The rows the menu acts on stay marked while it's open (no re-render of the list).
    for (const id of next) {
      const element = area.current.querySelector(`[data-issue-id="${id}"]`);
      if (element) {
        element.setAttribute("data-menu-open", "");
        highlighted.current.push(element);
      }
    }
    setIds(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // Only keys pressed in the top menu: submenus keep type-to-find (label names, people).
    if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const action = LETTERS[event.key];
    if (!action || targets.length === 0) return;
    event.preventDefault();
    (event as unknown as { preventBaseUIHandler?: () => void }).preventBaseUIHandler?.();
    setOpen(false);
    if (action === "assignToMe") assignToMe(targets, lookups, actions);
    else if (action === "newSubIssue") newSubIssue();
    else quickEdit.open(action, targets);
  }

  const commands = useAppCommands();
  const spaceOf = (issue: ListIssue) =>
    commands.data.spaces.find(
      (space) => space._id === issue.spaceId || space.key === issue.key.split("-")[0],
    );
  const only = targets.length === 1 ? targets[0] : undefined;
  const parentSpace = only ? spaceOf(only) : undefined;
  const canAddSubIssue =
    only !== undefined && only.parentId === undefined && parentSpace?.archivedAt === undefined;
  function newSubIssue() {
    if (!only) return;
    if (!canAddSubIssue || !parentSpace) {
      toast(only.parentId ? "Sub-issues can't have sub-issues" : "This space is archived");
      return;
    }
    commands.newIssue({ space: parentSpace, parent: only });
  }

  return (
    <>
      <ContextMenuArea
        ref={area}
        trigger={trigger}
        className="contents"
        onContextMenu={onContextMenu}
      >
        {children}
      </ContextMenuArea>
      <ContextMenu
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) unhighlight();
        }}
      >
        <ContextMenuTrigger ref={trigger} hidden />
        <ContextMenuContent className="w-60" onKeyDown={onKeyDown} aria-label="Issue actions">
          {targets.length > 0 && (
            <IssueMenuItems
              targets={targets}
              lookups={lookups}
              actions={actions}
              projects={projectsFor(targets, lookups)}
              canAddSubIssue={canAddSubIssue}
              onNewSubIssue={newSubIssue}
              onCustomDate={() => quickEdit.open("dueDate", targets)}
              onDelete={() => setDeleting(targets.map((issue) => issue._id))}
            />
          )}
        </ContextMenuContent>
      </ContextMenu>
      {quickEdit.element}
      <DeleteIssues ids={deleting} issues={issues} onDone={() => setDeleting(null)} />
    </>
  );
}

/**
 * The projects the targets can move to: their space's, when they share one. Null when they're in
 * different spaces (My issues), so the submenu is left out.
 */
function projectsFor(targets: ReadonlyArray<ListIssue>, lookups: Lookups) {
  const spaces = new Set(targets.map((issue) => issue.spaceId));
  if (spaces.size !== 1) return null;
  const projects = lookups.projectsOf(targets[0]!.spaceId);
  return projects.length > 0 ? projects : null;
}

function OptionItems({
  options,
  keepOpen = false,
}: {
  options: QuickEditOption[];
  keepOpen?: boolean;
}) {
  return options.map((option) => (
    <ContextMenuCheckboxItem
      key={option.id}
      checked={option.checked === true}
      closeOnClick={!keepOpen}
      onCheckedChange={() => option.apply()}
    >
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
        {option.icon}
      </span>
      <span className="truncate">{option.label}</span>
      {option.checked === "mixed" && (
        <span className="absolute right-2 flex items-center" aria-label="(some)">
          <MinusIcon className="text-foreground!" />
        </span>
      )}
    </ContextMenuCheckboxItem>
  ));
}

function IssueMenuItems({
  targets,
  lookups,
  actions,
  projects,
  canAddSubIssue,
  onNewSubIssue,
  onCustomDate,
  onDelete,
}: {
  targets: ReadonlyArray<ListIssue>;
  lookups: Lookups;
  actions: IssueActions;
  projects: Project[] | null;
  canAddSubIssue: boolean;
  onNewSubIssue: () => void;
  onCustomDate: () => void;
  onDelete: () => void;
}) {
  const many = targets.length > 1;
  const only = many ? undefined : targets[0]!;
  const options = (kind: QuickEditKind) => buildOptions(kind, targets, lookups, actions, "");
  const copyAll = (read: (issue: ListIssue) => string, one: string, what: string) =>
    void copyText(targets.map(read).join("\n"), many ? plural(targets.length, what) : one);

  return (
    <>
      <ContextMenuGroup>
        {many && <ContextMenuLabel>{plural(targets.length, "issue")}</ContextMenuLabel>}
        {PROPERTIES.map((property) => (
          <ContextMenuSub key={property.kind}>
            <ContextMenuSubTrigger>
              {propertyIcon(property.kind, targets, lookups)}
              {property.label}
              <Shortcut id={property.kind} />
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-52">
              <OptionItems options={options(property.kind)} keepOpen={property.kind === "labels"} />
              {property.kind === "labels" && lookups.data.labels.length === 0 && (
                <ContextMenuItem disabled>No labels yet. Add them in Settings.</ContextMenuItem>
              )}
            </ContextMenuSubContent>
          </ContextMenuSub>
        ))}
        {projects && <ProjectSubmenu targets={targets} projects={projects} actions={actions} />}
        <ContextMenuSub>
          <ContextMenuSubTrigger>
            <CalendarIcon />
            Due date
            <Shortcut id="dueDate" />
          </ContextMenuSubTrigger>
          <ContextMenuSubContent className="w-52">
            <OptionItems options={options("dueDate")} />
            <ContextMenuSeparator />
            <ContextMenuItem onClick={onCustomDate}>
              <CalendarIcon />
              Pick a date…
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuGroup>
        {only && (
          <ContextMenuItem onClick={() => openInNewTab(routes.issue(only.key))}>
            <ExternalLinkIcon />
            Open in new tab
          </ContextMenuItem>
        )}
        {only && canAddSubIssue && (
          <ContextMenuItem onClick={onNewSubIssue}>
            <PlusIcon />
            Add sub-issue
            <Shortcut id="newSubIssue" />
          </ContextMenuItem>
        )}
        <ContextMenuItem
          onClick={() => copyAll((issue) => absoluteUrl(routes.issue(issue.key)), "link", "link")}
        >
          <LinkIcon />
          {many ? "Copy links" : "Copy link"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => copyAll((issue) => issue.key, only?.key ?? "", "key")}>
          <CopyIcon />
          {many ? "Copy keys" : "Copy key"}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => copyAll((issue) => issue.title, "title", "title")}>
          <TextIcon />
          {many ? "Copy titles" : "Copy title"}
        </ContextMenuItem>
      </ContextMenuGroup>
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onClick={onDelete}>
        <Trash2Icon />
        {many ? `Delete ${plural(targets.length, "issue")}…` : "Delete issue…"}
      </ContextMenuItem>
    </>
  );
}

/** Project: sub-issues follow their parent, so they're skipped (and the item says why). */
function ProjectSubmenu({
  targets,
  projects,
  actions,
}: {
  targets: ReadonlyArray<ListIssue>;
  projects: Project[];
  actions: IssueActions;
}) {
  const movable = targets.filter((issue) => issue.parentId === undefined);
  if (movable.length === 0) {
    return (
      <ContextMenuItem disabled title="Sub-issues are in their parent's project">
        <LayersIcon />
        Project
        <ContextMenuShortcut>From parent</ContextMenuShortcut>
      </ContextMenuItem>
    );
  }
  const shared = (projectId: Id<"projects"> | undefined): boolean | "mixed" => {
    const hits = movable.filter((issue) => issue.projectId === projectId).length;
    return hits === 0 ? false : hits === movable.length ? true : "mixed";
  };
  const set = (projectId: Id<"projects"> | null, name: string) => {
    const changing = movable.filter((issue) => (issue.projectId ?? null) !== projectId);
    for (const issue of changing) void actions.update(issue._id, { projectId });
    const skipped = targets.length - movable.length;
    if (skipped > 0)
      toast(`Moved ${plural(changing.length, "issue")} to ${name}`, {
        description: `${plural(skipped, "sub-issue")} stayed with ${skipped === 1 ? "its parent" : "their parents"}.`,
      });
    else if (changing.length > 1) toast(`Moved ${plural(changing.length, "issue")} to ${name}`);
  };
  const options: QuickEditOption[] = [
    {
      id: "project-none",
      label: "No project",
      icon: <LayersIcon />,
      checked: shared(undefined),
      apply: () => set(null, "no project"),
    },
    ...projects.map<QuickEditOption>((project) => ({
      id: project._id,
      label: project.name,
      icon: (
        <span
          className="size-2 shrink-0 rounded-[2px]"
          style={{ background: projectColor(project) }}
        />
      ),
      checked: shared(project._id),
      apply: () => set(project._id, project.name),
    })),
  ];
  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger>
        <LayersIcon />
        Project
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="w-52">
        <OptionItems options={options} />
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

/**
 * Delete, after the same confirmation the issue page asks for. A sub-issue whose parent is deleted
 * too goes with it, so it isn't deleted twice.
 */
function DeleteIssues({
  ids,
  issues,
  onDone,
}: {
  ids: Id<"issues">[] | null;
  issues: ReadonlyArray<ListIssue>;
  onDone: () => void;
}) {
  const remove = useMutation(api.issues.remove);
  const byId = new Map(issues.map((issue) => [issue._id, issue]));
  const targets = (ids ?? []).map((id) => byId.get(id)).filter((issue) => issue !== undefined);
  const chosen = new Set(targets.map((issue) => issue._id));
  const roots = targets.filter((issue) => !issue.parentId || !chosen.has(issue.parentId));
  const subIssues = issues.filter(
    (issue) => issue.parentId !== undefined && chosen.has(issue.parentId) && !chosen.has(issue._id),
  ).length;
  const only = targets.length === 1 ? targets[0] : undefined;
  const title = only ? `Delete ${only.key}?` : `Delete ${plural(targets.length, "issue")}?`;
  const subs =
    subIssues > 0
      ? `${subIssues === 1 ? "1 sub-issue" : `${subIssues} sub-issues`}, comments and activity are deleted too`
      : "Their comments and activity are deleted too";
  return (
    <ConfirmDialog
      open={ids !== null && targets.length > 0}
      onOpenChange={(open) => !open && onDone()}
      title={title}
      description={`${only ? subs.replace(/^Their/, "Its") : subs}. There's no trash: this can't be undone.`}
      confirmLabel={only ? "Delete issue" : `Delete ${plural(targets.length, "issue")}`}
      destructive
      onConfirm={async () => {
        let deleted = 0;
        for (const issue of roots) {
          try {
            await remove({ issueId: issue._id });
            deleted += 1;
          } catch (err) {
            toast.error(describeError(err, `Couldn't delete ${issue.key}.`));
          }
        }
        if (deleted === 0) return;
        // A parent takes its chosen sub-issues with it: count them as deleted too.
        const count = deleted === roots.length ? targets.length : deleted;
        toast(only ? `Deleted ${only.key}` : `Deleted ${plural(count, "issue")}`);
      }}
    />
  );
}
