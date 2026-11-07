import { tinykeys } from "tinykeys";

/**
 * The shortcut registry (spec §4, §10b M3 task 1). Every keyboard shortcut in the app is declared
 * here, once: the `?` help, the palette's keycap hints and the key bindings all read this list.
 *
 * Scopes form a stack: `global` at the bottom, then the page (`list` for list, board and My issues,
 * `issue` for issue detail), then `overlay` while a dialog, the palette or a menu is open. A key goes
 * to the top scope only: a page scope falls back to `global`, an overlay doesn't fall back at all,
 * so `J` never moves the list selection behind an open dialog.
 */

export type ShortcutScope = "global" | "list" | "issue" | "overlay";

export type ShortcutGroup = "General" | "Navigation" | "Selection" | "Edit issues";

export type ShortcutDef = {
  id: ShortcutId;
  /** tinykeys binding: `$mod+k`, `[Shift]+?`, sequences like `g i`. */
  binding: string;
  /** Keycap notation for hints (`mod+k`, `?`, `g i`). */
  display: string;
  label: string;
  group: ShortcutGroup;
  /** Where it applies, for the help ("everywhere", "lists and boards", "an issue"). */
  where: ReadonlyArray<Exclude<ShortcutScope, "overlay">>;
  /** Fires while typing in an input or editor (modifier shortcuts only). */
  allowInInputs?: boolean;
  /** Fires again while the key is held (J/K). */
  repeat?: boolean;
  /** Listed in the help but handled by the focused component itself (editors, dialogs). */
  unbound?: true;
};

export const SHORTCUT_IDS = [
  "palette",
  "help",
  "contextMenu",
  "sidebar",
  "newIssue",
  "newSubIssue",
  "search",
  "submit",
  "escape",
  "goMyIssues",
  "goSpace",
  "goBoard",
  "next",
  "previous",
  "open",
  "select",
  "status",
  "assignee",
  "assignToMe",
  "labels",
  "priority",
  "dueDate",
] as const;

export type ShortcutId = (typeof SHORTCUT_IDS)[number];

const everywhere = ["global"] as const;
const lists = ["list"] as const;
const editable = ["list", "issue"] as const;

/**
 * Order matters to tinykeys: the first binding that completes wins, so sequences (`g i`) come
 * before the single keys they share a letter with (`i`).
 */
export const SHORTCUTS: ReadonlyArray<ShortcutDef> = [
  {
    id: "goMyIssues",
    binding: "g i",
    display: "g i",
    label: "Go to My issues",
    group: "Navigation",
    where: everywhere,
  },
  {
    id: "goSpace",
    binding: "g s",
    display: "g s",
    label: "Go to the space's list",
    group: "Navigation",
    where: everywhere,
  },
  {
    id: "goBoard",
    binding: "g b",
    display: "g b",
    label: "Go to the space's board",
    group: "Navigation",
    where: everywhere,
  },

  {
    id: "palette",
    binding: "$mod+k",
    display: "mod+k",
    label: "Open the command palette",
    group: "General",
    where: everywhere,
    allowInInputs: true,
  },
  {
    id: "newIssue",
    binding: "c",
    display: "c",
    label: "New issue",
    group: "General",
    where: everywhere,
  },
  {
    id: "newSubIssue",
    binding: "Shift+c",
    display: "shift+c",
    label: "New sub-issue",
    group: "General",
    where: ["issue"],
  },
  {
    id: "search",
    binding: "/",
    display: "/",
    label: "Filter the view by title, or search",
    group: "General",
    where: everywhere,
  },
  {
    id: "escape",
    binding: "Escape",
    display: "esc",
    label: "Back, close, or clear the selection",
    group: "General",
    where: everywhere,
  },
  {
    id: "submit",
    binding: "$mod+Enter",
    display: "mod+enter",
    label: "Submit a comment or issue",
    group: "General",
    where: everywhere,
    unbound: true,
  },
  {
    id: "contextMenu",
    binding: "Shift+F10",
    display: "shift+f10",
    label: "Open the right-click menu",
    group: "General",
    where: everywhere,
  },
  {
    id: "sidebar",
    binding: "[",
    display: "[",
    label: "Fold or unfold the sidebar",
    group: "General",
    where: everywhere,
  },
  {
    id: "help",
    binding: "[Shift]+?",
    display: "?",
    label: "Show keyboard shortcuts",
    group: "General",
    where: everywhere,
  },

  {
    id: "next",
    binding: "j",
    display: "j",
    label: "Move the cursor down",
    group: "Selection",
    where: lists,
    repeat: true,
  },
  {
    id: "previous",
    binding: "k",
    display: "k",
    label: "Move the cursor up",
    group: "Selection",
    where: lists,
    repeat: true,
  },
  {
    id: "select",
    binding: "x",
    display: "x",
    label: "Select or deselect (multi-select)",
    group: "Selection",
    where: lists,
  },
  {
    id: "open",
    binding: "Enter",
    display: "enter",
    label: "Open the issue",
    group: "Selection",
    where: lists,
  },

  {
    id: "status",
    binding: "s",
    display: "s",
    label: "Change status",
    group: "Edit issues",
    where: editable,
  },
  {
    id: "assignee",
    binding: "a",
    display: "a",
    label: "Change assignee",
    group: "Edit issues",
    where: editable,
  },
  {
    id: "assignToMe",
    binding: "i",
    display: "i",
    label: "Assign to me",
    group: "Edit issues",
    where: editable,
  },
  {
    id: "labels",
    binding: "l",
    display: "l",
    label: "Change labels",
    group: "Edit issues",
    where: editable,
  },
  {
    id: "priority",
    binding: "p",
    display: "p",
    label: "Change priority",
    group: "Edit issues",
    where: editable,
  },
  {
    id: "dueDate",
    binding: "d",
    display: "d",
    label: "Change due date",
    group: "Edit issues",
    where: editable,
  },
];

const BY_ID = new Map(SHORTCUTS.map((def) => [def.id, def]));

export function shortcut(id: ShortcutId): ShortcutDef {
  return BY_ID.get(id)!;
}

// ---------------------------------------------------------------------------------------------
// Help (generated from the registry)
// ---------------------------------------------------------------------------------------------

export const HELP_GROUPS: ReadonlyArray<ShortcutGroup> = [
  "General",
  "Navigation",
  "Selection",
  "Edit issues",
];

const WHERE_TEXT: Record<string, string> = {
  global: "",
  list: "Lists and boards",
  issue: "On an issue",
  "list,issue": "Lists, boards and issues",
};

export type HelpSection = {
  group: ShortcutGroup;
  /** Where the group's shortcuts work, when they share it ("Lists and boards"). */
  where: string;
  /** `where` on a row only when it differs from the group's. */
  rows: { id: ShortcutId; label: string; keys: string; where: string }[];
};

/** The `?` help: every registered shortcut, grouped, in registry order within a group. */
export function helpSections(defs: ReadonlyArray<ShortcutDef> = SHORTCUTS): HelpSection[] {
  return HELP_GROUPS.map((group) => {
    const rows = defs
      .filter((def) => def.group === group)
      .map((def) => ({
        id: def.id,
        label: def.label,
        keys: def.display,
        where: WHERE_TEXT[def.where.join(",")] ?? "",
      }));
    // The group's note is the place most of its rows share.
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.where, (counts.get(row.where) ?? 0) + 1);
    const where = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
    return {
      group,
      where,
      rows: rows.map((row) => ({ ...row, where: row.where === where ? "" : row.where })),
    };
  }).filter((section) => section.rows.length > 0);
}

// ---------------------------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------------------------

/** Return `false` when the key wasn't used (it then keeps its default behaviour). */
export type ShortcutHandler = (event: KeyboardEvent) => void | false;

/**
 * A popup that's animating out (Base UI marks it `data-closed` / `data-ending-style`) still holds
 * focus for a moment; keys pressed then belong to the page, so the next shortcut isn't lost.
 */
function inClosingPopup(element: Element): boolean {
  return element.closest("[data-closed], [data-ending-style]") !== null;
}

/** Inputs, textareas, selects and rich-text editors: letter keys are text there. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as Element;
  if (inClosingPopup(element)) return false;
  if (element.closest("input, textarea, select")) return true;
  const editable = element.closest("[contenteditable]");
  return editable !== null && editable.getAttribute("contenteditable") !== "false";
}

/**
 * Menus, listboxes and dialogs that aren't registered as an overlay scope (Base UI menus and
 * popovers move focus into their popup): keys pressed in them belong to them.
 */
const POPUP_SELECTOR =
  '[role="menu"], [role="listbox"], [role="dialog"], [role="alertdialog"], [data-shortcut-overlay]';

function inPopup(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as Element;
  return element.closest(POPUP_SELECTOR) !== null && !inClosingPopup(element);
}

type Entry = { scope: ShortcutScope; handler: ShortcutHandler; order: number };

export class ShortcutRegistry {
  private readonly handlers = new Map<ShortcutId, Entry[]>();
  private stack: { scope: ShortcutScope; token: number }[] = [];
  private counter = 0;
  private unbind: (() => void) | null = null;
  private bindings = 0;

  constructor(readonly defs: ReadonlyArray<ShortcutDef> = SHORTCUTS) {}

  /** Handle `id` while `scope` is the top scope (page scopes also fall back to `global`). */
  register(id: ShortcutId, scope: ShortcutScope, handler: ShortcutHandler): () => void {
    const entry: Entry = { scope, handler, order: ++this.counter };
    this.handlers.set(id, [...(this.handlers.get(id) ?? []), entry]);
    return () =>
      this.handlers.set(
        id,
        (this.handlers.get(id) ?? []).filter((item) => item !== entry),
      );
  }

  /** Push a scope (a page or an open overlay); returns the pop. Pops in any order are safe. */
  push(scope: ShortcutScope): () => void {
    const token = ++this.counter;
    this.stack.push({ scope, token });
    return () => {
      this.stack = this.stack.filter((item) => item.token !== token);
    };
  }

  /** The current top scope. Overlays win over pages; the latest page wins over older ones. */
  top(target: EventTarget | null = null): ShortcutScope {
    if (this.stack.some((item) => item.scope === "overlay") || inPopup(target)) return "overlay";
    const page = [...this.stack].reverse().find((item) => item.scope !== "global");
    return page?.scope ?? "global";
  }

  /** The handler a key would reach right now, if any. */
  resolve(id: ShortcutId, target: EventTarget | null = null): Entry | undefined {
    const top = this.top(target);
    const entries = this.handlers.get(id) ?? [];
    const pick = (scope: ShortcutScope) =>
      entries.filter((entry) => entry.scope === scope).sort((a, b) => b.order - a.order)[0];
    if (top === "overlay") return pick("overlay");
    return pick(top) ?? (top === "global" ? undefined : pick("global"));
  }

  /** Run `id` for a key event. Returns whether a handler took it. */
  dispatch(id: ShortcutId, event: KeyboardEvent): boolean {
    const def = BY_ID.get(id);
    if (!def || def.unbound) return false;
    if (event.isComposing) return false;
    if (event.repeat && !def.repeat) return false;
    if (!def.allowInInputs && isTypingTarget(event.target)) return false;
    const entry = this.resolve(id, event.target);
    if (!entry) return false;
    if (entry.handler(event) === false) return false;
    event.preventDefault();
    return true;
  }

  /** Listen on `target` (the window). Reference-counted, so nested callers share one listener. */
  bind(target: Window | HTMLElement = window): () => void {
    this.bindings += 1;
    if (!this.unbind) {
      const map: Record<string, (event: KeyboardEvent) => void> = {};
      for (const def of this.defs) {
        if (def.unbound) continue;
        map[def.binding] = (event) => void this.dispatch(def.id, event);
      }
      this.unbind = tinykeys(target, map, {
        // Typing never starts a sequence; modifier chords (Cmd+K) still reach dispatch.
        ignore: (event) =>
          event.isComposing || (isTypingTarget(event.target) && !event.metaKey && !event.ctrlKey),
      });
    }
    return () => {
      this.bindings -= 1;
      if (this.bindings === 0 && this.unbind) {
        this.unbind();
        this.unbind = null;
      }
    };
  }
}

/** The app's one registry. */
export const shortcuts = new ShortcutRegistry();
