import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { avatarValidator } from "./lib/avatar";

export const via = v.union(v.literal("app"), v.literal("mcp"));
export const category = v.union(
  v.literal("backlog"),
  v.literal("unstarted"),
  v.literal("started"),
  v.literal("review"),
  v.literal("done"),
  v.literal("canceled"),
);
// 0 none, 1 urgent, 2 high, 3 medium, 4 low (Linear's order)
export const priority = v.union(
  v.literal(0),
  v.literal(1),
  v.literal(2),
  v.literal(3),
  v.literal(4),
);
export const spaceKind = v.union(v.literal("product"), v.literal("client"));
/** What the workspace works on (onboarding step 1): the UI's words and defaults follow it. */
export const workspaceMode = v.union(v.literal("product"), v.literal("client"), v.literal("both"));

/*
 * TRANSITIONAL SCHEMA (the Spaces release). Until every instance has run `migrations:run`, the
 * tables below also accept M2 rows, so `convex deploy` validates against existing data:
 *   - `projects` holds both M2 "projects" (which are now spaces: key + counter) and new
 *     workstreams (spaceId + sortOrder);
 *   - `issues.spaceId` is optional (M2 issues point at their M2 project through `projectId`);
 *   - `docs` accepts the M2 `project_context` kind and its `projectId`.
 * A later release narrows these back (docs/MIGRATIONS.md); `migrations:assertMigrated` guards it.
 */

/** An M2 project: what is now a space. Only `migrations:run` reads these; it moves and deletes them. */
export const legacyProjectFields = {
  workspaceId: v.id("workspaces"),
  name: v.string(),
  key: v.string(),
  nextIssueNumber: v.number(),
  archivedAt: v.optional(v.number()),
};

/** A project: an optional workstream inside a space ("LinkedIn", "Launch"). */
export const projectFields = {
  workspaceId: v.id("workspaces"),
  spaceId: v.id("spaces"),
  name: v.string(), // unique per space among active projects, ignoring case
  color: v.optional(v.string()),
  sortOrder: v.number(),
  archivedAt: v.optional(v.number()),
};

export default defineSchema({
  workspaces: defineTable({
    name: v.string(),
    slug: v.string(),
    createdBy: v.string(),
    mode: v.optional(workspaceMode), // "product" when missing (workspaces from before onboarding)
  }).index("by_slug", ["slug"]),

  members: defineTable({
    workspaceId: v.id("workspaces"),
    userId: v.string(), // Better Auth user id (lives in the component, so a string)
    displayName: v.string(),
    avatarUrl: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("member")),
    onboardedAt: v.optional(v.number()), // when they finished (or skipped) onboarding; missing = not yet
  })
    // Kept next to by_workspace_and_user (spec §10b): lists members in join order.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_workspace", ["workspaceId"])
    .index("by_user", ["userId"])
    .index("by_workspace_and_user", ["workspaceId", "userId"]),

  invites: defineTable({
    workspaceId: v.id("workspaces"),
    email: v.string(), // lower-cased
    tokenHash: v.string(),
    createdBy: v.id("members"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_email", ["email"])
    .index("by_workspace", ["workspaceId"]),

  // A product or a client (spec §5): owns the issue key, the counter, the context doc and the views.
  spaces: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    key: v.string(), // ^[A-Z][A-Z0-9]{1,9}$, fixed after creation in v0.1
    nextIssueNumber: v.number(),
    archivedAt: v.optional(v.number()),
    kind: v.optional(spaceKind), // "product" when missing
    avatar: v.optional(avatarValidator), // unset: the app seeds one from the key
  })
    // Kept next to by_workspace_and_key (spec §10b): lists spaces in creation order.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_workspace", ["workspaceId"])
    .index("by_workspace_and_key", ["workspaceId", "key"]),

  // Workstreams inside a space; an issue is in at most one. TRANSITIONAL: also M2 projects (above).
  projects: defineTable(v.union(v.object(projectFields), v.object(legacyProjectFields)))
    // Finds a workspace's M2 rows (the "upgrade in progress" check).
    .index("by_workspace", ["workspaceId"])
    // Kept next to by_space_and_name (spec §10b): a space's projects, sorted by sortOrder in code.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_space", ["spaceId"])
    .index("by_space_and_name", ["spaceId", "name"]),

  statuses: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    category, // fixed after creation; name, colour and order are editable
    order: v.number(),
    color: v.string(),
  }).index("by_workspace_and_order", ["workspaceId", "order"]),

  labels: defineTable({
    workspaceId: v.id("workspaces"),
    name: v.string(),
    color: v.string(),
  }).index("by_workspace", ["workspaceId"]),

  issues: defineTable({
    workspaceId: v.id("workspaces"),
    // TRANSITIONAL: optional only so M2 issues validate; every issue gets one from migrations:run.
    spaceId: v.optional(v.id("spaces")),
    // A workstream in the issue's space. On an M2 issue (no spaceId) it's the M2 project instead.
    projectId: v.optional(v.id("projects")),
    number: v.number(),
    key: v.string(), // "PAN-42"
    title: v.string(),
    description: v.string(), // markdown, "" when empty
    statusId: v.id("statuses"),
    statusCategory: category, // copied from the status for fast category filters
    priority,
    assigneeId: v.optional(v.id("members")),
    creatorId: v.id("members"),
    labelIds: v.array(v.id("labels")),
    parentId: v.optional(v.id("issues")), // one level only
    dueDate: v.optional(v.string()), // "YYYY-MM-DD"
    sortOrder: v.number(), // fractional: new = midpoint of neighbours
    completedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_space_and_status", ["spaceId", "statusId", "sortOrder"])
    // Recently done/canceled issues of a column without reading the old ones (issues.listBySpace).
    .index("by_space_status_and_completed", ["spaceId", "statusId", "completedAt"])
    .index("by_project", ["projectId"])
    .index("by_assignee_and_category", ["assigneeId", "statusCategory"])
    .index("by_parent", ["parentId"])
    .index("by_workspace_and_key", ["workspaceId", "key"])
    .index("by_workspace_and_updated", ["workspaceId", "updatedAt"])
    // MCP list_issues: newest first inside one space, or one assignee's.
    .index("by_space_and_updated", ["spaceId", "updatedAt"])
    .index("by_assignee_and_updated", ["assigneeId", "updatedAt"])
    .searchIndex("search_title", {
      searchField: "title",
      filterFields: ["workspaceId", "spaceId", "projectId"],
    }),

  comments: defineTable({
    issueId: v.id("issues"),
    authorId: v.id("members"),
    body: v.string(),
    via,
    editedAt: v.optional(v.number()),
  }).index("by_issue", ["issueId"]),

  activity: defineTable({
    workspaceId: v.id("workspaces"),
    issueId: v.id("issues"),
    actorId: v.optional(v.id("members")),
    type: v.union(
      v.literal("created"),
      v.literal("status_changed"),
      v.literal("priority_changed"),
      v.literal("assigned"),
      v.literal("labels_changed"),
      v.literal("commented"),
      v.literal("title_changed"),
      v.literal("description_changed"),
      v.literal("parent_changed"),
      v.literal("due_date_changed"),
      v.literal("project_changed"),
    ),
    from: v.optional(v.string()),
    to: v.optional(v.string()),
    via,
  })
    .index("by_issue", ["issueId"])
    .index("by_workspace", ["workspaceId"]),

  docs: defineTable({
    workspaceId: v.id("workspaces"),
    spaceId: v.optional(v.id("spaces")),
    // TRANSITIONAL: "project_context" and `projectId` are M2 rows that migrations:run rewrites.
    kind: v.union(v.literal("space_context"), v.literal("project_context")), // widen to "doc" later
    projectId: v.optional(v.id("projects")),
    title: v.string(),
    body: v.string(),
    updatedBy: v.id("members"),
    updatedAt: v.number(),
  })
    .index("by_space_and_kind", ["spaceId", "kind"])
    // TRANSITIONAL: finds M2 docs still pointing at an M2 project (migrations:run).
    .index("by_project", ["projectId"]),

  apiTokens: defineTable({
    userId: v.string(),
    workspaceId: v.id("workspaces"),
    memberId: v.id("members"),
    name: v.string(),
    tokenPrefix: v.string(), // first 8 chars, e.g. "pan_x7Kq", shown in the UI
    tokenHash: v.string(), // SHA-256 hex
    lastUsedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    // Set on the access token of an OAuth connection (Claude, ChatGPT…): which connection it belongs
    // to and when it stops working. Personal API tokens have neither and never expire.
    grantId: v.optional(v.id("oauthGrants")),
    expiresAt: v.optional(v.number()),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_user", ["userId"]),

  // MCP authorization (OAuth 2.1), convex/oauth.ts. No plain secrets: codes and tokens are SHA-256.

  /** Apps that can ask to connect: registered (RFC 7591) or a cached Client ID Metadata Document. */
  oauthClients: defineTable({
    clientId: v.string(), // our random id (registered) or the metadata document's https URL
    kind: v.union(v.literal("registered"), v.literal("metadata_document")),
    name: v.string(), // self-reported by the app
    redirectUris: v.array(v.string()),
    clientUri: v.optional(v.string()),
    logoUri: v.optional(v.string()),
    cacheUntil: v.optional(v.number()), // metadata documents: refetch after this
    usedAt: v.optional(v.number()), // first time someone allowed it; unused registrations expire
  })
    .index("by_client_id", ["clientId"])
    .index("by_kind_and_used", ["kind", "usedAt"]),

  /** An authorization request waiting on the consent screen (between /authorize and Allow). */
  oauthRequests: defineTable({
    requestId: v.string(), // random, in the consent screen's URL; not a credential
    clientId: v.string(),
    redirectUri: v.string(),
    state: v.optional(v.string()),
    codeChallenge: v.string(), // PKCE S256
    resource: v.string(), // RFC 8707: this instance's /api/mcp
    scope: v.optional(v.string()),
    issuer: v.string(),
    expiresAt: v.number(),
  })
    .index("by_request_id", ["requestId"])
    .index("by_expires", ["expiresAt"]),

  /** Authorization codes: single use, short-lived, kept until expiry to catch replays. */
  oauthCodes: defineTable({
    codeHash: v.string(),
    clientId: v.string(),
    redirectUri: v.string(),
    codeChallenge: v.string(),
    resource: v.string(),
    scope: v.optional(v.string()),
    userId: v.string(),
    workspaceId: v.id("workspaces"),
    memberId: v.id("members"),
    expiresAt: v.number(),
    usedAt: v.optional(v.number()),
    grantId: v.optional(v.id("oauthGrants")), // the connection the code was exchanged for
  })
    .index("by_code_hash", ["codeHash"])
    .index("by_expires", ["expiresAt"]),

  /** A connected app (Settings → API tokens → Connected apps): one refresh token and one access token. */
  oauthGrants: defineTable({
    clientId: v.string(),
    clientName: v.string(),
    clientKind: v.union(v.literal("registered"), v.literal("metadata_document")),
    redirectUri: v.string(),
    userId: v.string(),
    workspaceId: v.id("workspaces"),
    memberId: v.id("members"),
    resource: v.string(),
    scope: v.optional(v.string()),
    tokenId: v.optional(v.id("apiTokens")), // the current access token
    refreshHash: v.string(),
    refreshExpiresAt: v.number(),
    previousRefreshHash: v.optional(v.string()), // honoured for REFRESH_REUSE_GRACE_MS after rotating
    rotatedAt: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
  })
    .index("by_refresh_hash", ["refreshHash"])
    .index("by_previous_refresh_hash", ["previousRefreshHash"])
    .index("by_user", ["userId"]),
});
