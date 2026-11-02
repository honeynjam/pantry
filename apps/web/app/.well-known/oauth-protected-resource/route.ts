import { metadataHandlers } from "@/lib/oauth";

// RFC 9728 protected resource metadata for /api/mcp (MCP authorization). Clients try the
// path-suffixed URL (./api/mcp) first, then this one; both answer the same.
export const dynamic = "force-dynamic";

export const GET = metadataHandlers.protectedResource;
export const OPTIONS = metadataHandlers.preflight;
