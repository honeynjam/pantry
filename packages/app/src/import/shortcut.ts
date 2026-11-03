import { Columns, parseCsvGrid } from "./csv";
import { parseDay } from "./dates";
import { BASE_FOLD_FIELDS, nameKey, type Parsed, type Priority, type SourceIssue } from "./engine";
import {
  capitalise,
  mergeFiles,
  oneLine,
  rowName,
  someOf,
  type Adapter,
  type SourceFile,
  type SourceSettings,
} from "./source";

/**
 * Shortcut's stories CSV ("Export as CSV" on the Organization and Workspace dashboard, or on a Space,
 * Epic or Iteration):
 * id, name, type, requester, owners, description, is_completed, created_at, started_at, updated_at,
 * moved_at, completed_at, estimate, external_tickets, is_blocked, is_a_blocker, due_date, labels,
 * tasks, state, epic_id, epic, iteration, team, workflow, priority, severity, milestone_* (objective_*
 * since Milestones became Objectives), custom_fields… Lists are joined with ";". Dates are
 * "2026/07/26 12:28:58" in the exporter's time zone, given as utc_offset ("-05:00").
 *
 * Mapping: each team becomes a space (one "Shortcut" space when there are none), workflow states
 * statuses, the story type (feature, bug, chore) a label, epics projects, the first owner the
 * assignee, tasks a checklist at the end of the description.
 */

export const SHORTCUT_FOLD_FIELDS = [
  ...BASE_FOLD_FIELDS("Shortcut"),
  { id: "iteration", label: "Iteration" },
  { id: "objective", label: "Objective (milestone)" },
  { id: "estimate", label: "Estimate" },
  { id: "relations", label: "Blocked, blocking and external tickets" },
  { id: "custom", label: "Severity, product area and custom fields" },
];

const PRIORITIES: Record<string, Priority> = {
  urgent: 1,
  highest: 1,
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
  lowest: 4,
};

const USED = new Set([
  "id",
  "name",
  "type",
  "story_type",
  "requester",
  "owners",
  "description",
  "is_completed",
  "created_at",
  "started_at",
  "completed_at",
  "estimate",
  "external_tickets",
  "is_blocked",
  "is_a_blocker",
  "due_date",
  "deadline",
  "labels",
  "tasks",
  "state",
  "epic_id",
  "epic",
  "iteration",
  "utc_offset",
  "is_archived",
  "team",
  "group",
  "workflow",
  "priority",
  "severity",
  "product_area",
  "skill_set",
  "technical_area",
  "custom_fields",
  "milestone",
  "objective",
  // Ids and counts that only repeat what's above.
  "team_id",
  "group_id",
  "workflow_id",
  "iteration_id",
  "project_id",
  "milestone_id",
  "objective_id",
  "external_ticket_count",
]);

export const isShortcutHeaders = (headers: string[]) => {
  const columns = new Columns(headers);
  return (
    columns.has("id") &&
    columns.has("name") &&
    columns.has("state") &&
    (columns.has("is_completed") || columns.has("workflow") || columns.has("owners"))
  );
};

/** Shortcut lists: ";" between items (some exports put each on its own line too). */
const items = (value: string) =>
  value
    .split(/;|\n/)
    .map((item) => item.trim())
    .filter(Boolean);

const truthy = (value: string) => /^(true|yes|1)$/i.test(value.trim());

/** "2026/07/26 12:28:58" with utc_offset "-05:00" → ms. */
export function shortcutTime(value: string, offset: string): number | undefined {
  const match = /^(\d{4})[/-](\d{2})[/-](\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(
    value.trim(),
  );
  if (!match) {
    const ms = Date.parse(value);
    return value.trim() && Number.isFinite(ms) ? ms : undefined;
  }
  const zone = /^[+-]\d{2}:?\d{2}$/.test(offset.trim()) ? offset.trim() : "Z";
  const iso = `${match[1]}-${match[2]}-${match[3]}T${match[4] ?? "00"}:${match[5] ?? "00"}:${match[6] ?? "00"}${zone}`;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * One checklist line from a story's task ("[x] Write tests", "Write tests (complete)", "✓ Write
 * tests"): Shortcut's import template uses the [x] form; anything else is kept as an open item.
 */
export function taskLine(task: string): string {
  let text = task.trim();
  let done = false;
  const box = /^\[( |x|X)\]\s*(.*)$/.exec(text);
  if (box) {
    done = box[1] !== " ";
    text = box[2]!;
  } else {
    const suffix = /^(.*?)\s*\((complete|completed|done|incomplete|not complete)\)$/i.exec(text);
    if (suffix) {
      done = /^(complete|completed|done)$/i.test(suffix[2]!);
      text = suffix[1]!;
    } else if (/^[✓✔]\s*/.test(text)) {
      done = true;
      text = text.replace(/^[✓✔]\s*/, "");
    }
  }
  return `- [${done ? "x" : " "}] ${text}`;
}

function parseFile(file: SourceFile, many: boolean, settings: { teamsAsSpaces: boolean }) {
  const { headers, rows } = parseCsvGrid(file.text);
  const c = new Columns(headers);
  if (!isShortcutHeaders(headers))
    throw new Error(
      `${file.name} doesn't look like a Shortcut stories export: it needs id, name and state columns.`,
    );
  const workflows = new Set(rows.map((row) => c.get(row, "workflow")).filter(Boolean));
  const problems: string[] = [];
  const unreadable: string[] = [];
  const issues: SourceIssue[] = [];
  rows.forEach((row, index) => {
    const line = index + 1;
    const id = c.get(row, "id");
    if (!/^\d+$/.test(id)) {
      problems.push(`${rowName(line, file.name, many)} has no story id, so it's left out.`);
      return;
    }
    const key = `sc-${id}`;
    const offset = c.get(row, "utc_offset");
    const when = (column: string) => {
      const value = c.get(row, column);
      const ms = value ? shortcutTime(value, offset) : undefined;
      if (value && ms === undefined) unreadable.push(`${key} ${column} "${value}"`);
      return ms;
    };
    const created = when("created_at");
    const started = when("started_at");
    const completed = when("completed_at");
    const dueRaw = c.get(row, "due_date", "deadline");
    const dueDate = dueRaw ? parseDay(dueRaw.replace(/\//g, "-").slice(0, 10)) : undefined;
    if (dueRaw && !dueDate) unreadable.push(`${key} due_date "${dueRaw}"`);
    const isCompleted = truthy(c.get(row, "is_completed")) || completed !== undefined;
    const state = c.get(row, "state") || (isCompleted ? "Done" : "Unscheduled");
    const workflow = c.get(row, "workflow");
    const owners = items(c.get(row, "owners"));
    const priorityName = c.get(row, "priority");
    const type = c.get(row, "type", "story_type");
    const epic = c.get(row, "epic");
    const epicId = c.get(row, "epic_id");
    const team = settings.teamsAsSpaces ? c.get(row, "team", "group") || "Shortcut" : "Shortcut";

    const tasks = items(c.raw(row, "tasks"));
    const body = c.raw(row, "description").trim();
    const description = tasks.length
      ? `${body ? `${body}\n\n` : ""}**Tasks**\n\n${tasks.map(taskLine).join("\n")}`
      : body;

    const extras: SourceIssue["extras"] = [];
    const add = (field: string, label: string, value: string) => {
      if (value) extras.push({ field, label, value: oneLine(value) });
    };
    if (owners.length > 1) add("people", "Other owners", owners.slice(1).join(", "));
    add("iteration", "Iteration", c.get(row, "iteration"));
    add("objective", "Objective", c.get(row, "objective", "milestone"));
    add("estimate", "Estimate", c.get(row, "estimate"));
    if (truthy(c.get(row, "is_blocked"))) add("relations", "Blocked", "yes");
    if (truthy(c.get(row, "is_a_blocker"))) add("relations", "Blocks other stories", "yes");
    add("relations", "External tickets", items(c.get(row, "external_tickets")).join(", "));
    add("custom", "Severity", c.get(row, "severity"));
    add("custom", "Product area", c.get(row, "product_area"));
    add("custom", "Skill set", c.get(row, "skill_set"));
    add("custom", "Technical area", c.get(row, "technical_area"));
    add("custom", "Custom fields", items(c.get(row, "custom_fields")).join(", "));
    if (!settings.teamsAsSpaces && c.get(row, "team", "group"))
      add("custom", "Team", c.get(row, "team", "group"));

    const archived = truthy(c.get(row, "is_archived"));
    issues.push({
      row: line,
      ...(many ? { file: file.name } : {}),
      externalId: id,
      key,
      team,
      prefix: "",
      title: c.get(row, "name"),
      description,
      status: workflows.size > 1 && workflow ? `${workflow}: ${state}` : state,
      ...(isCompleted ? { statusHint: "done" as const } : {}),
      priority: PRIORITIES[nameKey(priorityName)] ?? 0,
      priorityName: priorityName || "No priority",
      ...(epic ? { projectRef: { id: epicId ? `epic:${epicId}` : "", name: epic } } : {}),
      creator: c.get(row, "requester"),
      assignee: owners[0] ?? "",
      labels: items(c.get(row, "labels")),
      ...(type ? { typeLabel: capitalise(type) } : {}),
      ...(created !== undefined ? { createdAt: created } : {}),
      ...(started !== undefined ? { startedAt: started } : {}),
      ...(completed !== undefined ? { completedAt: completed } : {}),
      ...(archived
        ? {
            archivedAt:
              when("moved_at") ?? when("updated_at") ?? completed ?? created ?? Date.now(),
          }
        : {}),
      ...(dueDate ? { dueDate } : {}),
      extras,
    });
  });
  const warnings: string[] = [];
  if (unreadable.length)
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? "date" : "dates"} in ${file.name} couldn't be read and ${unreadable.length === 1 ? "is" : "are"} left out: ${someOf(unreadable)}.`,
    );
  const dropped = headers
    .filter((header) => {
      const lower = header.toLowerCase();
      return (
        !USED.has(lower) &&
        !lower.startsWith("epic_") &&
        !lower.startsWith("milestone_") &&
        !lower.startsWith("objective_")
      );
    })
    .map((column) => ({ column, count: c.count(rows, column) }))
    .filter((row) => row.count > 0);
  return { issues, problems, warnings, dropped };
}

/** Reads one or more Shortcut stories exports. */
export function parseShortcutCsv(
  files: SourceFile[],
  settings: { teamsAsSpaces: boolean } = { teamsAsSpaces: true },
): Parsed {
  const many = files.length > 1;
  const merged = mergeFiles(files.map((file) => parseFile(file, many, settings)));
  return {
    issues: merged.issues,
    problems: merged.problems,
    warnings: merged.warnings ?? [],
    dropped: merged.dropped,
  };
}

export const shortcut: Adapter = {
  id: "shortcut",
  name: "Shortcut",
  noteName: "Shortcut",
  beta: true,
  multiFile: true,
  howToExport:
    "In Shortcut: the Organization and Workspace dashboard (app.shortcut.com/organizations) → Export as CSV for everything, or Export as CSV on a Space, Epic or Iteration.",
  exportNote: "Shortcut's CSV has no comments or story links, so those don't come along.",
  teamTitle: "Teams",
  teamHint: "Each Shortcut team goes into a space.",
  foldFields: SHORTCUT_FOLD_FIELDS,
  keyFallback: "SC",
  detect: isShortcutHeaders,
  defaultSettings: () => ({ toggles: { teamsAsSpaces: true }, columns: {} }),
  toggles: (_files, parsed) =>
    parsed.issues.some(
      (issue) => issue.team !== "Shortcut" || issue.extras.some((extra) => extra.label === "Team"),
    )
      ? [
          {
            id: "teamsAsSpaces",
            label: "One space per Shortcut team",
            hint: "Off: every story goes into one space, with its team in the note.",
          },
        ]
      : [],
  parse: (files: SourceFile[], settings: SourceSettings) =>
    parseShortcutCsv(files, { teamsAsSpaces: settings.toggles.teamsAsSpaces !== false }),
};
