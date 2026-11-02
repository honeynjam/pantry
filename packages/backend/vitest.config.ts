import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // GitHub's shared runners are several times slower than a laptop; vitest's 5 s default
    // made healthy tests (first test in a file pays the start-up cost) fail CI at random.
    testTimeout: 30_000,
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test", "@convex-dev/better-auth"] } },
    include: ["convex/**/*.test.ts"],
  },
});
