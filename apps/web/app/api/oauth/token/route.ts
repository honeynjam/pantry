import { metadataHandlers, oauthRoute } from "@/lib/oauth";

// OAuth token endpoint: authorization_code (PKCE) and refresh_token (rotating).
export const dynamic = "force-dynamic";

export const POST = oauthRoute("token");
export const OPTIONS = metadataHandlers.preflight;
