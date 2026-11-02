"use client";

import { api } from "@pantry/backend/api";
import type { Doc } from "@pantry/backend/dataModel";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@pantry/ui/components/command";
import { IssueKey } from "@pantry/ui/components/issue-key";
import { Keycap } from "@pantry/ui/components/keycap";
import { StatusGlyph } from "@pantry/ui/components/status-glyph";
import { useTheme } from "@pantry/ui/lib/theme";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  CircleUserRoundIcon,
  CogIcon,
  FolderIcon,
  HouseIcon,
  KanbanIcon,
  KeyRoundIcon,
  KeyboardIcon,
  LayersIcon,
  ListIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  PanelLeftIcon,
  PlusIcon,
  RotateCcwIcon,
  SunIcon,
  TagIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SpaceAvatar } from "../components/space-avatar";
import { KIND_LABEL, kindOf, modeOf, vocabulary } from "../lib/vocabulary";
import { statusColor } from "../issues/lookups";
import { routes, useNavigation, type SettingsSection } from "../navigation";
import { useAuthClient } from "../providers";
import { useAppCommands } from "../shell/app-commands";
import { projectColor } from "../shell/space-color";
import { slug } from "../issues/filters";
import { shortcut } from "../shortcuts";
import { useShortcut, useShortcutScope } from "../use-shortcuts";
import {
  screenActions,
  useScreenActionsVersion,
  type PaletteAction,
  type PaletteGroup,
} from "./palette-actions";
import { highlightRuns, rankGroups, type Ranked } from "./rank";

const GROUPS: PaletteGroup[] = ["Issues", "Spaces", "Navigation", "Actions"];
const SEARCH_DEBOUNCE_MS = 120;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,9}-\d+$/;

type IssueHit = FunctionReturnType<typeof api.issues.search>[number];
type Row = PaletteAction & { issue?: IssueHit; boost?: number };

/**
 * The command palette (spec §9d): jump to issues, projects and screens, and run any action. Our
 * ranking replaces cmdk's filter; issues come from the debounced `issues.search`.
 */
export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  useShortcutScope("overlay", open);
  useShortcut("palette", "overlay", () => onOpenChange(false), open);

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next, details) => {
        // Esc clears the query first, then closes.
        if (!next && details.reason === "escape-key" && query) {
          details.cancel();
          setQuery("");
          return;
        }
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      {open && <PaletteBody query={query} setQuery={setQuery} close={() => onOpenChange(false)} />}
    </CommandDialog>
  );
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

/** Debounced `issues.search`; keeps the last results on screen while the next ones load. */
function useIssueSearch(query: string): IssueHit[] {
  const text = useDebounced(query.trim(), SEARCH_DEBOUNCE_MS);
  const results = useQuery(api.issues.search, text ? { text } : "skip");
  const [last, setLast] = useState<IssueHit[]>([]);
  if (results !== undefined && last !== results) setLast(results);
  if (!query.trim()) return [];
  return results ?? last;
}

function PaletteBody({
  query,
  setQuery,
  close,
}: {
  query: string;
  setQuery: (query: string) => void;
  close: () => void;
}) {
  const commands = useAppCommands();
  const { data, currentSpace } = commands;
  const { navigate } = useNavigation();
  const { setTheme } = useTheme();
  const authClient = useAuthClient();
  useScreenActionsVersion(); // re-render when a screen adds or removes actions
  const hits = useIssueSearch(query);
  const [value, setValue] = useState("");

  const statusById = useMemo(
    () => new Map(data.statuses.map((status) => [status._id, status])),
    [data.statuses],
  );

  // Rebuilt every render: a few dozen rows, and screen actions read their latest state.
  const rows: Row[] = (() => {
    const settings = (
      section: SettingsSection,
      label: string,
      icon: ReactNode,
      keywords: string[],
    ): Row => ({
      id: `settings:${section}`,
      label,
      group: "Navigation",
      description: "Settings",
      keywords,
      icon,
      run: () => navigate(routes.settings(section)),
    });
    const space = currentSpace;
    const words = vocabulary(modeOf(data.workspace));
    const isOwner = data.me.role === "owner";
    const spaceById = new Map(data.spaces.map((row) => [row._id, row]));
    const exactKey = KEY_PATTERN.test(query.trim()) ? query.trim().toUpperCase() : null;
    return [
      ...hits.map<Row>((issue) => ({
        id: `issue:${issue._id}`,
        label: issue.title,
        group: "Issues",
        keywords: [issue.key],
        issue,
        boost: issue.key === exactKey ? 5000 : 0,
        run: () => navigate(routes.issue(issue.key)),
      })),
      ...data.spaces.map<Row>((row) => ({
        id: `space:${row._id}`,
        label: row.name,
        group: "Spaces",
        description: row.kind === "client" ? "Client" : undefined,
        keywords: [row.key],
        icon: <SpaceAvatar space={row} size="xs" />,
        run: () => navigate(routes.space(row.key)),
      })),
      // Projects open their space's list filtered to them.
      ...data.projects.flatMap<Row>((row) => {
        const parent = spaceById.get(row.spaceId);
        if (!parent) return [];
        return [
          {
            id: `project:${row._id}`,
            label: row.name,
            group: "Spaces",
            description: `Project in ${parent.name}`,
            keywords: [parent.key, parent.name],
            icon: (
              <span className="size-2 rounded-[2px]" style={{ background: projectColor(row) }} />
            ),
            run: () =>
              navigate(`${routes.space(parent.key)}?project=${encodeURIComponent(slug(row.name))}`),
          },
        ];
      }),
      {
        id: "nav:home",
        label: "Go to Home",
        group: "Navigation",
        icon: <HouseIcon />,
        run: () => navigate(routes.home),
      },
      {
        id: "nav:my-issues",
        label: "Go to My issues",
        group: "Navigation",
        keywords: ["assigned", "mine"],
        icon: <CircleUserRoundIcon />,
        shortcut: "goMyIssues",
        run: () => navigate(routes.myIssues),
      },
      ...(space
        ? [
            {
              id: "nav:space-list",
              label: "Go to the space's list",
              group: "Navigation",
              description: space.name,
              icon: <ListIcon />,
              shortcut: "goSpace",
              run: () => navigate(routes.space(space.key)),
            } satisfies Row,
            {
              id: "nav:space-board",
              label: "Go to the space's board",
              group: "Navigation",
              description: space.name,
              icon: <KanbanIcon />,
              shortcut: "goBoard",
              run: () => navigate(routes.board(space.key)),
            } satisfies Row,
            {
              id: "nav:space-settings",
              label: `${KIND_LABEL[kindOf(space)].one} settings`,
              group: "Navigation",
              description: space.name,
              keywords: ["context doc", "projects", "rename", "archive", "kind", "client"],
              icon: <FolderIcon />,
              run: () => navigate(routes.spaceSettings(space.key)),
            } satisfies Row,
          ]
        : []),
      settings("members", "Members and invites", <UsersIcon />, ["invite", "people"]),
      settings("spaces", words.many, <FolderIcon />, ["spaces", "archive", "products", "clients"]),
      settings("labels", "Labels", <TagIcon />, ["tags", "colours", "colors"]),
      settings("statuses", "Statuses", <CogIcon />, ["workflow", "columns"]),
      settings("tokens", "API tokens", <KeyRoundIcon />, [
        "mcp",
        "agents",
        "claude",
        "cursor",
        "token",
      ]),
      {
        id: "action:new-issue",
        label: "New issue",
        group: "Actions",
        description: space ? `In ${space.name}` : undefined,
        keywords: ["create", "add"],
        icon: <PlusIcon />,
        shortcut: "newIssue",
        run: () => commands.newIssue(),
      },
      ...screenActions(),
      {
        id: "action:new-space",
        label: words.newLabel,
        group: "Actions",
        description: words.asksKind ? "Asks which" : undefined,
        keywords: ["create", "add", "space", "product", "client"],
        icon: <FolderIcon />,
        run: () => commands.newSpace(),
      },
      ...(space
        ? [
            {
              id: "action:new-project",
              label: "New project",
              group: "Actions",
              description: `In ${space.name}`,
              keywords: ["create", "add", "workstream"],
              icon: <LayersIcon />,
              run: () => navigate(`${routes.spaceSettings(space.key)}#projects`),
            } satisfies Row,
          ]
        : []),
      {
        id: "action:shortcuts",
        label: "Show keyboard shortcuts",
        group: "Actions",
        keywords: ["help", "keys", "hotkeys"],
        icon: <KeyboardIcon />,
        shortcut: "help",
        run: () => commands.openHelp(),
      },
      {
        id: "action:onboarding",
        label: isOwner ? "Run setup again" : "Show onboarding",
        group: "Actions",
        keywords: ["onboarding", "setup", "welcome", "tour", "start"],
        icon: <RotateCcwIcon />,
        run: () => navigate(routes.welcomeAgain),
      },
      {
        id: "action:sidebar",
        label: "Fold or unfold the sidebar",
        group: "Actions",
        keywords: ["collapse", "expand", "rail", "toggle"],
        icon: <PanelLeftIcon />,
        shortcut: "sidebar",
        run: () => commands.toggleSidebar(),
      },
      {
        id: "action:theme-light",
        label: "Use the light theme",
        group: "Actions",
        keywords: ["appearance", "mode"],
        icon: <SunIcon />,
        run: () => setTheme("light"),
      },
      {
        id: "action:theme-dark",
        label: "Use the dark theme",
        group: "Actions",
        keywords: ["appearance", "mode"],
        icon: <MoonIcon />,
        run: () => setTheme("dark"),
      },
      {
        id: "action:theme-system",
        label: "Use the system theme",
        group: "Actions",
        keywords: ["appearance", "mode", "auto"],
        icon: <MonitorIcon />,
        run: () => setTheme("system"),
      },
      {
        id: "action:sign-out",
        label: "Sign out",
        group: "Actions",
        keywords: ["log out"],
        icon: <LogOutIcon />,
        run: () => void authClient.signOut(),
      },
    ];
  })();

  const groups = rankGroups(rows, query, GROUPS);
  const spaceHeading = vocabulary(modeOf(data.workspace)).many;
  // An exact key match (`PAN-42`) leads, with its group.
  for (const group of groups) {
    group.items.sort((a, b) => (b.item.boost ?? 0) - (a.item.boost ?? 0));
    group.best += Math.max(0, ...group.items.map((entry) => entry.item.boost ?? 0));
  }
  groups.sort((a, b) => b.best - a.best);

  const ids = groups.flatMap((group) => group.items.map((entry) => entry.item.id));
  const active = ids.includes(value) ? value : (ids[0] ?? "");
  const count = ids.length;

  const run = (row: Row) => {
    close();
    // After the dialog has let go of focus, so a dialog the action opens can take it.
    requestAnimationFrame(() => row.run());
  };

  return (
    <Command shouldFilter={false} value={active} onValueChange={setValue} loop>
      <CommandInput
        value={query}
        onValueChange={(next) => {
          setQuery(next);
          setValue(""); // the first result is active as soon as results show
        }}
        placeholder="Search issues, projects and actions…"
        aria-label="Search issues, projects and actions"
        autoFocus
      />
      <CommandList>
        <CommandEmpty>
          {query.trim() ? `Nothing matches “${query.trim()}”.` : "Type to search."}
        </CommandEmpty>
        {groups.map((group) => (
          <CommandGroup
            key={group.group}
            heading={group.group === "Spaces" ? spaceHeading : group.group}
          >
            {group.items.map((entry) => (
              <PaletteRow
                key={entry.item.id}
                entry={entry}
                onSelect={() => run(entry.item)}
                statusById={statusById}
              />
            ))}
          </CommandGroup>
        ))}
      </CommandList>
      <div className="border-border text-muted-foreground flex h-9 items-center gap-3 border-t px-3.5 text-xs">
        <span className="flex items-center gap-1.5">
          <Keycap keys="up" />
          <Keycap keys="down" /> to move
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap keys="enter" /> to open
        </span>
        <span className="flex items-center gap-1.5">
          <Keycap keys="esc" /> {query ? "to clear" : "to close"}
        </span>
      </div>
      <div aria-live="polite" role="status" className="sr-only">
        {query.trim()
          ? count === 0
            ? "No results"
            : `${count} ${count === 1 ? "result" : "results"}`
          : ""}
      </div>
    </Command>
  );
}

function Highlighted({ label, matches }: { label: string; matches: number[] }) {
  return (
    <span className="truncate">
      {highlightRuns(label, matches).map((run, index) =>
        run.matched ? (
          <span key={index} className="text-foreground font-medium">
            {run.text}
          </span>
        ) : (
          <span key={index}>{run.text}</span>
        ),
      )}
    </span>
  );
}

function PaletteRow({
  entry,
  onSelect,
  statusById,
}: {
  entry: Ranked<Row>;
  onSelect: () => void;
  statusById: Map<string, Doc<"statuses">>;
}) {
  const { item, matches } = entry;
  const status = item.issue ? statusById.get(item.issue.statusId) : undefined;
  return (
    <CommandItem value={item.id} onSelect={onSelect} className="text-foreground/90">
      {item.issue ? (
        <>
          {status ? (
            <StatusGlyph category={status.category} color={statusColor(status)} />
          ) : (
            <span className="size-3.5" />
          )}
          <IssueKey value={item.issue.key} className="w-16 shrink-0" />
        </>
      ) : (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          {item.icon}
        </span>
      )}
      <Highlighted label={item.label} matches={matches} />
      {item.description && (
        <span className="text-muted-foreground truncate text-xs">{item.description}</span>
      )}
      {item.shortcut && (
        <CommandShortcut>
          <Keycap keys={shortcut(item.shortcut).display} />
        </CommandShortcut>
      )}
    </CommandItem>
  );
}
