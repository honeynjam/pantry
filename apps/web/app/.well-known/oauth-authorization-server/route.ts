import { metadataHandlers } from "@/lib/oauth";

// RFC 8414 authorization server metadata. The issuer is this origin, so this is the only path.
export const dynamic = "force-dynamic";

export const GET = metadataHandlers.authorizationServer;
export const OPTIONS = metadataHandlers.preflight;
