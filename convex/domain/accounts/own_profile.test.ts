import { describe, expect, test } from "vitest";
import { initialProfileFor, profileFullName } from "./own_profile";

describe("perfil inicial del primer ingreso (TI2-182)", () => {
  test("la población estudiante nace como Estudiante habilitado y vigente", () => {
    expect(initialProfileFor("estudiante")).toEqual({
      role: "student",
      institutionalStatus: "enabled",
      accountStatus: "active",
    });
  });

  test("la población personal nace pendiente de habilitación", () => {
    expect(initialProfileFor("personal")).toEqual({
      role: "professional",
      institutionalStatus: "pending",
      accountStatus: "active",
    });
  });

  test("usa el nombre de Google y, si llega vacío, la parte local del correo", () => {
    expect(profileFullName("  Estudiante Ficticio ", "e@alu.uct.cl")).toBe("Estudiante Ficticio");
    expect(profileFullName("   ", "estudiante.ficticio@alu.uct.cl")).toBe("estudiante.ficticio");
  });
});
