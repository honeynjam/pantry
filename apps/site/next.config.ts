import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  transpilePackages: ["@pantry/ui", "@pantry/backend", "@pantry/mcp", "@pantry/app"],
};

export default nextConfig;
