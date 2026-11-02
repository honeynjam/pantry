/**
 * MCP authorization (OAuth 2.1 with PKCE) for clients that can't send an API token header: Claude
 * (claude.ai, Desktop, mobile) and ChatGPT connectors, and any other client that follows the MCP
 * authorization spec (2026-07-28). Pure helpers here; the functions are in convex/oauth.ts and the
 * HTTP endpoints are thin adapters in packages/mcp/src/oauth.ts (served by apps/web).
 *
 * Why hand-rolled and not Better Auth's `mcp` / `oauth-provider` plugin: the `mcp` plugin in
 * better-auth 1.6 stores access tokens in plain text, has no Client ID Metadata Documents and only
 * issues refresh tokens with `offline_access`; `@better-auth/oauth-provider` needs tables the Convex
 * Better Auth component's built-in schema doesn't have (a "local install" migration on every
 * self-hosted instance). And neither would map a token onto Pantry's member + workspace the way an
 * API token does. Here an OAuth access token *is* an `apiTokens` row (with `grantId` and
 * `expiresAt`), so `findToken` / `mcp.verifyToken` and every tool work unchanged.
 */

import { sha256Base64Url } from "./tokens";

/** Single-use authorization codes live this long (RFC 6749 recommends at most 10 minutes). */
export const CODE_TTL_MS = 5 * 60 * 1000;
/** Access tokens. Clients refresh before this (Claude refreshes up to 5 minutes early). */
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
/** Refresh tokens expire after this long unused; every refresh rotates them and restarts the clock. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * A refresh token that was just rotated is still honoured this long, so a client that lost the
 * response (network drop, two refreshes racing) can retry. Reuse after that revokes the connection:
 * it means someone else has a copy (OAuth 2.1 refresh token rotation).
 */
export const REFRESH_REUSE_GRACE_MS = 2 * 60 * 1000;
/** The consent screen's request (between /authorize and Allow) expires after this. */
export const REQUEST_TTL_MS = 10 * 60 * 1000;
/** Client ID Metadata Documents are cached for their Cache-Control max-age, clamped to this range. */
export const CIMD_MIN_CACHE_MS = 5 * 60 * 1000;
export const CIMD_MAX_CACHE_MS = 24 * 60 * 60 * 1000;
export const CIMD_DEFAULT_CACHE_MS = 60 * 60 * 1000;
/** The draft suggests a 5 KB cap on metadata documents. */
export const CIMD_MAX_BYTES = 5 * 1024;
export const CIMD_FETCH_TIMEOUT_MS = 5000;
/** Connected apps per person, like MAX_ACTIVE_TOKENS for API tokens. */
export const MAX_ACTIVE_GRANTS = 25;
/** Registered (DCR) clients nobody has authorised are deleted after this. */
export const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
/** Refuse new DCR registrations while this many are pending, unused (a cap on runaway scripts). */
export const MAX_UNUSED_CLIENTS = 1000;

export const MAX_REDIRECT_URIS = 10;
export const MAX_URI_LENGTH = 2048;
export const MAX_CLIENT_NAME_LENGTH = 80;
export const MAX_STATE_LENGTH = 1024;
export const MAX_SCOPE_LENGTH = 512;

/** The MCP endpoint's path on the web app, and with it the RFC 8707 resource this server issues for. */
export const MCP_PATH = "/api/mcp";

/** OAuth error codes we send (RFC 6749 §4.1.2.1, §5.2; RFC 8707 `invalid_target`). */
export type OAuthErrorCode =
  | "invalid_request"
  | "invalid_client"
  | "invalid_grant"
  | "unauthorized_client"
  | "unsupported_grant_type"
  | "unsupported_response_type"
  | "invalid_scope"
  | "invalid_target"
  | "access_denied"
  | "invalid_redirect_uri"
  | "invalid_client_metadata"
  | "temporarily_unavailable"
  | "server_error";

export type OAuthError = { error: OAuthErrorCode; error_description: string };

export const oauthError = (error: OAuthErrorCode, description: string): OAuthError => ({
  error,
  error_description: description,
});

// ---------------------------------------------------------------------------------------------
// Origins, issuer and resource
// ---------------------------------------------------------------------------------------------

/**
 * The issuer (RFC 8414) for a web origin: the origin itself, no trailing slash. Clients compare it
 * with the `iss` we send back byte for byte (RFC 9207), so it's built in exactly one place.
 */
export function issuerFor(origin: string): string {
  return new URL(origin).origin;
}

/** The canonical MCP server URI (RFC 8707 resource) for a web origin. */
export function resourceFor(origin: string): string {
  return `${issuerFor(origin)}${MCP_PATH}`;
}

/**
 * Whether a `resource` a client sent names this server. RFC 8707 resources are absolute URIs without
 * a fragment; we accept case differences in scheme and host and a trailing slash (the MCP spec asks
 * servers to be lenient), nothing else.
 */
export function isOurResource(requested: string, ours: string): boolean {
  let url: URL;
  try {
    url = new URL(requested);
  } catch {
    return false;
  }
  if (url.hash || url.search || url.username || url.password) return false;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}` === ours;
}

// ---------------------------------------------------------------------------------------------
// Redirect URIs
// ---------------------------------------------------------------------------------------------

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Schemes a native app's private-use redirect must not use (RFC 8252 §7.1 allows the rest). */
const FORBIDDEN_SCHEMES = new Set([
  "javascript:",
  "data:",
  "vbscript:",
  "file:",
  "about:",
  "blob:",
  "filesystem:",
  "ftp:",
  "ws:",
  "wss:",
]);

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a redirect URI may be registered: https anywhere, http only on a loopback host (native
 * apps, RFC 8252 §7.3), or a private-use scheme like `cursor://` (RFC 8252 §7.1). Never a fragment.
 */
export function checkRedirectUri(uri: string): string | null {
  if (typeof uri !== "string" || uri.length === 0) return "A redirect URI is empty.";
  if (uri.length > MAX_URI_LENGTH) return "A redirect URI is too long.";
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return `${uri} isn't an absolute URI.`;
  }
  if (url.hash || uri.includes("#")) return `${uri} has a fragment, which redirect URIs can't.`;
  if (url.protocol === "https:") return url.hostname ? null : `${uri} has no host.`;
  if (url.protocol === "http:") {
    return LOOPBACK_HOSTS.has(url.hostname)
      ? null
      : `${uri} uses http on a public host; use https (http is only for localhost).`;
  }
  if (FORBIDDEN_SCHEMES.has(url.protocol)) return `${uri} uses a scheme that can't be a redirect.`;
  // A private-use scheme for a native app: a reverse domain name or an app name, no dangerous ones.
  return /^[a-z][a-z0-9+.-]*:$/.test(url.protocol) ? null : `${uri} has an invalid scheme.`;
}

/**
 * Whether the redirect URI in a request matches a registered one. Exact string match (OAuth 2.1),
 * except loopback redirects, where the port is ignored (RFC 8252 §7.3; Claude Code registers
 * `http://localhost/callback` and `http://127.0.0.1/callback` and listens on a random port).
 */
export function redirectUriMatches(requested: string, registered: readonly string[]): boolean {
  if (registered.includes(requested)) return true;
  if (!isLoopbackRedirect(requested)) return false;
  const want = new URL(requested);
  return registered.some((candidate) => {
    if (!isLoopbackRedirect(candidate)) return false;
    const have = new URL(candidate);
    return (
      have.protocol === want.protocol &&
      have.hostname === want.hostname &&
      have.pathname === want.pathname &&
      have.search === want.search
    );
  });
}

/** The redirect URL for an authorization response: code or error, plus `state` and `iss`. */
export function authorizationResponseUrl(
  redirectUri: string,
  params: Record<string, string | undefined>,
): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

/** The host people see on the consent screen (`claude.ai`), or the scheme for a native app. */
export function displayHost(uri: string): string {
  try {
    const url = new URL(uri);
    return url.host || url.protocol.replace(/:$/, "");
  } catch {
    return uri;
  }
}

// ---------------------------------------------------------------------------------------------
// PKCE (RFC 7636): S256 only
// ---------------------------------------------------------------------------------------------

const PKCE_VALUE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function isValidCodeChallenge(challenge: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(challenge);
}

/** Whether `verifier` is the one `challenge` was made from (`BASE64URL(SHA256(verifier))`). */
export async function verifyPkce(verifier: string, challenge: string): Promise<boolean> {
  if (!PKCE_VALUE.test(verifier)) return false;
  const computed = await sha256Base64Url(verifier);
  return timingSafeEqual(computed, challenge);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---------------------------------------------------------------------------------------------
// Clients: Client ID Metadata Documents and Dynamic Client Registration
// ---------------------------------------------------------------------------------------------

/** Client metadata we keep, whichever way the client registered. */
export type ClientMetadata = {
  name: string;
  redirectUris: string[];
  clientUri?: string;
  logoUri?: string;
};

/** Whether a client_id is a Client ID Metadata Document URL rather than an id we issued. */
export const isMetadataDocumentClientId = (clientId: string) => clientId.startsWith("https://");

const PRIVATE_IPV4 = [
  /^0\./,
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // carrier-grade NAT
  /^22[4-9]\./,
  /^2[3-5]\d\./,
];

/**
 * Whether a client_id URL is one we'll fetch (draft-ietf-oauth-client-id-metadata-document §3, plus
 * SSRF guards): https, a path, no fragment, credentials or dot segments, and a public DNS name or
 * public IP, never localhost or a private range.
 */
export function checkMetadataDocumentUrl(clientId: string): string | null {
  if (clientId.length > MAX_URI_LENGTH) return "The client_id URL is too long.";
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    return "The client_id isn't a URL.";
  }
  if (url.protocol !== "https:") return "A client_id URL must use https.";
  if (url.hash || clientId.includes("#")) return "A client_id URL can't have a fragment.";
  if (url.username || url.password) return "A client_id URL can't contain credentials.";
  if (url.pathname === "/" || url.pathname === "") return "A client_id URL needs a path.";
  if (/\/\.\.?(\/|$)/.test(clientId.slice(url.origin.length))) {
    return "A client_id URL can't contain . or .. segments.";
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return "A client_id URL can't point at a local host.";
  }
  if (host.startsWith("[")) return "A client_id URL can't use an IPv6 address.";
  if (host.endsWith(".internal") || !host.includes(".")) {
    return "A client_id URL must use a public host name.";
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (PRIVATE_IPV4.some((range) => range.test(host))) {
      return "A client_id URL can't point at a private address.";
    }
  }
  return null;
}

const cleanText = (value: unknown, max: number): string | undefined => {
  if (typeof value !== "string") return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : undefined;
};

const optionalHttpsUri = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > MAX_URI_LENGTH) return undefined;
  try {
    return new URL(value).protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Validates a fetched Client ID Metadata Document (draft §4): JSON object, `client_id` equal to the
 * URL it came from, a `client_name` (we fall back to the host) and at least one usable redirect URI.
 * Every client is treated as public (PKCE, no secret), whatever auth method it prefers: we don't
 * accept client secrets, and PKCE plus the exact redirect URI is what binds a code to the client.
 */
export function parseMetadataDocument(
  clientId: string,
  body: unknown,
): { ok: true; client: ClientMetadata } | { ok: false; reason: string } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, reason: "The client metadata document isn't a JSON object." };
  }
  const doc = body as Record<string, unknown>;
  if (doc.client_id !== clientId) {
    return { ok: false, reason: "The client metadata document's client_id doesn't match its URL." };
  }
  if ("client_secret" in doc || "client_secret_expires_at" in doc) {
    return { ok: false, reason: "A client metadata document can't contain a client secret." };
  }
  const listed = Array.isArray(doc.redirect_uris) ? doc.redirect_uris : [];
  const redirectUris = listed
    .filter((uri): uri is string => typeof uri === "string" && checkRedirectUri(uri) === null)
    .slice(0, MAX_REDIRECT_URIS);
  if (redirectUris.length === 0) {
    return { ok: false, reason: "The client metadata document lists no usable redirect_uris." };
  }
  return {
    ok: true,
    client: {
      name: cleanText(doc.client_name, MAX_CLIENT_NAME_LENGTH) ?? displayHost(clientId),
      redirectUris,
      clientUri: optionalHttpsUri(doc.client_uri),
      logoUri: optionalHttpsUri(doc.logo_uri),
    },
  };
}

/** How long to cache a metadata document: its `Cache-Control: max-age`, clamped. */
export function metadataCacheMs(cacheControl: string | null): number {
  if (!cacheControl) return CIMD_DEFAULT_CACHE_MS;
  if (/no-store|no-cache/i.test(cacheControl)) return CIMD_MIN_CACHE_MS;
  const match = cacheControl.match(/max-age=(\d+)/i);
  if (!match) return CIMD_DEFAULT_CACHE_MS;
  const ms = Number(match[1]) * 1000;
  return Math.min(CIMD_MAX_CACHE_MS, Math.max(CIMD_MIN_CACHE_MS, ms));
}

/**
 * Validates a Dynamic Client Registration request (RFC 7591 §2). Every client is registered as a
 * public client (`token_endpoint_auth_method: "none"`, no secret) for the authorization code and
 * refresh token grants; RFC 7591 lets the server replace what the client asked for.
 */
export function parseRegistrationRequest(
  body: unknown,
): { ok: true; client: ClientMetadata } | { ok: false; error: OAuthError } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      ok: false,
      error: oauthError("invalid_client_metadata", "Send the client metadata as a JSON object."),
    };
  }
  const doc = body as Record<string, unknown>;
  if (!Array.isArray(doc.redirect_uris) || doc.redirect_uris.length === 0) {
    return {
      ok: false,
      error: oauthError("invalid_redirect_uri", "redirect_uris must list at least one URI."),
    };
  }
  if (doc.redirect_uris.length > MAX_REDIRECT_URIS) {
    return {
      ok: false,
      error: oauthError(
        "invalid_redirect_uri",
        `Register at most ${MAX_REDIRECT_URIS} redirect URIs.`,
      ),
    };
  }
  const redirectUris: string[] = [];
  for (const uri of doc.redirect_uris) {
    const problem = typeof uri === "string" ? checkRedirectUri(uri) : "A redirect URI isn't text.";
    if (problem) return { ok: false, error: oauthError("invalid_redirect_uri", problem) };
    if (!redirectUris.includes(uri as string)) redirectUris.push(uri as string);
  }
  const grantTypes = Array.isArray(doc.grant_types) ? doc.grant_types : ["authorization_code"];
  if (!grantTypes.includes("authorization_code")) {
    return {
      ok: false,
      error: oauthError(
        "invalid_client_metadata",
        "Only the authorization_code grant (with refresh_token) is supported.",
      ),
    };
  }
  const responseTypes = Array.isArray(doc.response_types) ? doc.response_types : ["code"];
  if (!responseTypes.includes("code")) {
    return {
      ok: false,
      error: oauthError("invalid_client_metadata", "Only response_type code is supported."),
    };
  }
  return {
    ok: true,
    client: {
      name:
        cleanText(doc.client_name, MAX_CLIENT_NAME_LENGTH) ?? displayHost(redirectUris[0] ?? ""),
      redirectUris,
      clientUri: optionalHttpsUri(doc.client_uri),
      logoUri: optionalHttpsUri(doc.logo_uri),
    },
  };
}
