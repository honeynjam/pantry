"use client";

import type { Id } from "@pantry/backend/dataModel";
import { PersonAvatar } from "@pantry/ui/components/avatar-stack";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@pantry/ui/components/command";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { Keycap } from "@pantry/ui/components/keycap";
import { PriorityGlyph } from "@pantry/ui/components/priority-glyph";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { PRIORITIES, PRIORITY_LABEL, resolveLabelColor } from "@pantry/ui/lib/issue-meta";
import { cn } from "@pantry/ui/lib/utils";
import { CalendarIcon, CalendarX2Icon, CheckIcon, MinusIcon, UserRoundIcon } from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { addDays, formatDay, today } from "../lib/format";
import { highlightRuns, rank } from "../palette/rank";
import { useShortcutScope } from "../use-shortcuts";
import type { IssueActions } from "./actions";
import { statusColor, type Lookups, type ListIssue } from "./lookups";

/** The properties `S`, `A`, `L`, `P` and `D` edit. */
export type QuickEditKind = "status" | "assignee" | "labels" | "priority" | "dueDate";

const TITLES: Record<QuickEditKind, string> = {
  status: "Change status",
  assignee: "Change assignee",
  labels: "Change labels",
  priority: "Change priority",
  dueDate: "Change due date",
};

const PLACEHOLDERS: Record<QuickEditKind, string> = {
  status: "Status…",
  assignee: "Assign to…",
  labels: "Labels…",
  priority: "Priority…",
  dueDate: "Due date… (or type 2026-11-30)",
};

export type QuickEditOption = {
  id: string;
  label: string;
  keywords?: string[];
  icon: ReactNode;
  /** Shared by every target (true), by some ("mixed"), or none. */
  checked: boolean | "mixed";
  apply: () => void;
};

export const plural = (count: number, one: string) => `${count} ${count === 1 ? one : `${one}s`}`;

/**
 * Quick edit for the selection (spec §4 S/A/L/P/D): a small palette of options that applies to
 * every target issue, one mutation per issue. Status goes through `issues.move`.
 */
export function useQuickEdit(
  lookups: Lookups,
  actions: IssueActions,
  issues: ReadonlyArray<ListIssue>,
  /** The element to focus when the picker closes (the cursor's row); default: where focus was. */
  returnFocus?: () => HTMLElement | null,
) {
  const [state, setState] = useState<{ kind: QuickEditKind; ids: Id<"issues">[] } | null>(null);

  const open = useCallback((kind: QuickEditKind, targets: ReadonlyArray<ListIssue>) => {
    if (targets.length > 0) setState({ kind, ids: targets.map((issue) => issue._id) });
  }, []);

  // The latest version of each target, so the dialog reflects changes as they land.
  const targets = useMemo(() => {
    if (!state) return [];
    const byId = new Map(issues.map((issue) => [issue._id, issue]));
    return state.ids.map((id) => byId.get(id)).filter((issue) => issue !== undefined);
  }, [state, issues]);

  const element = (
    <QuickEditDialog
      kind={state?.kind ?? null}
      targets={targets}
      lookups={lookups}
      actions={actions}
      onClose={() => setState(null)}
      returnFocus={returnFocus}
    />
  );
  return { open, element, isOpen: state !== null };
}

/** `I`: assign every target to me, one mutation per issue that isn't mine yet. */
export function assignToMe(
  targets: ReadonlyArray<ListIssue>,
  lookups: Lookups,
  actions: IssueActions,
) {
  const me = lookups.data.me._id;
  const todo = targets.filter((issue) => issue.assigneeId !== me);
  if (todo.length === 0) {
    toast(targets.length === 1 ? `${targets[0]!.key} is already yours` : "These are already yours");
    return;
  }
  for (const issue of todo) void actions.update(issue._id, { assigneeId: me });
  if (todo.length > 1) toast(`Assigned ${plural(todo.length, "issue")} to you`);
}

function shared<T>(
  targets: ReadonlyArray<ListIssue>,
  read: (issue: ListIssue) => T,
  value: T,
): boolean | "mixed" {
  const hits = targets.filter((issue) => read(issue) === value).length;
  return hits === 0 ? false : hits === targets.length ? true : "mixed";
}

/** The options S/A/L/P/D offer for `targets`; the context menu's submenus show the same ones. */
export function buildOptions(
  kind: QuickEditKind,
  targets: ReadonlyArray<ListIssue>,
  lookups: Lookups,
  actions: IssueActions,
  query: string,
): QuickEditOption[] {
  const { data } = lookups;
  const many = targets.length > 1;
  const done = (message: string) => many && toast(message);

  switch (kind) {
    case "status":
      return data.statuses.map((status) => ({
        id: status._id,
        label: status.name,
        icon: <StatusGlyph category={status.category} color={statusColor(status)} />,
        checked: shared(targets, (issue) => issue.statusId, status._id),
        apply: () => {
          const moving = targets.filter((issue) => issue.statusId !== status._id);
          // Each move lands on top of the column, so go bottom-up to keep their order.
          for (const issue of [...moving].reverse()) void actions.move(issue._id, status._id);
          done(`Moved ${plural(moving.length, "issue")} to ${status.name}`);
        },
      }));
    case "priority":
      return PRIORITIES.map((priority) => ({
        id: `priority-${priority}`,
        label: PRIORITY_LABEL[priority],
        icon: <PriorityGlyph priority={priority} />,
        checked: shared(targets, (issue) => issue.priority, priority),
        apply: () => {
          const changing = targets.filter((issue) => issue.priority !== priority);
          for (const issue of changing) void actions.update(issue._id, { priority });
          done(`Set ${plural(changing.length, "issue")} to ${PRIORITY_LABEL[priority]}`);
        },
      }));
    case "assignee": {
      const people = [data.me, ...data.members.filter((member) => member._id !== data.me._id)];
      const assign = (memberId: Id<"members"> | null, name: string) => {
        const changing = targets.filter((issue) => (issue.assigneeId ?? null) !== memberId);
        for (const issue of changing) void actions.update(issue._id, { assigneeId: memberId });
        done(
          memberId
            ? `Assigned ${plural(changing.length, "issue")} to ${name}`
            : `Unassigned ${plural(changing.length, "issue")}`,
        );
      };
      return [
        {
          id: "assignee-none",
          label: "No assignee",
          keywords: ["unassign", "nobody"],
          icon: <UserRoundIcon />,
          checked: shared(targets, (issue) => issue.assigneeId ?? null, null),
          apply: () => assign(null, ""),
        },
        ...people.map<QuickEditOption>((member) => ({
          id: member._id,
          label: member._id === data.me._id ? `${member.displayName} (you)` : member.displayName,
          keywords: member._id === data.me._id ? ["me", "myself"] : [],
          icon: (
            <PersonAvatar
              person={{ name: member.displayName, avatarUrl: member.avatarUrl }}
              size="xs"
            />
          ),
          checked: shared(targets, (issue) => issue.assigneeId ?? null, member._id),
          apply: () => assign(member._id, member.displayName),
        })),
      ];
    }
    case "labels":
      return [...data.labels]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((label) => {
          const hits = targets.filter((issue) => issue.labelIds.includes(label._id)).length;
          const all = hits === targets.length;
          return {
            id: label._id,
            label: label.name,
            icon: (
              <span
                className="size-2 rounded-full"
                style={{ background: resolveLabelColor(label.color) }}
              />
            ),
            checked: hits === 0 ? false : all ? true : "mixed",
            // All have it: remove it from all. Otherwise add it where it's missing.
            apply: () => {
              for (const issue of targets) {
                const has = issue.labelIds.includes(label._id);
                if (all)
                  void actions.update(issue._id, {
                    labelIds: issue.labelIds.filter((id) => id !== label._id),
                  });
                else if (!has)
                  void actions.update(issue._id, { labelIds: [...issue.labelIds, label._id] });
              }
            },
          } satisfies QuickEditOption;
        });
    case "dueDate": {
      const set = (day: string | null) => {
        const changing = targets.filter((issue) => (issue.dueDate ?? null) !== day);
        for (const issue of changing) void actions.update(issue._id, { dueDate: day });
        done(
          day
            ? `Set ${plural(changing.length, "due date")} to ${formatDay(day)}`
            : `Cleared ${plural(changing.length, "due date")}`,
        );
      };
      const typed = query.trim();
      const valid =
        /^\d{4}-\d{2}-\d{2}$/.test(typed) && !Number.isNaN(new Date(`${typed}T00:00:00`).getTime());
      const day = (id: string, label: string, value: string): QuickEditOption => ({
        id,
        label,
        keywords: [formatDay(value)],
        icon: <CalendarIcon />,
        checked: shared(targets, (issue) => issue.dueDate ?? null, value),
        apply: () => set(value),
      });
      return [
        ...(valid ? [day(`typed-${typed}`, `On ${formatDay(typed)}`, typed)] : []),
        day("today", "Today", today()),
        day("tomorrow", "Tomorrow", addDays(1)),
        day("week", "In a week", addDays(7)),
        day("two-weeks", "In two weeks", addDays(14)),
        {
          id: "clear",
          label: "No due date",
          keywords: ["clear", "remove", "none"],
          icon: <CalendarX2Icon />,
          checked: shared(targets, (issue) => issue.dueDate ?? null, null),
          apply: () => set(null),
        },
      ];
    }
  }
}

function QuickEditDialog({
  kind,
  targets,
  lookups,
  actions,
  onClose,
  returnFocus,
}: {
  kind: QuickEditKind | null;
  targets: ReadonlyArray<ListIssue>;
  lookups: Lookups;
  actions: IssueActions;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
}) {
  const open = kind !== null && targets.length > 0;
  const [query, setQuery] = useState("");
  useShortcutScope("overlay", open);
  const close = () => {
    setQuery("");
    onClose();
  };

  return (
    <CommandDialog
      open={open}
      title={kind ? TITLES[kind] : "Edit issues"}
      description={
        targets.length === 1
          ? `${targets[0]!.key} ${targets[0]!.title}`
          : plural(targets.length, "issue")
      }
      className="sm:max-w-md"
      finalFocus={returnFocus ? () => returnFocus() ?? true : undefined}
      onOpenChange={(next, details) => {
        if (!next && details.reason === "escape-key" && query) {
          details.cancel();
          setQuery("");
          return;
        }
        if (!next) close();
      }}
    >
      {open && kind && (
        <QuickEditBody
          kind={kind}
          targets={targets}
          lookups={lookups}
          actions={actions}
          query={query}
          setQuery={setQuery}
          close={close}
        />
      )}
    </CommandDialog>
  );
}

function QuickEditBody({
  kind,
  targets,
  lookups,
  actions,
  query,
  setQuery,
  close,
}: {
  kind: QuickEditKind;
  targets: ReadonlyArray<ListIssue>;
  lookups: Lookups;
  actions: IssueActions;
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
}) {
  const [value, setValue] = useState("");
  const options = buildOptions(kind, targets, lookups, actions, query);
  // A typed date isn't a filter: keep every option and put the typed one first.
  const ranked =
    kind === "dueDate" && /^\d{4}-/.test(query.trim())
      ? options.map((item) => ({ item, matches: [] as number[] }))
      : rank(options, query);
  const ids = ranked.map((entry) => entry.item.id);
  // Start on the current value when every target shares it, else on the first option.
  const current = ranked.find((entry) => entry.item.checked === true)?.item.id;
  const active = ids.includes(value) ? value : query ? (ids[0] ?? "") : (current ?? ids[0] ?? "");
  const multi = kind === "labels";

  return (
    <Command shouldFilter={false} value={active} onValueChange={setValue} loop>
      <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 px-3.5 pt-3 text-xs">
        <span className="text-foreground font-medium">{TITLES[kind]}</span>
        <span aria-hidden>·</span>
        {targets.length === 1 ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <IssueKey value={targets[0]!.key} />
            <span className="truncate">{targets[0]!.title}</span>
          </span>
        ) : (
          <span>{plural(targets.length, "issue")}</span>
        )}
      </div>
      <CommandInput
        value={query}
        onValueChange={(next) => (setQuery(next), setValue(""))}
        placeholder={PLACEHOLDERS[kind]}
        aria-label={TITLES[kind]}
        autoFocus
      />
      <CommandList>
        <CommandEmpty>
          {kind === "labels" && lookups.data.labels.length === 0
            ? "No labels yet. Add them in Settings."
            : "No matches."}
        </CommandEmpty>
        {ranked.map(({ item, matches }) => (
          <CommandItem
            key={item.id}
            value={item.id}
            onSelect={() => {
              item.apply();
              if (!multi) close();
            }}
          >
            <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
              {item.icon}
            </span>
            <span className="truncate">
              {highlightRuns(item.label, matches).map((run, index) => (
                <span key={index} className={cn(run.matched && "font-medium")}>
                  {run.text}
                </span>
              ))}
            </span>
            <span
              className="text-muted-foreground ml-auto flex size-4 items-center justify-center"
              aria-hidden
            >
              {item.checked === true ? (
                <CheckIcon className="size-3.5" />
              ) : item.checked === "mixed" ? (
                <MinusIcon className="size-3.5" />
              ) : null}
            </span>
            <span className="sr-only">
              {item.checked === true ? "(current)" : item.checked === "mixed" ? "(some)" : ""}
            </span>
          </CommandItem>
        ))}
      </CommandList>
      <div className="border-border text-muted-foreground flex h-9 items-center gap-3 border-t px-3.5 text-xs">
        <span className="flex items-center gap-1.5">
          <Keycap keys="enter" /> {multi ? "to toggle" : "to apply"}
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap keys="esc" /> {query ? "to clear" : multi ? "when done" : "to close"}
        </span>
      </div>
    </Command>
  );
}
