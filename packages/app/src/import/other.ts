import { Columns, csvHeaders, parseCsvGrid } from "./csv";
import { guessDayOrder, parseDateTime, parseDay } from "./dates";
import { BASE_FOLD_FIELDS, nameKey, type Parsed, type Priority, type SourceIssue } from "./engine";
import {
  oneLine,
  rowName,
  shortHash,
  someOf,
  type Adapter,
  type SourceFile,
  type SourceSettings,
} from "./source";

/**
 * Any other CSV (ClickUp, Trello, Notion, a spreadsheet): the owner says which column is the title,
 * the status, the assignee and so on, then the same review as every source. Columns nobody picked go
 * into the note, one line each.
 *
 * Re-imports match rows on the ID column when there is one, else on the title and group (so an edited
 * title comes in again). Ids are scoped by the file's header row, so two different tools' exports
 * with the same ids ("1", "2") never skip each other's rows.
 */

export const CSV_FIELDS = [
  { id: "title", label: "Title", required: true },
  { id: "description", label: "Description" },
  { id: "status", label: "Status" },
  { id: "priority", label: "Priority" },
  { id: "labels", label: "Labels" },
  { id: "assignee", label: "Assignee (email or name)" },
  { id: "dueDate", label: "Due date" },
  { id: "created", label: "Created date" },
  { id: "parent", label: "Parent (its ID or title)" },
  { id: "externalId", label: "ID" },
  { id: "group", label: "Space (group rows by)" },
  { id: "project", label: "Project" },
] as const;
export type CsvField = (typeof CSV_FIELDS)[number]["id"];

/** Header names each field is guessed from, normalised (lowercase letters and digits only). */
const GUESSES: Record<CsvField, string[]> = {
  title: [
    "title",
    "name",
    "summary",
    "taskname",
    "cardname",
    "subject",
    "issue",
    "task",
    "storyname",
  ],
  description: [
    "description",
    "notes",
    "body",
    "details",
    "desc",
    "content",
    "taskcontent",
    "carddescription",
    "text",
  ],
  status: ["status", "state", "stage", "column", "listname", "list", "section", "sectioncolumn"],
  priority: ["priority", "prio", "importance", "urgency"],
  labels: ["labels", "label", "tags", "tag", "categories", "category"],
  assignee: [
    "assigneeemail",
    "assignee",
    "assignees",
    "owner",
    "owners",
    "assignedto",
    "members",
    "responsible",
  ],
  dueDate: ["duedate", "due", "deadline", "dueon", "datedue", "enddate"],
  created: ["created", "createdat", "datecreated", "createddate", "creationdate"],
  parent: [
    "parent",
    "parentid",
    "parenttask",
    "parentname",
    "parentissue",
    "parentkey",
    "parentitem",
  ],
  externalId: [
    "id",
    "taskid",
    "issueid",
    "cardid",
    "key",
    "issuekey",
    "uuid",
    "itemid",
    "ticketid",
  ],
  group: [
    "space",
    "spacename",
    "team",
    "board",
    "boardname",
    "group",
    "workspace",
    "foldername",
    "client",
  ],
  project: ["project", "projectname", "epic", "milestone", "listname"],
};

const norm = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** A first guess at which column is which, from the header names. */
export function guessColumns(headers: string[]): Record<CsvField, string> {
  const taken = new Set<string>();
  const result = {} as Record<CsvField, string>;
  // Most specific first, so "Task ID" goes to ID before "Task" could go to the title.
  const order: CsvField[] = [
    "externalId",
    "parent",
    "title",
    "description",
    "assignee",
    "dueDate",
    "created",
    "status",
    "priority",
    "labels",
    "group",
    "project",
  ];
  for (const field of order) {
    const header = GUESSES[field]
      .map((guess) =>
        headers.find((candidate) => norm(candidate) === guess && !taken.has(candidate)),
      )
      .find(Boolean);
    result[field] = header ?? "";
    if (header) taken.add(header);
  }
  return result;
}

const PRIORITIES: [RegExp, Priority][] = [
  [/^(urgent|highest|critical|blocker|p0|0|1|asap)$/, 1],
  [/^(high|p1|2|important)$/, 2],
  [/^(medium|normal|med|p2|3|moderate)$/, 3],
  [/^(low|lowest|minor|trivial|p3|p4|4|5)$/, 4],
];

export function csvPriority(value: string): Priority {
  const key = nameKey(value).replace(/^priority\s*/, "");
  return PRIORITIES.find(([pattern]) => pattern.test(key))?.[1] ?? 0;
}

const KEY = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;
const cleanList = (value: string) =>
  value
    .replace(/^\[|\]$/g, "")
    .split(/[,;|\n]/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

/** Reads a CSV with the owner's column choices. Throws when there's no title column. */
export function parseOtherCsv(files: SourceFile[], columns: Record<string, string>): Parsed {
  const file = files[0];
  if (!file) return { issues: [], problems: [], dropped: [] };
  const { headers, rows } = parseCsvGrid(file.text);
  if (headers.length === 0) throw new Error(`${file.name} is empty.`);
  const c = new Columns(headers);
  const pick = (field: CsvField) => (columns[field] && c.has(columns[field]) ? columns[field] : "");
  if (!pick("title")) throw new Error("Pick the column that has each issue's title.");
  const scope = shortHash(headers.join("\u0001"));
  const group = pick("group");
  const fallbackTeam = file.name.replace(/\.(csv|tsv|txt)$/i, "").trim() || "Imported";
  const mapped = new Set(CSV_FIELDS.map((field) => pick(field.id)).filter(Boolean));
  const others = headers.filter(
    (header, position) => header && !mapped.has(header) && headers.indexOf(header) === position,
  );
  const dateValues = rows.flatMap((row) => [
    c.get(row, pick("dueDate")),
    c.get(row, pick("created")),
  ]);
  const order = guessDayOrder(dateValues.filter(Boolean), "mdy");
  const problems: string[] = [];
  const unreadable: string[] = [];
  const seen = new Set<string>();
  const occurrences = new Map<string, number>();
  const issues: (SourceIssue & { parentValue: string; sourceId: string })[] = [];

  rows.forEach((row, index) => {
    const line = index + 1;
    const title = c.get(row, pick("title"));
    if (!title) {
      if (row.some((cell) => cell.trim()))
        problems.push(`${rowName(line, file.name, false)} has no title, so it's left out.`);
      return;
    }
    const team = (group && c.get(row, group)) || fallbackTeam;
    const sourceId = pick("externalId") ? c.get(row, pick("externalId")) : "";
    let externalId: string;
    if (sourceId) externalId = `${scope}:${sourceId}`;
    else {
      const base = `${nameKey(team)}|${nameKey(title)}`;
      const occurrence = (occurrences.get(base) ?? 0) + 1;
      occurrences.set(base, occurrence);
      externalId = `${scope}:t:${shortHash(`${base}|${occurrence}`)}`;
    }
    if (seen.has(externalId)) {
      problems.push(`${sourceId || title} appears twice; the second copy is left out.`);
      return;
    }
    seen.add(externalId);
    const keyMatch = KEY.exec(sourceId);
    const status = c.get(row, pick("status")) || "No status";
    const priorityName = c.get(row, pick("priority"));
    const people = cleanList(c.get(row, pick("assignee")));
    const dueRaw = c.get(row, pick("dueDate"));
    const dueDate = parseDay(dueRaw, order);
    if (dueRaw && !dueDate) unreadable.push(`${sourceId || `row ${line}`} "${dueRaw}"`);
    const createdRaw = c.get(row, pick("created"));
    const created = parseDateTime(createdRaw, order);
    if (createdRaw && created === undefined)
      unreadable.push(`${sourceId || `row ${line}`} "${createdRaw}"`);
    const project = c.get(row, pick("project"));

    const extras: SourceIssue["extras"] = [];
    if (people.length > 1)
      extras.push({ field: "people", label: "Other assignees", value: people.slice(1).join(", ") });
    for (const header of others) {
      const value = c.get(row, header);
      if (value) extras.push({ field: "columns", label: header, value: oneLine(value) });
    }
    issues.push({
      row: line,
      externalId,
      key: sourceId || `row ${line}`,
      ...(keyMatch ? { number: Number(keyMatch[2]) } : {}),
      team,
      prefix: keyMatch ? keyMatch[1]!.toUpperCase() : "",
      title,
      description: c.raw(row, pick("description")).trim(),
      status,
      priority: csvPriority(priorityName),
      priorityName: priorityName || "No priority",
      ...(project ? { projectRef: { id: "", name: project } } : {}),
      creator: "",
      assignee: people[0] ?? "",
      labels: cleanList(c.get(row, pick("labels"))),
      ...(created !== undefined ? { createdAt: created } : {}),
      ...(dueDate ? { dueDate } : {}),
      extras,
      parentValue: c.get(row, pick("parent")),
      sourceId,
    });
  });

  // A team's prefix only when all its keyed rows agree on it (they keep their numbers then).
  const prefixes = new Map<string, Set<string>>();
  for (const issue of issues) {
    const set = prefixes.get(issue.team) ?? new Set<string>();
    set.add(issue.prefix);
    prefixes.set(issue.team, set);
  }
  for (const issue of issues) {
    if (prefixes.get(issue.team)!.size !== 1) {
      issue.prefix = "";
      delete issue.number;
    }
  }

  const byId = new Map(
    issues.filter((issue) => issue.sourceId).map((issue) => [nameKey(issue.sourceId), issue]),
  );
  const byTitle = new Map<string, (typeof issues)[number][]>();
  for (const issue of issues)
    byTitle.set(nameKey(issue.title), [...(byTitle.get(nameKey(issue.title)) ?? []), issue]);
  let ambiguous = 0;
  for (const issue of issues) {
    const value = issue.parentValue;
    if (!value) continue;
    issue.parentRef = value;
    const parent =
      byId.get(nameKey(value)) ??
      ((byTitle.get(nameKey(value)) ?? []).length === 1
        ? byTitle.get(nameKey(value))![0]
        : undefined);
    if (parent && parent !== issue) issue.parentId = parent.externalId;
    else if ((byTitle.get(nameKey(value)) ?? []).length > 1) {
      ambiguous += 1;
      issue.parentRef = `"${oneLine(value, 80)}" (several rows have that title)`;
    }
  }

  const warnings: string[] = [];
  if (!pick("externalId"))
    warnings.push(
      "No ID column: importing this file again matches rows by title, so a row whose title changed comes in again.",
    );
  if (ambiguous)
    warnings.push(
      `${ambiguous} rows name a parent that several rows share, so they come in as normal issues.`,
    );
  if (unreadable.length)
    warnings.push(
      `${unreadable.length} ${unreadable.length === 1 ? "date" : "dates"} couldn't be read and ${unreadable.length === 1 ? "is" : "are"} left out: ${someOf(unreadable)}.`,
    );
  return {
    issues: issues.map(({ parentValue: _parent, sourceId: _id, ...issue }) => issue),
    problems,
    warnings,
    dropped: [],
  };
}

export const other: Adapter = {
  id: "csv",
  name: "Other CSV",
  noteName: "CSV",
  beta: false,
  multiFile: false,
  howToExport:
    "Any CSV with a header row: ClickUp, Trello, Notion, a spreadsheet. You pick which column is the title, status, assignee and so on.",
  teamTitle: "Spaces",
  teamHint: "Rows go into a space per value of the space column (or one space).",
  foldFields: [...BASE_FOLD_FIELDS("CSV"), { id: "columns", label: "Other columns" }],
  keyFallback: "IMP",
  detect: () => true,
  defaultSettings: (files) => ({
    toggles: {},
    columns: guessColumns(files[0] ? csvHeaders(files[0].text) : []),
  }),
  toggles: () => [],
  parse: (files: SourceFile[], settings: SourceSettings) => parseOtherCsv(files, settings.columns),
};
