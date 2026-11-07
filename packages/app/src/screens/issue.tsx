"use client";

import { api } from "@pantry/backend/api";
import type { Doc } from "@pantry/backend/dataModel";
import { normalizeTitle } from "@pantry/backend/rules";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import { Button } from "@pantry/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@pantry/ui/components/dropdown-menu";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { Popover, PopoverContent, PopoverTrigger } from "@pantry/ui/components/popover";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { cn } from "@pantry/ui/lib/utils";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  ChevronRightIcon,
  CopyIcon,
  CornerLeftUpIcon,
  FolderIcon,
  LinkIcon,
  MoreHorizontalIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ConfirmDialog } from "../components/confirm-dialog";
import { MarkdownEditor, useMarkdownEditorReady } from "../components/markdown-editor";
import { SpaceAvatar } from "../components/space-avatar";
import { EntryGate } from "../entry";
import { useIssueActions, type IssueActions } from "../issues/actions";
import { statusColor, useLookups, type ListIssue, type Lookups } from "../issues/lookups";
import {
  AssigneePicker,
  DueDatePicker,
  LabelsPicker,
  PriorityPicker,
  ProjectPicker,
  StatusPicker,
} from "../issues/pickers";
import { IssueContextMenu } from "../issues/issue-menu";
import { useIssueQuickEdit } from "../issues/selection";
import { SubIssueProgress } from "../issues/sub-issue-progress";
import { CommentComposer, Timeline } from "../issues/timeline";
import { fullDate, timeAgo } from "../lib/format";
import { routes, useNavigation } from "../navigation";
import { useAppCommands } from "../shell/app-commands";
import { AppShell, type WorkspaceData } from "../shell/app-shell";
import { lastListLocation } from "../shell/locations";
import { copyText } from "../lib/clipboard";
import { useShortcut, useShortcutScope } from "../use-shortcuts";
import { usePaletteActions } from "../palette/palette-actions";
import { describeError } from "./form-error";
import { NotMemberScreen } from "./not-member";

type IssueData = NonNullable<FunctionReturnType<typeof api.issues.get>>;

/** Issue detail (spec §4): description, sub-issues, comments, activity, properties sidebar. */
export function IssuePage({ issueKey }: { issueKey: string }) {
  return (
    <EntryGate allow={["ready", "not-member"]}>
      {(state) =>
        state.kind === "not-member" ? (
          <NotMemberScreen />
        ) : (
          <AppShell title={(data) => <IssueTitle data={data} issueKey={issueKey} />}>
            {(data) => <IssueScreen data={data} issueKey={issueKey} />}
          </AppShell>
        )
      }
    </EntryGate>
  );
}

function IssueTitle({ data, issueKey }: { data: WorkspaceData; issueKey: string }) {
  const { Link } = useNavigation();
  const spaceKey = issueKey.split("-")[0]?.toUpperCase() ?? "";
  const space = data.spaces.find((row) => row.key === spaceKey);
  return (
    <>
      {space && (
        <>
          <Link
            href={routes.space(space.key)}
            className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-2 rounded-sm transition-colors duration-(--duration-instant)"
          >
            <SpaceAvatar space={space} size="xs" />
            <span className="truncate">{space.name}</span>
          </Link>
          <ChevronRightIcon className="text-faint-foreground size-3.5 shrink-0" aria-hidden />
        </>
      )}
      <IssueKey value={issueKey.toUpperCase()} className="text-foreground" />
    </>
  );
}

function IssueScreen({ data, issueKey }: { data: WorkspaceData; issueKey: string }) {
  const result = useQuery(api.issues.get, { key: issueKey });
  // The editor loads alongside the issue (it usually wins: the query waits for auth and the socket).
  const editorReady = useMarkdownEditorReady();
  const lookups = useLookups(data);
  const { navigate } = useNavigation();
  // Registered before the issue loads, so Esc works at once.
  useShortcutScope("issue");
  // Back to the list or board it was opened from (filters included), else the space's list.
  useShortcut("escape", "issue", () =>
    navigate(lastListLocation() ?? routes.space(issueKey.split("-")[0]?.toUpperCase() ?? "")),
  );
  if (result === undefined || (result !== null && !editorReady)) return null;
  if (result === null) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-16 text-center">
        <p className="text-foreground text-sm font-medium">
          There&apos;s no issue {issueKey.toUpperCase()}
        </p>
        <p className="text-muted-foreground max-w-sm text-sm">
          It may have been deleted, or the key is mistyped.
        </p>
      </div>
    );
  }
  return <IssueDetail key={result.issue._id} result={result} lookups={lookups} />;
}

function IssueDetail({ result, lookups }: { result: IssueData; lookups: Lookups }) {
  const { issue, space, parent, subIssues, comments, activity } = result;
  const actions = useIssueActions();
  const commands = useAppCommands();
  const canHaveSubIssues = issue.parentId === undefined && space?.archivedAt === undefined;
  const newSubIssue = () => {
    if (space && canHaveSubIssues) commands.newIssue({ space, parent: issue });
  };

  const quickEdit = useIssueQuickEdit(issue, lookups, actions);
  useShortcut("newSubIssue", "issue", () => {
    if (!canHaveSubIssues) {
      toast(issue.parentId ? "Sub-issues can't have sub-issues" : "This space is archived");
      return;
    }
    newSubIssue();
  });
  usePaletteActions(() => [
    ...(canHaveSubIssues
      ? [
          {
            id: "issue:new-sub-issue",
            label: "New sub-issue",
            group: "Actions" as const,
            description: issue.key,
            icon: <PlusIcon />,
            shortcut: "newSubIssue" as const,
            run: newSubIssue,
          },
        ]
      : []),
    {
      id: "issue:copy-key",
      label: "Copy issue key",
      group: "Actions",
      description: issue.key,
      icon: <CopyIcon />,
      run: () => void copyText(issue.key, issue.key),
    },
    {
      id: "issue:copy-link",
      label: "Copy issue link",
      group: "Actions",
      description: issue.key,
      keywords: ["url", "share"],
      icon: <LinkIcon />,
      run: () => void copyText(`${window.location.origin}${routes.issue(issue.key)}`, "link"),
    },
  ]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-6 py-8 md:px-10">
          <div className="flex flex-col gap-2">
            {parent && <ParentLink parent={parent} lookups={lookups} />}
            <TitleField issue={issue} actions={actions} />
            <MarkdownEditor
              value={issue.description}
              placeholder="Add a description…"
              aria-label="Description"
              className="hover:bg-gray-2 -mx-2 rounded-md transition-colors duration-(--duration-instant) focus-within:bg-transparent"
              contentClassName="min-h-12 px-2 py-1.5"
              onSave={(description) => void actions.update(issue._id, { description })}
            />
          </div>

          {(subIssues.length > 0 || canHaveSubIssues) && (
            <section aria-labelledby="sub-issues" className="flex flex-col gap-1.5">
              <div className="flex h-7 items-center gap-2">
                <h2
                  id="sub-issues"
                  className="text-muted-foreground font-sans text-xs font-medium tracking-normal"
                >
                  Sub-issues
                </h2>
                {subIssues.length > 0 && <SubIssueProgress subIssues={subIssues} />}
                {canHaveSubIssues && (
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto"
                    onClick={newSubIssue}
                    data-icon="inline-start"
                  >
                    <PlusIcon />
                    Add sub-issue
                  </Button>
                )}
              </div>
              {subIssues.length > 0 && (
                <SubIssueList subIssues={subIssues} lookups={lookups} actions={actions} />
              )}
            </section>
          )}

          <section aria-labelledby="activity" className="flex flex-col gap-1">
            <h2
              id="activity"
              className="text-muted-foreground mb-1 font-sans text-xs font-medium tracking-normal"
            >
              Activity
            </h2>
            <Timeline activity={activity} comments={comments} lookups={lookups} />
            <CommentComposer issueId={issue._id} />
          </section>
        </article>
      </div>
      <PropertiesPanel
        issue={issue}
        space={space}
        parent={parent}
        lookups={lookups}
        actions={actions}
        subIssueCount={subIssues.length}
      />
      {quickEdit}
    </div>
  );
}

function ParentLink({
  parent,
  lookups,
}: {
  parent: NonNullable<IssueData["parent"]>;
  lookups: Lookups;
}) {
  const { Link } = useNavigation();
  const status = lookups.status(parent.statusId);
  return (
    <Link
      href={routes.issue(parent.key)}
      className="text-muted-foreground hover:text-foreground flex w-fit max-w-full items-center gap-1.5 rounded-sm text-xs transition-colors duration-(--duration-instant)"
    >
      <CornerLeftUpIcon className="size-3" aria-hidden />
      <span>Sub-issue of</span>
      {status && <StatusGlyph category={status.category} color={statusColor(status)} size={12} />}
      <IssueKey value={parent.key} />
      <span className="truncate">{parent.title}</span>
    </Link>
  );
}

/** The title edits in place: Enter or blur saves, Esc puts it back. No line breaks. */
function TitleField({ issue, actions }: { issue: Doc<"issues">; actions: IssueActions }) {
  const [draft, setDraft] = useState(issue.title);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const shown = focused ? draft : issue.title;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${element.scrollHeight}px`;
  }, [shown]);

  function commit() {
    setFocused(false);
    const next = normalizeTitle(draft);
    if (next && next !== issue.title) void actions.update(issue._id, { title: next });
  }

  return (
    <textarea
      ref={ref}
      rows={1}
      value={shown}
      aria-label="Title"
      maxLength={200}
      onFocus={() => {
        setDraft(issue.title);
        setFocused(true);
      }}
      onChange={(event) => setDraft(event.target.value.replace(/\n/g, " "))}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          setDraft(issue.title);
          setFocused(false);
          requestAnimationFrame(() => ref.current?.blur());
        }
      }}
      className="font-display text-foreground hover:bg-gray-2 -mx-2 resize-none overflow-hidden rounded-md bg-transparent px-2 py-1 text-2xl font-semibold tracking-[-0.012em] transition-colors duration-(--duration-instant) outline-none focus:bg-transparent"
    />
  );
}

function SubIssueList({
  subIssues,
  lookups,
  actions,
}: {
  subIssues: ListIssue[];
  lookups: Lookups;
  actions: IssueActions;
}) {
  const { Link } = useNavigation();
  return (
    <IssueContextMenu issues={subIssues} lookups={lookups} actions={actions}>
      <ul className="border-border flex flex-col overflow-hidden rounded-lg border">
        {subIssues.map((sub) => (
          <li
            key={sub._id}
            data-issue-id={sub._id}
            className="h-row border-border hover:bg-accent data-menu-open:bg-accent relative flex items-center gap-2 border-b px-2 text-sm transition-colors duration-(--duration-instant) last:border-b-0"
          >
            <StatusPicker
              statuses={lookups.data.statuses}
              value={sub.statusId}
              onChange={(statusId) => void actions.move(sub._id, statusId)}
            />
            <IssueKey value={sub.key} className="w-14" />
            <Link
              href={routes.issue(sub.key)}
              className="text-foreground min-w-0 flex-1 truncate outline-none after:absolute after:inset-0 focus-visible:underline"
            >
              {sub.title}
            </Link>
            <AssigneePicker
              members={lookups.data.members}
              me={lookups.data.me}
              value={sub.assigneeId}
              onChange={(assigneeId) => void actions.update(sub._id, { assigneeId })}
            />
          </li>
        ))}
      </ul>
    </IssueContextMenu>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-8 items-start gap-2">
      <span className="text-muted-foreground flex h-7 w-20 shrink-0 items-center text-xs">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

function PropertiesPanel({
  issue,
  space,
  parent,
  lookups,
  actions,
  subIssueCount,
}: {
  issue: Doc<"issues">;
  space: Doc<"spaces"> | null;
  parent: IssueData["parent"];
  lookups: Lookups;
  actions: IssueActions;
  subIssueCount: number;
}) {
  const { data } = lookups;
  const creator = lookups.member(issue.creatorId);
  return (
    <aside
      aria-label="Properties"
      className="border-border bg-gray-2 flex shrink-0 flex-col gap-4 overflow-y-auto border-t p-4 lg:w-76 lg:border-t-0 lg:border-l"
    >
      <div className="flex items-center gap-1">
        <IssueKey value={issue.key} className="text-foreground" />
        <IssueMenu issue={issue} subIssueCount={subIssueCount} />
      </div>
      <div className="flex flex-col gap-0.5">
        <PropertyRow label="Status">
          <StatusPicker
            statuses={data.statuses}
            value={issue.statusId}
            onChange={(statusId) => void actions.move(issue._id, statusId)}
            variant="full"
          />
        </PropertyRow>
        <PropertyRow label="Priority">
          <PriorityPicker
            value={issue.priority}
            onChange={(priority) => void actions.update(issue._id, { priority })}
            variant="full"
          />
        </PropertyRow>
        <PropertyRow label="Assignee">
          <AssigneePicker
            members={data.members}
            me={data.me}
            value={issue.assigneeId}
            onChange={(assigneeId) => void actions.update(issue._id, { assigneeId })}
            variant="full"
          />
        </PropertyRow>
        <PropertyRow label="Labels">
          <LabelsPicker
            labels={data.labels}
            value={issue.labelIds}
            onChange={(labelIds) => void actions.update(issue._id, { labelIds })}
          />
        </PropertyRow>
        <PropertyRow label="Due date">
          <DueDatePicker
            value={issue.dueDate}
            onChange={(dueDate) => void actions.update(issue._id, { dueDate })}
            variant="full"
          />
        </PropertyRow>
        <PropertyRow label="Project">
          <ProjectPicker
            projects={lookups.projectsOf(issue.spaceId)}
            value={issue.projectId}
            onChange={(projectId) => void actions.update(issue._id, { projectId })}
            lockedReason={issue.parentId ? "Sub-issues are in their parent's project" : undefined}
          />
        </PropertyRow>
        <PropertyRow label="Space">
          <span className="text-foreground flex h-7 min-w-0 items-center gap-2 px-2 text-sm">
            <FolderIcon className="text-muted-foreground size-3.5" aria-hidden />
            <span className="truncate">{space?.name ?? "—"}</span>
          </span>
        </PropertyRow>
        <PropertyRow label="Parent">
          <ParentPicker
            issue={issue}
            parent={parent}
            subIssueCount={subIssueCount}
            actions={actions}
          />
        </PropertyRow>
      </div>
      <div className="border-border text-muted-foreground mt-auto flex flex-col gap-1.5 border-t pt-3 text-xs">
        <span className="flex items-center gap-1.5">
          <PersonAvatar person={{ name: creator?.displayName ?? "?" }} size="xs" />
          Created by {creator?.displayName ?? "someone"}{" "}
          <span title={fullDate(issue._creationTime)}>{timeAgo(issue._creationTime)}</span>
        </span>
        <span title={fullDate(issue.updatedAt)}>Updated {timeAgo(issue.updatedAt)}</span>
      </div>
    </aside>
  );
}

/**
 * Pick or clear the parent: open top-level issues of the same space. Hidden for issues that have
 * sub-issues (one level only; the server enforces it too).
 */
function ParentPicker({
  issue,
  parent,
  subIssueCount,
  actions,
}: {
  issue: Doc<"issues">;
  parent: IssueData["parent"];
  subIssueCount: number;
  actions: IssueActions;
}) {
  const { Link } = useNavigation();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const candidates = useQuery(
    api.issues.listBySpace,
    open && issue.spaceId ? { spaceId: issue.spaceId } : "skip",
  );

  if (subIssueCount > 0) {
    return (
      <span className="text-muted-foreground flex h-7 items-center px-2 text-sm">
        Has sub-issues
      </span>
    );
  }
  const options = (candidates ?? [])
    .filter((row) => row._id !== issue._id && row.parentId === undefined)
    .filter((row) => {
      const q = query.trim().toLowerCase();
      return !q || row.key.toLowerCase().includes(q) || row.title.toLowerCase().includes(q);
    })
    .slice(0, 50);

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5">
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
      >
        <PopoverTrigger
          className={cn(
            "hover:bg-accent aria-expanded:bg-accent focus-visible:outline-ring flex h-7 min-w-0 flex-1 cursor-default items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-(--duration-instant) outline-none focus-visible:outline-2",
          )}
          aria-label="Parent issue. Change parent"
        >
          <CornerLeftUpIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
          {parent ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <IssueKey value={parent.key} className="text-foreground" />
              <span className="text-foreground truncate">{parent.title}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 gap-1 p-1.5">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a parent by key or title…"
            aria-label="Find a parent issue"
            autoFocus
            className="text-foreground placeholder:text-faint-foreground h-8 rounded-md bg-transparent px-2 text-sm outline-none"
          />
          <div className="border-border flex max-h-64 flex-col overflow-y-auto border-t pt-1">
            {candidates === undefined ? (
              <span className="text-muted-foreground px-2 py-1.5 text-sm">Loading…</span>
            ) : options.length === 0 ? (
              <span className="text-muted-foreground px-2 py-1.5 text-sm">No matching issues.</span>
            ) : (
              options.map((row) => (
                <button
                  key={row._id}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (row._id !== issue.parentId)
                      void actions.update(issue._id, { parentId: row._id });
                  }}
                  className="text-foreground hover:bg-accent focus-visible:bg-accent flex h-7 shrink-0 items-center gap-2 rounded-sm px-2 text-left text-sm outline-none"
                >
                  <IssueKey value={row.key} className="w-14" />
                  <span className="truncate">{row.title}</span>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
      {parent && (
        <>
          <Link
            href={routes.issue(parent.key)}
            aria-label={`Open ${parent.key}`}
            className="text-muted-foreground hover:bg-accent hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-sm"
          >
            <ChevronRightIcon className="size-3" />
          </Link>
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label="Remove parent"
            onClick={() => void actions.update(issue._id, { parentId: null })}
          >
            <XIcon />
          </Button>
        </>
      )}
    </div>
  );
}

function IssueMenu({ issue, subIssueCount }: { issue: Doc<"issues">; subIssueCount: number }) {
  const remove = useMutation(api.issues.remove);
  const { navigate } = useNavigation();
  const [deleting, setDeleting] = useState(false);
  const spaceKey = issue.key.split("-")[0]!;
  const copy = copyText;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label="Issue actions" />
          }
        >
          <MoreHorizontalIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuItem onClick={() => void copy(issue.key, issue.key)}>
            <CopyIcon />
            Copy key
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void copy(`${window.location.origin}${routes.issue(issue.key)}`, "link")}
          >
            <LinkIcon />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => setDeleting(true)}>
            <Trash2Icon />
            Delete issue…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${issue.key}?`}
        description={
          subIssueCount > 0
            ? `Its ${subIssueCount} sub-issue${subIssueCount === 1 ? "" : "s"}, comments and activity are deleted too. There's no trash: this can't be undone.`
            : "Its comments and activity are deleted too. There's no trash: this can't be undone."
        }
        confirmLabel="Delete issue"
        destructive
        onConfirm={async () => {
          try {
            await remove({ issueId: issue._id });
            toast(`Deleted ${issue.key}`);
            navigate(routes.space(spaceKey));
          } catch (err) {
            toast.error(describeError(err, "Couldn't delete the issue."));
          }
        }}
      />
    </>
  );
}
