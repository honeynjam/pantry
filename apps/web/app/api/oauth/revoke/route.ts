import { metadataHandlers, oauthRoute } from "@/lib/oauth";

// OAuth token revocation (RFC 7009): revokes the whole connection.
export const dynamic = "force-dynamic";

export const POST = oauthRoute("revoke");
export const OPTIONS = metadataHandlers.preflight;
