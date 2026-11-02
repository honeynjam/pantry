import { describe, expect, it } from "vitest";
import {
  checkMetadataDocumentUrl,
  checkRedirectUri,
  CIMD_DEFAULT_CACHE_MS,
  CIMD_MAX_CACHE_MS,
  CIMD_MIN_CACHE_MS,
  isOurResource,
  issuerFor,
  metadataCacheMs,
  parseMetadataDocument,
  parseRegistrationRequest,
  redirectUriMatches,
  resourceFor,
  verifyPkce,
} from "./oauth";

describe("issuer and resource", () => {
  it("is the origin without a trailing slash, and its /api/mcp", () => {
    expect(issuerFor("https://pantry.example.com/")).toBe("https://pantry.example.com");
    expect(resourceFor("https://pantry.example.com")).toBe("https://pantry.example.com/api/mcp");
  });

  it("accepts our resource with case or trailing-slash differences, nothing else", () => {
    const ours = "https://pantry.example.com/api/mcp";
    expect(isOurResource(ours, ours)).toBe(true);
    expect(isOurResource("HTTPS://Pantry.Example.com/api/mcp/", ours)).toBe(true);
    expect(isOurResource("https://pantry.example.com", ours)).toBe(false);
    expect(isOurResource("https://pantry.example.com/api/mcp#x", ours)).toBe(false);
    expect(isOurResource("https://evil.example.com/api/mcp", ours)).toBe(false);
    expect(isOurResource("not a url", ours)).toBe(false);
  });
});

describe("redirect URIs", () => {
  it("allows https, loopback http and private-use schemes", () => {
    expect(checkRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBeNull();
    expect(checkRedirectUri("https://chatgpt.com/connector_platform_oauth_redirect")).toBeNull();
    expect(checkRedirectUri("http://localhost:3118/callback")).toBeNull();
    expect(checkRedirectUri("http://127.0.0.1/callback")).toBeNull();
    expect(checkRedirectUri("cursor://anysphere.cursor-mcp/oauth/callback")).toBeNull();
  });

  it("refuses http on public hosts, fragments and dangerous schemes", () => {
    expect(checkRedirectUri("http://example.com/cb")).toMatch(/https/);
    expect(checkRedirectUri("https://example.com/cb#frag")).toMatch(/fragment/);
    expect(checkRedirectUri("javascript:alert(1)")).toMatch(/scheme/);
    expect(checkRedirectUri("data:text/html,hi")).toMatch(/scheme/);
    expect(checkRedirectUri("/relative")).toMatch(/absolute/);
  });

  it("matches exactly, except the port of a loopback redirect", () => {
    const claude = ["https://claude.ai/api/mcp/auth_callback"];
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback", claude)).toBe(true);
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback/", claude)).toBe(false);
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback?x=1", claude)).toBe(false);
    expect(redirectUriMatches("https://claude.com/api/mcp/auth_callback", claude)).toBe(false);

    const claudeCode = ["http://localhost/callback", "http://127.0.0.1/callback"];
    expect(redirectUriMatches("http://localhost:51234/callback", claudeCode)).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:8080/callback", claudeCode)).toBe(true);
    expect(redirectUriMatches("http://localhost:51234/other", claudeCode)).toBe(false);
    expect(redirectUriMatches("http://[::1]:51234/callback", claudeCode)).toBe(false);
    // The port is only ignored on loopback.
    expect(redirectUriMatches("https://claude.ai:8443/api/mcp/auth_callback", claude)).toBe(false);
  });
});

describe("PKCE", () => {
  // node -e 'crypto.createHash("sha256").update(verifier).digest("base64url")'
  const verifier = "test-verifier-0123456789-abcdefghijklmnopqrstuvwxyz";
  const challenge = "nw4Cig7sk_DT0QSX9Qn-3UKs33fmbbp8bRuv1b5-wXw";

  it("accepts the verifier the S256 challenge was made from, nothing else", async () => {
    expect(await verifyPkce(verifier, challenge)).toBe(true);
    expect(await verifyPkce(`${verifier}x`, challenge)).toBe(false);
    expect(await verifyPkce(challenge, challenge)).toBe(false);
    expect(await verifyPkce("short", challenge)).toBe(false);
  });
});

describe("client ID metadata documents", () => {
  it("only fetches https URLs with a path on public hosts", () => {
    expect(
      checkMetadataDocumentUrl("https://claude.ai/oauth/claude-code-client-metadata"),
    ).toBeNull();
    expect(checkMetadataDocumentUrl("https://chatgpt.com/oauth/client.json")).toBeNull();
    expect(checkMetadataDocumentUrl("http://example.com/client.json")).toMatch(/https/);
    expect(checkMetadataDocumentUrl("https://example.com/")).toMatch(/path/);
    expect(checkMetadataDocumentUrl("https://example.com/a#b")).toMatch(/fragment/);
    expect(checkMetadataDocumentUrl("https://user:pw@example.com/a")).toMatch(/credentials/);
    expect(checkMetadataDocumentUrl("https://localhost/client.json")).toMatch(/local/);
    expect(checkMetadataDocumentUrl("https://metadata/client.json")).toMatch(/public/);
    expect(checkMetadataDocumentUrl("https://10.0.0.5/client.json")).toMatch(/private/);
    expect(checkMetadataDocumentUrl("https://169.254.169.254/latest")).toMatch(/private/);
    expect(checkMetadataDocumentUrl("https://192.168.1.1/x")).toMatch(/private/);
    expect(checkMetadataDocumentUrl("https://[::1]/x")).toMatch(/IPv6/);
  });

  it("requires the document's client_id to equal its URL and a usable redirect URI", () => {
    const url = "https://app.example.com/client.json";
    const good = {
      client_id: url,
      client_name: "  Example\n  App ",
      redirect_uris: ["https://app.example.com/cb", "http://example.com/insecure"],
    };
    expect(parseMetadataDocument(url, good)).toEqual({
      ok: true,
      client: {
        name: "Example App",
        redirectUris: ["https://app.example.com/cb"],
        clientUri: undefined,
        logoUri: undefined,
      },
    });
    expect(
      parseMetadataDocument(url, { ...good, client_id: "https://other.example.com/c" }).ok,
    ).toBe(false);
    expect(parseMetadataDocument(url, { ...good, client_secret: "x" }).ok).toBe(false);
    expect(
      parseMetadataDocument(url, { ...good, redirect_uris: ["http://example.com/x"] }).ok,
    ).toBe(false);
    expect(parseMetadataDocument(url, [good]).ok).toBe(false);
    const unnamed = parseMetadataDocument(url, { ...good, client_name: undefined });
    expect(unnamed.ok && unnamed.client.name).toBe("app.example.com");
  });

  it("caches for max-age, clamped", () => {
    expect(metadataCacheMs(null)).toBe(CIMD_DEFAULT_CACHE_MS);
    expect(metadataCacheMs("public, max-age=600")).toBe(600_000);
    expect(metadataCacheMs("max-age=1")).toBe(CIMD_MIN_CACHE_MS);
    expect(metadataCacheMs("max-age=99999999")).toBe(CIMD_MAX_CACHE_MS);
    expect(metadataCacheMs("no-store")).toBe(CIMD_MIN_CACHE_MS);
  });
});

describe("dynamic client registration", () => {
  it("registers a public client for the code flow", () => {
    const parsed = parseRegistrationRequest({
      client_name: "Claude",
      redirect_uris: ["https://claude.ai/api/mcp/auth_callback"],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "client_secret_post",
    });
    expect(parsed).toEqual({
      ok: true,
      client: {
        name: "Claude",
        redirectUris: ["https://claude.ai/api/mcp/auth_callback"],
        clientUri: undefined,
        logoUri: undefined,
      },
    });
  });

  it("refuses bad redirect URIs and other grants", () => {
    expect(parseRegistrationRequest({ redirect_uris: [] })).toMatchObject({
      ok: false,
      error: { error: "invalid_redirect_uri" },
    });
    expect(
      parseRegistrationRequest({ redirect_uris: ["http://evil.example.com/cb"] }),
    ).toMatchObject({
      ok: false,
      error: { error: "invalid_redirect_uri" },
    });
    expect(
      parseRegistrationRequest({
        redirect_uris: ["https://a.example.com/cb"],
        grant_types: ["client_credentials"],
      }),
    ).toMatchObject({ ok: false, error: { error: "invalid_client_metadata" } });
    expect(parseRegistrationRequest("nope")).toMatchObject({ ok: false });
  });
});
