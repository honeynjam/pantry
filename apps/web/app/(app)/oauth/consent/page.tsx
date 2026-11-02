import { brand } from "@pantry/backend/brand";
import { OAuthConsentPage } from "@pantry/app/screens/oauth-consent";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: `Connect an app · ${brand.name}`,
  referrer: "no-referrer",
  robots: { index: false },
};

const one = (value: string | string[] | undefined) =>
  typeof value === "string" && value ? value : undefined;

/** MCP OAuth consent (packages/app/src/screens/oauth-consent.tsx); /api/oauth/authorize sends people here. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return (
    <OAuthConsentPage
      requestId={one(params.request)}
      error={one(params.error)}
      errorDescription={one(params.error_description)}
    />
  );
}
