import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Actor } from "./lib/activity";
import { findToken, requireToken } from "./lib/auth";
import { addComment as insertComment } from "./lib/comments";
import { DEFAULT_STATUSES } from "./lib/defaults";
import { fail } from "./lib/errors";
import {
  changeStatus,
  createIssue as insertIssue,
  deleteIssue as removeIssue,
  updateIssue as applyUpdate,
} from "./lib/issues";
import { isProject, issueSpaceId, type Project } from "./lib/model";
import {
  resolveAssignee,
  resolveLabelsByName,
  resolveStatusByName,
  workspaceLabels,
  workspaceMembers,
  workspaceStatuses,
} from "./lib/names";
import {
  archivedProjects,
  archiveProject as archiveProjectRow,
  createLabel as insertLabel,
  createProject as insertProject,
  createSpace as insertSpace,
  modeOf,
  reorderStatuses as applyStatusOrder,
  restoreProject,
  saveSpaceContext,
  updateProject as applyProjectUpdate,
  updateSpace as applySpaceUpdate,
  updateStatus as applyStatusUpdate,
} from "./lib/organise";
import { priorityName } from "./lib/priority";
import { searchIssues as findIssues } from "./lib/search";
import {
  activeProjects,
  getSpace,
  nameKey,
  resolveProjectByName,
  resolveSpaceByKey,
} from "./lib/spaces";
import { shouldTouch } from "./lib/tokens";
import { checkPaletteColor, PALETTE } from "./lib/validate";
import { category, priority, spaceKind } from "./schema";

/**
 * The MCP surface (spec §6, §10b "MCP tools"): one public function per tool, called by
 * `packages/mcp` over ConvexHttpClient with the caller's plain API token. Every function calls
 * `requireToken` first and resolves spaces, projects, issues, statuses, labels and members inside the
 * token's workspace only ("not found" otherwise). Writes go through the same helpers as the app,
 * with `via: "mcp"`, so the app shows them under the token's owner, tagged "via MCP".
 *
 * Results are plain JSON for agents: names instead of ids, ISO times. The adapter adds URLs.
 */

const asMcp = (member: Doc<"members">): Actor => ({ member, via: "mcp" });
const iso = (time: number) => new Date(time).toISOString();

export const LIST_LIMIT = 50;
export const MAX_LIST_LIMIT = 100;
const MAX_COMMENTS = 50;

// ---------------------------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------------------------

/**
 * Who a token acts as, or null when it's unknown or revoked (the route answers 401). Returns
 * `lastUsedAt` so the route can call `touchToken` only when it's stale.
 */
export const verifyToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const owner = await findToken(ctx, token);
    if (!owner) return null;
    const { apiToken, member } = owner;
    return {
      tokenId: apiToken._id,
      memberId: member._id,
      workspaceId: member.workspaceId,
      userId: member.userId,
      displayName: member.displayName,
      lastUsedAt: apiToken.lastUsedAt ?? null,
    };
  },
});

/** Records use of a token, at most once per 10 minutes (spec §10b). Returns whether it wrote. */
export const touchToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const owner = await findToken(ctx, token);
    if (!owner) return false;
    const now = Date.now();
    if (!shouldTouch(owner.apiToken.lastUsedAt, now)) return false;
    await ctx.db.patch("apiTokens", owner.apiToken._id, { lastUsedAt: now });
    return true;
  },
});

// ---------------------------------------------------------------------------------------------
// Reading issues as agents see them
// ---------------------------------------------------------------------------------------------

async function issueByKey(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  key: string,
): Promise<Doc<"issues">> {
  const upper = key.trim().toUpperCase();
  const issue = await ctx.db
    .query("issues")
    .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", upper))
    .first();
  if (!issue) return fail("NOT_FOUND", `No issue ${upper} in this workspace.`);
  return issue;
}

/** Names for ids, loaded once per call: statuses, labels, members and spaces are small tables. */
async function namer(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  const [statuses, labels, members, spaces] = await Promise.all([
    workspaceStatuses(ctx, workspaceId),
    workspaceLabels(ctx, workspaceId),
    workspaceMembers(ctx, workspaceId),
    ctx.db
      .query("spaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect(),
  ]);
  const byId = <T extends { _id: string }>(rows: T[]) => new Map(rows.map((row) => [row._id, row]));
  const statusMap = byId(statuses);
  const labelMap = byId(labels);
  const memberMap = byId(members);
  const spaceMap = byId(spaces);
  const projectNames = new Map<Id<"projects">, string | null>();
  const parentKeys = new Map<Id<"issues">, string | null>();

  async function projectName(issue: Doc<"issues">) {
    // On an unmigrated M2 issue, projectId still means its M2 project (now a space), not a workstream.
    if (!issue.projectId || !issue.spaceId) return null;
    if (!projectNames.has(issue.projectId)) {
      const project = await ctx.db.get("projects", issue.projectId);
      projectNames.set(issue.projectId, project && isProject(project) ? project.name : null);
    }
    return projectNames.get(issue.projectId) ?? null;
  }

  async function parentKey(issue: Doc<"issues">) {
    if (!issue.parentId) return null;
    if (!parentKeys.has(issue.parentId)) {
      const parent = await ctx.db.get("issues", issue.parentId);
      parentKeys.set(issue.parentId, parent?.key ?? null);
    }
    return parentKeys.get(issue.parentId) ?? null;
  }

  const member = (id: Id<"members"> | undefined) =>
    id ? (memberMap.get(id)?.displayName ?? null) : null;

  /** One issue as a list row. */
  async function row(issue: Doc<"issues">) {
    const status = statusMap.get(issue.statusId);
    return {
      key: issue.key,
      title: issue.title,
      space: issue.spaceId ? (spaceMap.get(issue.spaceId)?.key ?? null) : null,
      project: await projectName(issue),
      status: status?.name ?? null,
      category: issue.statusCategory,
      priority: priorityName(issue.priority),
      assignee: member(issue.assigneeId),
      labels: issue.labelIds.flatMap((id) => labelMap.get(id)?.name ?? []),
      parent: await parentKey(issue),
      dueDate: issue.dueDate ?? null,
      updatedAt: iso(issue.updatedAt),
    };
  }

  return { row, member, status: (id: Id<"statuses">) => statusMap.get(id)?.name ?? null };
}

// ---------------------------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------------------------

/** `get_issue`: the issue, its sub-issues and its last 50 comments. */
export const getIssue = query({
  args: { token: v.string(), key: v.string() },
  handler: async (ctx, { token, key }) => {
    const { member: me } = await requireToken(ctx, token);
    const issue = await issueByKey(ctx, me.workspaceId, key);
    const names = await namer(ctx, me.workspaceId);
    const [subIssues, comments] = await Promise.all([
      ctx.db
        .query("issues")
        .withIndex("by_parent", (q) => q.eq("parentId", issue._id))
        .collect(),
      ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .order("desc")
        .take(MAX_COMMENTS),
    ]);
    return {
      ...(await names.row(issue)),
      description: issue.description,
      creator: names.member(issue.creatorId),
      createdAt: iso(issue._creationTime),
      completedAt: issue.completedAt !== undefined ? iso(issue.completedAt) : null,
      subIssues: subIssues
        .sort((a, b) => a.number - b.number)
        .map((sub) => ({
          key: sub.key,
          title: sub.title,
          status: names.status(sub.statusId),
          category: sub.statusCategory,
        })),
      comments: comments.reverse().map((comment) => ({
        id: comment._id,
        author: names.member(comment.authorId),
        body: comment.body,
        via: comment.via,
        createdAt: iso(comment._creationTime),
        ...(comment.editedAt !== undefined ? { editedAt: iso(comment.editedAt) } : {}),
      })),
    };
  },
});

/** `get_space_context`: the space, its projects and its context doc (agents read it first). */
export const getSpaceContext = query({
  args: { token: v.string(), space: v.string() },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const [projects, doc] = await Promise.all([
      activeProjects(ctx, space._id),
      ctx.db
        .query("docs")
        .withIndex("by_space_and_kind", (q) =>
          q.eq("spaceId", space._id).eq("kind", "space_context"),
        )
        .first(),
    ]);
    const editor = doc ? await ctx.db.get("members", doc.updatedBy) : null;
    return {
      space: { key: space.key, name: space.name, kind: space.kind ?? "product" },
      projects: projects.map((project) => project.name),
      context: doc?.body ?? "",
      updatedAt: doc ? iso(doc.updatedAt) : null,
      updatedBy: editor?.displayName ?? null,
    };
  },
});

/** `list_issues`: newest first, filtered by space, project, status, category, assignee, label, priority. */
export const listIssues = query({
  args: {
    token: v.string(),
    space: v.optional(v.string()),
    project: v.optional(v.string()),
    status: v.optional(v.string()),
    category: v.optional(category),
    assignee: v.optional(v.string()),
    label: v.optional(v.string()),
    priority: v.optional(priority),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const workspaceId = me.workspaceId;
    if (args.project !== undefined && args.space === undefined) {
      fail("INVALID_INPUT", "Projects are found by name inside one space: give `space` too.");
    }
    const space =
      args.space !== undefined ? await resolveSpaceByKey(ctx, workspaceId, args.space) : null;
    const project =
      space && args.project !== undefined
        ? await resolveProjectByName(ctx, space, args.project)
        : undefined;
    const status =
      args.status !== undefined ? await resolveStatusByName(ctx, workspaceId, args.status) : null;
    const assignee =
      args.assignee !== undefined ? await resolveAssignee(ctx, me, args.assignee) : undefined;
    const label =
      args.label !== undefined
        ? (await resolveLabelsByName(ctx, workspaceId, [args.label]))[0]!
        : null;
    const limit = Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(args.limit ?? LIST_LIMIT)));

    // Walk the narrowest newest-first index the filters allow, then filter in code and stop at
    // `limit`: a space's issues, else an assignee's, else the workspace's.
    const matches: Doc<"issues">[] = [];
    const newestFirst = space
      ? ctx.db
          .query("issues")
          .withIndex("by_space_and_updated", (q) => q.eq("spaceId", space._id))
          .order("desc")
      : assignee
        ? ctx.db
            .query("issues")
            .withIndex("by_assignee_and_updated", (q) => q.eq("assigneeId", assignee._id))
            .order("desc")
        : ctx.db
            .query("issues")
            .withIndex("by_workspace_and_updated", (q) => q.eq("workspaceId", workspaceId))
            .order("desc");
    for await (const issue of newestFirst) {
      if (issue.workspaceId !== workspaceId) continue;
      if (space && issue.spaceId !== space._id) continue;
      if (project !== undefined && issue.projectId !== (project?._id ?? undefined)) continue;
      if (status && issue.statusId !== status._id) continue;
      if (args.category && issue.statusCategory !== args.category) continue;
      if (assignee !== undefined && issue.assigneeId !== (assignee?._id ?? undefined)) continue;
      if (label && !issue.labelIds.includes(label._id)) continue;
      if (args.priority !== undefined && issue.priority !== args.priority) continue;
      matches.push(issue);
      if (matches.length >= limit) break;
    }
    const names = await namer(ctx, workspaceId);
    return Promise.all(matches.map((issue) => names.row(issue)));
  },
});

/** `create_issue`: a new issue in a space, optionally in one of its projects. */
export const createIssue = mutation({
  args: {
    token: v.string(),
    space: v.string(),
    project: v.optional(v.string()),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(priority),
    assignee: v.optional(v.string()),
    labels: v.optional(v.array(v.string())),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const workspaceId = me.workspaceId;
    const space = await resolveSpaceByKey(ctx, workspaceId, args.space);
    const project =
      args.project !== undefined ? await resolveProjectByName(ctx, space, args.project) : null;
    const status =
      args.status !== undefined ? await resolveStatusByName(ctx, workspaceId, args.status) : null;
    const assignee =
      args.assignee !== undefined ? await resolveAssignee(ctx, me, args.assignee) : null;
    const labels = await resolveLabelsByName(ctx, workspaceId, args.labels ?? []);
    const { key } = await insertIssue(ctx, asMcp(me), {
      spaceId: space._id,
      projectId: project?._id ?? null,
      title: args.title,
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(status ? { statusId: status._id } : {}),
      ...(args.priority !== undefined ? { priority: args.priority } : {}),
      ...(assignee ? { assigneeId: assignee._id } : {}),
      labelIds: labels.map((label) => label._id),
      ...(args.dueDate !== undefined ? { dueDate: args.dueDate } : {}),
    });
    return { key, space: space.key, project: project?.name ?? null };
  },
});

/** `create_sub_issue`: a sub-issue under `parent`, in the parent's space and project. */
export const createSubIssue = mutation({
  args: {
    token: v.string(),
    parent: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.optional(priority),
    assignee: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const parent = await issueByKey(ctx, me.workspaceId, args.parent);
    const assignee =
      args.assignee !== undefined ? await resolveAssignee(ctx, me, args.assignee) : null;
    // The shared rule takes space and project from the parent and refuses a parent that is a sub-issue.
    const { issueId, key } = await insertIssue(ctx, asMcp(me), {
      parentId: parent._id,
      title: args.title,
      ...(args.description !== undefined ? { description: args.description } : {}),
      ...(args.priority !== undefined ? { priority: args.priority } : {}),
      ...(assignee ? { assigneeId: assignee._id } : {}),
    });
    const created = (await ctx.db.get("issues", issueId))!;
    const names = await namer(ctx, me.workspaceId);
    const row = await names.row(created);
    return { key, parent: parent.key, space: row.space, project: row.project };
  },
});

/** `add_comment`: a markdown comment, shown under the token's owner, tagged "via MCP". */
export const addComment = mutation({
  args: { token: v.string(), key: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const issue = await issueByKey(ctx, me.workspaceId, args.key);
    const commentId = await insertComment(ctx, asMcp(me), issue, args.body);
    return { key: issue.key, commentId };
  },
});

/**
 * `update_issue`: status (through the one status helper); title, description, priority, assignee,
 * labels, project and due date (through the same update helper as the app, one activity row per
 * changed field). Everything is resolved before anything is written,
 * and the mutation is one transaction, so a bad name changes nothing.
 */
export const updateIssue = mutation({
  args: {
    token: v.string(),
    key: v.string(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    status: v.optional(v.string()),
    priority: v.optional(priority),
    assignee: v.optional(v.string()),
    addLabels: v.optional(v.array(v.string())),
    removeLabels: v.optional(v.array(v.string())),
    project: v.optional(v.string()),
    dueDate: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const workspaceId = me.workspaceId;
    const issue = await issueByKey(ctx, workspaceId, args.key);
    const {
      title,
      description,
      dueDate,
      status: statusName,
      priority: nextPriority,
      assignee: assigneeName,
      addLabels,
      removeLabels,
      project: projectName,
    } = args;
    if (
      [
        title,
        description,
        dueDate,
        statusName,
        nextPriority,
        assigneeName,
        addLabels,
        removeLabels,
        projectName,
      ].every((value) => value === undefined)
    ) {
      fail(
        "INVALID_INPUT",
        "Nothing to change: give at least one of title, description, status, priority, assignee, addLabels, removeLabels, project or dueDate.",
      );
    }

    const status =
      statusName !== undefined ? await resolveStatusByName(ctx, workspaceId, statusName) : null;
    const assignee =
      assigneeName !== undefined ? await resolveAssignee(ctx, me, assigneeName) : undefined;
    let labelIds: Id<"labels">[] | undefined;
    if (addLabels !== undefined || removeLabels !== undefined) {
      const add = await resolveLabelsByName(ctx, workspaceId, addLabels ?? []);
      const remove = new Set(
        (await resolveLabelsByName(ctx, workspaceId, removeLabels ?? [])).map((label) => label._id),
      );
      labelIds = [...new Set([...issue.labelIds, ...add.map((label) => label._id)])].filter(
        (id) => !remove.has(id),
      );
    }
    let projectId: Id<"projects"> | null | undefined;
    if (projectName !== undefined) {
      const space = await getSpace(ctx, workspaceId, issueSpaceId(issue));
      projectId = (await resolveProjectByName(ctx, space, projectName))?._id ?? null;
    }

    const actor = asMcp(me);
    await applyUpdate(ctx, actor, issue, {
      ...(title !== undefined ? { title } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(dueDate !== undefined ? { dueDate } : {}),
      ...(nextPriority !== undefined ? { priority: nextPriority } : {}),
      ...(assignee !== undefined ? { assigneeId: assignee?._id ?? null } : {}),
      ...(labelIds !== undefined ? { labelIds } : {}),
      ...(projectId !== undefined ? { projectId } : {}),
    });
    if (status) await changeStatus(ctx, actor, (await ctx.db.get("issues", issue._id))!, status);

    const names = await namer(ctx, workspaceId);
    return names.row((await ctx.db.get("issues", issue._id))!);
  },
});

// ---------------------------------------------------------------------------------------------
// Orientation and search
// ---------------------------------------------------------------------------------------------

/**
 * `get_workspace`: everything an agent needs to orient itself in one call: spaces (archived ones
 * flagged) with their active projects, statuses in order, labels and members. All small tables,
 * read through indexes.
 */
export const getWorkspace = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const { member: me } = await requireToken(ctx, token);
    const workspaceId = me.workspaceId;
    const [workspace, statuses, labels, members, spaces] = await Promise.all([
      ctx.db.get("workspaces", workspaceId),
      workspaceStatuses(ctx, workspaceId),
      workspaceLabels(ctx, workspaceId),
      workspaceMembers(ctx, workspaceId),
      ctx.db
        .query("spaces")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ]);
    const projects = await Promise.all(
      spaces.map((space) =>
        space.archivedAt === undefined ? activeProjects(ctx, space._id) : Promise.resolve([]),
      ),
    );
    return {
      workspace: workspace?.name ?? null,
      /** What the workspace works on: "product", "client" or "both" (product when never set). */
      mode: modeOf(workspace),
      you: me.displayName,
      spaces: spaces.map((space, index) => ({
        key: space.key,
        name: space.name,
        kind: space.kind ?? "product",
        archived: space.archivedAt !== undefined,
        projects: projects[index]!.map((project) => ({
          name: project.name,
          color: project.color ?? null,
        })),
      })),
      statuses: statuses.map((status) => ({ name: status.name, category: status.category })),
      labels: labels.map((label) => ({ name: label.name, color: label.color })),
      members: members.map((member) => ({
        name: member.displayName,
        role: member.role,
        me: member._id === me._id,
      })),
    };
  },
});

/** `search_issues`: by key or title words, like the app's palette; exact key first. */
export const searchIssues = query({
  args: {
    token: v.string(),
    query: v.string(),
    space: v.optional(v.string()),
    project: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const workspaceId = me.workspaceId;
    if (args.project !== undefined && args.space === undefined) {
      fail("INVALID_INPUT", "Projects are found by name inside one space: give `space` too.");
    }
    const space =
      args.space !== undefined ? await resolveSpaceByKey(ctx, workspaceId, args.space) : null;
    const project =
      space && args.project !== undefined
        ? await resolveProjectByName(ctx, space, args.project)
        : null;
    const issues = await findIssues(ctx, workspaceId, {
      text: args.query,
      ...(space ? { spaceId: space._id } : {}),
      ...(project ? { projectId: project._id } : {}),
    });
    const names = await namer(ctx, workspaceId);
    return Promise.all(issues.map((issue) => names.row(issue)));
  },
});

// ---------------------------------------------------------------------------------------------
// Spaces, context docs, projects and labels: the same helpers as the app's settings screens.
// Any member can do these in the app, so any member's token can do them here. Deleting things,
// archiving spaces, invites, members, tokens and status edits are deliberately not exposed.
// ---------------------------------------------------------------------------------------------

/** `create_space`: a new space with the starter context doc, like the app's "New space". */
export const createSpace = mutation({
  args: { token: v.string(), name: v.string(), key: v.string(), kind: v.optional(spaceKind) },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const { key, name, kind } = await insertSpace(ctx, me, {
      name: args.name,
      key: args.key,
      ...(args.kind ? { kind: args.kind } : {}),
    });
    // Without a kind it follows the workspace's mode (a client workspace makes clients).
    return { key, name, kind };
  },
});

/** `update_space`: rename or change kind. The key never changes. */
export const updateSpace = mutation({
  args: {
    token: v.string(),
    space: v.string(),
    name: v.optional(v.string()),
    kind: v.optional(spaceKind),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    if (args.name === undefined && args.kind === undefined) {
      fail("INVALID_INPUT", "Nothing to change: give name or kind. A space's key can't change.");
    }
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    await applySpaceUpdate(ctx, space, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.kind !== undefined ? { kind: args.kind } : {}),
    });
    const updated = (await ctx.db.get("spaces", space._id))!;
    return { key: updated.key, name: updated.name, kind: updated.kind ?? "product" };
  },
});

/** `update_space_context`: replaces the space's context doc with new markdown. */
export const updateSpaceContext = mutation({
  args: { token: v.string(), space: v.string(), body: v.string() },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const updatedAt = await saveSpaceContext(ctx, me, space, args.body);
    return { space: space.key, updatedAt: iso(updatedAt), updatedBy: me.displayName };
  },
});

/** A named project of the space; "none" isn't one here. */
async function projectByName(ctx: QueryCtx, space: Doc<"spaces">, name: string): Promise<Project> {
  const project = await resolveProjectByName(ctx, space, name);
  if (!project)
    return fail("INVALID_INPUT", `Name one of ${space.key}'s projects; "none" isn't one.`);
  return project;
}

/** Project colours the app cycles through when you don't pick one (the palette minus gray). */
const PROJECT_COLORS = PALETTE.filter((color) => color !== "gray");

/** `create_project`: a workstream in a space, at the end of its order. */
export const createProject = mutation({
  args: { token: v.string(), space: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const color =
      args.color !== undefined
        ? checkPaletteColor(args.color)
        : PROJECT_COLORS[(await activeProjects(ctx, space._id)).length % PROJECT_COLORS.length]!;
    const { name } = await insertProject(ctx, space, { name: args.name, color });
    return { space: space.key, name, color };
  },
});

/** `update_project`: rename or recolour (`color: null` removes the colour). */
export const updateProject = mutation({
  args: {
    token: v.string(),
    space: v.string(),
    project: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    if (args.name === undefined && args.color === undefined) {
      fail("INVALID_INPUT", "Nothing to change: give name or color.");
    }
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const project = await projectByName(ctx, space, args.project);
    await applyProjectUpdate(ctx, project, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.color !== undefined
        ? { color: args.color === null ? null : checkPaletteColor(args.color) }
        : {}),
    });
    const updated = (await ctx.db.get("projects", project._id)) as Project;
    return { space: space.key, name: updated.name, color: updated.color ?? null };
  },
});

/**
 * `archive_project`: the project leaves the app's sidebar and pickers; its issues stay in the space
 * with no project (each change logged "via MCP"). `unarchive_project` brings the project back, but
 * not its issues.
 */
export const archiveProject = mutation({
  args: { token: v.string(), space: v.string(), project: v.string() },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const project = await projectByName(ctx, space, args.project);
    const issuesMoved = await archiveProjectRow(ctx, asMcp(me), project);
    return { space: space.key, project: project.name, archived: true, issuesMoved };
  },
});

/** `create_label`: a workspace label (other tools never create labels on the fly). */
export const createLabel = mutation({
  args: { token: v.string(), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const color = args.color !== undefined ? checkPaletteColor(args.color) : "gray";
    const { name } = await insertLabel(ctx, me.workspaceId, { name: args.name, color });
    return { name, color };
  },
});

/**
 * An archived project of the space by name (any case). Names are only unique among active projects,
 * so with two archived namesakes the most recently archived one is meant.
 */
async function archivedProjectByName(ctx: QueryCtx, space: Doc<"spaces">, name: string) {
  const archived = await archivedProjects(ctx, space._id);
  const match = archived.find((project) => nameKey(project.name) === nameKey(name));
  if (match) return match;
  const active = (await activeProjects(ctx, space._id)).find(
    (project) => nameKey(project.name) === nameKey(name),
  );
  if (active) return fail("NOT_ARCHIVED", `${active.name} isn't archived.`);
  const valid = archived.map((project) => project.name);
  return fail(
    "UNKNOWN_PROJECT",
    valid.length
      ? `No archived project "${name.trim()}" in ${space.key}. Archived: ${[...new Set(valid)].join(", ")}.`
      : `${space.key} has no archived projects.`,
  );
}

/**
 * `unarchive_project`: back at the end of the space's order. Issues that lost it when it was
 * archived stay without a project. If an active project now has the same name, give `name` to
 * restore it under a new one.
 */
export const unarchiveProject = mutation({
  args: { token: v.string(), space: v.string(), project: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const space = await resolveSpaceByKey(ctx, me.workspaceId, args.space);
    const project = await archivedProjectByName(ctx, space, args.project);
    const { name } = await restoreProject(
      ctx,
      space,
      project,
      args.name !== undefined ? { name: args.name } : {},
    );
    const restored = (await ctx.db.get("projects", project._id)) as Project;
    return { space: space.key, project: name, color: restored.color ?? null, archived: false };
  },
});

// ---------------------------------------------------------------------------------------------
// Issue deletion and status definitions (Kris, 27 Oct 2026: both over MCP, as in the app)
// ---------------------------------------------------------------------------------------------

/**
 * `delete_issue`: the app's hard delete (comments, activity and sub-issues go too). `confirm` must
 * repeat the issue's key, so a delete never happens by accident.
 */
export const deleteIssue = mutation({
  args: { token: v.string(), key: v.string(), confirm: v.string() },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const issue = await issueByKey(ctx, me.workspaceId, args.key);
    if (args.confirm.trim().toUpperCase() !== issue.key) {
      fail(
        "CONFIRM_MISMATCH",
        `Nothing deleted. To delete ${issue.key} ("${issue.title}"), pass confirm: "${issue.key}".`,
      );
    }
    const removed = await removeIssue(ctx, issue);
    return {
      deleted: issue.key,
      title: issue.title,
      subIssues: removed.subIssues,
      comments: removed.comments,
    };
  },
});

/** A status colour over MCP: a palette name, or "default" for the category's own colour. */
function statusColor(category: Doc<"statuses">["category"], color: string): string {
  if (nameKey(color) === "default") {
    return DEFAULT_STATUSES.find((row) => row.category === category)!.color;
  }
  return checkPaletteColor(color);
}

const statusRow = (status: Doc<"statuses">) => ({
  name: status.name,
  category: status.category,
  color: status.color,
});

/**
 * `update_status`: rename or recolour one of the six statuses (the definition, for everyone).
 * Moving an issue to a status is `update_issue { status }`.
 */
export const updateStatus = mutation({
  args: {
    token: v.string(),
    status: v.string(),
    name: v.optional(v.string()),
    color: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    if (args.name === undefined && args.color === undefined) {
      fail("INVALID_INPUT", "Nothing to change: give name or color.");
    }
    const status = await resolveStatusByName(ctx, me.workspaceId, args.status);
    await applyStatusUpdate(ctx, status, {
      ...(args.name !== undefined ? { name: args.name } : {}),
      ...(args.color !== undefined ? { color: statusColor(status.category, args.color) } : {}),
    });
    return statusRow((await ctx.db.get("statuses", status._id))!);
  },
});

/** `reorder_statuses`: the six statuses in a new order (list groups and board columns follow). */
export const reorderStatuses = mutation({
  args: { token: v.string(), statuses: v.array(v.string()) },
  handler: async (ctx, args) => {
    const { member: me } = await requireToken(ctx, args.token);
    const all = await workspaceStatuses(ctx, me.workspaceId);
    const order = await Promise.all(
      args.statuses.map((name) => resolveStatusByName(ctx, me.workspaceId, name)),
    );
    const ids = order.map((status) => status._id);
    if (new Set(ids).size !== ids.length || ids.length !== all.length) {
      fail(
        "INVALID_ORDER",
        `List each status exactly once, in the new order. Statuses: ${all.map((status) => `"${status.name}"`).join(", ")}.`,
      );
    }
    await applyStatusOrder(ctx, me.workspaceId, ids);
    return (await workspaceStatuses(ctx, me.workspaceId)).map(statusRow);
  },
});
