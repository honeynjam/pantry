import { convexBackend, createOAuthHandlers, type OAuthHandlers } from "@pantry/mcp";
import { getPublicOrigin } from "mcp-handler";
import { getConvexUrl } from "./convex-env";

/**
 * The MCP OAuth endpoints (packages/mcp/src/oauth.ts) for this deployment. The issuer and the MCP
 * resource come from the request's public origin, the same way /api/mcp builds its URLs.
 */
let cached: { convexUrl: string; handlers: OAuthHandlers } | undefined;

export function oauthHandlers(): OAuthHandlers | null {
  const convexUrl = getConvexUrl();
  if (!convexUrl) return null;
  if (cached?.convexUrl !== convexUrl) {
    cached = {
      convexUrl,
      handlers: createOAuthHandlers(convexBackend(convexUrl), { origin: getPublicOrigin }),
    };
  }
  return cached.handlers;
}

/** Metadata needs no backend; everything else answers 503 on a build without a Convex URL. */
export const metadataHandlers = createOAuthHandlers(
  {
    query: unavailable,
    mutation: unavailable,
    action: unavailable,
  },
  { origin: getPublicOrigin },
);

function unavailable(): never {
  throw new Error("Not available without NEXT_PUBLIC_CONVEX_URL");
}

type Endpoint = "authorize" | "token" | "register" | "revoke";

export function oauthRoute(endpoint: Endpoint) {
  return (req: Request): Promise<Response> | Response => {
    const handlers = oauthHandlers();
    if (!handlers) {
      return Response.json(
        {
          error: "temporarily_unavailable",
          error_description:
            "This server was built without NEXT_PUBLIC_CONVEX_URL; see the README troubleshooting list.",
        },
        { status: 503 },
      );
    }
    return handlers[endpoint](req);
  };
}
