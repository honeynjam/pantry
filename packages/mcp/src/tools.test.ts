import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { ConvexError } from "convex/values";
import { getFunctionName } from "convex/server";
import { createMcpHandler, withMcpAuth } from "mcp-handler";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PantryAuthExtra } from "./auth";
import type { Backend } from "./backend";
import { registerTools, SERVER_INSTRUCTIONS, type ToolName } from "./tools";

const TOKEN = "pan_test-token";
const extra: PantryAuthExtra = {
  tokenId: "token1",
  memberId: "member1",
  workspaceId: "ws1",
  userId: "user1",
  displayName: "Kris",
  appUrl: "https://pantry.example.com",
};
const stubAuth: AuthInfo = { token: TOKEN, clientId: "token1", scopes: [], extra };

type Call = { fn: string; args: Record<string, unknown> };

/** A fake Convex: answers by function name ("mcp:getIssue") and records every call. */
function fakeBackend(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: Call[] = [];
  const answer = async (fn: Parameters<Backend["query"]>[0], args: Record<string, unknown>) => {
    const name = getFunctionName(fn);
    calls.push({ fn: name, args });
    const handler = answers[name];
    if (!handler) throw new Error(`unexpected call to ${name}`);
    return handler(args);
  };
  const backend = { query: answer, mutation: answer } as unknown as Backend;
  return { backend, calls };
}

/** A real MCP client talking to the real handler in-process, with the stub authInfo. */
async function connect(backend: Backend, auth: AuthInfo | null = stubAuth) {
  const handler = withMcpAuth(
    createMcpHandler((server) => registerTools(server, { backend }), {
      serverInfo: { name: "Pantry", version: "0.0.0" },
      instructions: SERVER_INSTRUCTIONS,
    }),
    async () => auth ?? undefined,
    { required: true },
  );
  const client = new Client({ name: "test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(
    new URL("https://pantry.example.com/api/mcp"),
    {
      fetch: (url, init) => handler(new Request(url, init)),
    },
  );
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: ToolName, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]!.text;
  return {
    isError: result.isError === true,
    text,
    json: () => JSON.parse(text) as Record<string, unknown>,
  };
}

const userError = (message: string) => new ConvexError({ code: "UNKNOWN_STATUS", message });

describe("tools/list", () => {
  it("lists the twenty tools, each telling the agent what to read first", async () => {
    const client = await connect(fakeBackend({}).backend);
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "add_comment",
      "archive_project",
      "create_issue",
      "create_label",
      "create_project",
      "create_space",
      "create_sub_issue",
      "delete_issue",
      "get_issue",
      "get_space_context",
      "get_workspace",
      "list_issues",
      "reorder_statuses",
      "search_issues",
      "unarchive_project",
      "update_issue",
      "update_project",
      "update_space",
      "update_space_context",
      "update_status",
    ]);
    for (const tool of tools) {
      expect(tool.inputSchema.type).toBe("object");
      expect(tool.description).toMatch(
        ["get_space_context", "get_workspace"].includes(tool.name)
          ? /Call this first/
          : /(Call|with) get_(space_context|workspace)/,
      );
    }
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    expect(byName.get_issue!.annotations?.readOnlyHint).toBe(true);
    expect(byName.update_issue!.annotations?.readOnlyHint).toBe(false);
    expect(Object.keys(byName.create_issue!.inputSchema.properties ?? {})).toEqual([
      "space",
      "project",
      "title",
      "description",
      "status",
      "priority",
      "assignee",
      "labels",
      "dueDate",
    ]);
    expect(byName.create_issue!.inputSchema.required).toEqual(["space", "title"]);
    expect(byName.archive_project!.annotations?.destructiveHint).toBe(false);
    expect(byName.delete_issue!.annotations?.destructiveHint).toBe(true);
    expect(byName.delete_issue!.description).toMatch(/can't be undone\. Ask the person first/);
    expect(byName.update_status!.description).toMatch(/use update_issue \{ status \} instead/);
    expect(byName.update_issue!.description).toMatch(/update_status \/ reorder_statuses/);
    expect(byName.create_project!.annotations?.destructiveHint).toBe(false);
    expect(byName.create_project!.inputSchema.properties?.color).toMatchObject({
      enum: [
        "gray",
        "red",
        "orange",
        "yellow",
        "lime",
        "green",
        "teal",
        "blue",
        "indigo",
        "violet",
        "pink",
      ],
    });
    expect(client.getInstructions()).toMatch(/call get_issue and then get_space_context/);
    expect(client.getInstructions()).toMatch(/Call get_workspace first/);
    expect(client.getInstructions()).toMatch(
      /Not available over MCP: deleting spaces, comments or labels/,
    );
  });
});

describe("each tool passes the token to its Convex function", () => {
  it("get_issue", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:getIssue": () => ({ key: "PAN-42", title: "Fix it" }),
    });
    const result = await call(await connect(backend), "get_issue", { key: "pan-42" });
    expect(calls).toEqual([{ fn: "mcp:getIssue", args: { token: TOKEN, key: "PAN-42" } }]);
    expect(result.json()).toEqual({
      key: "PAN-42",
      title: "Fix it",
      url: "https://pantry.example.com/issues/PAN-42",
    });
  });

  it("get_space_context", async () => {
    const context = {
      space: { key: "PAN", name: "Pantry", kind: "product" },
      projects: [],
      context: "# Hi",
      updatedAt: null,
      updatedBy: null,
    };
    const { backend, calls } = fakeBackend({ "mcp:getSpaceContext": () => context });
    const result = await call(await connect(backend), "get_space_context", { space: " PAN " });
    expect(calls).toEqual([{ fn: "mcp:getSpaceContext", args: { token: TOKEN, space: "PAN" } }]);
    expect(result.json()).toEqual(context);
  });

  it("list_issues, with priority names turned into numbers and unset filters left out", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:listIssues": () => [{ key: "PAN-1" }, { key: "WEB-2" }],
    });
    const result = await call(await connect(backend), "list_issues", {
      space: "PAN",
      assignee: "me",
      priority: "urgent",
      limit: 5,
    });
    expect(calls).toEqual([
      {
        fn: "mcp:listIssues",
        args: { token: TOKEN, space: "PAN", assignee: "me", priority: 1, limit: 5 },
      },
    ]);
    expect(result.json()).toEqual([
      { key: "PAN-1", url: "https://pantry.example.com/issues/PAN-1" },
      { key: "WEB-2", url: "https://pantry.example.com/issues/WEB-2" },
    ]);
  });

  it("create_issue", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:createIssue": () => ({ key: "PAN-7", space: "PAN", project: "Launch" }),
    });
    const args = {
      space: "PAN",
      project: "Launch",
      title: "New",
      labels: ["Bug"],
      priority: 3,
      dueDate: "2026-11-30",
    };
    const result = await call(await connect(backend), "create_issue", args);
    expect(calls).toEqual([{ fn: "mcp:createIssue", args: { token: TOKEN, ...args } }]);
    expect(result.json()).toEqual({
      key: "PAN-7",
      space: "PAN",
      project: "Launch",
      url: "https://pantry.example.com/issues/PAN-7",
    });
  });

  it("create_sub_issue", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:createSubIssue": () => ({
        key: "PAN-8",
        parent: "PAN-7",
        space: "PAN",
        project: "Launch",
      }),
    });
    const result = await call(await connect(backend), "create_sub_issue", {
      parent: "PAN-7",
      title: "Child",
      priority: "low",
    });
    expect(calls).toEqual([
      {
        fn: "mcp:createSubIssue",
        args: { token: TOKEN, parent: "PAN-7", title: "Child", priority: 4 },
      },
    ]);
    expect(result.json()).toMatchObject({
      key: "PAN-8",
      parent: "PAN-7",
      url: "https://pantry.example.com/issues/PAN-8",
    });
  });

  it("add_comment", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:addComment": () => ({ key: "PAN-7", commentId: "c1" }),
    });
    const result = await call(await connect(backend), "add_comment", {
      key: "PAN-7",
      body: "Done **step 1**.",
    });
    expect(calls).toEqual([
      { fn: "mcp:addComment", args: { token: TOKEN, key: "PAN-7", body: "Done **step 1**." } },
    ]);
    expect(result.json()).toEqual({
      key: "PAN-7",
      commentId: "c1",
      url: "https://pantry.example.com/issues/PAN-7#comment-c1",
    });
  });

  it("update_issue", async () => {
    const { backend, calls } = fakeBackend({
      "mcp:updateIssue": () => ({ key: "PAN-7", status: "In Review" }),
    });
    const result = await call(await connect(backend), "update_issue", {
      key: "PAN-7",
      status: "In Review",
      removeLabels: ["Bug"],
    });
    expect(calls).toEqual([
      {
        fn: "mcp:updateIssue",
        args: { token: TOKEN, key: "PAN-7", status: "In Review", removeLabels: ["Bug"] },
      },
    ]);
    expect(result.json()).toEqual({
      key: "PAN-7",
      status: "In Review",
      url: "https://pantry.example.com/issues/PAN-7",
    });
  });
});

describe("the organising tools pass the token to their Convex function", () => {
  const cases: [ToolName, Record<string, unknown>, string, Record<string, unknown>, unknown][] = [
    [
      "search_issues",
      { query: "login", space: "PAN" },
      "mcp:searchIssues",
      { query: "login", space: "PAN" },
      [{ key: "PAN-1" }],
    ],
    [
      "create_space",
      { name: "Acme", key: "acme", kind: "client" },
      "mcp:createSpace",
      { name: "Acme", key: "ACME", kind: "client" },
      { key: "ACME", name: "Acme", kind: "client" },
    ],
    [
      "update_space",
      { space: "WEB", name: "Site" },
      "mcp:updateSpace",
      { space: "WEB", name: "Site" },
      { key: "WEB", name: "Site", kind: "product" },
    ],
    [
      "update_space_context",
      { space: "PAN", body: "# Hi" },
      "mcp:updateSpaceContext",
      { space: "PAN", body: "# Hi" },
      { space: "PAN" },
    ],
    [
      "create_project",
      { space: "PAN", name: "Launch", color: "teal" },
      "mcp:createProject",
      { space: "PAN", name: "Launch", color: "teal" },
      { space: "PAN", name: "Launch", color: "teal" },
    ],
    [
      "update_project",
      { space: "PAN", project: "Launch", color: null },
      "mcp:updateProject",
      { space: "PAN", project: "Launch", color: null },
      { space: "PAN", name: "Launch", color: null },
    ],
    [
      "archive_project",
      { space: "PAN", project: "Launch" },
      "mcp:archiveProject",
      { space: "PAN", project: "Launch" },
      { space: "PAN", project: "Launch", archived: true, issuesMoved: 2 },
    ],
    [
      "create_label",
      { name: "Perf" },
      "mcp:createLabel",
      { name: "Perf" },
      { name: "Perf", color: "gray" },
    ],
    [
      "unarchive_project",
      { space: "PAN", project: "Launch", name: "Launch (old)" },
      "mcp:unarchiveProject",
      { space: "PAN", project: "Launch", name: "Launch (old)" },
      { space: "PAN", project: "Launch (old)", color: null, archived: false },
    ],
    [
      "delete_issue",
      { key: "pan-7", confirm: "PAN-7" },
      "mcp:deleteIssue",
      { key: "PAN-7", confirm: "PAN-7" },
      { deleted: "PAN-7", title: "Old", subIssues: ["PAN-8"], comments: 2 },
    ],
    [
      "update_status",
      { status: "Todo", name: "To do", color: "default" },
      "mcp:updateStatus",
      { status: "Todo", name: "To do", color: "default" },
      { name: "To do", category: "unstarted", color: "#9b9ea6" },
    ],
    [
      "reorder_statuses",
      { statuses: ["Todo", "Backlog"] },
      "mcp:reorderStatuses",
      { statuses: ["Todo", "Backlog"] },
      [{ name: "Todo", category: "unstarted", color: "#9b9ea6" }],
    ],
  ];
  for (const [name, args, fn, sent, answer] of cases) {
    it(name, async () => {
      const { backend, calls } = fakeBackend({ [fn]: () => answer });
      const result = await call(await connect(backend), name, args);
      expect(result.isError).toBe(false);
      expect(calls).toEqual([{ fn, args: { token: TOKEN, ...sent } }]);
      const urls = {
        create_space: "https://pantry.example.com/spaces/ACME",
        update_space: "https://pantry.example.com/spaces/WEB",
      } as Record<string, string>;
      const expected =
        name === "search_issues"
          ? [{ key: "PAN-1", url: "https://pantry.example.com/issues/PAN-1" }]
          : urls[name]
            ? { ...(answer as object), url: urls[name] }
            : answer;
      expect(result.json()).toEqual(expected);
    });
  }

  it("get_workspace adds each space's link", async () => {
    const workspace = {
      workspace: "Home",
      you: "Kris",
      spaces: [{ key: "PAN", name: "Pantry" }],
      statuses: [],
      labels: [],
      members: [],
    };
    const { backend, calls } = fakeBackend({ "mcp:getWorkspace": () => workspace });
    const result = await call(await connect(backend), "get_workspace", {});
    expect(calls).toEqual([{ fn: "mcp:getWorkspace", args: { token: TOKEN } }]);
    expect(result.json()).toEqual({
      ...workspace,
      spaces: [{ key: "PAN", name: "Pantry", url: "https://pantry.example.com/spaces/PAN" }],
    });
  });

  it("update_issue passes title, description and a null due date through", async () => {
    const { backend, calls } = fakeBackend({ "mcp:updateIssue": () => ({ key: "PAN-7" }) });
    await call(await connect(backend), "update_issue", {
      key: "PAN-7",
      title: "New",
      description: "## Hi",
      dueDate: null,
    });
    expect(calls).toEqual([
      {
        fn: "mcp:updateIssue",
        args: { token: TOKEN, key: "PAN-7", title: "New", description: "## Hi", dueDate: null },
      },
    ]);
  });
});

describe("errors", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a refusal from Convex comes back as isError with its valid-values message", async () => {
    const message =
      'No status "Doing". Statuses: "Backlog", "Todo", "In Progress", "In Review", "Done", "Canceled".';
    const { backend } = fakeBackend({
      "mcp:updateIssue": () => {
        throw userError(message);
      },
    });
    const result = await call(await connect(backend), "update_issue", {
      key: "PAN-7",
      status: "Doing",
    });
    expect(result).toMatchObject({ isError: true, text: message });
  });

  it("bad input is refused before Convex is called", async () => {
    const { backend, calls } = fakeBackend({});
    const client = await connect(backend);
    for (const [name, args] of [
      ["get_issue", { key: "PAN42" }],
      ["create_issue", { space: "PAN", title: "" }],
      ["create_issue", { space: "PAN", title: "x", priority: "highest" }],
      ["add_comment", { key: "PAN-1", body: "" }],
      ["list_issues", { limit: 500 }],
      ["create_space", { name: "X", key: "1AB" }],
      ["create_project", { space: "PAN", name: "X", color: "#ff0000" }],
      ["create_label", { name: "X", color: "beige" }],
      ["delete_issue", { key: "PAN-1" }],
      ["delete_issue", { key: "PAN-1", confirm: "" }],
      ["update_status", { status: "Todo", color: "#ffffff" }],
      ["reorder_statuses", { statuses: [] }],
      ["update_issue", { key: "PAN-1", dueDate: "tomorrow" }],
      ["search_issues", { query: "" }],
    ] as const) {
      const result = await call(client, name, args);
      expect(result.isError, `${name} ${JSON.stringify(args)}`).toBe(true);
    }
    expect(calls).toEqual([]);
  });

  it("an unexpected server error is reported without its internals", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { backend } = fakeBackend({
      "mcp:getIssue": () => {
        throw new Error("[Request ID: abc] Server Error");
      },
    });
    const result = await call(await connect(backend), "get_issue", { key: "PAN-1" });
    expect(result.isError).toBe(true);
    expect(result.text).toBe(
      "Pantry couldn't complete get_issue because of a server error. Try again in a moment.",
    );
  });

  it("a request without a token gets 401 from withMcpAuth", async () => {
    const { backend } = fakeBackend({});
    await expect(connect(backend, null)).rejects.toThrow(/401|nauthorized|No authorization/i);
  });
});
