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
  test("cada población usa el proveedor de su dominio con retorno controlado a la SPA", () => {
    expect(getLoginRequest("estudiante")).toEqual({
      providerId: "google-alu",
      callbackURL: "/",
      errorCallbackURL: "/?auth=error",
    });
    expect(getLoginRequest("personal")).toEqual({
      providerId: "google-uct",
      callbackURL: "/",
      errorCallbackURL: "/?auth=error",
    });
  });

  test("el proveedor de cada botón coincide con el sufijo que muestra", () => {
    const providerBySuffix = Object.fromEntries(
      POPULATION_LOGINS.map((entry) => [entry.emailSuffix, getLoginRequest(entry.id).providerId]),
    );
    expect(providerBySuffix).toEqual({ "@alu.uct.cl": "google-alu", "@uct.cl": "google-uct" });
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
