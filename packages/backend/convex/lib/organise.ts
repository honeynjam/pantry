import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "./activity";
import type { avatarValidator } from "./avatar";
import { SAMPLE_CONTEXT_DOC } from "./defaults";
import { fail } from "./errors";
import { setIssueProject } from "./issues";
import { isProject, type Project } from "./model";
import { activeProjects, nameKey } from "./spaces";
import { checkColor, cleanName, SPACE_KEY_PATTERN } from "./validate";

/**
 * Organising a workspace: spaces, their context docs, projects and labels. Shared by the app's
 * `spaces.*`, `docs.saveContext`, `projects.*` and `labels.create` and by the MCP tools that do the
 * same things, so both follow one set of rules. Callers check membership (`requireMember` or
 * `requireToken`) and resolve the space or project inside the caller's workspace first.
 */

type Kind = NonNullable<Doc<"spaces">["kind"]>;
type Avatar = Infer<typeof avatarValidator>;

// ---------------------------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------------------------

type Mode = NonNullable<Doc<"workspaces">["mode"]>;

/** The workspace's mode; workspaces from before onboarding are product workspaces. */
export const modeOf = (workspace: Pick<Doc<"workspaces">, "mode"> | null): Mode =>
  workspace?.mode ?? "product";

/** The kind a new space gets when none is given: clients in a client workspace, else products. */
export const defaultKind = (mode: Mode): Kind => (mode === "client" ? "client" : "product");

/** A valid key (2–10 letters or digits, a letter first) not used by any space, archived included. */
async function checkKeyFree(
  ctx: QueryCtx,
  workspaceId: Id<"workspaces">,
  rawKey: string,
  except?: Id<"spaces">,
): Promise<string> {
  const key = rawKey.trim().toUpperCase();
  if (!SPACE_KEY_PATTERN.test(key)) {
    fail(
      "INVALID_KEY",
      "Keys are 2–10 letters or digits and start with a letter, like PAN or WEB2.",
    );
  }
  const taken = await ctx.db
    .query("spaces")
    .withIndex("by_workspace_and_key", (q) => q.eq("workspaceId", workspaceId).eq("key", key))
    .first();
  if (taken && taken._id !== except) {
    fail(
      "KEY_TAKEN",
      taken.archivedAt === undefined
        ? `${key} is already the key of ${taken.name}.`
        : `${key} belongs to an archived space (${taken.name}). Pick another key.`,
    );
  }
  return key;
}

/**
 * New space with its context doc. The key is unique per workspace, archived spaces included (their
 * issues keep their keys), and fixed once the space has issues. Without a kind the space takes the
 * workspace's default (clients in a client workspace). Without an avatar the space gets a look
 * seeded from its key.
 */
export async function createSpace(
  ctx: MutationCtx,
  me: Doc<"members">,
  args: { name: string; key: string; kind?: Kind; avatar?: Avatar },
) {
  const name = cleanName(args.name, "Space name");
  const key = await checkKeyFree(ctx, me.workspaceId, args.key);
  const kind = args.kind ?? defaultKind(modeOf(await ctx.db.get("workspaces", me.workspaceId)));

  const spaceId = await ctx.db.insert("spaces", {
    workspaceId: me.workspaceId,
    name,
    key,
    nextIssueNumber: 1,
    ...(kind !== "product" ? { kind } : {}),
    ...(args.avatar ? { avatar: args.avatar } : {}),
  });
  await ctx.db.insert("docs", {
    workspaceId: me.workspaceId,
    spaceId,
    kind: "space_context",
    title: `${name} context`,
    body: SAMPLE_CONTEXT_DOC,
    updatedBy: me._id,
    updatedAt: Date.now(),
  });
  return { spaceId, key, name, kind };
}

/**
 * Rename, change kind, or change the key. The key can only change while the space has never had an
 * issue (nextIssueNumber is still 1): after that, issue keys and agents' references depend on it.
 */
export async function updateSpace(
  ctx: MutationCtx,
  space: Doc<"spaces">,
  args: { name?: string; kind?: Kind; key?: string },
) {
  let key: string | undefined;
  if (args.key !== undefined && args.key.trim().toUpperCase() !== space.key) {
    if (space.nextIssueNumber !== 1) {
      fail("KEY_FIXED", `${space.key} has issues, so its key can't change any more.`);
    }
    key = await checkKeyFree(ctx, space.workspaceId, args.key, space._id);
  }
  await ctx.db.patch("spaces", space._id, {
    ...(args.name !== undefined ? { name: cleanName(args.name, "Space name") } : {}),
    ...(args.kind !== undefined ? { kind: args.kind } : {}),
    ...(key !== undefined ? { key } : {}),
  });
}

export const MAX_CONTEXT_DOC = 100_000;

/** Replaces the space's context doc (markdown); creates it if an old space has none. */
export async function saveSpaceContext(
  ctx: MutationCtx,
  me: Doc<"members">,
  space: Doc<"spaces">,
  body: string,
) {
  if (body.length > MAX_CONTEXT_DOC)
    fail(
      "TOO_LONG",
      `The context doc can be at most ${MAX_CONTEXT_DOC.toLocaleString("en")} characters.`,
    );
  const doc = await ctx.db
    .query("docs")
    .withIndex("by_space_and_kind", (q) => q.eq("spaceId", space._id).eq("kind", "space_context"))
    .first();
  const now = Date.now();
  if (doc) {
    if (doc.body === body) return doc.updatedAt;
    await ctx.db.patch("docs", doc._id, { body, updatedBy: me._id, updatedAt: now });
  } else {
    await ctx.db.insert("docs", {
      workspaceId: me.workspaceId,
      spaceId: space._id,
      kind: "space_context",
      title: `${space.name} context`,
      body,
      updatedBy: me._id,
      updatedAt: now,
    });
  }
  return now;
}

// ---------------------------------------------------------------------------------------------
// Projects (workstreams inside a space)
// ---------------------------------------------------------------------------------------------

/** Names are unique per space among active projects, ignoring case (MCP finds them by name). */
async function checkProjectNameFree(
  ctx: QueryCtx,
  spaceId: Id<"spaces">,
  name: string,
  except?: Id<"projects">,
) {
  const taken = (await activeProjects(ctx, spaceId)).find(
    (project) => project._id !== except && nameKey(project.name) === nameKey(name),
  );
  if (taken) fail("NAME_TAKEN", `There's already a project called ${taken.name} in this space.`);
}

/** New project at the end of the space's order. The space must be active. */
export async function createProject(
  ctx: MutationCtx,
  space: Doc<"spaces">,
  args: { name: string; color?: string },
) {
  if (space.archivedAt !== undefined) fail("ARCHIVED", `${space.name} is archived.`);
  const name = cleanName(args.name, "Project name", 60);
  await checkProjectNameFree(ctx, space._id, name);
  const last = (await activeProjects(ctx, space._id)).at(-1);
  const projectId = await ctx.db.insert("projects", {
    workspaceId: space.workspaceId,
    spaceId: space._id,
    name,
    ...(args.color !== undefined ? { color: checkColor(args.color) } : {}),
    sortOrder: (last?.sortOrder ?? 0) + 1,
  });
  return { projectId, name };
}

/** Rename and recolour (`color: null` removes the colour). */
export async function updateProject(
  ctx: MutationCtx,
  project: Project,
  args: { name?: string; color?: string | null },
) {
  const patch: Partial<Project> = {};
  if (args.name !== undefined) {
    const name = cleanName(args.name, "Project name", 60);
    if (project.archivedAt === undefined)
      await checkProjectNameFree(ctx, project.spaceId, name, project._id);
    patch.name = name;
  }
  if (args.color !== undefined)
    patch.color = args.color === null ? undefined : checkColor(args.color);
  await ctx.db.patch("projects", project._id, patch);
}

/**
 * Archive: the project leaves the sidebar and pickers, and every issue in it stays in the space with
 * no project (each an issue write by `actor`: `updatedAt` and one `project_changed` row). Returns how
 * many issues (sub-issues included) left the project.
 */
export async function archiveProject(ctx: MutationCtx, actor: Actor, project: Project) {
  if (project.archivedAt !== undefined) return 0;
  const issues = await ctx.db
    .query("issues")
    .withIndex("by_project", (q) => q.eq("projectId", project._id))
    .collect();
  const now = Date.now();
  for (const issue of issues) {
    // Sub-issues are cleared along with their parent; re-read so none is written twice.
    const current = await ctx.db.get("issues", issue._id);
    if (current?.projectId === project._id) await setIssueProject(ctx, actor, current, null, now);
  }
  await ctx.db.patch("projects", project._id, { archivedAt: now });
  return issues.length;
}

// ---------------------------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------------------------

export async function workspaceLabelRows(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  return ctx.db
    .query("labels")
    .withIndex("by_workspace", (q) => q.eq("workspaceId", workspaceId))
    .collect();
}

/** Label names are unique per workspace, ignoring case: agents pick labels by name over MCP. */
export function assertLabelNameFree(labels: Doc<"labels">[], name: string, except?: Id<"labels">) {
  const clash = labels.find(
    (label) => label._id !== except && label.name.toLowerCase() === name.toLowerCase(),
  );
  if (clash) fail("NAME_TAKEN", `There's already a label called ${clash.name}.`);
}

export async function createLabel(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  args: { name: string; color: string },
) {
  const name = cleanName(args.name, "Label name", 40);
  assertLabelNameFree(await workspaceLabelRows(ctx, workspaceId), name);
  const labelId = await ctx.db.insert("labels", {
    workspaceId,
    name,
    color: checkColor(args.color),
  });
  return { labelId, name };
}

/**
 * Restore an archived project: it goes to the end of the space's order and shows in the sidebar and
 * pickers again. Issues that lost it when it was archived stay without a project (archiving cleared
 * them; nothing records which they were). Refused when the space is archived, or when an active
 * project in the space already has its name (names are unique among active projects): rename one of
 * them first, or pass `name` to restore it under a new name.
 */
export async function restoreProject(
  ctx: MutationCtx,
  space: Doc<"spaces">,
  project: Project,
  args: { name?: string } = {},
) {
  if (project.spaceId !== space._id)
    fail("WRONG_SPACE", `${project.name} isn't a project in ${space.name}.`);
  if (space.archivedAt !== undefined) fail("ARCHIVED", `${space.name} is archived.`);
  if (project.archivedAt === undefined) return { name: project.name, restored: false };
  const name = args.name !== undefined ? cleanName(args.name, "Project name", 60) : project.name;
  const taken = (await activeProjects(ctx, space._id)).find(
    (row) => nameKey(row.name) === nameKey(name),
  );
  if (taken) {
    fail(
      "NAME_TAKEN",
      `There's already an active project called ${taken.name} in ${space.name}. Rename one of them first, then restore.`,
    );
  }
  const last = (await activeProjects(ctx, space._id)).at(-1);
  await ctx.db.patch("projects", project._id, {
    name,
    archivedAt: undefined,
    sortOrder: (last?.sortOrder ?? 0) + 1,
  });
  return { name, restored: true };
}

/** A space's archived projects, most recently archived first. */
export async function archivedProjects(ctx: QueryCtx, spaceId: Id<"spaces">): Promise<Project[]> {
  const rows = await ctx.db
    .query("projects")
    .withIndex("by_space", (q) => q.eq("spaceId", spaceId))
    .collect();
  return rows
    .filter(isProject)
    .filter((row) => row.archivedAt !== undefined)
    .sort((a, b) => b.archivedAt! - a.archivedAt!);
}

// ---------------------------------------------------------------------------------------------
// Statuses: six fixed ones (one per category). Rename, recolour and reorder only.
// ---------------------------------------------------------------------------------------------

export async function workspaceStatusRows(ctx: QueryCtx, workspaceId: Id<"workspaces">) {
  return ctx.db
    .query("statuses")
    .withIndex("by_workspace_and_order", (q) => q.eq("workspaceId", workspaceId))
    .collect();
}

/** Names stay unique, ignoring case, because agents set status by name over MCP. */
export async function updateStatus(
  ctx: MutationCtx,
  status: Doc<"statuses">,
  args: { name?: string; color?: string },
) {
  const patch: Partial<Doc<"statuses">> = {};
  if (args.name !== undefined) {
    const name = cleanName(args.name, "Status name", 40);
    const clash = (await workspaceStatusRows(ctx, status.workspaceId)).find(
      (row) => row._id !== status._id && row.name.toLowerCase() === name.toLowerCase(),
    );
    if (clash) fail("NAME_TAKEN", `There's already a status called ${clash.name}.`);
    patch.name = name;
  }
  if (args.color !== undefined) patch.color = checkColor(args.color);
  await ctx.db.patch("statuses", status._id, patch);
}

/** New order for all of the workspace's statuses: `statusIds` must list each exactly once. */
export async function reorderStatuses(
  ctx: MutationCtx,
  workspaceId: Id<"workspaces">,
  statusIds: Id<"statuses">[],
) {
  const all = await workspaceStatusRows(ctx, workspaceId);
  const known = new Set(all.map((status) => status._id));
  const given = new Set(statusIds);
  if (
    given.size !== statusIds.length ||
    given.size !== known.size ||
    statusIds.some((id) => !known.has(id))
  ) {
    fail("INVALID_ORDER", "Reorder needs every status exactly once.");
  }
  for (const [order, statusId] of statusIds.entries()) {
    const status = all.find((row) => row._id === statusId)!;
    if (status.order !== order) await ctx.db.patch("statuses", statusId, { order });
  }
}
