import { parseCsv } from "./csv";
import type { Adapter } from "./source";
import {
  BASE_FOLD_FIELDS,
  defaultOptions as engineDefaults,
  list,
  nameKey,
  planImport as enginePlan,
  summarize,
  type ImportContext,
  type ImportPlan,
  type Parsed,
  type Priority,
  type ReviewOptions,
  type SourceIssue,
  type Summary,
  type WorkspaceInfo,
} from "./engine";

/**
 * Linear's CSV export → `SourceIssue`s for the import engine (engine.ts). Pure, so it's tested
 * without a browser or a backend.
 */

export {
  BATCH_CHARS,
  BATCH_SIZE,
  guessStatus,
  nameKey,
  reviewProblems,
  suggestKey,
  targetKey,
  toBatches,
} from "./engine";
export type {
  Draft,
  ImportContext,
  ImportPlan,
  IssueArgs,
  PlanTeam,
  Prepared,
  Priority,
  ReviewOptions,
  StatusCategory,
  TeamTarget,
  WorkspaceInfo,
} from "./engine";

export type LinearIssue = SourceIssue & {
  prefix: string;
  number: number;
  estimate: string;
  projectId: string;
  project: string;
  cycle: string;
  parentKey?: string;
  initiatives: string;
  milestone: string;
  related: string[];
  blockedBy: string[];
  duplicateOf: string[];
};

export type ParsedLinear = Parsed<LinearIssue>;
export type LinearSummary = Summary;

const REQUIRED = ["ID", "Title", "Status", "Team"] as const;
const KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)\b/;
const DAY = 24 * 60 * 60 * 1000;

const PRIORITIES: Record<string, Priority> = {
  "no priority": 0,
  none: 0,
  "": 0,
  urgent: 1,
  high: 2,
  medium: 3,
  low: 4,
};

function timestamp(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined;
  const ms = Date.parse(value.trim());
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Linear writes due dates as the exporter's local midnight in UTC ("2026-10-18T23:00:00.000Z" is
 * 19 October in London). Rounding to the nearest UTC midnight gives the calendar day for any time
 * zone from UTC−12 to UTC+12, whatever the importer's own time zone is.
 */
export function linearDay(value: string | undefined): string | undefined {
  const raw = value?.trim();
  if (!raw) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(Math.round(ms / DAY) * DAY).toISOString().slice(0, 10);
}

function priorityOf(value: string | undefined): Priority {
  const raw = nameKey(value ?? "");
  if (raw in PRIORITIES) return PRIORITIES[raw]!;
  const number = Number(raw);
  return Number.isInteger(number) && number >= 0 && number <= 4 ? (number as Priority) : 0;
}

/** Linear fields Pantry has no place for, folded into a "From Linear" note at the end of the description. */
export const FOLD_FIELDS = [
  ...BASE_FOLD_FIELDS("Linear"),
  { id: "milestone", label: "Project milestone" },
  { id: "initiatives", label: "Initiatives" },
  { id: "cycle", label: "Cycle" },
  { id: "estimate", label: "Estimate" },
  { id: "relations", label: "Related, blocked by and duplicate of" },
];

/** Columns that aren't imported at all (Pantry keeps its own times for these). */
export const DROPPED_COLUMNS = [
  "Updated",
  "Started",
  "Triaged",
  "SLA Status",
  "Time in status (minutes)",
  "Cycle Start",
  "Cycle End",
] as const;

/** Whether these headers are a Linear export's. */
export const isLinearHeaders = (headers: string[]) =>
  REQUIRED.every((column) => headers.includes(column));

/** Reads a Linear CSV export. Throws when it isn't one; rows it can't use are listed in `problems`. */
export function parseLinearCsv(text: string): ParsedLinear {
  const { headers, rows } = parseCsv(text);
  const missing = REQUIRED.filter((column) => !headers.includes(column));
  if (missing.length > 0) {
    throw new Error(
      `This doesn't look like a Linear CSV export: it has no ${missing.join(", ")} column${missing.length > 1 ? "s" : ""}.`,
    );
  }
  const issues: LinearIssue[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const line = index + 1;
    const key = (row.ID ?? "").trim();
    const match = KEY.exec(key);
    if (!match) {
      problems.push(`Row ${line} has no issue ID like ENG-12, so it's left out.`);
      return;
    }
    const externalId = (row.UUID ?? "").trim() || key;
    if (seen.has(externalId)) {
      problems.push(`${key} appears twice; the second copy is left out.`);
      return;
    }
    seen.add(externalId);
    const parent = KEY.exec((row["Parent issue"] ?? "").trim());
    const prefix = match[1]!.toUpperCase();
    const project = (row.Project ?? "").trim();
    const projectId = (row["Project ID"] ?? "").trim();
    const issue: LinearIssue = {
      row: line,
      key: key.toUpperCase(),
      prefix,
      number: Number(match[2]),
      externalId,
      team: (row.Team ?? "").trim() || prefix,
      title: row.Title ?? "",
      description: (row.Description ?? "").replace(/\r\n/g, "\n").trim(),
      status: (row.Status ?? "").trim() || "Backlog",
      priority: priorityOf(row.Priority),
      priorityName: (row.Priority ?? "").trim() || "No priority",
      estimate: (row.Estimate ?? "").trim(),
      projectId,
      project,
      ...(project ? { projectRef: { id: projectId, name: project } } : {}),
      creator: (row.Creator ?? "").trim(),
      assignee: (row.Assignee ?? "").trim(),
      labels: list(row.Labels),
      cycle: [row["Cycle Number"], row["Cycle Name"]]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join(" · "),
      createdAt: timestamp(row.Created),
      startedAt: timestamp(row.Started),
      completedAt: timestamp(row.Completed),
      canceledAt: timestamp(row.Canceled),
      archivedAt: timestamp(row.Archived),
      dueDate: linearDay(row["Due Date"]),
      parentKey: parent ? `${parent[1]!.toUpperCase()}-${parent[2]}` : undefined,
      initiatives: list(row.Initiatives).join(", "),
      milestone: (row["Project Milestone"] ?? "").trim(),
      related: list(row["Related to"]),
      blockedBy: list(row["Blocked by"]),
      duplicateOf: list(row["Duplicate of"]),
      extras: [],
    };
    issue.parentRef = issue.parentKey;
    issue.extras = [
      { field: "milestone", label: "Milestone", value: issue.milestone },
      { field: "initiatives", label: "Initiatives", value: issue.initiatives },
      { field: "cycle", label: "Cycle", value: issue.cycle },
      { field: "estimate", label: "Estimate", value: issue.estimate },
      { field: "relations", label: "Related to", value: issue.related.join(", ") },
      { field: "relations", label: "Blocked by", value: issue.blockedBy.join(", ") },
      { field: "relations", label: "Duplicate of", value: issue.duplicateOf.join(", ") },
    ].filter((extra) => extra.value);
    issues.push(issue);
  });
  // Parents by key → by Linear id, so the engine can walk them.
  const byKey = new Map(issues.map((issue) => [issue.key, issue.externalId]));
  for (const issue of issues) {
    if (issue.parentKey && byKey.has(issue.parentKey)) issue.parentId = byKey.get(issue.parentKey);
  }
  const dropped = DROPPED_COLUMNS.filter((column) => headers.includes(column)).map((column) => ({
    column,
    count: rows.filter((row) => (row[column] ?? "").trim() !== "").length,
  }));
  return { issues, problems, dropped };
}

export function summarizeLinear(parsed: Parsed): LinearSummary {
  return summarize(parsed, FOLD_FIELDS);
}

export function defaultOptions(
  parsed: Parsed,
  summary: Summary,
  workspace: WorkspaceInfo,
  context: ImportContext,
): ReviewOptions {
  return engineDefaults(parsed, summary, workspace, context, "LIN");
}

export function planImport(
  parsed: Parsed,
  summary: Summary,
  options: ReviewOptions,
  workspace: WorkspaceInfo,
  context: ImportContext,
): ImportPlan {
  return enginePlan(parsed, summary, options, workspace, context, "Linear");
}

export const linear: Adapter = {
  id: "linear",
  name: "Linear",
  noteName: "Linear",
  beta: false,
  multiFile: false,
  howToExport: "In Linear: Settings → Import / Export → Export CSV.",
  teamTitle: "Teams",
  teamHint: "Each Linear team goes into a space.",
  foldFields: FOLD_FIELDS,
  keyFallback: "LIN",
  detect: isLinearHeaders,
  defaultSettings: () => ({ toggles: {}, columns: {} }),
  toggles: () => [],
  parse: (files) => {
    if (files.length !== 1)
      throw new Error("Linear exports everything in one file: pick just that one.");
    return parseLinearCsv(files[0]!.text);
  },
};
