import { paginationOptsValidator } from "convex/server";
import { query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { isProject } from "./lib/model";
import { SERVER_VERSION } from "./lib/version";

/**
 * Export (Settings → Import and Export): the workspace's data as the app downloads it. Any member can
 * export, since members can already read all of it in the app. The app reads `workspace` once and
 * pages through `issues` (with their comments) and `activity`, so an export of thousands of issues
 * stays inside Convex's per-query limits; it builds the JSON and CSV files in the browser.
 */

/** Bumped when the export's shape changes in a way a reader would notice. */
export const EXPORT_FORMAT = 1;

/** Everything but the issues: workspace, members, statuses, labels, spaces, projects, context docs. */
export const workspace = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const workspaceId = me.workspaceId;
    const workspace = await ctx.db.get("workspaces", workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const [members, statuses, labels, spaces] = await Promise.all([
      ctx.db
        .query("members")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("statuses")
        .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("labels")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
      ctx.db
        .query("spaces")
        .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
        .collect(),
    ]);
    const perSpace = await Promise.all(
      spaces.map(async (space) => {
        const [projects, docs] = await Promise.all([
          ctx.db
            .query("projects")
            .withIndex("by_space", (q) => q.eq("spaceId", space._id))
            .collect(),
          ctx.db
            .query("docs")
            .withIndex("by_space_and_kind", (q) =>
              q.eq("spaceId", space._id).eq("kind", "space_context"),
            )
            .collect(),
        ]);
        return { projects: projects.filter(isProject), docs };
      }),
    );
    return {
      format: EXPORT_FORMAT,
      serverVersion: SERVER_VERSION,
      exportedAt: Date.now(),
      workspace: {
        _id: workspace._id,
        name: workspace.name,
        slug: workspace.slug,
        mode: workspace.mode ?? "product",
      },
      // Display names and roles only: sign-in emails live in the auth component, not here.
      members: members.map((member) => ({
        _id: member._id,
        _creationTime: member._creationTime,
        displayName: member.displayName,
        role: member.role,
      })),
      statuses,
      labels,
      spaces,
      projects: perSpace.flatMap((row) => row.projects),
      docs: perSpace.flatMap((row) => row.docs),
    };
  },
});

/** One page of the workspace's issues (sub-issues included), each with its comments. */
export const issues = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireMember(ctx);
    const page = await ctx.db
      .query("issues")
      .withIndex("by_workspace_and_updated", (q) => q.eq("workspaceId", me.workspaceId))
      .paginate(paginationOpts);
    const withComments = await Promise.all(
      page.page.map(async (issue) => ({
        ...issue,
        comments: await ctx.db
          .query("comments")
          .withIndex("by_issue", (q) => q.eq("issueId", issue._id))
          .collect(),
      })),
    );
    return { ...page, page: withComments };
  },
});

/** One page of the workspace's activity rows (the issues' history). */
export const activity = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, { paginationOpts }) => {
    const me = await requireMember(ctx);
    return ctx.db
      .query("activity")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", me.workspaceId))
      .paginate(paginationOpts);
  },
});
