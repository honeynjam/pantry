import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { via as viaValidator } from "../schema";

export type Via = Infer<typeof viaValidator>;
export type ActivityType = Doc<"activity">["type"];

/** Who is writing and through which surface. Every issue write carries one. */
export type Actor = { member: Doc<"members">; via: Via };

/**
 * One activity row. `from`/`to` hold readable snapshots (status, label and member names, issue
 * keys, ISO days, priority digits) so history reads right after renames and deletes.
 */
export async function logActivity(
  ctx: MutationCtx,
  actor: Actor,
  issue: { _id: Id<"issues">; workspaceId: Id<"workspaces"> },
  type: ActivityType,
  change: { from?: string; to?: string } = {},
) {
  await ctx.db.insert("activity", {
    workspaceId: issue.workspaceId,
    issueId: issue._id,
    actorId: actor.member._id,
    type,
    ...(change.from !== undefined ? { from: change.from } : {}),
    ...(change.to !== undefined ? { to: change.to } : {}),
    via: actor.via,
  });
}

/**
 * The one `created` row of an imported issue: the importer is the actor, `via` is "import" and
 * `from` names the source ("Linear"), so the timeline says it came from the import rather than
 * looking like the importer typed it in.
 */
export async function logImportActivity(
  ctx: MutationCtx,
  importer: Doc<"members">,
  issue: { _id: Id<"issues">; workspaceId: Id<"workspaces"> },
  source: string,
  status: string,
) {
  await ctx.db.insert("activity", {
    workspaceId: issue.workspaceId,
    issueId: issue._id,
    actorId: importer._id,
    type: "created",
    from: source,
    to: status,
    via: "import",
  });
}
