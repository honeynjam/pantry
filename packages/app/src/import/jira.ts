import { Columns, parseCsvGrid } from "./csv";
import { guessDayOrder, parseDateTime, parseDay, type DayOrder } from "./dates";
import {
  BASE_FOLD_FIELDS,
  nameKey,
  type Parsed,
  type Priority,
  type SourceIssue,
  type StatusHint,
} from "./engine";
import { jiraToMarkdown } from "./jira-markup";
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
 * Jira Cloud's issue search CSV export ("Export → Export CSV (all fields)"). Jira repeats a column
 * once per value (Labels, Sprint, Comment, Attachment, Watchers, issue links), so rows are read by
 * position (`Columns`), never into a header-keyed object. Dates are in the site's format and
 * language ("03/Nov/26 10:15 AM" by default). People are display names, with their Atlassian
 * account ids in the "… Id" columns (comments only carry the id).
 *
 * Mapping: each Jira project becomes a space (keeping issue numbers when the key matches), Issue
 * Type a label, Status (with Resolution) a status, Highest…Lowest a priority, sub-tasks sub-issues,
 * epics projects (or issues, in the review), comments comments.
 */

export type JiraIssue = SourceIssue & { issueType: string; isEpic: boolean };

const KEY = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/;

const PRIORITIES: Record<string, Priority> = {
  highest: 1,
  blocker: 1,
  critical: 1,
  urgent: 1,
  high: 2,
  major: 2,
  medium: 3,
  normal: 3,
  low: 4,
  minor: 4,
  lowest: 4,
  trivial: 4,
};

/** Resolutions that mean "finished", as opposed to "closed without doing it". */
const DONE_RESOLUTIONS = new Set(["done", "fixed", "resolved", "complete", "completed", "unresolved"]);

const STATUS_CATEGORY: Record<string, StatusHint> = {
  "to do": "todo",
  new: "todo",
  "in progress": "doing",
  indeterminate: "doing",
  done: "done",
  complete: "done",
};

/** Columns read into Pantry fields or the note; everything else is listed as not imported. */
const USED = new Set(
  [
    "Summary",
    "Issue key",
    "Issue id",
    "Issue Type",
    "Status",
    "Project key",
    "Project name",
    "Priority",
    "Resolution",
    "Assignee",
    "Assignee Id",
    "Reporter",
    "Reporter Id",
    "Creator",
    "Creator Id",
    "Created",
    "Resolved",
    "Due date",
    "Labels",
    "Description",
    "Environment",
    "Watchers",
    "Watchers Id",
    "Attachment",
    "Sprint",
    "Comment",
    "Parent",
    "Parent id",
    "Parent key",
    "Parent summary",
    "Status category",
    "Component/s",
    "Components",
    "Fix Version/s",
    "Fix versions",
    "Affects Version/s",
    "Affects versions",
    "Custom field (Story point estimate)",
    "Custom field (Story Points)",
    "Custom field (Epic Link)",
    "Custom field (Epic Name)",
    "Custom field (Start date)",
  ].map((column) => column.toLowerCase()),
);

export const JIRA_FOLD_FIELDS = [
  ...BASE_FOLD_FIELDS("Jira"),
  { id: "sprint", label: "Sprints" },
  { id: "estimate", label: "Story points" },
  { id: "versions", label: "Components and versions" },
  { id: "relations", label: "Issue links (blocks, relates, duplicates…)" },
  { id: "attachments", label: "Attachment links" },
  { id: "environment", label: "Environment" },
];

export const isJiraHeaders = (headers: string[]) => {
  const columns = new Columns(headers);
  return (
    columns.has("Summary") &&
    columns.has("Issue key") &&
    (columns.has("Issue id") || columns.has("Issue Type"))
  );
};

/** Inward and outward names of Jira's standard link types, for the note. */
const LINK_NAMES: Record<string, [string, string]> = {
  blocks: ["Blocked by", "Blocks"],
  cloners: ["Cloned by", "Clones"],
  duplicate: ["Duplicated by", "Duplicates"],
  relates: ["Related to", "Related to"],
};

function linkLabel(header: string): string | undefined {
  const match = /^(inward|outward) issue link \((.+)\)$/i.exec(header.trim());
  if (!match) return undefined;
  const [inward, outward] = LINK_NAMES[match[2]!.toLowerCase()] ?? [
    `${match[2]} (inward)`,
    `${match[2]} (outward)`,
  ];
  return match[1]!.toLowerCase() === "inward" ? inward : outward;
}

type RawComment = { date?: number; authorId: string; body: string };

/** "03/Nov/26 10:15 AM;712020:5b10…;The body; with semicolons" → its three parts. */
export function splitJiraComment(value: string): { date: string; author: string; body: string } {
  const first = value.indexOf(";");
  const second = first < 0 ? -1 : value.indexOf(";", first + 1);
  if (first < 0 || second < 0) return { date: "", author: "", body: value.trim() };
  return {
    date: value.slice(0, first).trim(),
    author: value.slice(first + 1, second).trim(),
    body: value.slice(second + 1).trim(),
  };
}

/** Atlassian account ids look like "712020:5b10…" or 24 hex digits; Server usernames are readable. */
const looksLikeAccountId = (id: string) => /^\d+:[0-9a-f-]{8,}$/i.test(id) || /^[0-9a-f]{24}$/i.test(id);

function parseFile(file: SourceFile, many: boolean, names: Map<string, string>) {
  const { headers, rows } = parseCsvGrid(file.text);
  const c = new Columns(headers);
  if (!isJiraHeaders(headers))
    throw new Error(
      `${file.name} doesn't look like a Jira CSV export: it needs Summary and Issue key columns.`,
    );
  // Account id → display name, from every person column that has an id next to it.
  for (const row of rows) {
    for (const [nameColumn, idColumn] of [
      ["Assignee", "Assignee Id"],
      ["Reporter", "Reporter Id"],
      ["Creator", "Creator Id"],
      ["Project lead", "Project lead id"],
    ] as const) {
      const id = c.get(row, idColumn);
      const name = c.get(row, nameColumn);
      if (id && name) names.set(id, name);
    }
    const watchers = c.all(row, "Watchers");
    const watcherIds = c.all(row, "Watchers Id");
    if (watchers.length === watcherIds.length)
      watcherIds.forEach((id, index) => names.set(id, watchers[index]!));
  }

  const dateColumns = ["Created", "Resolved", "Due date"];
  const order: DayOrder = guessDayOrder(
    rows.flatMap((row) => [
      ...dateColumns.map((column) => c.get(row, column)),
      ...c.all(row, "Comment").map((comment) => splitJiraComment(comment).date),
    ]),
  );
  const unreadable: string[] = [];
  const when = (row: string[], column: string, key: string) => {
    const value = c.get(row, column);
    const ms = parseDateTime(value, order);
    if (value && ms === undefined) unreadable.push(`${key} ${column} "${value}"`);
    return ms;
  };

  const problems: string[] = [];
  const issues: (JiraIssue & { raw: { parent: string; parentKey: string; parentSummary: string; epicLink: string; comments: RawComment[] } })[] = [];
  const seen = new Set<string>();
  const linkColumns = headers
    .map((header) => ({ header, label: linkLabel(header) }))
    .filter((column): column is { header: string; label: string } => Boolean(column.label));

  rows.forEach((row, index) => {
    const line = index + 1;
    const key = c.get(row, "Issue key").toUpperCase();
    const match = KEY.exec(key);
    if (!match) {
      problems.push(`${rowName(line, file.name, many)} has no issue key like ENG-12, so it's left out.`);
      return;
    }
    const externalId = c.get(row, "Issue id") || key;
    if (seen.has(externalId)) {
      problems.push(`${key} appears twice in ${file.name}; the second copy is left out.`);
      return;
    }
    seen.add(externalId);
    const prefix = (c.get(row, "Project key") || match[1]!).toUpperCase();
    const issueType = c.get(row, "Issue Type");
    const status = c.get(row, "Status") || "To Do";
    const resolution = c.get(row, "Resolution");
    const statusName =
      resolution && !DONE_RESOLUTIONS.has(nameKey(resolution)) ? `${status} · ${resolution}` : status;
    const priorityName = c.get(row, "Priority");
    const created = when(row, "Created", key);
    const resolved = when(row, "Resolved", key);
    const dueRaw = c.get(row, "Due date");
    const dueDate = parseDay(dueRaw, order);
    if (dueRaw && !dueDate) unreadable.push(`${key} Due date "${dueRaw}"`);

    const extras: SourceIssue["extras"] = [];
    const add = (field: string, label: string, values: string[]) => {
      const value = values.map((item) => oneLine(item)).filter(Boolean).join(", ");
      if (value) extras.push({ field, label, value });
    };
    add("sprint", c.all(row, "Sprint").length > 1 ? "Sprints" : "Sprint", c.all(row, "Sprint"));
    add("estimate", "Story points", [
      c.get(row, "Custom field (Story point estimate)", "Custom field (Story Points)"),
    ]);
    add("versions", "Components", [...c.all(row, "Component/s"), ...c.all(row, "Components")]);
    add("versions", "Fix versions", [...c.all(row, "Fix Version/s"), ...c.all(row, "Fix versions")]);
    add("versions", "Affects versions", [
      ...c.all(row, "Affects Version/s"),
      ...c.all(row, "Affects versions"),
    ]);
    const links = new Map<string, string[]>();
    for (const column of linkColumns) {
      const keys = c.all(row, column.header);
      if (keys.length) links.set(column.label, [...(links.get(column.label) ?? []), ...keys]);
    }
    for (const [label, keys] of links) add("relations", label, [...new Set(keys)]);
    const attachments = c.all(row, "Attachment").map((value) => {
      // date;authorId;file name;url
      const parts = value.split(";");
      const url = parts.slice(3).join(";").trim();
      const name = (parts[2] ?? "").trim();
      return url ? `[${name || "file"}](${url})` : value;
    });
    add("attachments", "Attachments", attachments);
    add("environment", "Environment", [c.raw(row, "Environment")]);
    const start = c.get(row, "Custom field (Start date)");
    if (start) add("dates", "Start date", [parseDay(start, order) ?? start]);

    const comments: RawComment[] = c.all(row, "Comment").map((value) => {
      const parts = splitJiraComment(value);
      return { date: parseDateTime(parts.date, order), authorId: parts.author, body: parts.body };
    });

    issues.push({
      row: line,
      ...(many ? { file: file.name } : {}),
      externalId,
      key,
      number: Number(match[2]),
      team: c.get(row, "Project name") || prefix,
      prefix,
      title: c.get(row, "Summary"),
      description: c.raw(row, "Description"),
      status: statusName,
      ...(STATUS_CATEGORY[nameKey(c.get(row, "Status category", "Status Category"))]
        ? { statusHint: STATUS_CATEGORY[nameKey(c.get(row, "Status category", "Status Category"))] }
        : {}),
      priority: PRIORITIES[nameKey(priorityName)] ?? 0,
      priorityName: priorityName || "No priority",
      creator: c.get(row, "Reporter", "Creator"),
      assignee: c.get(row, "Assignee"),
      labels: [
        ...new Set(c.all(row, "Labels").flatMap((value) => value.split(/[\s,]+/).filter(Boolean))),
      ],
      ...(issueType ? { typeLabel: capitalise(issueType) } : {}),
      issueType,
      isEpic: nameKey(issueType) === "epic",
      ...(created !== undefined ? { createdAt: created } : {}),
      ...(resolved !== undefined ? { completedAt: resolved } : {}),
      ...(dueDate ? { dueDate } : {}),
      extras,
      raw: {
        parent: c.get(row, "Parent", "Parent id"),
        parentKey: c.get(row, "Parent key").toUpperCase(),
        parentSummary: c.get(row, "Parent summary"),
        epicLink: c.get(row, "Custom field (Epic Link)").toUpperCase(),
        comments,
      },
    });
  });

  const warnings: string[] = [];
  if (unreadable.length)
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? "date" : "dates"} in ${file.name} couldn't be read and ${unreadable.length === 1 ? "is" : "are"} left out: ${someOf(unreadable)}.`,
    );
  if (rows.length === 1000 || rows.length === 10_000)
    warnings.push(
      `${file.name} has exactly ${rows.length.toLocaleString("en")} rows, which is where Jira stops an export. If the search had more issues, export the rest (for example by created date) and add the file here.`,
    );
  const dropped = headers
    .filter(
      (header, position) =>
        headers.findIndex((other) => other.toLowerCase() === header.toLowerCase()) === position &&
        !USED.has(header.toLowerCase()) &&
        !linkLabel(header),
    )
    .map((column) => ({ column, count: c.count(rows, column) }))
    .filter((row) => row.count > 0);
  return { issues, problems, warnings, dropped };
}

/** Reads one or more Jira CSV exports. Throws when a file isn't one. */
export function parseJiraCsv(
  files: SourceFile[],
  settings: { epicsAsProjects: boolean } = { epicsAsProjects: true },
): Parsed<JiraIssue> & { epics: number } {
  const names = new Map<string, string>();
  const many = files.length > 1;
  const parts = files.map((file) => parseFile(file, many, names));
  const merged = mergeFiles(parts);
  const issues = merged.issues;
  const byId = new Map(issues.map((issue) => [issue.externalId, issue]));
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  const person = (id: string) => names.get(id) ?? (looksLikeAccountId(id) ? undefined : id);

  let epics = 0;
  for (const issue of issues) {
    const { raw } = issue;
    const parent =
      (raw.parentKey && byKey.get(raw.parentKey)) ||
      (raw.parent && (byId.get(raw.parent) ?? byKey.get(raw.parent.toUpperCase()))) ||
      (raw.epicLink && byKey.get(raw.epicLink)) ||
      undefined;
    const reference = raw.parentKey || (KEY.test(raw.parent) ? raw.parent : "") || raw.epicLink;
    const label = reference
      ? `${reference}${raw.parentSummary ? ` (${raw.parentSummary})` : ""}`
      : raw.parentSummary || raw.parent;
    const subtask = /sub-?task/i.test(issue.issueType);
    if (settings.epicsAsProjects && !issue.isEpic) {
      if (parent?.isEpic) {
        issue.projectRef = { id: `epic:${parent.externalId}`, name: parent.title };
      } else if (!parent && (raw.parent || raw.parentKey || raw.epicLink) && !subtask) {
        // The parent of a standard issue is an epic in Jira Cloud's hierarchy, even when the epic
        // isn't in the file: use its name.
        const name = raw.parentSummary || reference || raw.parent;
        issue.projectRef = { id: `epic:${raw.parent || reference}`, name };
      } else if (parent) {
        issue.parentId = parent.externalId;
        issue.parentRef = parent.key;
      } else if (label) issue.parentRef = label;
    } else if (parent) {
      issue.parentId = parent.externalId;
      issue.parentRef = parent.key;
    } else if (label) issue.parentRef = label;
    if (settings.epicsAsProjects && issue.isEpic) epics += 1;

    const mentions = (id: string) => person(id);
    issue.description = jiraToMarkdown(issue.description, mentions);
    issue.comments = raw.comments
        .filter((comment) => comment.body)
        .map((comment) => ({
          author: person(comment.authorId) ?? "A Jira user",
          ...(comment.date !== undefined ? { date: comment.date } : {}),
          body: jiraToMarkdown(comment.body, mentions),
        }));
  }
  const kept = settings.epicsAsProjects ? issues.filter((issue) => !issue.isEpic) : issues;
  // A sub-task is a sub-issue in Pantry already; "Subtask" as a label would only repeat it.
  for (const issue of kept) if (/sub-?task/i.test(issue.issueType)) delete issue.typeLabel;
  return {
    issues: kept.map(({ raw: _raw, ...issue }) => issue),
    problems: merged.problems,
    warnings: merged.warnings ?? [],
    dropped: merged.dropped,
    epics,
  };
}

export const jira: Adapter = {
  id: "jira",
  name: "Jira",
  noteName: "Jira",
  beta: true,
  multiFile: true,
  howToExport:
    "In Jira: Filters → Search work items, search for the issues (e.g. project = ENG), then Export → Export CSV (all fields).",
  teamTitle: "Jira projects",
  teamHint: "Each Jira project goes into a space.",
  foldFields: JIRA_FOLD_FIELDS,
  keyFallback: "JIRA",
  detect: isJiraHeaders,
  defaultSettings: () => ({ toggles: { epicsAsProjects: true }, columns: {} }),
  toggles: (_files, parsed) =>
    parsed.issues.some(
      (issue) => (issue as JiraIssue).isEpic || issue.projectRef?.id.startsWith("epic:"),
    )
      ? [
          {
            id: "epicsAsProjects",
            label: "Epics become projects",
            hint: "Their issues go into the project. Off: epics come in as issues, with their issues as sub-issues.",
          },
        ]
      : [],
  parse: (files: SourceFile[], settings: SourceSettings) =>
    parseJiraCsv(files, { epicsAsProjects: settings.toggles.epicsAsProjects !== false }),
};
