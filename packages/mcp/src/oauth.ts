import { api } from "@pantry/backend/api";
import { brand } from "@pantry/backend/brand";
import type { Backend } from "./backend";

/**
 * The HTTP side of MCP authorization (OAuth 2.1, MCP spec 2026-07-28), served by apps/web. Thin:
 * every decision is in Convex (convex/oauth.ts, design notes in convex/lib/oauth.ts). This file
 * shapes requests and responses: discovery documents, form parsing, status codes, CORS.
 *
 *   /.well-known/oauth-protected-resource[/api/mcp]  RFC 9728, points at the issuer
 *   /.well-known/oauth-authorization-server          RFC 8414
 *   /api/oauth/authorize   → the consent screen (/oauth/consent) or back to the app with an error
 *   /api/oauth/token       authorization_code + PKCE, refresh_token (rotating)
 *   /api/oauth/register    RFC 7591 dynamic client registration (public clients)
 *   /api/oauth/revoke      RFC 7009
 *
 * The issuer is the web origin, so `iss` (RFC 9207) and the metadata's `issuer` are the same string.
 */

export const OAUTH_PATHS = {
  protectedResource: "/.well-known/oauth-protected-resource",
  protectedResourceForMcp: "/.well-known/oauth-protected-resource/api/mcp",
  authorizationServer: "/.well-known/oauth-authorization-server",
  authorize: "/api/oauth/authorize",
  token: "/api/oauth/token",
  register: "/api/oauth/register",
  revoke: "/api/oauth/revoke",
  consent: "/oauth/consent",
  mcp: "/api/mcp",
} as const;

/** Discovery and the token endpoints are called from browsers too (MCP Inspector); no cookies. */
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};
const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { ...CORS, ...headers } });

type Origin = (req: Request) => string;

export function protectedResourceMetadata(origin: string) {
  const issuer = new URL(origin).origin;
  return {
    resource: `${issuer}${OAUTH_PATHS.mcp}`,
    authorization_servers: [issuer],
    bearer_methods_supported: ["header"],
    resource_name: brand.name,
  };
}

export function authorizationServerMetadata(origin: string) {
  const issuer = new URL(origin).origin;
  return {
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${issuer}${OAUTH_PATHS.token}`,
    registration_endpoint: `${issuer}${OAUTH_PATHS.register}`,
    revocation_endpoint: `${issuer}${OAUTH_PATHS.revoke}`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    // Public clients only: PKCE and the exact redirect URI bind the code (Claude and ChatGPT both
    // use `none` with a Client ID Metadata Document).
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    authorization_response_iss_parameter_supported: true,
  };
}

/** Form (the standard) or JSON body as a flat string record; null when a parameter repeats. */
async function readParams(req: Request): Promise<Record<string, string> | null> {
  const type = req.headers.get("content-type") ?? "";
  const params: Record<string, string> = {};
  if (type.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    for (const [key, value] of Object.entries(body ?? {})) {
      if (typeof value === "string") params[key] = value;
    }
    return params;
  }
  const form = new URLSearchParams(await req.text());
  for (const [key, value] of form) {
    if (key in params) return null; // RFC 6749 §3.1: parameters MUST NOT repeat
    params[key] = value;
  }
  return params;
}

/** A public client may still send its client_id in HTTP Basic auth (with an empty secret). */
function basicClientId(req: Request): string | undefined {
  const header = req.headers.get("authorization");
  if (!header?.toLowerCase().startsWith("basic ")) return undefined;
  try {
    const decoded = atob(header.slice(6).trim());
    const id = decoded.slice(0, decoded.indexOf(":") === -1 ? undefined : decoded.indexOf(":"));
    return id ? decodeURIComponent(id) : undefined;
  } catch {
    return undefined;
  }
}

const serverError = (err: unknown) => {
  console.error("OAuth endpoint failed:", err);
  return json(
    { error: "server_error", error_description: "Something went wrong. Try again." },
    500,
    NO_STORE,
  );
};

export function createOAuthHandlers(backend: Backend, { origin }: { origin: Origin }) {
  return {
    protectedResource: (req: Request) =>
      json(protectedResourceMetadata(origin(req)), 200, { "Cache-Control": "max-age=300" }),

    authorizationServer: (req: Request) =>
      json(authorizationServerMetadata(origin(req)), 200, { "Cache-Control": "max-age=300" }),

    preflight: () => new Response(null, { status: 204, headers: CORS }),

    /** GET (or form POST) /api/oauth/authorize: always a redirect, never a page of its own. */
    async authorize(req: Request): Promise<Response> {
      const base = origin(req);
      const params: Record<string, string> = {};
      for (const [key, value] of new URL(req.url).searchParams) params[key] ??= value;
      if (req.method === "POST") Object.assign(params, (await readParams(req)) ?? {});
      try {
        const result = await backend.action(api.oauth.startAuthorization, {
          params,
          origin: base,
        });
        const consent = new URL(OAUTH_PATHS.consent, base);
        if (result.kind === "consent") consent.searchParams.set("request", result.requestId);
        if (result.kind === "redirect") return Response.redirect(result.url, 302);
        if (result.kind === "error") {
          consent.searchParams.set("error", result.error);
          consent.searchParams.set("error_description", result.error_description);
        }
        return new Response(null, {
          status: 302,
          headers: { Location: consent.toString(), ...NO_STORE },
        });
      } catch (err) {
        return serverError(err);
      }
    },

    async token(req: Request): Promise<Response> {
      const params = await readParams(req);
      if (!params) {
        return json(
          { error: "invalid_request", error_description: "A parameter is repeated." },
          400,
          NO_STORE,
        );
      }
      params.client_id ??= basicClientId(req) ?? "";
      if (!params.client_id) delete params.client_id;
      try {
        const result = await backend.action(api.oauth.token, { params, origin: origin(req) });
        if (result.ok) return json(result.tokens, 200, NO_STORE);
        const { error, error_description } = result;
        return json({ error, error_description }, error === "invalid_client" ? 401 : 400, NO_STORE);
      } catch (err) {
        return serverError(err);
      }
    },

    async register(req: Request): Promise<Response> {
      const metadata = await req.json().catch(() => null);
      try {
        const result = await backend.action(api.oauth.register, { metadata });
        if (result.ok) return json(result.client, 201, NO_STORE);
        const { error, error_description } = result;
        return json(
          { error, error_description },
          error === "temporarily_unavailable" ? 503 : 400,
          NO_STORE,
        );
      } catch (err) {
        return serverError(err);
      }
    },

    /** RFC 7009: 200 whether or not the token was known. */
    async revoke(req: Request): Promise<Response> {
      const params = await readParams(req);
      if (!params?.token) {
        return json({ error: "invalid_request", error_description: "token is missing." }, 400);
      }
      try {
        await backend.mutation(api.oauth.revoke, { token: params.token });
        return new Response(null, { status: 200, headers: { ...CORS, ...NO_STORE } });
      } catch (err) {
        return serverError(err);
      }
    },
  };
}

export type OAuthHandlers = ReturnType<typeof createOAuthHandlers>;
