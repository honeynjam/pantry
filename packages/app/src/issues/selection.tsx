"use client";

import type { Id } from "@pantry/backend/dataModel";
import {
  CircleDotIcon,
  CalendarIcon,
  SignalIcon,
  TagIcon,
  UserRoundIcon,
  UserRoundCheckIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { toast } from "sonner";
import { routes, useNavigation } from "../navigation";
import { usePaletteActions, type PaletteAction } from "../palette/palette-actions";
import { rememberListLocation } from "../shell/locations";
import { useShortcut, useShortcutMap, useShortcutScope } from "../use-shortcuts";
import type { IssueActions } from "./actions";
import type { Lookups, ListIssue } from "./lookups";
import { issueDrag } from "./drag-state";
import { assignToMe, useQuickEdit, type QuickEditKind } from "./quick-edit";

/**
 * Keyboard selection for list, board and My issues (spec §4): `J`/`K` move a cursor through the
 * issues in on-screen order, `X` adds the cursor's issue to a multi-selection, `Enter` opens it,
 * `Esc` clears. `S`/`A`/`I`/`L`/`P`/`D` act on the selection, or on the cursor's issue when
 * nothing is selected.
 */
export type Selection = {
  cursor: Id<"issues"> | null;
  selected: ReadonlySet<Id<"issues">>;
  setCursor: (id: Id<"issues">) => void;
  toggle: (id: Id<"issues">) => void;
};

const QUICK_EDITS: {
  kind: QuickEditKind;
  id: "status" | "assignee" | "labels" | "priority" | "dueDate";
  label: string;
  icon: ReactNode;
}[] = [
  { kind: "status", id: "status", label: "Change status…", icon: <CircleDotIcon /> },
  { kind: "assignee", id: "assignee", label: "Change assignee…", icon: <UserRoundIcon /> },
  { kind: "labels", id: "labels", label: "Change labels…", icon: <TagIcon /> },
  { kind: "priority", id: "priority", label: "Change priority…", icon: <SignalIcon /> },
  { kind: "dueDate", id: "dueDate", label: "Change due date…", icon: <CalendarIcon /> },
];

/** The focusable part of an issue's row (its title link) or card. */
function focusTarget(container: HTMLElement | null, id: Id<"issues">): HTMLElement | null {
  const element = container?.querySelector<HTMLElement>(`[data-issue-id="${id}"]`);
  return element ? (element.querySelector<HTMLElement>("[data-issue-focus]") ?? element) : null;
}

/** Focus the issue's row or card (so screen readers follow) and scroll it into view. */
function focusIssue(container: HTMLElement | null, id: Id<"issues">) {
  const target = focusTarget(container, id);
  if (!target) return;
  target.focus({ preventScroll: true });
  target.closest("[data-issue-id]")?.scrollIntoView({ block: "nearest" });
}

/**
 * Owns the cursor and selection for one view. `ordered` is the on-screen order (status groups or
 * columns, top to bottom). Registers the list-scope shortcuts and the palette's selection actions.
 */
export function useIssueSelection({
  ordered,
  lookups,
  actions,
  container,
}: {
  ordered: ReadonlyArray<ListIssue>;
  lookups: Lookups;
  actions: IssueActions;
  container: RefObject<HTMLElement | null>;
}) {
  const { navigate, pathname, search } = useNavigation();
  // Esc on an issue comes back here, filters included.
  useEffect(() => rememberListLocation(pathname + search), [pathname, search]);
  const [cursorState, setCursorState] = useState<Id<"issues"> | null>(null);
  const [selectedState, setSelected] = useState<ReadonlySet<Id<"issues">>>(new Set());
  // After a picker closes, focus returns to the cursor's row even if it moved (status changes do).
  const cursorRef = useRef<Id<"issues"> | null>(null);
  const quickEdit = useQuickEdit(lookups, actions, ordered, () =>
    cursorRef.current ? focusTarget(container.current, cursorRef.current) : null,
  );

  // Issues that left the view (filtered, moved away, deleted) drop out of the cursor and selection.
  const visible = useMemo(() => new Set(ordered.map((issue) => issue._id)), [ordered]);
  const cursor = cursorState && visible.has(cursorState) ? cursorState : null;
  const selected = useMemo(
    () => new Set([...selectedState].filter((id) => visible.has(id))),
    [selectedState, visible],
  );
  useEffect(() => {
    cursorRef.current = cursor;
  });

  const targets = (): ListIssue[] => {
    if (selected.size > 0) return ordered.filter((issue) => selected.has(issue._id));
    const issue = cursor ? ordered.find((row) => row._id === cursor) : undefined;
    return issue ? [issue] : [];
  };

  const moveCursor = (step: 1 | -1) => {
    if (ordered.length === 0) return false;
    const index = cursor ? ordered.findIndex((issue) => issue._id === cursor) : -1;
    const next = index < 0 ? 0 : Math.min(ordered.length - 1, Math.max(0, index + step));
    const id = ordered[next]!._id;
    setCursorState(id);
    focusIssue(container.current, id);
  };

  // Stable, so memoised rows and cards don't re-render when only the cursor moves.
  const toggle = useCallback(
    (id: Id<"issues">) =>
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );

  const edit = (kind: QuickEditKind) => {
    const list = targets();
    if (list.length === 0) {
      toast("Pick an issue first", {
        description: "Move to one with J and K, or select some with X.",
      });
      return;
    }
    quickEdit.open(kind, list);
  };

  useShortcutScope("list");
  // While an issue is being dragged, its keys (Esc cancels, Enter drops) aren't the list's.
  useShortcut("next", "list", () => !issueDrag.active && moveCursor(1));
  useShortcut("previous", "list", () => !issueDrag.active && moveCursor(-1));
  useShortcut("select", "list", () => {
    if (ordered.length === 0) return false;
    const id = cursor ?? ordered[0]!._id;
    if (!cursor) {
      setCursorState(id);
      focusIssue(container.current, id);
    }
    toggle(id);
  });
  useShortcut("open", "list", (event) => {
    if (!cursor || issueDrag.active) return false;
    // Enter on some other control (a button, a menu trigger) is that control's.
    const target = event.target as HTMLElement | null;
    const row = target?.closest?.("[data-issue-id]");
    if (target && target !== document.body && row?.getAttribute("data-issue-id") !== cursor)
      return false;
    const issue = ordered.find((row) => row._id === cursor);
    if (!issue) return false;
    navigate(routes.issue(issue.key));
  });
  useShortcut("escape", "list", () => {
    if (issueDrag.active) return false;
    if (selected.size > 0) setSelected(new Set());
    else if (cursor) setCursorState(null);
    else return false;
  });
  useShortcutMap(
    "list",
    Object.fromEntries(QUICK_EDITS.map((item) => [item.id, () => edit(item.kind)])),
  );
  useShortcut("assignToMe", "list", () => {
    const list = targets();
    if (list.length === 0) return edit("assignee");
    assignToMe(list, lookups, actions);
  });

  usePaletteActions(() => {
    const list = targets();
    if (list.length === 0) return [];
    const description = list.length === 1 ? list[0]!.key : `${list.length} selected`;
    return [
      ...QUICK_EDITS.map<PaletteAction>((item) => ({
        id: `selection:${item.kind}`,
        label: item.label,
        group: "Actions",
        description,
        icon: item.icon,
        shortcut: item.id,
        run: () => quickEdit.open(item.kind, list),
      })),
      {
        id: "selection:assign-to-me",
        label: "Assign to me",
        group: "Actions",
        description,
        icon: <UserRoundCheckIcon />,
        shortcut: "assignToMe",
        run: () => assignToMe(list, lookups, actions),
      },
      ...(selected.size > 0
        ? [
            {
              id: "selection:clear",
              label: "Clear the selection",
              group: "Actions",
              description,
              icon: <XIcon />,
              shortcut: "escape",
              run: () => setSelected(new Set()),
            } satisfies PaletteAction,
          ]
        : []),
    ];
  });

  const value = useMemo<Selection>(
    () => ({ cursor, selected, setCursor: setCursorState, toggle }),
    [cursor, selected, toggle],
  );
  return { value, element: quickEdit.element };
}

/**
 * Issue detail: the same letter keys act on the open issue (no cursor needed), in the `issue` scope.
 */
export function useIssueQuickEdit(issue: ListIssue, lookups: Lookups, actions: IssueActions) {
  const issues = useMemo(() => [issue], [issue]);
  const quickEdit = useQuickEdit(lookups, actions, issues);
  useShortcutMap(
    "issue",
    Object.fromEntries(
      QUICK_EDITS.map((item) => [item.id, () => quickEdit.open(item.kind, issues)]),
    ),
  );
  useShortcut("assignToMe", "issue", () => assignToMe(issues, lookups, actions));
  usePaletteActions(() => [
    ...QUICK_EDITS.map<PaletteAction>((item) => ({
      id: `issue:${item.kind}`,
      label: item.label,
      group: "Actions",
      description: issue.key,
      icon: item.icon,
      shortcut: item.id,
      run: () => quickEdit.open(item.kind, issues),
    })),
    {
      id: "issue:assign-to-me",
      label: "Assign to me",
      group: "Actions",
      description: issue.key,
      icon: <UserRoundCheckIcon />,
      shortcut: "assignToMe",
      run: () => assignToMe(issues, lookups, actions),
    },
  ]);
  return quickEdit.element;
}
