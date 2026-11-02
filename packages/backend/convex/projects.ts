import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { fail } from "./lib/errors";
import {
  archivedProjects,
  archiveProject,
  createProject,
  restoreProject,
  updateProject,
} from "./lib/organise";
import { activeProjects, getProject, getSpace } from "./lib/spaces";

/**
 * Projects: optional workstreams inside a space ("LinkedIn", "Marketing", "Launch"). A name, an
 * optional colour, an order and an archive flag; an issue is in at most one. Names are unique per
 * space among active projects, ignoring case (MCP looks them up by name).
 */

export const create = mutation({
  args: { spaceId: v.id("spaces"), name: v.string(), color: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    const { projectId } = await createProject(ctx, space, args);
    return projectId;
  },
});

/** Rename and recolour (`color: null` removes the colour). */
export const update = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    color: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const project = await getProject(ctx, me.workspaceId, args.projectId);
    await updateProject(ctx, project, args);
  },
});

/**
 * Archive: the project leaves the sidebar and pickers, and every issue in it stays in the space with
 * no project (each an issue write: `updatedAt` and one `project_changed` row).
 */
export const archive = mutation({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const project = await getProject(ctx, me.workspaceId, args.projectId);
    await archiveProject(ctx, { member: me, via: "app" }, project);
  },
});

/**
 * Un-archive: back at the end of the space's order, in the sidebar and pickers. Issues that lost the
 * project when it was archived stay without one. Refused if an active project in the space has the
 * same name; the settings screen lets you rename the archived one first (or pass `name`).
 */
export const restore = mutation({
  args: { projectId: v.id("projects"), name: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const project = await getProject(ctx, me.workspaceId, args.projectId);
    const space = await getSpace(ctx, me.workspaceId, project.spaceId);
    await restoreProject(ctx, space, project, args.name !== undefined ? { name: args.name } : {});
  },
});

/** A space's archived projects for Space settings, most recently archived first. */
export const listArchived = query({
  args: { spaceId: v.id("spaces") },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    return archivedProjects(ctx, space._id);
  },
});

/** New order for a space's active projects: every one of them, each once. */
export const reorder = mutation({
  args: { spaceId: v.id("spaces"), projectIds: v.array(v.id("projects")) },
  handler: async (ctx, args) => {
    const me = await requireMember(ctx);
    const space = await getSpace(ctx, me.workspaceId, args.spaceId);
    const current = await activeProjects(ctx, space._id);
    const ids = new Set(current.map((project) => project._id));
    const same =
      args.projectIds.length === current.length &&
      new Set(args.projectIds).size === args.projectIds.length &&
      args.projectIds.every((id) => ids.has(id));
    if (!same)
      fail("INVALID_ORDER", "The new order has to list each of the space's projects once.");
    for (const [index, projectId] of args.projectIds.entries()) {
      await ctx.db.patch("projects", projectId, { sortOrder: index + 1 });
    }
  },
});
