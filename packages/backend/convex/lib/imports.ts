import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logImportActivity } from "./activity";
import { MAX_COMMENT } from "./comments";
import { fail } from "./errors";
import {
  checkDescription,
  checkDueDate,
  checkParent,
  cleanTitle,
  getStatus,
  placeInColumn,
  type Priority,
} from "./issues";
import { isProject } from "./model";
import { createLabel, createProject, createSpace, workspaceLabelRows } from "./organise";
import { isTerminal } from "./rules";
import { activeProjects, getProjectForSpace, getSpace, nameKey } from "./spaces";
import { PALETTE } from "./validate";
import type { importSource } from "../schema";

/**
 * Importing from another tracker (Settings → Import and Export). The app parses the file and shows a
 * review; these helpers do the writes, with the same rules as everything else (keys, the sub-issue
 * rule, label and project names) plus one: every row an import makes is remembered in `importLinks`
 * under the source's own id, so importing the same file again skips what's already there, and an
 * import that stopped halfway carries on where it stopped.
 */

export type ImportSource = Infer<typeof importSource>;

/** What one batch call may carry: well inside Convex's per-transaction read and write limits. */
export const MAX_ISSUES_PER_BATCH = 100;
export const MAX_TEAMS = 50;
export const MAX_PROJECTS = 500;
export const MAX_LABELS = 500;

/** What the source is called in the timeline ("imported the issue from Linear"). */
export const SOURCE_NAME: Record<ImportSource, string> = {
  linear: "Linear",
  asana: "Asana",
  shortcut: "Shortcut",
  jira: "Jira",
  csv: "a CSV file",
};

/** Comments one imported issue may bring (Jira's), each at most MAX_COMMENT characters. */
export const MAX_COMMENTS_PER_ISSUE = 100;
/** Comments one batch may bring: each is a write in the batch's transaction. */
export const MAX_COMMENTS_PER_BATCH = 1_000;

// ---------------------------------------------------------------------------------------------
// Links: source id → what the import made
// ---------------------------------------------------------------------------------------------

export async function findLink(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  source: ImportSource,
  externalId: string,
) {
  return ctx.db
    .query("importLinks")
    .withIndex("by_workspace_source_and_external", (q) =>
      q.eq("workspaceId", workspaceId).eq("source", source).eq("externalId", externalId),
    )
    .first();
}

/** Records (or repoints, when the old target was deleted) the link for `externalId`. */
async function saveLink(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  source: ImportSource,
  externalId: string,
  target: Doc<"importLinks">["target"],
) {
  const existing = await findLink(ctx, workspaceId, source, externalId);
  if (existing) {
    if (existing.target !== target) await ctx.db.patch("importLinks", existing._id, { target });
    return;
  }
  await ctx.db.insert("importLinks", { workspaceId, source, externalId, target });
}

/** The live issue an earlier import made from `externalId`, or null (never imported, or deleted since). */
export async function importedIssue(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  source: ImportSource,
  externalId: string,
): Promise<Doc<"issues"> | null> {
  const link = await findLink(ctx, workspaceId, source, externalId);
  if (!link) return null;
  const id = ctx.db.normalizeId("issues", link.target);
  const issue = id ? await ctx.db.get("issues", id) : null;
  return issue && issue.workspaceId === workspaceId ? issue : null;
}

/** The live space an earlier import made or used for `externalId` (a team), or null. */
export async function linkedSpace(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  source: ImportSource,
  externalId: string,
): Promise<Doc<"spaces"> | null> {
  const link = await findLink(ctx, workspaceId, source, externalId);
  const id = link ? ctx.db.normalizeId("spaces", link.target) : null;
  const space = id ? await ctx.db.get("spaces", id) : null;
  return space && space.workspaceId === workspaceId && space.archivedAt === undefined
    ? space
    : null;
}

/** A stable palette colour for a name, so the same label or project gets the same colour every time. */
export function paletteColorFor(name: string): string {
  let hash = 0;
  for (const char of nameKey(name)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  // Skip gray: imported labels and projects read better with a hue.
  const hues = PALETTE.filter((color) => color !== "gray");
  return hues[hash % hues.length]!;
}

/** Trims to `max` characters on a word boundary when it can, for names longer than Pantry allows. */
export function clip(value: string, max: number): string {
  const clean = value.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------
// Step 1: spaces, projects and labels
// ---------------------------------------------------------------------------------------------

export type TeamPlan = {
  /** The source's name for the team (a Linear team, a Jira project…); its link is `team:<name>`. */
  team: string;
  /** The team's issue prefix in the source ("ENG" for ENG-12), or "" when it has none. */
  prefix: string;
  /** The highest issue number of the team in the file (archived included). */
  maxNumber: number;
  target: { spaceId: Id<"spaces"> } | { name: string; key: string };
  projects: { externalId: string; name: string }[];
};

export type PreparedTeam = {
  team: string;
  spaceId: Id<"spaces">;
  key: string;
  name: string;
  createdSpace: boolean;
  /** The space's key is the team's prefix, so issues keep their numbers where they're free. */
  keepsNumbers: boolean;
  projects: Record<string, Id<"projects">>;
};

/**
 * Finds or creates each team's space (a space this import made before is found by its link, even
 * when the review picked "new space" again), each project inside it and each label (by name, ignoring
 * case, so existing labels are reused). When the space's key is the team's prefix, its counter is
 * raised past the file's highest number first, so renumbered issues never take a number a later
 * issue of the file keeps.
 */
export async function prepareImport(
  ctx: MutationCtx,
  importer: Doc<"members">,
  source: ImportSource,
  teams: TeamPlan[],
  labelNames: string[],
) {
  if (teams.length > MAX_TEAMS) fail("TOO_MANY", `An import can have at most ${MAX_TEAMS} teams.`);
  if (labelNames.length > MAX_LABELS)
    fail("TOO_MANY", `An import can have at most ${MAX_LABELS} labels.`);
  if (teams.reduce((sum, team) => sum + team.projects.length, 0) > MAX_PROJECTS)
    fail("TOO_MANY", `An import can have at most ${MAX_PROJECTS} projects.`);
  const workspaceId = importer.workspaceId;
  const created = { spaces: 0, projects: 0, labels: 0 };
  const prepared: PreparedTeam[] = [];

  for (const team of teams) {
    const teamId = `team:${team.team}`;
    let space = await linkedSpace(ctx, workspaceId, source, teamId);
    let createdSpace = false;
    if (!space && "spaceId" in team.target) {
      space = await getSpace(ctx, workspaceId, team.target.spaceId);
      if (space.archivedAt !== undefined) fail("ARCHIVED", `${space.name} is archived.`);
    }
    if (!space && "key" in team.target) {
      const made = await createSpace(ctx, importer, {
        name: team.target.name,
        key: team.target.key,
      });
      space = (await ctx.db.get("spaces", made.spaceId))!;
      createdSpace = true;
      created.spaces += 1;
    }
    await saveLink(ctx, workspaceId, source, teamId, space!._id);
    space = space!;

    const keepsNumbers = team.prefix !== "" && space.key === team.prefix.toUpperCase();
    if (keepsNumbers && space.nextIssueNumber <= team.maxNumber) {
      await ctx.db.patch("spaces", space._id, { nextIssueNumber: team.maxNumber + 1 });
    }

    const projects: Record<string, Id<"projects">> = {};
    let active = await activeProjects(ctx, space._id);
    for (const project of team.projects) {
      const linkId = `project:${project.externalId}:${team.team}`;
      const link = await findLink(ctx, workspaceId, source, linkId);
      const linkedId = link ? ctx.db.normalizeId("projects", link.target) : null;
      const linked = linkedId ? await ctx.db.get("projects", linkedId) : null;
      let projectId =
        linked &&
        isProject(linked) &&
        linked.spaceId === space._id &&
        linked.archivedAt === undefined
          ? linked._id
          : undefined;
      const name = clip(project.name, 60);
      projectId ??= active.find((row) => nameKey(row.name) === nameKey(name))?._id;
      if (!projectId) {
        projectId = (await createProject(ctx, space, { name, color: paletteColorFor(name) }))
          .projectId;
        created.projects += 1;
        active = await activeProjects(ctx, space._id);
      }
      await saveLink(ctx, workspaceId, source, linkId, projectId);
      projects[project.externalId] = projectId;
    }

    prepared.push({
      team: team.team,
      spaceId: space._id,
      key: space.key,
      name: space.name,
      createdSpace,
      keepsNumbers,
      projects,
    });
  }

  // Labels are workspace-wide and unique by name (ignoring case): reuse, else create.
  const labels: Record<string, Id<"labels">> = {};
  let existing = await workspaceLabelRows(ctx, workspaceId);
  for (const raw of labelNames) {
    const name = clip(raw, 40);
    if (!name) continue;
    let label = existing.find((row) => nameKey(row.name) === nameKey(name));
    if (!label) {
      const { labelId } = await createLabel(ctx, workspaceId, {
        name,
        color: paletteColorFor(name),
      });
      created.labels += 1;
      existing = await workspaceLabelRows(ctx, workspaceId);
      label = existing.find((row) => row._id === labelId)!;
    }
    labels[nameKey(raw)] = label._id;
  }

  return { teams: prepared, labels, created };
}

// ---------------------------------------------------------------------------------------------
// Step 2: issues, in batches, parents before their sub-issues
// ---------------------------------------------------------------------------------------------

export type ImportIssueInput = {
  /** The source's stable id for the issue (Linear's UUID, Jira's issue id, Asana's task id…). */
  externalId: string;
  /**
   * The issue's key in the source ("ENG-12"): kept as the Pantry key when the space's key matches.
   * Empty for sources without keys (Asana, Shortcut).
   */
  sourceKey: string;
  spaceId: Id<"spaces">;
  projectId?: Id<"projects">;
  /** The parent's `externalId`; it must have been imported first (an earlier batch or earlier here). */
  parentExternalId?: string;
  title: string;
  description: string;
  statusId: Id<"statuses">;
  priority: Priority;
  assigneeId?: Id<"members">;
  creatorId?: Id<"members">;
  labelIds: Id<"labels">[];
  dueDate?: string;
  /** When it was done or canceled in the source (only kept for done and canceled statuses). */
  completedAt?: number;
  /**
   * The source's comments, oldest first, each already saying who wrote it there and when. They're
   * written under the importer's name, tagged "via import", and only when the issue is created.
   */
  comments?: string[];
};

export type ImportIssueResult = {
  externalId: string;
  key: string;
  outcome: "created" | "skipped";
  /** The source's number was taken in this space, so the issue got the next free one. */
  renumbered?: true;
  /** The parent wasn't imported (left out, or deleted since), so this came in as a top-level issue. */
  parentMissing?: true;
};

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]*)-(\d+)$/;

/**
 * Whether the space's key is the source's prefix (`matches`) and, if so, the source's number when
 * that key is still free in Pantry.
 */
async function keptNumber(
  ctx: QueryCtx,
  space: Doc<"spaces">,
  sourceKey: string,
): Promise<{ matches: boolean; number: number | null }> {
  const match = KEY_PATTERN.exec(sourceKey.trim());
  if (!match || match[1]!.toUpperCase() !== space.key) return { matches: false, number: null };
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1) return { matches: true, number: null };
  const taken = await ctx.db
    .query("issues")
    .withIndex("by_workspace_and_key", (q) =>
      q.eq("workspaceId", space.workspaceId).eq("key", `${space.key}-${number}`),
    )
    .first();
  return { matches: true, number: taken ? null : number };
}

async function checkMember(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  memberId: Id<"members"> | undefined,
) {
  if (!memberId) return undefined;
  const member = await ctx.db.get("members", memberId);
  if (!member || member.workspaceId !== workspaceId) return fail("NOT_FOUND", "Member not found.");
  return member._id;
}

/**
 * One issue from the source, or a skip when an earlier import already made it. Same rules as
 * `createIssue` (title, description, due date, project of the space, sub-issues one level deep in
 * the parent's space and project, top of its column), plus the source's number when the key is free,
 * the matched creator, the source's completion time, its comments (tagged "via import", without
 * an activity row each) and one `created` row "via import".
 */
export async function importIssue(
  ctx: MutationCtx,
  importer: Doc<"members">,
  source: ImportSource,
  input: ImportIssueInput,
): Promise<ImportIssueResult> {
  const workspaceId = importer.workspaceId;
  const already = await importedIssue(ctx, workspaceId, source, input.externalId);
  if (already) return { externalId: input.externalId, key: already.key, outcome: "skipped" };

  let parent: Doc<"issues"> | null = null;
  let parentMissing = false;
  if (input.parentExternalId) {
    const found = await importedIssue(ctx, workspaceId, source, input.parentExternalId);
    if (found) parent = await checkParent(ctx, workspaceId, found._id);
    else parentMissing = true;
  }
  const space = await getSpace(ctx, workspaceId, parent?.spaceId ?? input.spaceId);
  if (space.archivedAt !== undefined) fail("ARCHIVED", `${space.name} is archived.`);
  let projectId = parent ? parent.projectId : input.projectId;
  if (projectId && !parent)
    projectId = (await getProjectForSpace(ctx, workspaceId, space, projectId))._id;

  const status = await getStatus(ctx, workspaceId, input.statusId);
  const assigneeId = await checkMember(ctx, workspaceId, input.assigneeId);
  const creatorId = (await checkMember(ctx, workspaceId, input.creatorId)) ?? importer._id;
  const labelIds = [...new Set(input.labelIds)];
  for (const labelId of labelIds) {
    const label = await ctx.db.get("labels", labelId);
    if (!label || label.workspaceId !== workspaceId) fail("NOT_FOUND", "Label not found.");
  }

  const comments = (input.comments ?? []).filter((body) => body.trim());
  if (comments.length > MAX_COMMENTS_PER_ISSUE)
    fail("TOO_MANY", `An imported issue can bring at most ${MAX_COMMENTS_PER_ISSUE} comments.`);
  if (comments.some((body) => body.length > MAX_COMMENT))
    fail("TOO_LONG", `Comments can be at most ${MAX_COMMENT.toLocaleString("en")} characters.`);

  const kept = await keptNumber(ctx, space, input.sourceKey);
  const number = kept.number ?? space.nextIssueNumber;
  const nextIssueNumber = Math.max(space.nextIssueNumber, number + 1);
  if (nextIssueNumber !== space.nextIssueNumber)
    await ctx.db.patch("spaces", space._id, { nextIssueNumber });
  const key = `${space.key}-${number}`;

  const now = Date.now();
  const completedAt = isTerminal(status.category)
    ? input.completedAt !== undefined && Number.isFinite(input.completedAt)
      ? Math.min(input.completedAt, now)
      : now
    : undefined;
  const sortOrder = await placeInColumn(ctx, space._id, status._id, {});
  const issueId = await ctx.db.insert("issues", {
    workspaceId,
    spaceId: space._id,
    ...(projectId ? { projectId } : {}),
    number,
    key,
    title: cleanTitle(input.title),
    description: checkDescription(input.description),
    statusId: status._id,
    statusCategory: status.category,
    priority: input.priority,
    ...(assigneeId ? { assigneeId } : {}),
    creatorId,
    labelIds,
    ...(parent ? { parentId: parent._id } : {}),
    ...(input.dueDate ? { dueDate: checkDueDate(input.dueDate) } : {}),
    sortOrder,
    ...(completedAt !== undefined ? { completedAt } : {}),
    updatedAt: now,
  });
  await logImportActivity(
    ctx,
    importer,
    { _id: issueId, workspaceId },
    SOURCE_NAME[source],
    status.name,
  );
  for (const body of comments)
    await ctx.db.insert("comments", { issueId, authorId: importer._id, body, via: "import" });
  await saveLink(ctx, workspaceId, source, input.externalId, issueId);
  return {
    externalId: input.externalId,
    key,
    outcome: "created",
    ...(kept.matches && kept.number === null ? { renumbered: true as const } : {}),
    ...(parentMissing ? { parentMissing: true as const } : {}),
  };
}
