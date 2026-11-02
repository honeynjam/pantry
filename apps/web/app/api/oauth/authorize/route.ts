import { oauthRoute } from "@/lib/oauth";

// OAuth authorization endpoint: checks the request in Convex, then redirects to the consent screen
// (/oauth/consent) or back to the app with an error.
export const dynamic = "force-dynamic";

const authorize = oauthRoute("authorize");
export { authorize as GET, authorize as POST };
