import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import type { Actor } from "./lib/activity";
import { requireMember } from "./lib/auth";
import { notFound } from "./lib/errors";
import {
  changeStatus,
  createIssue,
  deleteIssue,
  getIssue,
  getStatus,
  updateIssue,
} from "./lib/issues";
import { isProject } from "./lib/model";
import { isTerminal, OPEN_CATEGORIES } from "./lib/rules";
import { searchIssues } from "./lib/search";
import { getProject } from "./lib/spaces";
import { priority } from "./schema";

/** Done and canceled issues older than this are hidden from lists and boards unless asked for. */
export const RECENT_DONE_MS = 14 * 24 * 60 * 60 * 1000;

const app = (member: Doc<"members">): Actor => ({ member, via: "app" });

/**
 * An issue as lists and boards show it: everything but the description, which only the issue page
 * reads (`issues.get`). Descriptions are most of an issue's size, and a live list is re-sent whole on
 * every change to any of its issues.
 */
export function listRow(issue: Doc<"issues">) {
  const { description: _description, ...row } = issue;
  return row;
}

/** Column order: `sortOrder`, then creation (the `by_space_and_status` index order). */
const byColumnOrder = (a: Doc<"issues">, b: Doc<"issues">) =>
  a.sortOrder - b.sortOrder || a._creationTime - b._creationTime;

/**
 * Issues of one space, ordered by status (workspace order) then `sortOrder`; with `projectId`, only
 * that project's (it must be in the space). Done and canceled issues completed more than 14 days ago
 * are left out unless `includeDone`, and they aren't read either: those columns are read through
 * `by_space_status_and_completed` from the cutoff on, so old done issues cost nothing.
 */
export const listBySpace = query({
  args: {
    spaceId: v.id("spaces"),
    projectId: v.optional(v.id("projects")),
    includeDone: v.optional(v.boolean()),
  },
  handler: async (ctx, { spaceId, projectId, includeDone }) => {
    const me = await requireMember(ctx);
    const space = await ctx.db.get("spaces", spaceId);
    if (!space || space.workspaceId !== me.workspaceId) return notFound("Space");
    if (projectId) {
      // getProject only returns workstreams, never an unmigrated M2 project.
      const project = await getProject(ctx, me.workspaceId, projectId);
      if (project.spaceId !== space._id) return notFound("Project");
    }
    const statuses = await ctx.db
      .query("statuses")
      .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", me.workspaceId))
      .collect();
    const since = Date.now() - RECENT_DONE_MS;
    const columns = await Promise.all(
      statuses.map(async (status) => {
        let issues: Doc<"issues">[];
        if (includeDone || !isTerminal(status.category)) {
          issues = await ctx.db
            .query("issues")
            .withIndex("by_space_and_status", (q) =>
              q.eq("spaceId", spaceId).eq("statusId", status._id),
            )
            .collect();
        } else {
          const [recent, undated] = await Promise.all([
            ctx.db
              .query("issues")
              .withIndex("by_space_status_and_completed", (q) =>
                q.eq("spaceId", spaceId).eq("statusId", status._id).gte("completedAt", since),
              )
              .collect(),
            // Every done/canceled issue has completedAt (changeStatus and createIssue set it); this
            // keeps the old fallback to updatedAt for any row that somehow doesn't.
            ctx.db
              .query("issues")
              .withIndex("by_space_status_and_completed", (q) =>
                q.eq("spaceId", spaceId).eq("statusId", status._id).eq("completedAt", undefined),
              )
              .collect(),
          ]);
          issues = [...recent, ...undated.filter((issue) => issue.updatedAt >= since)].sort(
            byColumnOrder,
          );
        }
        return projectId ? issues.filter((issue) => issue.projectId === projectId) : issues;
      }),
    );
    return columns.flat().map(listRow);
  },
});

/** My open issues (unstarted, started, review), most recently updated first, as list rows. */
export const listMine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const groups = await Promise.all(
      OPEN_CATEGORIES.map((category) =>
        ctx.db
          .query("issues")
          .withIndex("by_assignee_and_category", (q) =>
            q.eq("assigneeId", me._id).eq("statusCategory", category),
          )
          .collect(),
      ),
    );
    return groups
      .flat()
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(listRow);
  },
});

/**
 * One issue by key (`PAN-42`, any case) with its space, its project (if any), sub-issues, comments
 * and the last 100 activity rows.
 */
export const get = query({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const key = args.key.trim().toUpperCase();
    const issue = await ctx.db
      .query("issues")
      .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", me.workspaceId).eq("key", key))
      .first();
    if (!issue) return null;
    const [subIssues, comments, activity, parent, space, project] = await Promise.all([
      ctx.db
        .query("issues")
        .withIndex("by_parent", (q) => q.eq("parentId", issue._id))
        .collect(),
      ctx.db
        .query("comments")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .collect(),
      ctx.db
        .query("activity")
        .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
        .order("desc")
        .take(100),
      issue.parentId ? ctx.db.get("issues", issue.parentId) : null,
      issue.spaceId ? ctx.db.get("spaces", issue.spaceId) : null,
      issue.spaceId && issue.projectId ? ctx.db.get("projects", issue.projectId) : null,
    ]);
    return {
      issue,
      space,
      // Only a workstream; on an M2 issue projectId still means its M2 project (the space).
      project: project && isProject(project) ? project : null,
      parent: parent
        ? { _id: parent._id, key: parent.key, title: parent.title, statusId: parent.statusId }
        : null,
      subIssues: subIssues.sort((a, b) => a.number - b.number).map(listRow),
      comments,
      activity: activity.reverse(),
    };
  },
});

/** What the palette shows for a match: no description, so results stay small. */
const searchResult = (issue: Doc<"issues">) => ({
  _id: issue._id,
  key: issue.key,
  title: issue.title,
  spaceId: issue.spaceId,
  projectId: issue.projectId,
  statusId: issue.statusId,
  priority: issue.priority,
  assigneeId: issue.assigneeId,
});

/**
 * Up to 20 issues for the command palette: an exact key match first (`PAN-42`, any case), then a
 * bare number as a key in every space (`42` → PAN-42, WEB-42), then title matches from the
 * `search_title` index (relevance order; the last word matches as a prefix while you type).
 * `spaceId` / `projectId` narrow it.
 */
export const search = query({
  args: {
    text: v.string(),
    spaceId: v.optional(v.id("spaces")),
    projectId: v.optional(v.id("projects")),
  },
  handler: async (ctx, { text, spaceId, projectId }) => {
    const me = await requireMember(ctx);
    const issues = await searchIssues(ctx, me.workspaceId, { text, spaceId, projectId });
    return issues.map(searchResult);
  },
});

export const create = mutation({
  args: {
    spaceId: v.id("spaces"),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
    title: v.string(),
    description: v.optional(v.string()),
    statusId: v.optional(v.id("statuses")),
    priority: v.optional(priority),
    assigneeId: v.optional(v.id("members")),
    labelIds: v.optional(v.array(v.id("labels"))),
    parentId: v.optional(v.id("issues")),
    dueDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    return createIssue(ctx, app(me), args);
  },
});

/** Field changes; one activity row per changed field. Never changes status (that's `move`). */
export const update = mutation({
  args: {
    issueId: v.id("issues"),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    priority: v.optional(priority),
    assigneeId: v.optional(v.union(v.id("members"), v.null())),
    labelIds: v.optional(v.array(v.id("labels"))),
    dueDate: v.optional(v.union(v.string(), v.null())),
    parentId: v.optional(v.union(v.id("issues"), v.null())),
    projectId: v.optional(v.union(v.id("projects"), v.null())),
  },
  handler: async (ctx, { issueId, ...changes }) => {
    const me = await requireMember(ctx);
    const issue = await getIssue(ctx, me.workspaceId, issueId);
    await updateIssue(ctx, app(me), issue, changes);
  },
});

/**
 * Status change and drag in one: the board, the list and the status picker all call this.
 * `afterId` is the issue it lands right after, `beforeId` the one it lands right before.
 */
export const move = mutation({
  args: {
    issueId: v.id("issues"),
    statusId: v.id("statuses"),
    beforeId: v.optional(v.id("issues")),
    afterId: v.optional(v.id("issues")),
  },
  handler: async (ctx, { issueId, statusId, beforeId, afterId }) => {
    const me = await requireMember(ctx);
    const issue = await getIssue(ctx, me.workspaceId, issueId);
    const status = await getStatus(ctx, me.workspaceId, statusId);
    await changeStatus(ctx, app(me), issue, status, { beforeId, afterId });
  },
});

/** Hard delete with comments, activity and sub-issues (the app asks for confirmation first). */
export const remove = mutation({
  args: { issueId: v.id("issues") },
  handler: async (ctx, { issueId }) => {
    const me = await requireMember(ctx);
    const issue = await getIssue(ctx, me.workspaceId, issueId);
    await deleteIssue(ctx, issue);
  },
});
