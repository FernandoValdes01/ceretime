import { describe, expect, test } from "vitest";
import { GENERIC_AUTH_MESSAGES, POPULATION_LOGINS, getLoginRequest } from "./institutional-login";

describe("POPULATION_LOGINS", () => {
  test("expone un inicio por población con su sufijo institucional", () => {
    expect(POPULATION_LOGINS.map((entry) => entry.id)).toEqual(["estudiante", "personal"]);
    expect(POPULATION_LOGINS.map((entry) => entry.emailSuffix)).toEqual(["@alu.uct.cl", "@uct.cl"]);
  });

  test("orienta a elegir la cuenta correcta sin prometer acceso", () => {
    for (const entry of POPULATION_LOGINS) {
      expect(entry.buttonLabel).toContain(entry.emailSuffix);
    }
  });
});

describe("getLoginRequest", () => {
  test("usa el mismo proveedor Google con retorno controlado a la SPA", () => {
    expect(getLoginRequest()).toEqual({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/?auth=error",
    });
  });

  test("con origen del entorno vuelve a esa SPA y no al SITE_URL del deployment", () => {
    expect(getLoginRequest("http://localhost:5173")).toEqual({
      provider: "google",
      callbackURL: "http://localhost:5173/",
      errorCallbackURL: "http://localhost:5173/?auth=error",
    });
  });

  test("usa solo el origen aunque la variable traiga ruta o barra final", () => {
    expect(getLoginRequest(" https://ceretime.vercel.app/inicio/ ").callbackURL).toBe(
      "https://ceretime.vercel.app/",
    );
  });

  test("sin origen válido conserva la ruta relativa de siempre", () => {
    for (const value of ["", "   ", "localhost:5173-no-es-url", "no es una url"]) {
      expect(getLoginRequest(value)).toEqual({
        provider: "google",
        callbackURL: "/",
        errorCallbackURL: "/?auth=error",
      });
    }
  });
});

describe("GENERIC_AUTH_MESSAGES", () => {
  test("cubre carga, error de ingreso, expiración, cierre y entorno", () => {
    expect(GENERIC_AUTH_MESSAGES.loading.length).toBeGreaterThan(0);
    expect(GENERIC_AUTH_MESSAGES.signInError.length).toBeGreaterThan(0);
    expect(GENERIC_AUTH_MESSAGES.sessionExpired.length).toBeGreaterThan(0);
    expect(GENERIC_AUTH_MESSAGES.signOutError.length).toBeGreaterThan(0);
    expect(GENERIC_AUTH_MESSAGES.misconfigured).toContain("VITE_CONVEX_URL");
    expect(GENERIC_AUTH_MESSAGES.misconfigured).toContain("VITE_CONVEX_SITE_URL");
  });

  test("no filtra motivo, dominio ni datos de sesión", () => {
    const sensitive = [
      GENERIC_AUTH_MESSAGES.signInError,
      GENERIC_AUTH_MESSAGES.sessionExpired,
      GENERIC_AUTH_MESSAGES.signOutError,
    ];
    for (const message of sensitive) {
      expect(message).not.toContain("@");
      expect(message).not.toContain("alu.uct.cl");
      expect(message).not.toContain("uct.cl");
      expect(message).not.toContain("gmail");
    }
  });
});
