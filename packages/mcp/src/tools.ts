import type { CallToolResult, McpServer, ServerContext } from "@modelcontextprotocol/server";
import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import { PRIORITY_NAMES } from "@pantry/backend/priority";
import { PALETTE, SPACE_KEY_PATTERN } from "@pantry/backend/validate";
import type { FunctionArgs } from "convex/server";
import { z } from "zod";
import type { PantryAuthExtra } from "./auth";
import type { Backend } from "./backend";

/**
 * The MCP tools (spec §6, §10b "MCP tools"): issue work plus organising (spaces, context docs,
 * projects, labels). Thin adapters: zod checks the shape, Convex
 * (`convex/mcp.ts`) checks the token, resolves names inside the token's workspace and writes through
 * the app's helpers. A refusal from Convex (an unknown status, project, label…) comes back as
 * `isError: true` with its message, which lists the valid values so the agent can retry.
 */

const KEY = brand.defaultKey;
const ISSUE_KEY = /^[A-Z][A-Z0-9]{1,9}-\d+$/;

export const SERVER_INSTRUCTIONS = [
  `${brand.name} is the team's issue tracker. Call get_workspace first to see its spaces, projects, statuses, labels and people.`,
  `Work on an issue starts from its key, like ${KEY}-42.`,
  `Before starting work on an issue, call get_issue and then get_space_context for its space (the part of the key before the dash) and follow that doc.`,
  `Nothing changes status by itself: move the issue to "In Progress" with update_issue when you start and to "In Review" when you're done,`,
  `post progress notes and findings with add_comment, and add follow-ups with create_sub_issue.`,
  `You can also organise work: create and rename spaces, rewrite a space's context doc, create, rename, recolour, archive and restore projects, create labels, and rename, recolour or reorder the six statuses.`,
  `delete_issue permanently deletes an issue with its sub-issues and comments: only use it when the person asked for that delete.`,
  `Not available over MCP: deleting spaces, comments or labels, archiving spaces, adding or removing statuses, and invites, members or API tokens; ask a person to do those in the app.`,
  `Everything you do shows under the token owner's name, tagged "via MCP".`,
].join(" ");

const ORIENT_FIRST = `Call get_workspace first to see the spaces, projects and labels that exist.`;

const READ_FIRST = `Call get_space_context for the issue's space before you start work.`;

// ---------------------------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------------------------

const issueKey = z
  .string()
  .trim()
  .toUpperCase()
  .regex(ISSUE_KEY, `An issue key looks like ${KEY}-42.`)
  .describe(`Issue key, like ${KEY}-42`);
const spaceKey = z
  .string()
  .trim()
  .min(1)
  .max(10)
  .describe(`Space key, like ${KEY} (the part of an issue key before the dash)`);
const name = (what: string) => z.string().trim().min(1).max(80).describe(what);
const priorityInput = z
  .union([z.enum(PRIORITY_NAMES), z.number().int().min(0).max(4)])
  .describe('Priority: "none", "urgent", "high", "medium" or "low" (or 0–4 in that order)');
const assignee = name(`Assignee: "me" (the token's owner), "none", or a member's display name`);
const CATEGORIES = [
  "backlog",
  "unstarted",
  "started",
  "review",
  "done",
  "canceled",
] as const satisfies readonly NonNullable<FunctionArgs<typeof api.mcp.listIssues>["category"]>[];

const spaceKind = z
  .enum(["product", "client"])
  .describe('"product" (something you build) or "client" (work for someone)');
const color = z.enum(PALETTE).describe(`Palette colour: ${PALETTE.join(", ")}`);
const dueDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Due dates look like 2026-11-30.")
  .describe("Due date, YYYY-MM-DD");
const title = z.string().trim().min(1).max(200).describe("Title, up to 200 characters");
const markdown = (what: string, max: number) => z.string().max(max).describe(what);

const toPriority = (value: z.infer<typeof priorityInput> | undefined) =>
  value === undefined
    ? undefined
    : typeof value === "number"
      ? (value as 0 | 1 | 2 | 3 | 4)
      : (PRIORITY_NAMES.indexOf(value) as 0 | 1 | 2 | 3 | 4);

/** Drops undefined values, so Convex validators only see the fields that were given. */
function defined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
}

export const schemas = {
  get_issue: z.object({ key: issueKey }),
  get_space_context: z.object({ space: spaceKey }),
  list_issues: z.object({
    space: spaceKey.optional(),
    project: name(
      'Project name inside `space` (needs `space`), or "none" for issues without a project',
    ).optional(),
    status: name(`Status name, like "In Progress"`).optional(),
    category: z.enum(CATEGORIES).optional().describe("Status category"),
    assignee: assignee.optional(),
    label: name("Label name").optional(),
    priority: priorityInput.optional(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("How many to return (default 50, at most 100)"),
  }),
  create_issue: z.object({
    space: spaceKey,
    project: name('Project name inside the space, or "none"').optional(),
    title,
    description: markdown("Markdown description", 100_000).optional(),
    status: name('Status name; default is the first "unstarted" status (Todo)').optional(),
    priority: priorityInput.optional(),
    assignee: assignee.optional(),
    labels: z
      .array(name("Label name"))
      .max(20)
      .optional()
      .describe("Existing label names; labels are never created on the fly"),
    dueDate: dueDate.optional(),
  }),
  create_sub_issue: z.object({
    parent: issueKey.describe("Parent issue key; the sub-issue takes its space and project"),
    title,
    description: markdown("Markdown description", 100_000).optional(),
    priority: priorityInput.optional(),
    assignee: assignee.optional(),
  }),
  add_comment: z.object({
    key: issueKey,
    body: z.string().min(1).max(20_000).describe("Markdown, up to 20,000 characters"),
  }),
  update_issue: z.object({
    key: issueKey,
    title: title.optional(),
    description: markdown("New markdown description (replaces the old one)", 100_000).optional(),
    status: name(`New status name, like "In Progress" or "In Review"`).optional(),
    priority: priorityInput.optional(),
    assignee: assignee.optional(),
    addLabels: z.array(name("Label name")).max(20).optional().describe("Label names to add"),
    removeLabels: z.array(name("Label name")).max(20).optional().describe("Label names to remove"),
    project: name('Project name in the issue\'s space, or "none"').optional(),
    dueDate: z
      .union([dueDate, z.null()])
      .optional()
      .describe("Due date, YYYY-MM-DD, or null to clear it"),
  }),
  get_workspace: z.object({}),
  search_issues: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(`Words from the title, or an issue key like ${KEY}-42`),
    space: spaceKey.optional(),
    project: name("Project name inside `space` (needs `space`)").optional(),
  }),
  create_space: z.object({
    name: name("Space name, like the product or client"),
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(
        SPACE_KEY_PATTERN,
        "Keys are 2–10 letters or digits and start with a letter, like PAN or WEB2.",
      )
      .describe(
        "Issue key prefix: 2–10 letters or digits starting with a letter (WEB → WEB-1). Fixed forever",
      ),
    kind: spaceKind.optional(),
  }),
  update_space: z.object({
    space: spaceKey,
    name: name("New name").optional(),
    kind: spaceKind.optional(),
  }),
  update_space_context: z.object({
    space: spaceKey,
    body: markdown("The whole new context doc in markdown; it replaces the old one", 100_000),
  }),
  create_project: z.object({
    space: spaceKey,
    name: z.string().trim().min(1).max(60).describe("Project name, unique in the space"),
    color: color.optional(),
  }),
  update_project: z.object({
    space: spaceKey,
    project: name("The project's current name"),
    name: z.string().trim().min(1).max(60).optional().describe("New name"),
    color: z
      .union([color, z.null()])
      .optional()
      .describe(`New colour (${PALETTE.join(", ")}), or null for none`),
  }),
  archive_project: z.object({
    space: spaceKey,
    project: name("The project's name"),
  }),
  unarchive_project: z.object({
    space: spaceKey,
    project: name("The archived project's name"),
    name: z
      .string()
      .trim()
      .min(1)
      .max(60)
      .optional()
      .describe("Restore it under this name instead (when an active project already has its name)"),
  }),
  delete_issue: z.object({
    key: issueKey,
    confirm: z
      .string()
      .trim()
      .min(1)
      .describe(`The issue's key again, like ${KEY}-42; anything else deletes nothing`),
  }),
  update_status: z.object({
    status: name(`The status's current name, like "In Review"`),
    name: z.string().trim().min(1).max(40).optional().describe("New name, unique in the workspace"),
    color: z
      .union([color, z.literal("default")])
      .optional()
      .describe(`New colour: ${PALETTE.join(", ")}, or "default" for the category's own colour`),
  }),
  reorder_statuses: z.object({
    statuses: z
      .array(name("Status name"))
      .min(1)
      .max(20)
      .describe(
        "Every status name exactly once, in the new order (first = first list group and board column)",
      ),
  }),
  create_label: z.object({
    name: z.string().trim().min(1).max(40).describe("Label name, unique in the workspace"),
    color: color.optional(),
  }),
};

// ---------------------------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------------------------

const json = (data: unknown): CallToolResult => ({
  content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
});
const failure = (message: string): CallToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** A ConvexError's message (what our functions raise on purpose), else null. */
function userMessage(err: unknown): string | null {
  const data = (err as { data?: unknown } | null)?.data;
  if (
    data &&
    typeof data === "object" &&
    typeof (data as { message?: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return null;
}

type Links = { issue: (key: string) => string; space: (key: string) => string };
type Run<S extends z.ZodType> = (
  args: z.infer<S>,
  call: { token: string; backend: Backend; links: Links },
) => Promise<unknown>;

type ToolDef<S extends z.ZodType> = {
  title: string;
  description: string;
  readOnly: boolean;
  /** Changes that can't be undone (deleting). */
  destructive?: boolean;
  schema: S;
  run: Run<S>;
};

const tool = <S extends z.ZodType>(def: ToolDef<S>) => def;

export const tools = {
  get_issue: tool({
    title: "Get issue",
    description: `Read one issue by key (like ${KEY}-42): title, markdown description, status, priority, assignee, labels, space, project, parent, sub-issues and the last 50 comments. ${READ_FIRST}`,
    readOnly: true,
    schema: schemas.get_issue,
    run: async ({ key }, { token, backend, links }) => {
      const issue = await backend.query(api.mcp.getIssue, { token, key });
      return { ...issue, url: links.issue(issue.key) };
    },
  }),
  get_space_context: tool({
    title: "Get space context",
    description: `Read a space's context doc (what it is, how to work in it, conventions) and its project names. Call this first, before starting work on any issue in the space: the space is the part of the issue key before the dash (${KEY}-42 → ${KEY}).`,
    readOnly: true,
    schema: schemas.get_space_context,
    run: ({ space }, { token, backend }) =>
      backend.query(api.mcp.getSpaceContext, { token, space }),
  }),
  list_issues: tool({
    title: "List issues",
    description: `List issues, newest first. Filter by space key, project name (needs space; "none" for no project), status name, category, assignee ("me", "none" or a name), label or priority. ${READ_FIRST}`,
    readOnly: true,
    schema: schemas.list_issues,
    run: async (args, { token, backend, links }) => {
      const rows = await backend.query(
        api.mcp.listIssues,
        defined({ token, ...args, priority: toPriority(args.priority) }),
      );
      return rows.map((row) => ({ ...row, url: links.issue(row.key) }));
    },
  }),
  create_issue: tool({
    title: "Create issue",
    description: `Create an issue in a space (by key), optionally in one of its projects (by name). Status defaults to Todo; labels must already exist. Returns the new key and its link. ${READ_FIRST}`,
    readOnly: false,
    schema: schemas.create_issue,
    run: async (args, { token, backend, links }) => {
      const created = await backend.mutation(
        api.mcp.createIssue,
        defined({ token, ...args, priority: toPriority(args.priority) }),
      );
      return { ...created, url: links.issue(created.key) };
    },
  }),
  create_sub_issue: tool({
    title: "Create sub-issue",
    description: `Add a sub-issue under a parent issue, for follow-ups and split-out work. It takes the parent's space and project. Sub-issues are one level deep, so the parent can't be a sub-issue itself. ${READ_FIRST}`,
    readOnly: false,
    schema: schemas.create_sub_issue,
    run: async (args, { token, backend, links }) => {
      const created = await backend.mutation(
        api.mcp.createSubIssue,
        defined({ token, ...args, priority: toPriority(args.priority) }),
      );
      return { ...created, url: links.issue(created.key) };
    },
  }),
  add_comment: tool({
    title: "Add comment",
    description: `Comment on an issue in markdown: progress notes, findings, questions, handoffs. It shows under the token owner's name, tagged "via MCP". ${READ_FIRST}`,
    readOnly: false,
    schema: schemas.add_comment,
    run: async ({ key, body }, { token, backend, links }) => {
      const result = await backend.mutation(api.mcp.addComment, { token, key, body });
      return {
        key: result.key,
        commentId: result.commentId,
        url: `${links.issue(result.key)}#comment-${result.commentId}`,
      };
    },
  }),
  update_issue: tool({
    title: "Update issue",
    description: `Change an issue's title, markdown description, status (by name, like "In Progress" or "In Review"), priority, assignee, labels (add or remove by name), project (by name, or "none") or due date (null clears it). Give at least one; each change is logged. A sub-issue always follows its parent's project. This moves one issue; renaming or reordering the statuses themselves is update_status / reorder_statuses. Nothing changes status automatically: move the issue yourself when you start and when you finish. ${READ_FIRST}`,
    readOnly: false,
    schema: schemas.update_issue,
    run: async (args, { token, backend, links }) => {
      const row = await backend.mutation(
        api.mcp.updateIssue,
        defined({ token, ...args, priority: toPriority(args.priority) }),
      );
      return { ...row, url: links.issue(row.key) };
    },
  }),
  get_workspace: tool({
    title: "Get workspace",
    description: `Orient yourself: the workspace's mode (what it works on: "product", "client" or "both"), every space (key, name, kind, archived) with its projects, the statuses in order, the labels and the members (you are marked "me"). Call this first when you're organising work or don't know the names to use.`,
    readOnly: true,
    schema: schemas.get_workspace,
    run: async (_args, { token, backend, links }) => {
      const workspace = await backend.query(api.mcp.getWorkspace, { token });
      return {
        ...workspace,
        spaces: workspace.spaces.map((space) => ({ ...space, url: links.space(space.key) })),
      };
    },
  }),
  search_issues: tool({
    title: "Search issues",
    description: `Find issues by title words or key (an exact key like ${KEY}-42 comes first), like the app's search. Optionally narrow to a space, and a project in it. Up to 20 results. ${READ_FIRST}`,
    readOnly: true,
    schema: schemas.search_issues,
    run: async (args, { token, backend, links }) => {
      const rows = await backend.query(api.mcp.searchIssues, defined({ token, ...args }));
      return rows.map((row) => ({ ...row, url: links.issue(row.key) }));
    },
  }),
  create_space: tool({
    title: "Create space",
    description: `Create a space (a product or a client) with its key and a starter context doc, which you can then rewrite with update_space_context. The key prefixes its issue keys and can never change. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.create_space,
    run: async (args, { token, backend, links }) => {
      const created = await backend.mutation(api.mcp.createSpace, defined({ token, ...args }));
      return { ...created, url: links.space(created.key) };
    },
  }),
  update_space: tool({
    title: "Update space",
    description: `Rename a space or change its kind. Its key stays the same. Archiving or deleting spaces isn't available over MCP. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.update_space,
    run: async (args, { token, backend, links }) => {
      const updated = await backend.mutation(api.mcp.updateSpace, defined({ token, ...args }));
      return { ...updated, url: links.space(updated.key) };
    },
  }),
  update_space_context: tool({
    title: "Update space context",
    description: `Replace a space's context doc (what it is, how to work in it, conventions) with new markdown. It replaces the whole doc: read it with get_space_context first and keep what still holds.`,
    readOnly: false,
    schema: schemas.update_space_context,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.updateSpaceContext, { token, ...args }),
  }),
  create_project: tool({
    title: "Create project",
    description: `Create a project (a workstream like "Launch" or "LinkedIn") in a space. Without a colour it gets the next one in the app's rotation. Then put issues in it with create_issue or update_issue { project }. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.create_project,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.createProject, defined({ token, ...args })),
  }),
  update_project: tool({
    title: "Update project",
    description: `Rename or recolour a project in a space (color null removes it). ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.update_project,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.updateProject, defined({ token, ...args })),
  }),
  archive_project: tool({
    title: "Archive project",
    description: `Archive a project: it disappears from the app's sidebar and pickers, and its issues stay in the space with no project. unarchive_project brings the project back, but not its issues: they stay without a project. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.archive_project,
    run: (args, { token, backend }) => backend.mutation(api.mcp.archiveProject, { token, ...args }),
  }),
  unarchive_project: tool({
    title: "Unarchive project",
    description: `Restore an archived project to the end of its space's project list. Issues that lost it when it was archived stay without a project; move them back with update_issue { project }. If an active project already has its name, pass name to restore it under a new one. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.unarchive_project,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.unarchiveProject, defined({ token, ...args })),
  }),
  delete_issue: tool({
    title: "Delete issue",
    description: `Permanently delete an issue together with its sub-issues, comments and activity. This can't be undone. Ask the person first, unless they explicitly asked you to delete this issue. confirm must repeat the issue's key; anything else deletes nothing. To finish or drop an issue instead, move it to a done or canceled status with update_issue. ${READ_FIRST}`,
    readOnly: false,
    destructive: true,
    schema: schemas.delete_issue,
    run: (args, { token, backend }) => backend.mutation(api.mcp.deleteIssue, { token, ...args }),
  }),
  update_status: tool({
    title: "Update status",
    description: `Rename or recolour one of the workspace's six statuses: the definition everyone sees (list groups, board columns, pickers), not one issue's status. To move an issue to a status, use update_issue { status } instead. Statuses can't be added or removed. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.update_status,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.updateStatus, defined({ token, ...args })),
  }),
  reorder_statuses: tool({
    title: "Reorder statuses",
    description: `Put the workspace's statuses in a new order (the order of list groups and board columns, for everyone). List every status name exactly once. This doesn't move any issue; use update_issue { status } for that. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.reorder_statuses,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.reorderStatuses, { token, ...args }),
  }),
  create_label: tool({
    title: "Create label",
    description: `Create a workspace label (gray unless you pick a colour). Other tools never create labels on the fly, so create one here first if it's missing. ${ORIENT_FIRST}`,
    readOnly: false,
    schema: schemas.create_label,
    run: (args, { token, backend }) =>
      backend.mutation(api.mcp.createLabel, defined({ token, ...args })),
  }),
};

export type ToolName = keyof typeof tools;

/**
 * Registers every tool on `server`. Each call reads the token and the instance URL from
 * `ctx.http.authInfo` (set by `withMcpAuth` + `createVerifyToken`) and passes the raw token to Convex,
 * which re-checks it: the Convex functions are public.
 */
export function registerTools(server: McpServer, { backend }: { backend: Backend }) {
  for (const [toolName, def] of Object.entries(tools) as [ToolName, ToolDef<z.ZodType>][]) {
    server.registerTool(
      toolName,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.schema,
        annotations: {
          readOnlyHint: def.readOnly,
          destructiveHint: def.destructive ?? false,
          openWorldHint: false,
        },
      },
      async (args: unknown, ctx: ServerContext): Promise<CallToolResult> => {
        const auth = ctx.http?.authInfo;
        const extra = auth?.extra as PantryAuthExtra | undefined;
        if (!auth?.token || !extra)
          return failure(`Send your ${brand.name} API token as "Authorization: Bearer <token>".`);
        const links: Links = {
          issue: (key) => `${extra.appUrl}/issues/${encodeURIComponent(key)}`,
          space: (key) => `${extra.appUrl}/spaces/${encodeURIComponent(key)}`,
        };
        try {
          return json(await def.run(args, { token: auth.token, backend, links }));
        } catch (err) {
          const message = userMessage(err);
          if (message) return failure(message);
          console.error(`MCP tool ${toolName} failed:`, err);
          return failure(
            `${brand.name} couldn't complete ${toolName} because of a server error. Try again in a moment.`,
          );
        }
      },
    );
  }
}
