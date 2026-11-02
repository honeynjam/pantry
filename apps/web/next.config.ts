import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/** In local dev, pick up the URLs `convex dev` writes for packages/backend, so `pnpm dev` just works. */
function localConvexEnv(): Record<string, string> {
  try {
    const file = fileURLToPath(new URL("../../packages/backend/.env.local", import.meta.url));
    return Object.fromEntries(
      readFileSync(file, "utf8")
        .split("\n")
        .map((line) => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
        .filter((match): match is RegExpMatchArray => match !== null)
        .map((match) => [match[1]!, match[2]!.replace(/^["']|["']$/g, "")]),
    );
  } catch {
    return {};
  }
}

const isDev = process.env.NODE_ENV !== "production";
const local = isDev ? localConvexEnv() : {};
// `convex dev` names them VITE_CONVEX_* when it finds vite in packages/backend (vitest pulls it in).
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL ?? local.CONVEX_URL ?? local.VITE_CONVEX_URL;
const convexSiteUrl =
  process.env.NEXT_PUBLIC_CONVEX_SITE_URL ??
  local.CONVEX_SITE_URL ??
  local.VITE_CONVEX_SITE_URL ??
  convexUrl?.replace(/\.convex\.cloud\/?$/, ".convex.site");

const nextConfig: NextConfig = {
  // Lets a second dev server run from the same folder (Next allows one per build dir), e.g. for tests.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@pantry/ui", "@pantry/app", "@pantry/backend", "@pantry/mcp"],
  // The MCP OAuth consent screen can't be framed (clickjacking an "Allow" press).
  async headers() {
    return [
      {
        source: "/oauth/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
    ];
  },
  env: Object.fromEntries(
    Object.entries({
      NEXT_PUBLIC_CONVEX_URL: convexUrl,
      NEXT_PUBLIC_CONVEX_SITE_URL: convexSiteUrl,
    }).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    ),
  ),
};

export default nextConfig;
