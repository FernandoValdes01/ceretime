import { describe, expect, test } from "bun:test";
import {
  getHostedDomainForPopulation,
  getInstitutionalPopulation,
  isInstitutionalEmail,
  normalizeEmail,
} from "./institutional-domain";

describe("normalizeEmail", () => {
  test("recorta espacios y pasa a minúsculas", () => {
    expect(normalizeEmail("  Estudiante@ALU.uct.CL ")).toBe(
      "estudiante@alu.uct.cl",
    );
  });

  test("devuelve vacío ante valores no textuales", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
    expect(normalizeEmail(42)).toBe("");
  });
});

describe("isInstitutionalEmail", () => {
  test("acepta ambos dominios institucionales", () => {
    expect(isInstitutionalEmail("nombre@alu.uct.cl")).toBe(true);
    expect(isInstitutionalEmail("nombre@uct.cl")).toBe(true);
  });

  test("rechaza correos fuera de la institución", () => {
    expect(isInstitutionalEmail("nombre@gmail.com")).toBe(false);
    expect(isInstitutionalEmail("nombre@uct.cl.evil.com")).toBe(false);
    expect(isInstitutionalEmail("")).toBe(false);
    expect(isInstitutionalEmail(null)).toBe(false);
  });
});

describe("getInstitutionalPopulation", () => {
  test("distingue estudiante de personal por sufijo", () => {
    expect(getInstitutionalPopulation("a@alu.uct.cl")).toBe("estudiante");
    expect(getInstitutionalPopulation("b@uct.cl")).toBe("personal");
  });

  test("devuelve null fuera de la institución", () => {
    expect(getInstitutionalPopulation("a@gmail.com")).toBe(null);
  });
});

describe("getHostedDomainForPopulation", () => {
  test("mapea cada población a su hd de Workspace", () => {
    expect(getHostedDomainForPopulation("estudiante")).toBe("alu.uct.cl");
    expect(getHostedDomainForPopulation("personal")).toBe("uct.cl");
  });
});
