import { brand } from "@pantry/backend/brand";
import { SERVER_VERSION } from "@pantry/backend/version";
import {
  convexBackend,
  createVerifyToken,
  OAUTH_PATHS,
  registerTools,
  SERVER_INSTRUCTIONS,
} from "@pantry/mcp";
import { createMcpHandler, getPublicOrigin, withMcpAuth } from "mcp-handler";
import { getConvexUrl } from "@/lib/convex-env";

export const dynamic = "force-dynamic";

type Handler = (req: Request) => Promise<Response>;
let cached: { convexUrl: string; handler: Handler } | undefined;

/**
 * The MCP server (spec §6, §10b): `withMcpAuth(createMcpHandler(registerTools), verifyToken,
 * { required: true })`. A request without a live token (a personal API token or an OAuth access
 * token) gets a 401 before any tool runs, with `WWW-Authenticate: Bearer resource_metadata=…` so
 * OAuth clients can find /api/oauth/*; each tool passes the token on to Convex, which checks it
 * again. Stateless, so GET answers 405.
 */
function handlerFor(convexUrl: string): Handler {
  if (cached?.convexUrl !== convexUrl) {
    const backend = convexBackend(convexUrl);
    const mcp = createMcpHandler((server) => registerTools(server, { backend }), {
      serverInfo: { name: brand.name, version: SERVER_VERSION },
      instructions: SERVER_INSTRUCTIONS,
    });
    const verifyToken = createVerifyToken(backend, { appUrl: getPublicOrigin });
    cached = {
      convexUrl,
      handler: withMcpAuth(mcp, verifyToken, {
        required: true,
        // The 401 points OAuth clients (Claude, ChatGPT) at the metadata for this endpoint.
        resourceMetadataPath: OAUTH_PATHS.protectedResourceForMcp,
      }),
    };
  }
  return cached.handler;
}

async function handle(req: Request): Promise<Response> {
  const convexUrl = getConvexUrl();
  if (!convexUrl) {
    return Response.json(
      {
        error:
          "This server was built without NEXT_PUBLIC_CONVEX_URL; see the README troubleshooting list.",
      },
      { status: 503 },
    );
  }
  return handlerFor(convexUrl)(req);
}

export { handle as DELETE, handle as GET, handle as POST };
