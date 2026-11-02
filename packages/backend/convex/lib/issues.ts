import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { logActivity, type Actor } from "./activity";
import { fail, notFound } from "./errors";
import { isProject, issueSpaceId, type Project } from "./model";
import { isTerminal, normalizeTitle } from "./rules";
import { getProjectForSpace, getSpace } from "./spaces";

/**
 * Issue rules shared by the app (`issues.*`, via "app") and, from M4, the MCP functions (via "mcp"),
 * so both follow the same rules: numbering, the sub-issue rule (same space and project as the
 * parent), the one status-change helper, ordering and activity rows.
 */

export type Priority = Doc<"issues">["priority"];
export type Placement = { beforeId?: Id<"issues">; afterId?: Id<"issues"> };

/** Below this gap between neighbours, a column is renumbered 1, 2, 3… (spec §10b ordering). */
export const MIN_GAP = 1e-9;
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE = 200;
const MAX_DESCRIPTION = 100_000;

// ---------------------------------------------------------------------------------------------
// Lookups, always inside one workspace ("not found" for anything else)
// ---------------------------------------------------------------------------------------------

export async function getIssue(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  issueId: Id<"issues">,
) {
  const issue = await ctx.db.get("issues", issueId);
  if (!issue || issue.workspaceId !== workspaceId) return notFound("Issue");
  return issue;
}

export async function getStatus(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  statusId: Id<"statuses">,
) {
  const status = await ctx.db.get("statuses", statusId);
  if (!status || status.workspaceId !== workspaceId) return notFound("Status");
  return status;
}

async function getMember(ctx: QueryCtx, workspaceId: Id<"workspaces">, memberId: Id<"members">) {
  const member = await ctx.db.get("members", memberId);
  if (!member || member.workspaceId !== workspaceId) return notFound("Member");
  return member;
}

async function getLabels(ctx: QueryCtx, workspaceId: Id<"workspaces">, labelIds: Id<"labels">[]) {
  const unique = [...new Set(labelIds)];
  const labels = await Promise.all(unique.map((id) => ctx.db.get("labels", id)));
  return labels.map((label) =>
    label && label.workspaceId === workspaceId ? label : notFound("Label"),
  );
}

/** The first `unstarted` status by order (Todo by default): where new issues land unless told otherwise. */
export async function defaultStatus(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const statuses = await ctx.db
    .query("statuses")
    .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", workspaceId))
    .collect();
  const status = statuses.find((row) => row.category === "unstarted") ?? statuses[0];
  if (!status) return notFound("Status");
  return status;
}

// ---------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------

export function cleanTitle(title: string): string {
  const clean = normalizeTitle(title);
  if (!clean) fail("INVALID_TITLE", "Give the issue a title.");
  if (clean.length > MAX_TITLE)
    fail("INVALID_TITLE", `Titles can be at most ${MAX_TITLE} characters.`);
  return clean;
}

export function checkDescription(description: string): string {
  if (description.length > MAX_DESCRIPTION) {
    fail(
      "TOO_LONG",
      `Descriptions can be at most ${MAX_DESCRIPTION.toLocaleString("en")} characters.`,
    );
  }
  return description;
}

/** "YYYY-MM-DD" that is a real calendar day. */
export function checkDueDate(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  const parsed = new Date(Date.UTC(year!, month! - 1, date!));
  if (
    !DAY_PATTERN.test(day) ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month! - 1 ||
    parsed.getUTCDate() !== date
  ) {
    fail("INVALID_DATE", "Due dates are calendar days like 2026-10-28.");
  }
  return day;
}

// ---------------------------------------------------------------------------------------------
// Sub-issues: one level, no loops, same space and project as the parent
// ---------------------------------------------------------------------------------------------

/**
 * The one sub-issue rule, for `issues.create`, `issues.update` and MCP `create_sub_issue`:
 * the parent is in the workspace, isn't the issue itself, isn't a sub-issue, and an issue that
 * has sub-issues can't become one; an existing issue must be in the parent's space. Returns the
 * parent, whose space and project the sub-issue takes.
 */
export async function checkParent(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  parentId: Id<"issues">,
  child?: Doc<"issues">,
): Promise<Doc<"issues">> {
  if (child && parentId === child._id) fail("INVALID_PARENT", "An issue can't be its own parent.");
  const parent = await ctx.db.get("issues", parentId);
  if (!parent || parent.workspaceId !== workspaceId) return notFound("Parent issue");
  if (parent.parentId !== undefined) {
    fail("INVALID_PARENT", `${parent.key} is already a sub-issue; sub-issues are one level deep.`);
  }
  if (child) {
    const grandchild = await ctx.db
      .query("issues")
      .withIndex("by_parent", (q) => q.eq("parentId", child._id))
      .first();
    if (grandchild) {
      fail(
        "INVALID_PARENT",
        `${child.key} has sub-issues of its own, so it can't become a sub-issue.`,
      );
    }
    if (child.spaceId !== parent.spaceId) {
      fail("INVALID_PARENT", "A sub-issue has to be in the same space as its parent.");
    }
  }
  return parent;
}

// ---------------------------------------------------------------------------------------------
// Ordering inside a status column
// ---------------------------------------------------------------------------------------------

type Column = { spaceId: Id<"spaces">; statusId: Id<"statuses"> };

const inColumn = (ctx: QueryCtx, { spaceId, statusId }: Column) =>
  ctx.db
    .query("issues")
    .withIndex("by_space_and_status", (q) => q.eq("spaceId", spaceId).eq("statusId", statusId));

/**
 * The issue right after `anchor` (or right before it, `direction: "desc"`) in column order
 * (`sortOrder`, then creation), skipping `skip`. Reads only the anchor's ties and one neighbour, not
 * the column.
 */
async function neighbour(
  ctx: QueryCtx,
  column: Column,
  anchor: Doc<"issues">,
  direction: "asc" | "desc",
  skip?: Id<"issues">,
) {
  const rows = ctx.db
    .query("issues")
    .withIndex("by_space_and_status", (q) => {
      const inIt = q.eq("spaceId", column.spaceId).eq("statusId", column.statusId);
      return direction === "asc"
        ? inIt.gte("sortOrder", anchor.sortOrder)
        : inIt.lte("sortOrder", anchor.sortOrder);
    })
    .order(direction);
  let passed = false;
  for await (const row of rows) {
    if (passed && row._id !== skip) return row;
    if (row._id === anchor._id) passed = true;
  }
  return undefined;
}

/**
 * The `sortOrder` for `issueId` in a column: the top (`min - 1`) unless `afterId` (the issue it goes
 * right after) or `beforeId` (the issue it goes right before) say otherwise; between two issues it
 * takes the midpoint. Neighbours that aren't in the column are ignored (they may have just moved).
 * When the gap is below MIN_GAP, the column is renumbered 1, 2, 3… here, in the same transaction.
 *
 * Only the neighbours are read (index ranges around the anchor), so a move into a column of
 * thousands of done issues costs a handful of reads; the whole column is read only to renumber it.
 */
export async function placeInColumn(
  ctx: MutationCtx,
  spaceId: Id<"spaces">,
  statusId: Id<"statuses">,
  placement: Placement,
  issueId?: Id<"issues">,
): Promise<number> {
  const column = { spaceId, statusId };
  const member = async (id: Id<"issues"> | undefined) => {
    if (!id || id === issueId) return null;
    const row = await ctx.db.get("issues", id);
    return row && row.spaceId === spaceId && row.statusId === statusId ? row : null;
  };
  let above: Doc<"issues"> | undefined;
  let below: Doc<"issues"> | undefined;
  const after = await member(placement.afterId);
  const before = after ? null : await member(placement.beforeId);
  if (after) {
    above = after;
    below = await neighbour(ctx, column, after, "asc", issueId);
  } else if (before) {
    below = before;
    above = await neighbour(ctx, column, before, "desc", issueId);
  } else {
    below = (await inColumn(ctx, column).take(2)).find((row) => row._id !== issueId);
  }
  if (!above && !below) return 1;
  if (!above) return below!.sortOrder - 1;
  if (!below) return above.sortOrder + 1;
  const mid = (above.sortOrder + below.sortOrder) / 2;
  if (
    below.sortOrder - above.sortOrder >= MIN_GAP &&
    mid > above.sortOrder &&
    mid < below.sortOrder
  )
    return mid;
  return renumberColumn(ctx, column, placement, issueId);
}

/** Too close: renumber the whole column 1, 2, 3… with a slot left for the moved issue. */
async function renumberColumn(
  ctx: MutationCtx,
  column: Column,
  placement: Placement,
  issueId?: Id<"issues">,
) {
  const others = (await inColumn(ctx, column).collect()).filter((row) => row._id !== issueId);
  let index = -1;
  if (placement.afterId) {
    const at = others.findIndex((row) => row._id === placement.afterId);
    if (at >= 0) index = at + 1;
  }
  if (index < 0 && placement.beforeId)
    index = others.findIndex((row) => row._id === placement.beforeId);
  if (index < 0) index = 0;
  for (const [position, row] of others.entries()) {
    const sortOrder = position < index ? position + 1 : position + 2;
    if (row.sortOrder !== sortOrder) await ctx.db.patch("issues", row._id, { sortOrder });
  }
  return index + 1;
}

// ---------------------------------------------------------------------------------------------
// Status changes: the one helper behind issues.move and MCP update_issue { status }
// ---------------------------------------------------------------------------------------------

/**
 * Sets `statusId` and `statusCategory`, sets or clears `completedAt`, places the issue (top of the
 * new column unless `placement` says otherwise) and writes one `status_changed` row when the status
 * changed. A move within the same column only reorders: no activity row and no `updatedAt` bump,
 * since nothing about the issue itself changed.
 */
export async function changeStatus(
  ctx: MutationCtx,
  actor: Actor,
  issue: Doc<"issues">,
  status: Doc<"statuses">,
  placement: Placement = {},
) {
  if (status.workspaceId !== issue.workspaceId) return notFound("Status");
  const sortOrder = await placeInColumn(ctx, issueSpaceId(issue), status._id, placement, issue._id);
  if (status._id === issue.statusId) {
    if (sortOrder !== issue.sortOrder) await ctx.db.patch("issues", issue._id, { sortOrder });
    return;
  }

  const previous = await ctx.db.get("statuses", issue.statusId);
  const now = Date.now();
  const completedAt = isTerminal(status.category)
    ? previous && isTerminal(previous.category) && issue.completedAt !== undefined
      ? issue.completedAt
      : now
    : undefined;
  await ctx.db.patch("issues", issue._id, {
    statusId: status._id,
    statusCategory: status.category,
    completedAt,
    sortOrder,
    updatedAt: now,
  });
  await logActivity(ctx, actor, issue, "status_changed", {
    ...(previous ? { from: previous.name } : {}),
    to: status.name,
  });
}

// ---------------------------------------------------------------------------------------------
// Create, update, delete
// ---------------------------------------------------------------------------------------------

export type CreateIssueInput = {
  spaceId?: Id<"spaces">;
  /** Optional workstream in the space; null or missing means none. */
  projectId?: Id<"projects"> | null;
  title: string;
  description?: string;
  statusId?: Id<"statuses">;
  priority?: Priority;
  assigneeId?: Id<"members">;
  labelIds?: Id<"labels">[];
  parentId?: Id<"issues">;
  dueDate?: string;
};

/**
 * New issue: number from `spaces.nextIssueNumber` (bumped here, transactionally), top of its status
 * column, one `created` activity row. The project, if any, must be an active project of the space.
 * A sub-issue takes its parent's space and project; a different `spaceId` or `projectId` is
 * rejected.
 */
export async function createIssue(ctx: MutationCtx, actor: Actor, input: CreateIssueInput) {
  const workspaceId = actor.member.workspaceId;
  const parent = input.parentId ? await checkParent(ctx, workspaceId, input.parentId) : null;
  if (parent && input.spaceId && input.spaceId !== parent.spaceId) {
    fail("INVALID_PARENT", "A sub-issue is always in its parent's space.");
  }
  if (
    parent &&
    input.projectId !== undefined &&
    (input.projectId ?? undefined) !== parent.projectId
  ) {
    fail("INVALID_PARENT", "A sub-issue is always in its parent's project.");
  }
  const spaceId = parent?.spaceId ?? input.spaceId;
  if (!spaceId) return fail("INVALID_SPACE", "Pick a space for the issue.");
  const space = await getSpace(ctx, workspaceId, spaceId);
  if (space.archivedAt !== undefined) fail("ARCHIVED", `${space.name} is archived.`);
  const projectId = parent ? parent.projectId : (input.projectId ?? undefined);
  // A sub-issue just shares its parent's project; anything else must be an active project of the space.
  if (projectId && !parent) await getProjectForSpace(ctx, workspaceId, space, projectId);

  const status = input.statusId
    ? await getStatus(ctx, workspaceId, input.statusId)
    : await defaultStatus(ctx, workspaceId);
  if (input.assigneeId) await getMember(ctx, workspaceId, input.assigneeId);
  const labels = await getLabels(ctx, workspaceId, input.labelIds ?? []);

  const number = space.nextIssueNumber;
  await ctx.db.patch("spaces", space._id, { nextIssueNumber: number + 1 });
  const key = `${space.key}-${number}`;
  const now = Date.now();
  const sortOrder = await placeInColumn(ctx, space._id, status._id, {});
  const issueId = await ctx.db.insert("issues", {
    workspaceId,
    spaceId: space._id,
    ...(projectId ? { projectId } : {}),
    number,
    key,
    title: cleanTitle(input.title),
    description: checkDescription(input.description ?? ""),
    statusId: status._id,
    statusCategory: status.category,
    priority: input.priority ?? 0,
    ...(input.assigneeId ? { assigneeId: input.assigneeId } : {}),
    creatorId: actor.member._id,
    labelIds: labels.map((label) => label._id),
    ...(parent ? { parentId: parent._id } : {}),
    ...(input.dueDate ? { dueDate: checkDueDate(input.dueDate) } : {}),
    sortOrder,
    ...(isTerminal(status.category) ? { completedAt: now } : {}),
    updatedAt: now,
  });
  await logActivity(ctx, actor, { _id: issueId, workspaceId }, "created", { to: status.name });
  return { issueId, key };
}

/**
 * Put an issue in a project (or none), with `updatedAt` and one `project_changed` row. Its
 * sub-issues follow, so they always share their parent's project. Used by `updateIssue` and by
 * `projects.archive` (which clears the project of every issue in it).
 */
export async function setIssueProject(
  ctx: MutationCtx,
  actor: Actor,
  issue: Doc<"issues">,
  project: Project | null,
  now = Date.now(),
) {
  const nextId = project?._id;
  if (nextId === issue.projectId) return;
  const previous = issue.projectId ? await ctx.db.get("projects", issue.projectId) : null;
  await ctx.db.patch("issues", issue._id, { projectId: nextId, updatedAt: now });
  await logActivity(ctx, actor, issue, "project_changed", {
    ...(previous ? { from: previous.name } : {}),
    ...(project ? { to: project.name } : {}),
  });
  const children = await ctx.db
    .query("issues")
    .withIndex("by_parent", (q) => q.eq("parentId", issue._id))
    .collect();
  for (const child of children) await setIssueProject(ctx, actor, child, project, now);
}

export type UpdateIssueInput = {
  title?: string;
  description?: string;
  priority?: Priority;
  assigneeId?: Id<"members"> | null;
  labelIds?: Id<"labels">[];
  dueDate?: string | null;
  parentId?: Id<"issues"> | null;
  /** A project of the issue's space, or null for none. Sub-issues follow their parent's. */
  projectId?: Id<"projects"> | null;
};

/**
 * Field changes (never status: that's `changeStatus`). One activity row per field that actually
 * changed; `updatedAt` only moves when something did. Parent changes go through `checkParent`; a
 * new parent brings its project along. A project change on a parent moves its sub-issues too; a
 * sub-issue can't take a project of its own.
 */
export async function updateIssue(
  ctx: MutationCtx,
  actor: Actor,
  issue: Doc<"issues">,
  input: UpdateIssueInput,
) {
  const workspaceId = issue.workspaceId;
  const patch: Partial<Doc<"issues">> = {};
  const rows: { type: Doc<"activity">["type"]; from?: string; to?: string }[] = [];

  if (input.title !== undefined) {
    const title = cleanTitle(input.title);
    if (title !== issue.title) {
      patch.title = title;
      rows.push({ type: "title_changed", from: issue.title, to: title });
    }
  }
  if (input.description !== undefined && input.description !== issue.description) {
    patch.description = checkDescription(input.description);
    rows.push({ type: "description_changed" });
  }
  if (input.priority !== undefined && input.priority !== issue.priority) {
    patch.priority = input.priority;
    rows.push({
      type: "priority_changed",
      from: String(issue.priority),
      to: String(input.priority),
    });
  }
  if (input.assigneeId !== undefined && (input.assigneeId ?? undefined) !== issue.assigneeId) {
    const next = input.assigneeId ? await getMember(ctx, workspaceId, input.assigneeId) : null;
    const previous = issue.assigneeId ? await ctx.db.get("members", issue.assigneeId) : null;
    patch.assigneeId = next?._id;
    rows.push({
      type: "assigned",
      ...(previous ? { from: previous.displayName } : {}),
      ...(next ? { to: next.displayName } : {}),
    });
  }
  if (input.labelIds !== undefined) {
    const next = await getLabels(ctx, workspaceId, input.labelIds);
    const nextIds = next.map((label) => label._id);
    const same =
      nextIds.length === issue.labelIds.length &&
      nextIds.every((id) => issue.labelIds.includes(id));
    if (!same) {
      const previous = (
        await Promise.all(issue.labelIds.map((id) => ctx.db.get("labels", id)))
      ).filter((label): label is Doc<"labels"> => label !== null);
      patch.labelIds = nextIds;
      rows.push({
        type: "labels_changed",
        from: previous.map((label) => label.name).join(", "),
        to: next.map((label) => label.name).join(", "),
      });
    }
  }
  if (input.dueDate !== undefined && (input.dueDate ?? undefined) !== issue.dueDate) {
    patch.dueDate = input.dueDate === null ? undefined : checkDueDate(input.dueDate);
    rows.push({
      type: "due_date_changed",
      ...(issue.dueDate ? { from: issue.dueDate } : {}),
      ...(input.dueDate ? { to: input.dueDate } : {}),
    });
  }
  if (input.parentId !== undefined && (input.parentId ?? undefined) !== issue.parentId) {
    const parent = input.parentId
      ? await checkParent(ctx, workspaceId, input.parentId, issue)
      : null;
    const previous = issue.parentId ? await ctx.db.get("issues", issue.parentId) : null;
    patch.parentId = parent?._id;
    rows.push({
      type: "parent_changed",
      ...(previous ? { from: previous.key } : {}),
      ...(parent ? { to: parent.key } : {}),
    });
  }

  // The project: asked for directly, or brought along by a new parent.
  const newParent =
    patch.parentId !== undefined ? await ctx.db.get("issues", patch.parentId) : null;
  const parentAfter =
    "parentId" in patch
      ? newParent
      : issue.parentId
        ? await ctx.db.get("issues", issue.parentId)
        : null;
  let project: Project | null | undefined; // undefined: unchanged
  if (input.projectId !== undefined) {
    if (parentAfter && (input.projectId ?? undefined) !== parentAfter.projectId) {
      fail(
        "INVALID_PARENT",
        `A sub-issue is always in its parent's project. Change ${parentAfter.key}'s project instead.`,
      );
    }
    if ((input.projectId ?? undefined) !== issue.projectId) {
      const space = await getSpace(ctx, workspaceId, issueSpaceId(issue));
      project = input.projectId
        ? await getProjectForSpace(ctx, workspaceId, space, input.projectId)
        : null;
    }
  } else if (newParent && newParent.projectId !== issue.projectId) {
    const parentProject = newParent.projectId
      ? await ctx.db.get("projects", newParent.projectId)
      : null;
    project = parentProject && isProject(parentProject) ? parentProject : null;
  }

  if (rows.length > 0) {
    await ctx.db.patch("issues", issue._id, { ...patch, updatedAt: Date.now() });
    for (const row of rows) {
      await logActivity(ctx, actor, issue, row.type, { from: row.from, to: row.to });
    }
  }
  if (project !== undefined) {
    const current = (await ctx.db.get("issues", issue._id))!;
    await setIssueProject(ctx, actor, current, project);
  }
}

/**
 * Hard delete (no trash in v0.1) with comments, activity and sub-issues (and theirs). Returns the
 * sub-issue keys and the number of comments that went with it.
 */
export async function deleteIssue(
  ctx: MutationCtx,
  issue: Doc<"issues">,
): Promise<{ subIssues: string[]; comments: number }> {
  const children = await ctx.db
    .query("issues")
    .withIndex("by_parent", (q) => q.eq("parentId", issue._id))
    .collect();
  const removed = { subIssues: [] as string[], comments: 0 };
  for (const child of children) {
    const nested = await deleteIssue(ctx, child);
    removed.subIssues.push(child.key, ...nested.subIssues);
    removed.comments += nested.comments;
  }
  const [comments, activity] = await Promise.all([
    ctx.db
      .query("comments")
      .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
      .collect(),
    ctx.db
      .query("activity")
      .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
      .collect(),
  ]);
  for (const row of comments) await ctx.db.delete("comments", row._id);
  for (const row of activity) await ctx.db.delete("activity", row._id);
  await ctx.db.delete("issues", issue._id);
  removed.comments += comments.length;
  return removed;
}
