import { metadataHandlers } from "@/lib/oauth";

// RFC 9728 protected resource metadata at the path-suffixed URL for /api/mcp. The 401 from /api/mcp
// points here (WWW-Authenticate resource_metadata).
export const dynamic = "force-dynamic";

export const GET = metadataHandlers.protectedResource;
export const OPTIONS = metadataHandlers.preflight;
