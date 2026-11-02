import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

// The Convex client the route builds: answers mcp.verifyToken from `tokens`, records every call.
const LIVE = "pan_live-token";
const tokens = new Map<string, object | null>();
const calls: { fn: string; args: Record<string, unknown> }[] = [];
vi.mock("convex/browser", async () => {
  const { getFunctionName } = await import("convex/server");
  return {
    ConvexHttpClient: function ConvexHttpClient() {
      const answer = async (fn: never, args: Record<string, unknown>) => {
        const name = getFunctionName(fn);
        calls.push({ fn: name, args });
        if (name === "mcp:verifyToken") return tokens.get(args.token as string) ?? null;
        if (name === "mcp:touchToken") return true;
        if (name === "mcp:getIssue") return { key: args.key, title: "Fix it" };
        throw new Error(`unexpected ${name}`);
      };
      return { query: answer, mutation: answer };
    },
  };
});

const owner = {
  tokenId: "t1",
  memberId: "m1",
  workspaceId: "w1",
  userId: "u1",
  displayName: "Kris",
  lastUsedAt: Date.now(),
};

function rpc(body: object, token?: string) {
  return new Request("https://pantry.example.com/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": "2025-11-25",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, ...body }),
  });
}

const getIssue = {
  method: "tools/call",
  params: { name: "get_issue", arguments: { key: "PAN-1" } },
};

/** The JSON-RPC message in a JSON or single-event SSE response. */
async function message(res: Response) {
  const text = await res.text();
  const data = text.startsWith("{")
    ? text
    : text
        .split("\n")
        .find((line) => line.startsWith("data: "))!
        .slice(6);
  return JSON.parse(data) as { result?: { content: { text: string }[]; isError?: boolean } };
}

describe("POST /api/mcp", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://happy-cat-123.convex.cloud");
    tokens.clear();
    tokens.set(LIVE, owner);
    calls.length = 0;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("answers 401 without a token, and never runs a tool", async () => {
    const res = await POST(rpc(getIssue));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toMatch(/^Bearer /);
    // OAuth clients (Claude, ChatGPT) find the authorization server from here.
    expect(res.headers.get("www-authenticate")).toContain(
      'resource_metadata="https://pantry.example.com/.well-known/oauth-protected-resource/api/mcp"',
    );
    expect(calls).toEqual([]);
  });

  it("answers 401 for a revoked or unknown token", async () => {
    const res = await POST(rpc(getIssue, "pan_revoked"));
    expect(res.status).toBe(401);
    expect(calls.map((call) => call.fn)).toEqual(["mcp:verifyToken"]);
  });

  it("runs the tool as the token's owner with a live token", async () => {
    const res = await POST(rpc(getIssue, LIVE));
    expect(res.status).toBe(200);
    const { result } = await message(res);
    expect(JSON.parse(result!.content[0]!.text)).toEqual({
      key: "PAN-1",
      title: "Fix it",
      url: "https://pantry.example.com/issues/PAN-1",
    });
    expect(calls).toEqual([
      { fn: "mcp:verifyToken", args: { token: LIVE } },
      { fn: "mcp:getIssue", args: { token: LIVE, key: "PAN-1" } },
    ]);
  });

  it("answers 503 when built without a Convex URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "");
    expect((await POST(rpc(getIssue, LIVE))).status).toBe(503);
  });
});
