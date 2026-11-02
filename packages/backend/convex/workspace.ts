import { mutation, query } from "./_generated/server";
import { requireMember, requireOwner } from "./lib/auth";
import { activeProjects, upgradePending } from "./lib/spaces";
import { workspaceMode } from "./schema";

/**
 * Everything the app shell needs in one subscription: the workspace, my member row, statuses (by
 * order), labels, members, active spaces and their active projects (spec §10b).
 */
export const current = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const workspace = await ctx.db.get("workspaces", me.workspaceId);
    if (!workspace) throw new Error("Workspace not found");

    const [statuses, labels, members, spaces] = await Promise.all([
      ctx.db
        .query("statuses")
        .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("labels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
      ctx.db
        .query("spaces")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspace._id))
        .collect(),
    ]);
    const activeSpaces = spaces.filter((space) => space.archivedAt === undefined);
    const projects = (
      await Promise.all(activeSpaces.map((space) => activeProjects(ctx, space._id)))
    ).flat();

    return {
      workspace,
      me,
      statuses,
      labels,
      members,
      spaces: activeSpaces,
      /** M2 data still waiting for `migrations:run` (seconds after a deploy): the app shows a notice. */
      upgrading: await upgradePending(ctx, workspace._id),
      /** Active projects of active spaces, in each space's order. */
      projects,
    };
  },
});

/**
 * Owner only: what the workspace works on (products, client work or both). The app's words and the
 * default kind of new spaces follow it; existing spaces keep their kind.
 */
export const setMode = mutation({
  args: { mode: workspaceMode },
  handler: async (ctx, { mode }) => {
    const me = await requireOwner(ctx);
    await ctx.db.patch("workspaces", me.workspaceId, { mode });
  },
});
