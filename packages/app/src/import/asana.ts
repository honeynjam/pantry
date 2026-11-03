import { Columns, parseCsvGrid } from "./csv";
import { guessDayOrder, parseDateTime, parseDay, type DayOrder } from "./dates";
import { BASE_FOLD_FIELDS, list, nameKey, type Parsed, type Priority, type SourceIssue } from "./engine";
import {
  mergeFiles,
  oneLine,
  rowName,
  shortHash,
  someOf,
  type Adapter,
  type SourceFile,
  type SourceSettings,
} from "./source";

/**
 * Asana's project CSV export (a project's ⌄ menu → Export/Print → CSV), one file per project:
 * Task ID, Created At, Completed At, Last Modified, Name, Section/Column, Assignee, Assignee Email,
 * Start Date, Due Date, Tags, Notes, Projects, Parent task, Blocked By (Dependencies), Blocking
 * (Dependencies), then one column per custom field. Dates are YYYY-MM-DD. There's no status: a task
 * is done when Completed At is set, and its section is the closest thing to a status. Subtasks are
 * rows of their own whose "Parent task" is the parent's *name*, so parents are matched by name and a
 * name shared by several tasks can't be resolved.
 *
 * Mapping: each Asana project becomes a space, or (one switch in the review, the default with several
 * files) a project in one space; sections become statuses for open tasks; completed tasks are done.
 */

export const ASANA_FOLD_FIELDS = [
  ...BASE_FOLD_FIELDS("Asana"),
  { id: "relations", label: "Blocked by and blocking" },
  { id: "projects", label: "Other Asana projects of the task" },
  { id: "custom", label: "Custom fields" },
];

/** Columns of Asana's own; every other column is a custom field. */
const KNOWN = new Set(
  [
    "Task ID",
    "Created At",
    "Completed At",
    "Last Modified",
    "Name",
    "Section/Column",
    "Assignee",
    "Assignee Email",
    "Start Date",
    "Due Date",
    "Due Time",
    "Tags",
    "Notes",
    "Projects",
    "Parent task",
    "Parent Task",
    "Parent Task ID",
    "Blocked By (Dependencies)",
    "Blocking (Dependencies)",
  ].map((column) => column.toLowerCase()),
);

const PRIORITIES: Record<string, Priority> = {
  urgent: 1,
  highest: 1,
  critical: 1,
  high: 2,
  medium: 3,
  med: 3,
  normal: 3,
  low: 4,
  lowest: 4,
};

/** The completed tasks' status row in the review. */
export const ASANA_COMPLETED = "Completed";
/** Open tasks without a section (often subtasks). */
export const ASANA_NO_SECTION = "No section";

export const isAsanaHeaders = (headers: string[]) => {
  const columns = new Columns(headers);
  return (
    columns.has("Task ID") &&
    columns.has("Name") &&
    (columns.has("Section/Column") || columns.has("Completed At") || columns.has("Notes"))
  );
};

type Raw = {
  parentName: string;
  parentGid: string;
  projects: string[];
};

/** The Asana project a file is: the project most of its tasks list, else the file's name. */
export function fileProject(file: SourceFile, projectsPerRow: string[][]): string {
  const counts = new Map<string, number>();
  for (const projects of projectsPerRow)
    for (const project of new Set(projects)) counts.set(project, (counts.get(project) ?? 0) + 1);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (best) return best[0];
  return file.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " ").trim() || "Asana";
}

function parseFile(file: SourceFile, many: boolean) {
  const { headers, rows } = parseCsvGrid(file.text);
  const c = new Columns(headers);
  if (!isAsanaHeaders(headers))
    throw new Error(
      `${file.name} doesn't look like an Asana CSV export: it needs Task ID and Name columns.`,
    );
  // Projects are joined with "," and no space; a project name with a comma is split, so it's
  // matched back against the names the file uses.
  const projectsPerRow = rows.map((row) => list(c.get(row, "Projects")));
  const project = fileProject(file, projectsPerRow);
  const order: DayOrder = guessDayOrder(
    rows.flatMap((row) =>
      ["Created At", "Completed At", "Due Date", "Start Date"].map((column) => c.get(row, column)),
    ),
    "mdy",
  );
  const unreadable: string[] = [];
  const custom = headers.filter((header) => !KNOWN.has(header.toLowerCase()));
  const priorityColumn = custom.find((header) => nameKey(header) === "priority");
  const problems: string[] = [];
  let mangledIds = 0;
  const issues: (SourceIssue & { raw: Raw })[] = [];
  const seen = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 1;
    const title = c.get(row, "Name");
    let gid = c.get(row, "Task ID");
    if (!title && !gid) return;
    if (!/^\d+$/.test(gid)) {
      // A spreadsheet app rewrote the id ("1.20871E+15"): fall back to the name, stable enough
      // for re-importing the same file.
      if (gid) mangledIds += 1;
      const occurrence = (seen.get(`${project}:${nameKey(title)}`) ?? 0) + 1;
      seen.set(`${project}:${nameKey(title)}`, occurrence);
      gid = `name:${shortHash(`${nameKey(project)}|${nameKey(title)}|${occurrence}`)}`;
    }
    const key = gid.startsWith("name:") ? `"${oneLine(title, 80)}"` : `task ${gid}`;
    const when = (column: string) => {
      const value = c.get(row, column);
      const ms = parseDateTime(value, order);
      if (value && ms === undefined) unreadable.push(`${key} ${column} "${value}"`);
      return ms;
    };
    const created = when("Created At");
    const completed = when("Completed At");
    const dueRaw = c.get(row, "Due Date");
    const dueDate = parseDay(dueRaw, order);
    if (dueRaw && !dueDate) unreadable.push(`${key} Due Date "${dueRaw}"`);
    const section = c.get(row, "Section/Column");
    const name = c.get(row, "Assignee");
    const email = c.get(row, "Assignee Email");
    const assignee = email && name && name.toLowerCase() !== email.toLowerCase() ? `${name} <${email}>` : email || name;
    const priorityName = priorityColumn ? c.get(row, priorityColumn) : "";

    const extras: SourceIssue["extras"] = [];
    const start = c.get(row, "Start Date");
    if (start) extras.push({ field: "dates", label: "Start date", value: parseDay(start, order) ?? start });
    const blockedBy = c.get(row, "Blocked By (Dependencies)");
    const blocking = c.get(row, "Blocking (Dependencies)");
    if (blockedBy) extras.push({ field: "relations", label: "Blocked by", value: oneLine(blockedBy) });
    if (blocking) extras.push({ field: "relations", label: "Blocking", value: oneLine(blocking) });
    const others = projectsPerRow[index]!.filter((name) => name !== project);
    if (others.length)
      extras.push({ field: "projects", label: "Also in Asana projects", value: others.join(", ") });
    for (const column of custom) {
      if (column === priorityColumn) continue;
      const value = c.get(row, column);
      if (value) extras.push({ field: "custom", label: column, value: oneLine(value) });
    }

    issues.push({
      row: line,
      ...(many ? { file: file.name } : {}),
      externalId: gid,
      key,
      team: project,
      prefix: "",
      title,
      description: c.raw(row, "Notes").trim(),
      status: completed !== undefined ? ASANA_COMPLETED : section || ASANA_NO_SECTION,
      ...(completed !== undefined ? { statusHint: "done" as const } : {}),
      priority: PRIORITIES[nameKey(priorityName)] ?? 0,
      priorityName: priorityName || "No priority",
      creator: "",
      assignee,
      labels: list(c.get(row, "Tags")),
      ...(created !== undefined ? { createdAt: created } : {}),
      ...(completed !== undefined ? { completedAt: completed } : {}),
      ...(dueDate ? { dueDate } : {}),
      extras,
      raw: {
        parentName: c.get(row, "Parent task", "Parent Task"),
        parentGid: c.get(row, "Parent Task ID"),
        projects: projectsPerRow[index]!,
      },
    });
  });

  const warnings: string[] = [];
  if (mangledIds)
    warnings.push(
      `${mangledIds} task IDs in ${file.name} were changed by a spreadsheet app (like 1.2E+15), so those tasks are matched by name when you import again. Export from Asana again to avoid this.`,
    );
  if (unreadable.length)
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? "date" : "dates"} in ${file.name} couldn't be read and ${unreadable.length === 1 ? "is" : "are"} left out: ${someOf(unreadable)}.`,
    );
  const dropped = ["Last Modified"]
    .filter((column) => c.has(column))
    .map((column) => ({ column, count: c.count(rows, column) }));
  return { issues, problems, warnings, dropped, project };
}

/**
 * Reads one or more Asana CSV exports (one per Asana project). `oneSpace` puts every project in one
 * space ("Asana projects") as Pantry projects; otherwise each Asana project is its own space.
 */
export function parseAsanaCsv(
  files: SourceFile[],
  settings: { oneSpace: boolean } = { oneSpace: false },
): Parsed & { ambiguousParents: number } {
  const many = files.length > 1;
  const parts = files.map((file) => parseFile(file, many));
  const merged = mergeFiles(parts);
  const issues = merged.issues;
  const byGid = new Map(issues.map((issue) => [issue.externalId, issue]));
  // Names → tasks, per project and across files: a subtask's parent is usually in its own file.
  const byName = new Map<string, (typeof issues)[number][]>();
  for (const issue of issues) {
    const key = nameKey(issue.title);
    byName.set(key, [...(byName.get(key) ?? []), issue]);
  }
  let ambiguousParents = 0;
  for (const issue of issues) {
    const { parentName, parentGid } = issue.raw;
    if (parentGid && byGid.has(parentGid)) {
      issue.parentId = parentGid;
      issue.parentRef = `"${oneLine(parentName || byGid.get(parentGid)!.title, 80)}"`;
      continue;
    }
    if (!parentName) continue;
    const candidates = (byName.get(nameKey(parentName)) ?? []).filter(
      (candidate) => candidate !== issue,
    );
    const sameProject = candidates.filter((candidate) => candidate.team === issue.team);
    const pick = sameProject.length === 1 ? sameProject : candidates;
    issue.parentRef = `"${oneLine(parentName, 80)}"`;
    if (pick.length === 1) issue.parentId = pick[0]!.externalId;
    else if (pick.length > 1) {
      ambiguousParents += 1;
      issue.parentRef = `"${oneLine(parentName, 80)}" (several tasks have that name)`;
    }
  }
  // A subtask often lists no project: it belongs where its parent is.
  for (const issue of issues) {
    if (issue.raw.projects.length === 0 && issue.parentId) {
      let parent = byGid.get(issue.parentId);
      const seen = new Set<string>();
      while (parent?.parentId && parent.raw.projects.length === 0 && !seen.has(parent.externalId)) {
        seen.add(parent.externalId);
        parent = byGid.get(parent.parentId);
      }
      if (parent) issue.team = parent.team;
    }
  }
  if (settings.oneSpace) {
    for (const issue of issues) {
      issue.projectRef = { id: `asana-project:${nameKey(issue.team)}`, name: issue.team };
      issue.team = ASANA_ONE_SPACE;
    }
  }
  const warnings = [...(merged.warnings ?? [])];
  if (ambiguousParents)
    warnings.push(
      `${ambiguousParents} ${ambiguousParents === 1 ? "subtask's parent name is" : "subtasks' parent names are"} shared by several tasks, so ${ambiguousParents === 1 ? "it comes" : "they come"} in as normal issues, with the parent's name in the note.`,
    );
  return {
    issues: issues.map(({ raw: _raw, ...issue }) => issue),
    problems: merged.problems,
    warnings,
    dropped: merged.dropped,
    ambiguousParents,
  };
}

/** The one space's "team" name when every Asana project goes into one space. */
export const ASANA_ONE_SPACE = "Asana";

export const asana: Adapter = {
  id: "asana",
  name: "Asana",
  noteName: "Asana",
  beta: true,
  multiFile: true,
  howToExport:
    "In Asana: open the project, click the ⌄ next to its name → Export/Print → CSV. One file per project; add them all here.",
  teamTitle: "Asana projects",
  teamHint: "Each Asana project goes into a space.",
  foldFields: ASANA_FOLD_FIELDS,
  keyFallback: "ASANA",
  detect: isAsanaHeaders,
  defaultSettings: (files) => ({ toggles: { oneSpace: files.length > 1 }, columns: {} }),
  toggles: (files) =>
    files.length > 1
      ? [
          {
            id: "oneSpace",
            label: "Put every Asana project in one space",
            hint: "Each Asana project becomes a project in that space. Off: one space per Asana project.",
          },
        ]
      : [],
  parse: (files: SourceFile[], settings: SourceSettings) =>
    parseAsanaCsv(files, { oneSpace: settings.toggles.oneSpace === true }),
};
