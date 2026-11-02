import { normalizeTitle } from "@pantry/backend/rules";
import { SPACE_KEY_PATTERN } from "@pantry/backend/validate";
import { parseCsv } from "./csv";

/**
 * Linear's CSV export → what the review shows and what the import sends. Pure, so it's tested
 * without a browser or a backend. The import's rules (owner only, keys, sub-issues, label and project
 * names, re-import safety) are enforced by convex/imports.ts; this only reads the file and proposes
 * a mapping the owner can change in the review.
 */

export type Priority = 0 | 1 | 2 | 3 | 4;
export type StatusCategory = "backlog" | "unstarted" | "started" | "review" | "done" | "canceled";

export type LinearIssue = {
  /** 1-based row in the file, after the header. */
  row: number;
  key: string;
  prefix: string;
  number: number;
  /** Linear's UUID (the key when the file has no UUID column): what re-imports match on. */
  externalId: string;
  team: string;
  title: string;
  description: string;
  status: string;
  priority: Priority;
  estimate: string;
  projectId: string;
  project: string;
  creator: string;
  assignee: string;
  labels: string[];
  cycle: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  canceledAt?: number;
  archivedAt?: number;
  dueDate?: string;
  parentKey?: string;
  initiatives: string;
  milestone: string;
  related: string[];
  blockedBy: string[];
  duplicateOf: string[];
};

export type ParsedLinear = {
  issues: LinearIssue[];
  problems: string[];
  /** Columns that aren't imported, with how many rows have a value in each. */
  dropped: { column: string; count: number }[];
};

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

/** Case-insensitive, whitespace-normalised name key (the backend's `nameKey`). */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

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
    issues.push({
      row: line,
      key: key.toUpperCase(),
      prefix: match[1]!.toUpperCase(),
      number: Number(match[2]),
      externalId,
      team: (row.Team ?? "").trim() || match[1]!.toUpperCase(),
      title: row.Title ?? "",
      description: (row.Description ?? "").replace(/\r\n/g, "\n").trim(),
      status: (row.Status ?? "").trim() || "Backlog",
      priority: priorityOf(row.Priority),
      estimate: (row.Estimate ?? "").trim(),
      projectId: (row["Project ID"] ?? "").trim(),
      project: (row.Project ?? "").trim(),
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
    });
  });
  const dropped = DROPPED_COLUMNS.filter((column) => headers.includes(column)).map((column) => ({
    column,
    count: rows.filter((row) => (row[column] ?? "").trim() !== "").length,
  }));
  return { issues, problems, dropped };
}

// ---------------------------------------------------------------------------------------------
// What's in the file
// ---------------------------------------------------------------------------------------------

/** Linear fields Pantry has no place for, folded into a "From Linear" note at the end of the description. */
export const FOLD_FIELDS = [
  { id: "people", label: "Creator and assignee who aren't members" },
  { id: "dates", label: "Created date and Linear key" },
  { id: "milestone", label: "Project milestone" },
  { id: "initiatives", label: "Initiatives" },
  { id: "cycle", label: "Cycle" },
  { id: "estimate", label: "Estimate" },
  { id: "relations", label: "Related, blocked by and duplicate of" },
] as const;
export type FoldField = (typeof FOLD_FIELDS)[number]["id"];

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

export type LinearSummary = {
  teams: { name: string; prefix: string; count: number; maxNumber: number }[];
  statuses: { name: string; count: number }[];
  priorities: { priority: Priority; count: number }[];
  labels: { name: string; count: number }[];
  people: { value: string; count: number }[];
  archived: number;
  /** Issues that have a value, per folded field. */
  folded: Record<FoldField, number>;
  /** Issues that have a value, per dropped column. */
  dropped: { column: string; count: number }[];
};

function tally<T>(items: T[], keyOf: (item: T) => string[]) {
  const counts = new Map<string, { name: string; count: number }>();
  for (const item of items) {
    for (const name of keyOf(item)) {
      const key = nameKey(name);
      const row = counts.get(key) ?? { name, count: 0 };
      row.count += 1;
      counts.set(key, row);
    }
  }
  return [...counts.values()];
}

export function summarizeLinear(parsed: ParsedLinear): LinearSummary {
  const { issues } = parsed;
  const teams = new Map<string, LinearSummary["teams"][number]>();
  for (const issue of issues) {
    const team = teams.get(issue.team) ?? {
      name: issue.team,
      prefix: issue.prefix,
      count: 0,
      maxNumber: 0,
    };
    team.count += 1;
    team.maxNumber = Math.max(team.maxNumber, issue.number);
    teams.set(issue.team, team);
  }
  const people = tally(issues, (issue) => [issue.creator, issue.assignee].filter(Boolean));
  const count = (test: (issue: LinearIssue) => boolean) => issues.filter(test).length;
  return {
    teams: [...teams.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    statuses: tally(issues, (issue) => [issue.status]).sort((a, b) => b.count - a.count),
    priorities: ([0, 1, 2, 3, 4] as Priority[]).map((priority) => ({
      priority,
      count: count((issue) => issue.priority === priority),
    })),
    labels: tally(issues, (issue) => issue.labels).sort((a, b) => a.name.localeCompare(b.name)),
    people: people.map(({ name, count: n }) => ({ value: name, count: n })),
    archived: count((issue) => issue.archivedAt !== undefined),
    folded: {
      people: count((issue) => Boolean(issue.creator || issue.assignee)),
      dates: count((issue) => issue.createdAt !== undefined),
      milestone: count((issue) => Boolean(issue.milestone)),
      initiatives: count((issue) => Boolean(issue.initiatives)),
      cycle: count((issue) => Boolean(issue.cycle)),
      estimate: count((issue) => Boolean(issue.estimate)),
      relations: count(
        (issue) => issue.related.length + issue.blockedBy.length + issue.duplicateOf.length > 0,
      ),
    },
    dropped: parsed.dropped,
  };
}

// ---------------------------------------------------------------------------------------------
// The mapping the review starts from
// ---------------------------------------------------------------------------------------------

export type WorkspaceInfo = {
  statuses: { _id: string; name: string; category: StatusCategory }[];
  spaces: { _id: string; key: string; name: string }[];
  labels: { name: string }[];
  projects: { spaceId: string; name: string }[];
  members: { _id: string; displayName: string }[];
};

/** What the server knows about this file (imports.linearContext). */
export type ImportContext = {
  teams: Record<string, { spaceId: string; key: string; name: string } | null>;
  people: Record<string, { memberId: string; displayName: string } | null>;
  imported: Record<string, string>;
};

export type TeamTarget =
  { kind: "new"; name: string; key: string } | { kind: "existing"; spaceId: string };

export type ReviewOptions = {
  teams: Record<string, TeamTarget>;
  /** Linear status name (nameKey) → Pantry status id. */
  statuses: Record<string, string>;
  includeArchived: boolean;
  fold: Record<FoldField, boolean>;
};

const CATEGORY_WORDS: [StatusCategory, RegExp][] = [
  ["canceled", /cancel|duplicate|won'?t|wontfix|reject|invalid|obsolete/],
  ["done", /done|complete|closed|shipped|released|merged|resolved|finished/],
  ["review", /review|qa\b|testing|verify|approval/],
  ["started", /progress|started|doing|active|working|develop/],
  ["unstarted", /todo|to do|unstarted|planned|ready|next|selected/],
  ["backlog", /backlog|triage|icebox|someday|idea/],
];

/**
 * The Pantry status for a Linear status: the one with the same name, else by meaning (Duplicate →
 * Canceled), else by what its issues' dates say (completed → done, canceled, started), else Backlog.
 */
export function guessStatus(
  name: string,
  issues: LinearIssue[],
  statuses: WorkspaceInfo["statuses"],
): string | undefined {
  const same = statuses.find((status) => nameKey(status.name) === nameKey(name));
  if (same) return same._id;
  const key = nameKey(name);
  let category = CATEGORY_WORDS.find(([, words]) => words.test(key))?.[0];
  if (!category) {
    const mine = issues.filter((issue) => nameKey(issue.status) === key);
    const most = (test: (issue: LinearIssue) => boolean) =>
      mine.filter(test).length > mine.length / 2;
    category = most((issue) => issue.completedAt !== undefined)
      ? "done"
      : most((issue) => issue.canceledAt !== undefined)
        ? "canceled"
        : most((issue) => issue.startedAt !== undefined)
          ? "started"
          : "backlog";
  }
  return (statuses.find((status) => status.category === category) ?? statuses[0])?._id;
}

/** A valid space key from a Linear prefix or team name ("Salt & Pepper" → "SP"). */
export function suggestKey(prefix: string, team: string): string {
  const fromPrefix = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  if (SPACE_KEY_PATTERN.test(fromPrefix)) return fromPrefix;
  const initials = team
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  const key = (
    initials.length >= 2 ? initials : team.toUpperCase().replace(/[^A-Z0-9]/g, "")
  ).slice(0, 10);
  return SPACE_KEY_PATTERN.test(key) ? key : "LIN";
}

/**
 * Where each team goes unless the owner changes it: the space it went to last time; else an
 * existing space whose key is the team's prefix (issues keep their numbers there where free); else a
 * new space named after the team with the prefix as its key.
 */
export function defaultOptions(
  parsed: ParsedLinear,
  summary: LinearSummary,
  workspace: WorkspaceInfo,
  context: ImportContext,
): ReviewOptions {
  const teams: Record<string, TeamTarget> = {};
  for (const team of summary.teams) {
    const linked = context.teams[team.name];
    const sameKey = workspace.spaces.find((space) => space.key === team.prefix);
    if (linked && workspace.spaces.some((space) => space._id === linked.spaceId))
      teams[team.name] = { kind: "existing", spaceId: linked.spaceId };
    else if (sameKey) teams[team.name] = { kind: "existing", spaceId: sameKey._id };
    else
      teams[team.name] = {
        kind: "new",
        name: team.name.slice(0, 80),
        key: suggestKey(team.prefix, team.name),
      };
  }
  const statuses: Record<string, string> = {};
  for (const status of summary.statuses) {
    const id = guessStatus(status.name, parsed.issues, workspace.statuses);
    if (id) statuses[nameKey(status.name)] = id;
  }
  return {
    teams,
    statuses,
    includeArchived: false,
    fold: {
      people: true,
      dates: true,
      milestone: true,
      initiatives: true,
      cycle: true,
      estimate: true,
      relations: true,
    },
  };
}

/** The key a team's issues get: the target space's key, or the new space's key. */
export function targetKey(target: TeamTarget, workspace: WorkspaceInfo): string | undefined {
  if (target.kind === "new") return target.key.trim().toUpperCase();
  return workspace.spaces.find((space) => space._id === target.spaceId)?.key;
}

// ---------------------------------------------------------------------------------------------
// The plan: what Import will do
// ---------------------------------------------------------------------------------------------

export type Draft = {
  externalId: string;
  sourceKey: string;
  team: string;
  projectExternalId?: string;
  parentExternalId?: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  labels: string[];
  assigneeId?: string;
  creatorId?: string;
  dueDate?: string;
  completedAt?: number;
};

export type PlanTeam = {
  team: string;
  prefix: string;
  maxNumber: number;
  target: { spaceId: string } | { name: string; key: string };
  projects: { externalId: string; name: string }[];
};

export type ImportPlan = {
  teams: PlanTeam[];
  labels: string[];
  /** Parents before their sub-issues; only issues not imported yet. */
  drafts: Draft[];
  counts: {
    newSpaces: number;
    existingSpaces: number;
    newProjects: number;
    newLabels: number;
    issues: number;
    subIssues: number;
    archivedSkipped: number;
    alreadyImported: number;
    /** Sub-issues that come in as top-level issues (parent left out or in another space). */
    detached: number;
  };
  people: { value: string; count: number; member: { _id: string; displayName: string } | null }[];
  problems: string[];
};

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 100_000;

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** A member for a Linear person: by sign-in email (from the server), else by unique display name. */
function personResolver(workspace: WorkspaceInfo, context: ImportContext) {
  return (value: string) => {
    if (!value) return null;
    if (value.includes("@")) {
      const match = context.people[value.trim().toLowerCase()];
      return match ? { _id: match.memberId, displayName: match.displayName } : null;
    }
    const named = workspace.members.filter(
      (member) => nameKey(member.displayName) === nameKey(value),
    );
    return named.length === 1 ? named[0]! : null;
  };
}

/** The note at the end of an imported description: what Pantry has no field for. */
export function linearNote(
  issue: LinearIssue,
  fold: Record<FoldField, boolean>,
  extra: {
    creatorUnmatched: boolean;
    assigneeUnmatched: boolean;
    fullTitle?: string;
    detachedFrom?: string;
  },
): string {
  const lines: string[] = [];
  const head: string[] = [];
  const by = fold.people && extra.creatorUnmatched && issue.creator ? issue.creator : null;
  if (fold.dates) {
    head.push(`Imported from Linear: ${issue.key}`);
    if (issue.createdAt !== undefined)
      head.push(`created ${isoDay(issue.createdAt)}${by ? ` by ${by}` : ""}`);
    else if (by) head.push(`created by ${by}`);
  } else if (by) head.push(`Created in Linear by ${by}`);
  if (fold.people && extra.assigneeUnmatched && issue.assignee)
    lines.push(`- Assignee in Linear: ${issue.assignee}`);
  if (extra.fullTitle) lines.push(`- Full title: ${extra.fullTitle}`);
  if (extra.detachedFrom) lines.push(`- Sub-issue of ${extra.detachedFrom} in Linear`);
  if (fold.milestone && issue.milestone) lines.push(`- Milestone: ${issue.milestone}`);
  if (fold.initiatives && issue.initiatives) lines.push(`- Initiatives: ${issue.initiatives}`);
  if (fold.cycle && issue.cycle) lines.push(`- Cycle: ${issue.cycle}`);
  if (fold.estimate && issue.estimate) lines.push(`- Estimate: ${issue.estimate}`);
  if (fold.relations) {
    if (issue.related.length) lines.push(`- Related to: ${issue.related.join(", ")}`);
    if (issue.blockedBy.length) lines.push(`- Blocked by: ${issue.blockedBy.join(", ")}`);
    if (issue.duplicateOf.length) lines.push(`- Duplicate of: ${issue.duplicateOf.join(", ")}`);
  }
  if (issue.archivedAt !== undefined)
    lines.push(`- Archived in Linear on ${isoDay(issue.archivedAt)}`);
  if (head.length === 0 && lines.length === 0) return "";
  return [
    "---",
    ...(head.length ? [head.join(", ")] : []),
    ...(head.length && lines.length ? [""] : []),
    ...lines,
  ].join("\n");
}

function withNote(description: string, note: string) {
  if (!note) return description.slice(0, MAX_DESCRIPTION);
  const room = MAX_DESCRIPTION - note.length - 4;
  const body = description.length > room ? `${description.slice(0, room - 1)}…` : description;
  return body ? `${body}\n\n${note}` : note;
}

function cleanTitle(title: string): { title: string; full?: string } {
  const clean = normalizeTitle(title) || "Untitled";
  if (clean.length <= MAX_TITLE) return { title: clean };
  return { title: `${clean.slice(0, MAX_TITLE - 1).trimEnd()}…`, full: clean };
}

/**
 * The whole import, from the file and the review's choices: the spaces, projects and labels to make
 * or reuse, then each issue (parents first). Sub-issues stay one level deep: a sub-issue of a
 * sub-issue hangs off the top-level issue. A sub-issue whose parent is left out (archived, not in the
 * file) or goes to another space comes in as a top-level issue, with a note saying whose it was.
 */
export function planImport(
  parsed: ParsedLinear,
  summary: LinearSummary,
  options: ReviewOptions,
  workspace: WorkspaceInfo,
  context: ImportContext,
): ImportPlan {
  const person = personResolver(workspace, context);
  const byKey = new Map(parsed.issues.map((issue) => [issue.key, issue]));
  const included = parsed.issues.filter(
    (issue) => options.includeArchived || issue.archivedAt === undefined,
  );
  const includedIds = new Set(included.map((issue) => issue.externalId));
  const spaceOf = (team: string) => {
    const target = options.teams[team];
    return target?.kind === "existing" ? `space:${target.spaceId}` : `team:${team}`;
  };

  /** The top-level ancestor this issue hangs off in Pantry, or why it can't have one. */
  function parentFor(issue: LinearIssue): { parent?: LinearIssue; detachedFrom?: string } {
    if (!issue.parentKey) return {};
    let parent = byKey.get(issue.parentKey);
    const seen = new Set([issue.key]);
    while (parent?.parentKey && !seen.has(parent.key)) {
      seen.add(parent.key);
      const next = byKey.get(parent.parentKey);
      if (!next) break;
      parent = next;
    }
    if (!parent || seen.has(parent.parentKey ?? "") || parent.key === issue.key)
      return { detachedFrom: issue.parentKey };
    const usable =
      (includedIds.has(parent.externalId) || parent.externalId in context.imported) &&
      spaceOf(parent.team) === spaceOf(issue.team);
    return usable ? { parent } : { detachedFrom: issue.parentKey };
  }

  const drafts: Draft[] = [];
  const projects = new Map<string, Map<string, string>>(); // team → externalId → name
  const labels = new Map<string, string>();
  let subIssues = 0;
  let detached = 0;
  let alreadyImported = 0;
  for (const issue of included) {
    if (issue.externalId in context.imported) {
      alreadyImported += 1;
      continue;
    }
    const { parent, detachedFrom } = parentFor(issue);
    if (parent) subIssues += 1;
    if (detachedFrom) detached += 1;
    const creator = person(issue.creator);
    const assignee = person(issue.assignee);
    const title = cleanTitle(issue.title);
    const statusId = options.statuses[nameKey(issue.status)] ?? workspace.statuses[0]?._id ?? "";
    const category = workspace.statuses.find((status) => status._id === statusId)?.category;
    const completedAt =
      category === "done"
        ? (issue.completedAt ?? issue.canceledAt)
        : category === "canceled"
          ? (issue.canceledAt ?? issue.completedAt)
          : undefined;
    const projectExternalId =
      !parent && issue.project ? issue.projectId || `name:${nameKey(issue.project)}` : undefined;
    if (projectExternalId) {
      const teamProjects = projects.get(issue.team) ?? new Map<string, string>();
      teamProjects.set(projectExternalId, issue.project);
      projects.set(issue.team, teamProjects);
    }
    for (const label of issue.labels)
      if (!labels.has(nameKey(label))) labels.set(nameKey(label), label);
    const note = linearNote(issue, options.fold, {
      creatorUnmatched: !creator,
      assigneeUnmatched: !assignee,
      fullTitle: title.full,
      detachedFrom,
    });
    drafts.push({
      externalId: issue.externalId,
      sourceKey: issue.key,
      team: issue.team,
      ...(projectExternalId ? { projectExternalId } : {}),
      ...(parent ? { parentExternalId: parent.externalId } : {}),
      title: title.title,
      description: withNote(issue.description, note),
      statusId,
      priority: issue.priority,
      labels: [...new Set(issue.labels.map(nameKey))],
      ...(assignee ? { assigneeId: assignee._id } : {}),
      ...(creator ? { creatorId: creator._id } : {}),
      ...(issue.dueDate ? { dueDate: issue.dueDate } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    });
  }
  // Parents first, then sub-issues; each in Linear's number order.
  const order = new Map(parsed.issues.map((issue) => [issue.externalId, issue]));
  drafts.sort((a, b) => {
    const level = Number(Boolean(a.parentExternalId)) - Number(Boolean(b.parentExternalId));
    if (level !== 0) return level;
    const left = order.get(a.externalId)!;
    const right = order.get(b.externalId)!;
    return left.team.localeCompare(right.team) || left.number - right.number;
  });

  const teams: PlanTeam[] = summary.teams.map((team) => {
    const target = options.teams[team.name]!;
    return {
      team: team.name,
      prefix: team.prefix,
      maxNumber: team.maxNumber,
      target:
        target.kind === "existing"
          ? { spaceId: target.spaceId }
          : { name: target.name.trim(), key: target.key.trim().toUpperCase() },
      projects: [...(projects.get(team.name) ?? new Map<string, string>()).entries()].map(
        ([externalId, name]) => ({
          externalId,
          name,
        }),
      ),
    };
  });

  const existingLabels = new Set(workspace.labels.map((label) => nameKey(label.name)));
  const newProjects = teams.reduce((sum, team) => {
    const spaceId = "spaceId" in team.target ? team.target.spaceId : null;
    const have = new Set(
      workspace.projects
        .filter((project) => project.spaceId === spaceId)
        .map((project) => nameKey(project.name)),
    );
    return sum + team.projects.filter((project) => !have.has(nameKey(project.name))).length;
  }, 0);
  const newSpaceTeams = teams.filter((team) => "key" in team.target);
  return {
    teams,
    labels: [...labels.values()],
    drafts,
    counts: {
      newSpaces: newSpaceTeams.length,
      existingSpaces: new Set(
        teams.filter((team) => "spaceId" in team.target).map((team) => JSON.stringify(team.target)),
      ).size,
      newProjects,
      newLabels: [...labels.keys()].filter((key) => !existingLabels.has(key)).length,
      issues: drafts.length,
      subIssues,
      archivedSkipped: parsed.issues.length - included.length,
      alreadyImported,
      detached,
    },
    people: summary.people.map((row) => ({ ...row, member: person(row.value) })),
    problems: [...parsed.problems, ...reviewProblems(options, summary, workspace)],
  };
}

/** What stops Import: a new space without a valid or free key, two teams wanting the same new key. */
export function reviewProblems(
  options: ReviewOptions,
  summary: LinearSummary,
  workspace: WorkspaceInfo,
): string[] {
  const problems: string[] = [];
  const newKeys = new Map<string, string>();
  for (const team of summary.teams) {
    const target = options.teams[team.name];
    if (!target || target.kind !== "new") continue;
    const key = target.key.trim().toUpperCase();
    if (!target.name.trim()) problems.push(`Give ${team.name}'s new space a name.`);
    if (!SPACE_KEY_PATTERN.test(key))
      problems.push(`${team.name}: keys are 2–10 letters or digits and start with a letter.`);
    else if (workspace.spaces.some((space) => space.key === key))
      problems.push(
        `${team.name}: ${key} is already a space's key. Pick another, or import into that space.`,
      );
    else if (newKeys.has(key))
      problems.push(`${team.name} and ${newKeys.get(key)} can't both get the key ${key}.`);
    newKeys.set(key, team.name);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Batches for imports.importLinearIssues
// ---------------------------------------------------------------------------------------------

export type Prepared = {
  teams: { team: string; spaceId: string; projects: Record<string, string> }[];
  labels: Record<string, string>;
};

export type IssueArgs = {
  externalId: string;
  sourceKey: string;
  spaceId: string;
  projectId?: string;
  parentExternalId?: string;
  title: string;
  description: string;
  statusId: string;
  priority: Priority;
  assigneeId?: string;
  creatorId?: string;
  labelIds: string[];
  dueDate?: string;
  completedAt?: number;
};

export const BATCH_SIZE = 50;
/** Keeps one batch's arguments far below Convex's argument size limit, whatever the descriptions. */
export const BATCH_CHARS = 1_000_000;

/** The drafts as mutation arguments with the ids `prepareLinear` returned, in batches. */
export function toBatches(
  drafts: Draft[],
  prepared: Prepared,
  size = BATCH_SIZE,
  chars = BATCH_CHARS,
): IssueArgs[][] {
  const teams = new Map(prepared.teams.map((team) => [team.team, team]));
  const batches: IssueArgs[][] = [];
  let current: IssueArgs[] = [];
  let currentChars = 0;
  for (const draft of drafts) {
    const team = teams.get(draft.team);
    if (!team) throw new Error(`No space was prepared for ${draft.team}.`);
    const projectId = draft.projectExternalId ? team.projects[draft.projectExternalId] : undefined;
    const args: IssueArgs = {
      externalId: draft.externalId,
      sourceKey: draft.sourceKey,
      spaceId: team.spaceId,
      ...(projectId ? { projectId } : {}),
      ...(draft.parentExternalId ? { parentExternalId: draft.parentExternalId } : {}),
      title: draft.title,
      description: draft.description,
      statusId: draft.statusId,
      priority: draft.priority,
      ...(draft.assigneeId ? { assigneeId: draft.assigneeId } : {}),
      ...(draft.creatorId ? { creatorId: draft.creatorId } : {}),
      labelIds: [
        ...new Set(
          draft.labels
            .map((label) => prepared.labels[label])
            .filter((id): id is string => Boolean(id)),
        ),
      ],
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      ...(draft.completedAt !== undefined ? { completedAt: draft.completedAt } : {}),
    };
    const length = args.description.length + args.title.length + 500;
    if (current.length > 0 && (current.length >= size || currentChars + length > chars)) {
      batches.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(args);
    currentChars += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
