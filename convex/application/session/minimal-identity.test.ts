import { describe, expect, test } from "bun:test";
import { toMinimalIdentity } from "./minimal-identity";

describe("toMinimalIdentity", () => {
  test("conserva solo correo, nombre y población", () => {
    expect(
      toMinimalIdentity({ email: "a@alu.uct.cl", name: " Ana " }),
    ).toEqual({ email: "a@alu.uct.cl", name: "Ana", population: "estudiante" });
    expect(toMinimalIdentity({ email: "b@uct.cl", name: "Luz" })).toEqual({
      email: "b@uct.cl",
      name: "Luz",
      population: "personal",
    });
  });

  test("normaliza el correo antes de validar", () => {
    const result = toMinimalIdentity({
      email: "  C@UCT.cl ",
      name: "Luz",
    });
    expect(result?.email).toBe("c@uct.cl");
    expect(result?.population).toBe("personal");
  });

  test("rechaza correos no institucionales sin exponer motivo", () => {
    expect(
      toMinimalIdentity({ email: "a@gmail.com", name: "Ana" }),
    ).toBe(null);
    expect(toMinimalIdentity({ email: "", name: "Ana" })).toBe(null);
    expect(toMinimalIdentity({ email: null, name: "Ana" })).toBe(null);
  });

  test("acepta nombre ausente como cadena vacía", () => {
    expect(toMinimalIdentity({ email: "a@alu.uct.cl", name: null })).toEqual({
      email: "a@alu.uct.cl",
      name: "",
      population: "estudiante",
    });
  });
});
