import { describe, expect, it } from "vitest";
import { GET as authorizationServer } from "../oauth-authorization-server/route";
import { GET as forMcp } from "./api/mcp/route";
import { GET as root } from "./route";

// The discovery documents Claude and ChatGPT read after the 401 from /api/mcp. They come from the
// request's public origin (x-forwarded-host on Vercel), and need no Convex.
describe("OAuth discovery", () => {
  const req = (path: string) =>
    new Request(`http://internal:3000${path}`, {
      headers: { "x-forwarded-host": "pantry.example.com", "x-forwarded-proto": "https" },
    });

  it("serves the same protected resource metadata at both paths", async () => {
    for (const [handler, path] of [
      [forMcp, "/.well-known/oauth-protected-resource/api/mcp"],
      [root, "/.well-known/oauth-protected-resource"],
    ] as const) {
      const res = handler(req(path));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        resource: "https://pantry.example.com/api/mcp",
        authorization_servers: ["https://pantry.example.com"],
      });
    }
  });

  it("serves authorization server metadata whose issuer is the public origin", async () => {
    const res = authorizationServer(req("/.well-known/oauth-authorization-server"));
    expect(await res.json()).toMatchObject({
      issuer: "https://pantry.example.com",
      token_endpoint: "https://pantry.example.com/api/oauth/token",
    });
  });
});
