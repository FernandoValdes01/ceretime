/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { createAuth, resolveTrustedOrigins } from "./auth";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");

/**
 * Inicio de sesión desde la app móvil (TI2-182, adicional pedido por TI4-69):
 * sin el esquema de confianza ni el plugin `expo()`, Better Auth no devuelve
 * la sesión a la app Expo.
 */
describe("inicio de sesión desde la app móvil", () => {
  test("Better Auth confía en el esquema ceretime:// en todo deployment", () => {
    expect(resolveTrustedOrigins("https://web.ficticia.test")).toContain("ceretime://");
  });

  test("createAuth incluye el plugin expo", async () => {
    const t = convexTest(schema, modules);
    const ids = await t.run(async (ctx) =>
      (createAuth(ctx).options.plugins ?? []).map((plugin) => plugin.id),
    );
    expect(ids).toContain("expo");
  });
});
