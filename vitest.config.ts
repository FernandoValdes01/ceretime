import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    environmentMatchGlobs: [["apps/web/**", "jsdom"]],
    deps: {
      inline: [/^react$/, /^react-dom$/, /^@tanstack\/react-router/],
    },
    include: ["convex/**/*.test.ts", "apps/web/src/**/*.test.{ts,tsx}"],
    // Las pruebas de Convex comparten CPU entre workers; las más pesadas
    // rozaban el límite por defecto de 5 s en máquinas de 16 núcleos.
    testTimeout: 15_000,
  },
});
