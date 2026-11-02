import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";
import type { Backend } from "./backend";
import { createOAuthHandlers } from "./oauth";

const ORIGIN = "https://pantry.example.com";

/** A fake Convex: answers by function name, records what it was asked. */
function fake(answers: Record<string, (args: Record<string, unknown>) => unknown>) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const answer = async (fn: never, args: Record<string, unknown>) => {
    const name = getFunctionName(fn);
    calls.push({ fn: name, args });
    const handler = answers[name];
    if (!handler) throw new Error(`unexpected ${name}`);
    return handler(args);
  };
  const backend = { query: answer, mutation: answer, action: answer } as unknown as Backend;
  return { handlers: createOAuthHandlers(backend, { origin: () => ORIGIN }), calls };
}

const form = (path: string, body: Record<string, string>, headers: Record<string, string> = {}) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(body).toString(),
  });

describe("discovery", () => {
  it("protected resource metadata names /api/mcp and this origin as the issuer", async () => {
    const { handlers } = fake({});
    const res = handlers.protectedResource(new Request(`${ORIGIN}/.well-known/x`));
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toEqual({
      resource: `${ORIGIN}/api/mcp`,
      authorization_servers: [ORIGIN],
      bearer_methods_supported: ["header"],
      resource_name: "Pantry",
    });
  });

  it("authorization server metadata advertises what Claude and ChatGPT check for", async () => {
    const { handlers } = fake({});
    const meta = await handlers.authorizationServer(new Request(ORIGIN)).json();
    expect(meta).toMatchObject({
      issuer: ORIGIN,
      authorization_endpoint: `${ORIGIN}/api/oauth/authorize`,
      token_endpoint: `${ORIGIN}/api/oauth/token`,
      registration_endpoint: `${ORIGIN}/api/oauth/register`,
      revocation_endpoint: `${ORIGIN}/api/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
      grant_types_supported: ["authorization_code", "refresh_token"],
    });
    // No OIDC scopes: ChatGPT would request them by default.
    expect(meta).not.toHaveProperty("scopes_supported");
  });
});

describe("authorize", () => {
  const url = `${ORIGIN}/api/oauth/authorize?client_id=c1&response_type=code&state=s`;

  it("sends the browser to the consent screen with the parked request", async () => {
    const { handlers, calls } = fake({
      "oauth:startAuthorization": () => ({ kind: "consent", requestId: "req1" }),
    });
    const res = await handlers.authorize(new Request(url));
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/oauth/consent?request=req1`);
    expect(calls[0]!.args).toEqual({
      params: { client_id: "c1", response_type: "code", state: "s" },
      origin: ORIGIN,
    });
  });

  it("sends errors the app can handle back to it, and shows the rest", async () => {
    const back = fake({
      "oauth:startAuthorization": () => ({
        kind: "redirect",
        url: "https://claude.ai/api/mcp/auth_callback?error=invalid_request",
      }),
    });
    const res = await back.handlers.authorize(new Request(url));
    expect(res.headers.get("location")).toBe(
      "https://claude.ai/api/mcp/auth_callback?error=invalid_request",
    );

    const shown = fake({
      "oauth:startAuthorization": () => ({
        kind: "error",
        error: "invalid_client",
        error_description: "This app isn't registered.",
      }),
    });
    const location = new URL(
      (await shown.handlers.authorize(new Request(url))).headers.get("location")!,
    );
    expect(location.pathname).toBe("/oauth/consent");
    expect(location.searchParams.get("error")).toBe("invalid_client");
    expect(location.searchParams.get("error_description")).toBe("This app isn't registered.");
  });
});

describe("token", () => {
  const tokens = {
    access_token: "pan_a",
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "pan_rt_b",
  };

  it("reads the form body, answers JSON with no-store", async () => {
    const { handlers, calls } = fake({ "oauth:token": () => ({ ok: true, tokens }) });
    const res = await handlers.token(
      form("/api/oauth/token", { grant_type: "authorization_code", code: "c", client_id: "x" }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(tokens);
    expect(calls[0]!.args).toEqual({
      params: { grant_type: "authorization_code", code: "c", client_id: "x" },
      origin: ORIGIN,
    });
  });

  it("takes client_id from HTTP Basic, and accepts JSON bodies", async () => {
    const { handlers, calls } = fake({ "oauth:token": () => ({ ok: true, tokens }) });
    await handlers.token(
      form(
        "/api/oauth/token",
        { grant_type: "refresh_token", refresh_token: "r" },
        {
          authorization: `Basic ${btoa("client%201:")}`,
        },
      ),
    );
    expect(calls[0]!.args.params).toMatchObject({ client_id: "client 1" });

    await handlers.token(
      new Request(`${ORIGIN}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "refresh_token", refresh_token: "r", n: 1 }),
      }),
    );
    expect(calls[1]!.args.params).toEqual({ grant_type: "refresh_token", refresh_token: "r" });
  });

  it("maps OAuth errors to 400 (401 for invalid_client) and refuses repeated parameters", async () => {
    const { handlers } = fake({
      "oauth:token": ({ params }) =>
        (params as Record<string, string>).code === "bad-client"
          ? { ok: false, error: "invalid_client", error_description: "no" }
          : { ok: false, error: "invalid_grant", error_description: "no" },
    });
    const bad = await handlers.token(form("/api/oauth/token", { code: "x" }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_grant", error_description: "no" });
    expect((await handlers.token(form("/api/oauth/token", { code: "bad-client" }))).status).toBe(
      401,
    );

    const repeated = await handlers.token(
      new Request(`${ORIGIN}/api/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: "code=a&code=b",
      }),
    );
    expect(repeated.status).toBe(400);
  });

  it("answers 500 server_error when Convex fails", async () => {
    const { handlers } = fake({
      "oauth:token": () => {
        throw new Error("down");
      },
    });
    const res = await handlers.token(form("/api/oauth/token", { code: "x" }));
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: "server_error" });
  });
});

describe("register and revoke", () => {
  it("registers with 201, refuses with 400", async () => {
    const { handlers } = fake({
      "oauth:register": ({ metadata }) =>
        (metadata as { redirect_uris?: string[] }).redirect_uris
          ? { ok: true, client: { client_id: "c1" } }
          : { ok: false, error: "invalid_redirect_uri", error_description: "no" },
    });
    const post = (body: unknown) =>
      handlers.register(
        new Request(`${ORIGIN}/api/oauth/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const ok = await post({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"] });
    expect(ok.status).toBe(201);
    expect(await ok.json()).toEqual({ client_id: "c1" });
    expect((await post({})).status).toBe(400);
  });

  it("revokes with 200 whatever the token, 400 without one", async () => {
    const { handlers, calls } = fake({ "oauth:revoke": () => null });
    expect((await handlers.revoke(form("/api/oauth/revoke", { token: "pan_x" }))).status).toBe(200);
    expect(calls[0]!.args).toEqual({ token: "pan_x" });
    expect((await handlers.revoke(form("/api/oauth/revoke", {}))).status).toBe(400);
  });
});
