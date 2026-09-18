import { describe, expect, test } from "vitest";
import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login";
import { readAuthErrorNotice, removeAuthErrorParams } from "./auth-error";

describe("readAuthErrorNotice", () => {
  test("traduce el marcador controlado a mensaje genérico", () => {
    expect(readAuthErrorNotice("?auth=error")).toBe(GENERIC_AUTH_MESSAGES.signInError);
  });

  test("traduce el error del proveedor sin exponer sus valores", () => {
    const notice = readAuthErrorNotice(
      "?auth=error&error=access_denied&error_description=Access+denied",
    );
    expect(notice).toBe(GENERIC_AUTH_MESSAGES.signInError);
    expect(notice).not.toContain("access_denied");
  });

  test("ignora un parámetro error ajeno sin marcador controlado", () => {
    expect(readAuthErrorNotice("?error=boom")).toBe(null);
    expect(readAuthErrorNotice("?next=panel&error=boom")).toBe(null);
  });

  test("devuelve null sin parámetros de error", () => {
    expect(readAuthErrorNotice("")).toBe(null);
    expect(readAuthErrorNotice("?next=panel")).toBe(null);
  });
});

describe("removeAuthErrorParams", () => {
  test("retira solo los parámetros de auth y conserva el resto", () => {
    expect(removeAuthErrorParams("?auth=error&error=x&error_description=y&next=panel")).toBe(
      "?next=panel",
    );
  });

  test("devuelve cadena vacía cuando solo hay parámetros de auth", () => {
    expect(removeAuthErrorParams("?auth=error")).toBe("");
    expect(removeAuthErrorParams("")).toBe("");
  });
});
