import { normalizeTitle } from "@pantry/backend/rules";
import { SPACE_KEY_PATTERN } from "@pantry/backend/validate";
import { isoDay } from "./dates";

/**
 * The import engine every source shares (Settings → Import and Export). A source adapter reads its
 * export into `SourceIssue`s; from there the review, the mapping, the plan and the batches are the
 * same for Linear, Asana, Shortcut, Jira and any other CSV. Pure, so it's tested without a browser or
 * a backend. The import's rules (owner only, keys, sub-issues, label and project names, re-import
 * safety) are enforced by convex/imports.ts; this only proposes a mapping the owner can change.
 *
 * Words: a "team" is whatever the source groups issues by that becomes a Pantry space (a Linear team,
 * an Asana project, a Shortcut team, a Jira project, a spreadsheet column). A "project" is a Pantry
 * workstream inside that space (a Linear project, a Shortcut or Jira epic).
 */

export type SourceId = "linear" | "asana" | "shortcut" | "jira" | "csv";
export type Priority = 0 | 1 | 2 | 3 | 4;
export type StatusCategory = "backlog" | "unstarted" | "started" | "review" | "done" | "canceled";

/** What the source says about where an issue stands, when its status name doesn't say it. */
export type StatusHint = "todo" | "doing" | "done";

export type SourceIssue = {
  /** 1-based row in its file, after the header. */
  row: number;
  /** The file it came from, when the import has several. */
  file?: string;
  /** The source's stable id: what re-imports match on. Never changes between exports. */
  externalId: string;
  /** How the source shows the issue ("ENG-12", "sc-123", a task id): for the note. */
  key: string;
  /** The number in `key` when the source has keys like ENG-12, so the issue can keep it. */
  number?: number;
  /** The team (→ space) it belongs to. */
  team: string;
  /** The team's key prefix ("ENG"), or "" when the source has none. */
  prefix: string;
  title: string;
  description: string;
  /** The source's status, as the status mapping shows it. */
  status: string;
  statusHint?: StatusHint;
  /** The proposed priority, and the source's own name for it (the priority mapping's row). */
  priority: Priority;
  priorityName: string;
  /** The Pantry project (workstream) inside the space. */
  projectRef?: { id: string; name: string };
  /** Email, "Name <email>" or display name. */
  creator: string;
  assignee: string;
  labels: string[];
  /** The source's issue type ("Bug", "feature"), added as a label when the review says so. */
  typeLabel?: string;
  createdAt?: number;
  startedAt?: number;
  completedAt?: number;
  canceledAt?: number;
  archivedAt?: number;
  /** "YYYY-MM-DD". */
  dueDate?: string;
  /** The parent's `externalId` when the parent is in the files. */
  parentId?: string;
  /** How the source names the parent, for the note when it can't be attached. */
  parentRef?: string;
  /** Source fields Pantry has no place for: `- label: value` lines in the note, per fold field. */
  extras: { field: string; label: string; value: string }[];
  /** Comments, imported as comments under the importer's name with the original author and date. */
  comments?: { author: string; date?: number; body: string }[];
};

export type Parsed<I extends SourceIssue = SourceIssue> = {
  issues: I[];
  /** Rows left out, with why. */
  problems: string[];
  /** Things to check that don't stop the import (dates we couldn't read, a capped export…). */
  warnings?: string[];
  /** Columns that aren't imported, with how many rows have a value in each. */
  dropped: { column: string; count: number }[];
};

/** A group of source fields that go into the note at the end of the description. */
export type FoldField = { id: string; label: string };

/** Every source has these two. */
export const BASE_FOLD_FIELDS = (source: string): FoldField[] => [
  { id: "people", label: "Creator and assignee who aren't members" },
  { id: "dates", label: `Created date and ${source} key` },
];

/** Case-insensitive, whitespace-normalised name key (the backend's `nameKey`). */
export const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** Comma-separated values, trimmed, without empties. */
export const list = (value: string | undefined, separator: string | RegExp = ",") =>
  (value ?? "")
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean);

/** The email in "Ana <ana@example.com>" or "ana@example.com", lowercased. */
export function emailIn(value: string): string | undefined {
  return /[^\s<>(),;"']+@[^\s<>(),;"']+\.[^\s<>(),;"']+/.exec(value)?.[0]?.toLowerCase();
}

// ---------------------------------------------------------------------------------------------
// What's in the file
// ---------------------------------------------------------------------------------------------

export type Summary = {
  teams: { name: string; prefix: string; count: number; maxNumber: number }[];
  statuses: { name: string; count: number }[];
  priorities: { key: string; name: string; priority: Priority; count: number }[];
  labels: { name: string; count: number }[];
  types: { name: string; count: number }[];
  people: { value: string; count: number }[];
  archived: number;
  comments: number;
  /** Issues that have a value, per fold field. */
  folded: Record<string, number>;
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

const PRIORITY_ORDER: Priority[] = [1, 2, 3, 4, 0];

export function summarize(parsed: Parsed, foldFields: FoldField[]): Summary {
  const { issues } = parsed;
  const teams = new Map<string, Summary["teams"][number]>();
  for (const issue of issues) {
    const team = teams.get(issue.team) ?? {
      name: issue.team,
      prefix: issue.prefix,
      count: 0,
      maxNumber: 0,
    };
    team.count += 1;
    team.maxNumber = Math.max(team.maxNumber, issue.number ?? 0);
    teams.set(issue.team, team);
  }
  const count = (test: (issue: SourceIssue) => boolean) => issues.filter(test).length;
  const priorities = new Map<string, Summary["priorities"][number]>();
  for (const issue of issues) {
    const key = nameKey(issue.priorityName);
    const row = priorities.get(key) ?? {
      key,
      name: issue.priorityName || "No priority",
      priority: issue.priority,
      count: 0,
    };
    row.count += 1;
    priorities.set(key, row);
  }
  const folded: Record<string, number> = {};
  for (const field of foldFields) {
    folded[field.id] =
      field.id === "people"
        ? count((issue) => Boolean(issue.creator || issue.assignee))
        : field.id === "dates"
          ? count((issue) => issue.createdAt !== undefined)
          : count((issue) => issue.extras.some((extra) => extra.field === field.id));
  }
  return {
    teams: [...teams.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    statuses: tally(issues, (issue) => [issue.status]).sort((a, b) => b.count - a.count),
    priorities: [...priorities.values()].sort(
      (a, b) =>
        PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
        b.count - a.count,
    ),
    labels: tally(issues, (issue) => issue.labels).sort((a, b) => a.name.localeCompare(b.name)),
    types: tally(issues, (issue) => (issue.typeLabel ? [issue.typeLabel] : [])).sort(
      (a, b) => b.count - a.count,
    ),
    people: tally(issues, (issue) => [issue.creator, issue.assignee].filter(Boolean)).map(
      ({ name, count: n }) => ({ value: name, count: n }),
    ),
    archived: count((issue) => issue.archivedAt !== undefined),
    comments: issues.reduce((sum, issue) => sum + (issue.comments?.length ?? 0), 0),
    folded,
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

/** What the server knows about these files (imports.context). */
export type ImportContext = {
  teams: Record<string, { spaceId: string; key: string; name: string } | null>;
  people: Record<string, { memberId: string; displayName: string } | null>;
  imported: Record<string, string>;
};

export type TeamTarget =
  | { kind: "new"; name: string; key: string }
  | { kind: "existing"; spaceId: string };

export type ReviewOptions = {
  teams: Record<string, TeamTarget>;
  /** Source status name (nameKey) → Pantry status id. */
  statuses: Record<string, string>;
  /** Source priority name (nameKey) → Pantry priority. */
  priorities: Record<string, Priority>;
  includeArchived: boolean;
  /** Add the source's issue type ("Bug", "feature") as a label. */
  typeLabels: boolean;
  /** Bring the source's comments in as comments (Jira). */
  comments: boolean;
  fold: Record<string, boolean>;
};

const CATEGORY_WORDS: [StatusCategory, RegExp][] = [
  // "Ready for Development" is waiting to start, not "develop" in progress.
  ["unstarted", /ready for (dev|development|work|pickup)\b/],
  ["canceled", /cancel|duplicate|won'?t|wontfix|reject|invalid|obsolete|declined|cannot reproduce|incomplete|not a bug/],
  ["done", /done|complete|closed|shipped|released|merged|resolved|finished|deployed/],
  ["review", /review|qa\b|testing|verify|approval|deploy|staging/],
  ["started", /progress|started|doing|active|working|develop/],
  ["unstarted", /todo|to do|unstarted|planned|ready|next|selected/],
  ["backlog", /backlog|triage|icebox|someday|idea|unscheduled/],
];

const HINT_CATEGORIES: Record<StatusHint, { allowed: StatusCategory[]; fallback: StatusCategory }> =
  {
    todo: { allowed: ["backlog", "unstarted"], fallback: "unstarted" },
    doing: { allowed: ["started", "review"], fallback: "started" },
    done: { allowed: ["done", "canceled"], fallback: "done" },
  };

/**
 * The Pantry status for a source status: the one with the same name, else by meaning (Duplicate →
 * Canceled), checked against what the source says about it (Jira's status category, Asana's
 * completion) when it says anything, else by what its issues' dates say (completed → done, canceled,
 * started), else Backlog.
 */
export function guessStatus(
  name: string,
  issues: SourceIssue[],
  statuses: WorkspaceInfo["statuses"],
): string | undefined {
  const same = statuses.find((status) => nameKey(status.name) === nameKey(name));
  if (same) return same._id;
  const key = nameKey(name);
  const mine = issues.filter((issue) => nameKey(issue.status) === key);
  const most = (test: (issue: SourceIssue) => boolean) =>
    mine.length > 0 && mine.filter(test).length > mine.length / 2;
  const hint = (["done", "doing", "todo"] as StatusHint[]).find((value) =>
    most((issue) => issue.statusHint === value),
  );
  let category = CATEGORY_WORDS.find(([, words]) => words.test(key))?.[0];
  if (hint && (!category || !HINT_CATEGORIES[hint].allowed.includes(category)))
    category = HINT_CATEGORIES[hint].fallback;
  if (!category) {
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

/** A valid space key from a prefix or a name ("Salt & Pepper" → "SP"), else `fallback`. */
export function suggestKey(prefix: string, team: string, fallback = "LIN"): string {
  const fromPrefix = prefix
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 10);
  if (SPACE_KEY_PATTERN.test(fromPrefix)) return fromPrefix;
  const words = team.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words.map((word) => word[0]!.toUpperCase()).join("");
  const key = (
    initials.length >= 2 ? initials : team.toUpperCase().replace(/[^A-Z0-9]/g, "")
  ).slice(0, 10);
  if (SPACE_KEY_PATTERN.test(key)) return key;
  // One word: its first letters ("Website" → "WEB").
  const word = team.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  return SPACE_KEY_PATTERN.test(word) ? word : fallback;
}

/** A short key from a name: its initials (2–4 words), else its first three letters. */
export function shortKey(name: string, fallback: string): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const initials = words
    .slice(0, 4)
    .map((word) => word[0]!.toUpperCase())
    .join("");
  if (words.length >= 2 && SPACE_KEY_PATTERN.test(initials)) return initials;
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
  return SPACE_KEY_PATTERN.test(letters) ? letters : fallback;
}

/** Keys of new spaces, unique among themselves and the workspace's: ACME, ACME2, ACME3… */
function freeKey(key: string, taken: Set<string>): string {
  if (!taken.has(key)) return key;
  for (let n = 2; n < 100; n += 1) {
    const next = `${key.slice(0, 10 - String(n).length)}${n}`;
    if (!taken.has(next)) return next;
  }
  return key;
}

/**
 * Where each team goes unless the owner changes it: the space it went to last time; else an
 * existing space whose key is the team's prefix (issues keep their numbers there where free); else a
 * new space named after the team with the prefix (or the name's initials) as its key.
 */
export function defaultOptions(
  parsed: Parsed,
  summary: Summary,
  workspace: WorkspaceInfo,
  context: ImportContext,
  keyFallback = "LIN",
): ReviewOptions {
  const teams: Record<string, TeamTarget> = {};
  const taken = new Set(workspace.spaces.map((space) => space.key));
  for (const team of summary.teams) {
    const linked = context.teams[team.name];
    const sameKey = team.prefix
      ? workspace.spaces.find((space) => space.key === team.prefix.toUpperCase())
      : undefined;
    if (linked && workspace.spaces.some((space) => space._id === linked.spaceId))
      teams[team.name] = { kind: "existing", spaceId: linked.spaceId };
    else if (sameKey) teams[team.name] = { kind: "existing", spaceId: sameKey._id };
    else {
      // A source with keys keeps the prefix (a clash is for the owner to settle); otherwise a short
      // free key from the name ("Growth" → GRO, "Web Shop" → WS).
      const key = team.prefix
        ? suggestKey(team.prefix, team.name, keyFallback)
        : freeKey(shortKey(team.name, keyFallback), taken);
      taken.add(key);
      teams[team.name] = { kind: "new", name: team.name.slice(0, 80), key };
    }
  }
  const statuses: Record<string, string> = {};
  for (const status of summary.statuses) {
    const id = guessStatus(status.name, parsed.issues, workspace.statuses);
    if (id) statuses[nameKey(status.name)] = id;
  }
  const priorities: Record<string, Priority> = {};
  for (const row of summary.priorities) priorities[row.key] = row.priority;
  return {
    teams,
    statuses,
    priorities,
    includeArchived: false,
    typeLabels: true,
    comments: true,
    fold: Object.fromEntries(Object.keys(summary.folded).map((id) => [id, true])),
  };
}

/**
 * The options for a new parse of the same import (the owner changed a source setting or added a
 * file): the new defaults, with every choice the owner already made that still applies.
 */
export function carryOptions(previous: ReviewOptions, next: ReviewOptions): ReviewOptions {
  const keep = <T>(fresh: Record<string, T>, old: Record<string, T>) =>
    Object.fromEntries(Object.entries(fresh).map(([key, value]) => [key, old[key] ?? value]));
  return {
    teams: keep(next.teams, previous.teams),
    statuses: keep(next.statuses, previous.statuses),
    priorities: keep(next.priorities, previous.priorities),
    includeArchived: previous.includeArchived,
    typeLabels: previous.typeLabels,
    comments: previous.comments,
    fold: keep(next.fold, previous.fold),
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
  /** The source key when the issue can keep its number ("ENG-12"), else "". */
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
  comments?: string[];
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
    /** Sub-issues that come in as top-level issues (parent left out, ambiguous or in another space). */
    detached: number;
  };
  comments: number;
  people: { value: string; count: number; member: { _id: string; displayName: string } | null }[];
  problems: string[];
};

const MAX_TITLE = 200;
const MAX_DESCRIPTION = 100_000;
/** convex/lib/comments.ts MAX_COMMENT. */
const MAX_COMMENT = 20_000;
/** Comments per issue an import brings in (convex/lib/imports.ts takes at most this many). */
export const MAX_COMMENTS = 100;

/** A member for a person: by sign-in email (from the server), else by unique display name. */
export function personResolver(workspace: WorkspaceInfo, context: ImportContext) {
  return (value: string) => {
    if (!value) return null;
    const email = emailIn(value);
    if (email) {
      const match = context.people[email];
      if (match) return { _id: match.memberId, displayName: match.displayName };
      // "Ana Lopez <ana@…>": the name can still match a member.
      const name = value.replace(/<[^>]*>/, "").trim();
      if (!name || name.includes("@")) return null;
      value = name;
    }
    const named = workspace.members.filter(
      (member) => nameKey(member.displayName) === nameKey(value),
    );
    return named.length === 1 ? named[0]! : null;
  };
}

/** The note at the end of an imported description: what Pantry has no field for. */
export function sourceNote(
  issue: SourceIssue,
  sourceName: string,
  fold: Record<string, boolean>,
  extra: {
    creatorUnmatched: boolean;
    assigneeUnmatched: boolean;
    fullTitle?: string;
    detachedFrom?: string;
    commentsLeftOut?: number;
  },
): string {
  const lines: string[] = [];
  const head: string[] = [];
  const by = fold.people && extra.creatorUnmatched && issue.creator ? issue.creator : null;
  if (fold.dates) {
    head.push(`Imported from ${sourceName}: ${issue.key}`);
    if (issue.createdAt !== undefined)
      head.push(`created ${isoDay(issue.createdAt)}${by ? ` by ${by}` : ""}`);
    else if (by) head.push(`created by ${by}`);
  } else if (by) head.push(`Created in ${sourceName} by ${by}`);
  if (fold.people && extra.assigneeUnmatched && issue.assignee)
    lines.push(`- Assignee in ${sourceName}: ${issue.assignee}`);
  if (extra.fullTitle) lines.push(`- Full title: ${extra.fullTitle}`);
  if (extra.detachedFrom) lines.push(`- Sub-issue of ${extra.detachedFrom} in ${sourceName}`);
  for (const row of issue.extras) {
    if (fold[row.field] && row.value) lines.push(`- ${row.label}: ${row.value}`);
  }
  if (issue.archivedAt !== undefined)
    lines.push(`- Archived in ${sourceName} on ${isoDay(issue.archivedAt)}`);
  if (extra.commentsLeftOut)
    lines.push(`- ${extra.commentsLeftOut} older comments in ${sourceName} aren't imported`);
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

/** An imported comment: who wrote it and when in the source, then the text. */
export function commentBody(
  comment: { author: string; date?: number; body: string },
  sourceName: string,
): string {
  const who = comment.author || "Someone";
  const when = comment.date !== undefined ? ` on ${isoDay(comment.date)}` : "";
  const head = `*${who} in ${sourceName}${when}:*`;
  const room = MAX_COMMENT - head.length - 3;
  const body = comment.body.length > room ? `${comment.body.slice(0, room - 1)}…` : comment.body;
  return `${head}\n\n${body}`;
}

/**
 * The whole import, from the files and the review's choices: the spaces, projects and labels to make
 * or reuse, then each issue (parents first). Sub-issues stay one level deep: a sub-issue of a
 * sub-issue hangs off the top-level issue. A sub-issue whose parent is left out (archived, not in the
 * files, ambiguous) or goes to another space comes in as a top-level issue, with a note saying whose
 * it was.
 */
export function planImport(
  parsed: Parsed,
  summary: Summary,
  options: ReviewOptions,
  workspace: WorkspaceInfo,
  context: ImportContext,
  sourceName = "Linear",
): ImportPlan {
  const person = personResolver(workspace, context);
  const byId = new Map(parsed.issues.map((issue) => [issue.externalId, issue]));
  const included = parsed.issues.filter(
    (issue) => options.includeArchived || issue.archivedAt === undefined,
  );
  const includedIds = new Set(included.map((issue) => issue.externalId));
  const spaceOf = (team: string) => {
    const target = options.teams[team];
    return target?.kind === "existing" ? `space:${target.spaceId}` : `team:${team}`;
  };

  /** The top-level ancestor this issue hangs off in Pantry, or why it can't have one. */
  function parentFor(issue: SourceIssue): { parent?: SourceIssue; detachedFrom?: string } {
    if (!issue.parentId) return issue.parentRef ? { detachedFrom: issue.parentRef } : {};
    const detached = { detachedFrom: issue.parentRef ?? byId.get(issue.parentId)?.key };
    let parent = byId.get(issue.parentId);
    const seen = new Set([issue.externalId]);
    while (parent?.parentId && !seen.has(parent.externalId)) {
      seen.add(parent.externalId);
      const next = byId.get(parent.parentId);
      if (!next) break;
      parent = next;
    }
    if (!parent || seen.has(parent.parentId ?? "") || parent.externalId === issue.externalId)
      return detached;
    const usable =
      (includedIds.has(parent.externalId) || parent.externalId in context.imported) &&
      spaceOf(parent.team) === spaceOf(issue.team);
    return usable ? { parent } : detached;
  }

  const drafts: Draft[] = [];
  const projects = new Map<string, Map<string, string>>(); // team → externalId → name
  const labels = new Map<string, string>();
  let subIssues = 0;
  let detached = 0;
  let alreadyImported = 0;
  let comments = 0;
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
      !parent && issue.projectRef?.name
        ? issue.projectRef.id || `name:${nameKey(issue.projectRef.name)}`
        : undefined;
    if (projectExternalId) {
      const teamProjects = projects.get(issue.team) ?? new Map<string, string>();
      teamProjects.set(projectExternalId, issue.projectRef!.name);
      projects.set(issue.team, teamProjects);
    }
    const issueLabels = [
      ...issue.labels,
      ...(options.typeLabels && issue.typeLabel ? [issue.typeLabel] : []),
    ];
    for (const label of issueLabels)
      if (!labels.has(nameKey(label))) labels.set(nameKey(label), label);
    const sourceComments = options.comments === false ? [] : (issue.comments ?? []);
    const issueComments = sourceComments
      .slice(-MAX_COMMENTS)
      .map((comment) => commentBody(comment, sourceName));
    const note = sourceNote(issue, sourceName, options.fold, {
      creatorUnmatched: !creator,
      assigneeUnmatched: !assignee,
      fullTitle: title.full,
      detachedFrom,
      commentsLeftOut: Math.max(0, sourceComments.length - MAX_COMMENTS),
    });
    comments += issueComments.length;
    drafts.push({
      externalId: issue.externalId,
      sourceKey: issue.number !== undefined ? issue.key : "",
      team: issue.team,
      ...(projectExternalId ? { projectExternalId } : {}),
      ...(parent ? { parentExternalId: parent.externalId } : {}),
      title: title.title,
      description: withNote(issue.description, note),
      statusId,
      priority: options.priorities[nameKey(issue.priorityName)] ?? issue.priority,
      labels: [...new Set(issueLabels.map(nameKey))],
      ...(assignee ? { assigneeId: assignee._id } : {}),
      ...(creator ? { creatorId: creator._id } : {}),
      ...(issue.dueDate ? { dueDate: issue.dueDate } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
      ...(issueComments.length ? { comments: issueComments } : {}),
    });
  }
  // Parents first, then sub-issues; each in the source's number order, else file order.
  const order = new Map(parsed.issues.map((issue, index) => [issue.externalId, { issue, index }]));
  drafts.sort((a, b) => {
    const level = Number(Boolean(a.parentExternalId)) - Number(Boolean(b.parentExternalId));
    if (level !== 0) return level;
    const left = order.get(a.externalId)!;
    const right = order.get(b.externalId)!;
    const numbered = left.issue.number !== undefined && right.issue.number !== undefined;
    return (
      left.issue.team.localeCompare(right.issue.team) ||
      (numbered ? left.issue.number! - right.issue.number! : left.index - right.index)
    );
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
        ([externalId, name]) => ({ externalId, name }),
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
    comments,
    people: summary.people.map((row) => ({ ...row, member: person(row.value) })),
    problems: [...parsed.problems, ...reviewProblems(options, summary, workspace)],
  };
}

/** What stops Import: a new space without a valid or free key, two teams wanting the same new key. */
export function reviewProblems(
  options: ReviewOptions,
  summary: Summary,
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
// Batches for imports.importIssues
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
  comments?: string[];
};

export const BATCH_SIZE = 50;
/** Keeps one batch's arguments far below Convex's argument size limit, whatever the descriptions. */
export const BATCH_CHARS = 1_000_000;
/** Comments per batch: each is a write, and a batch is one transaction. */
export const BATCH_COMMENTS = 500;

/** The drafts as mutation arguments with the ids `prepare` returned, in batches. */
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
  let currentComments = 0;
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
      ...(draft.comments?.length ? { comments: draft.comments } : {}),
    };
    const commentCount = args.comments?.length ?? 0;
    const length =
      args.description.length +
      args.title.length +
      500 +
      (args.comments ?? []).reduce((sum, body) => sum + body.length + 50, 0);
    if (
      current.length > 0 &&
      (current.length >= size ||
        currentChars + length > chars ||
        currentComments + commentCount > BATCH_COMMENTS)
    ) {
      batches.push(current);
      current = [];
      currentChars = 0;
      currentComments = 0;
    }
    current.push(args);
    currentChars += length;
    currentComments += commentCount;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
