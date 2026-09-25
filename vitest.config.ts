import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
    deps: {
      inline: [/^react$/, /^react-dom$/, /^@tanstack\/react-router/],
    },
    include: ["convex/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
  },
});
