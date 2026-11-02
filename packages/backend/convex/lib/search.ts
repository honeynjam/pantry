import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

export const SEARCH_LIMIT = 20;
const KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

/**
 * Up to 20 issues in a workspace: an exact key match first (`PAN-42`, any case), then a bare number
 * as a key in every space (`42` → PAN-42, WEB-42), then title matches from the `search_title` index
 * (relevance order; the last word matches as a prefix while you type). `spaceId` / `projectId`
 * narrow it. Shared by the palette (`issues.search`) and MCP `search_issues`.
 */
export async function searchIssues(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  {
    text,
    spaceId,
    projectId,
  }: { text: string; spaceId?: Id<"spaces">; projectId?: Id<"projects"> },
): Promise<Doc<"issues">[]> {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const found = new Map<string, Doc<"issues">>();
  const byKey = (key: string) =>
    ctx.db
      .query("issues")
      .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", key))
      .first();
  const keep = (issue: Doc<"issues"> | null) => {
    if (
      issue &&
      (!spaceId || issue.spaceId === spaceId) &&
      (!projectId || issue.projectId === projectId)
    ) {
      found.set(issue._id, issue);
    }
  };

  const upper = trimmed.toUpperCase();
  if (KEY_PATTERN.test(upper)) keep(await byKey(upper));
  if (/^\d{1,9}$/.test(trimmed)) {
    const spaces = await ctx.db
      .query("spaces")
      .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect();
    // One lookup per space, in parallel; results keep the spaces' order.
    for (const issue of await Promise.all(
      spaces.map((space) => byKey(`${space.key}-${Number(trimmed)}`)),
    ))
      keep(issue);
  }

  const matches = await ctx.db
    .query("issues")
    .withSearchIndex("search_title", (q) => {
      const scoped = q.search("title", trimmed).eq("workspaceId", workspaceId);
      const inSpace = spaceId ? scoped.eq("spaceId", spaceId) : scoped;
      return projectId ? inSpace.eq("projectId", projectId) : inSpace;
    })
    .take(SEARCH_LIMIT);
  for (const issue of matches) if (!found.has(issue._id)) found.set(issue._id, issue);
  return [...found.values()].slice(0, SEARCH_LIMIT);
}
