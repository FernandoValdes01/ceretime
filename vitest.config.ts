import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
    include: ["convex/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
  },
});
