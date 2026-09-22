import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["convex/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
  },
});
