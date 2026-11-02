import { metadataHandlers, oauthRoute } from "@/lib/oauth";

// OAuth dynamic client registration (RFC 7591): public clients only.
export const dynamic = "force-dynamic";

export const POST = oauthRoute("register");
export const OPTIONS = metadataHandlers.preflight;
