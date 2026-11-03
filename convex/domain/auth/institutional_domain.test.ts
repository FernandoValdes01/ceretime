import { describe, expect, test } from "vitest";
import {
  getInstitutionalPopulation,
  isAcceptedGoogleIdentity,
  isInstitutionalEmail,
  normalizeEmail,
} from "./institutional_domain";

describe("normalizeEmail", () => {
  test("recorta espacios y pasa a minúsculas", () => {
    expect(normalizeEmail("  Estudiante@ALU.uct.CL ")).toBe("estudiante@alu.uct.cl");
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

  test("rechaza correos inválidos aunque terminen con el sufijo", () => {
    expect(isInstitutionalEmail("@uct.cl")).toBe(false);
    expect(isInstitutionalEmail("@alu.uct.cl")).toBe(false);
    expect(isInstitutionalEmail("usuario@@uct.cl")).toBe(false);
    expect(isInstitutionalEmail("usuario@@alu.uct.cl")).toBe(false);
    expect(isInstitutionalEmail("sin-arroba")).toBe(false);
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

describe("isAcceptedGoogleIdentity", () => {
  const student = { email: "a@alu.uct.cl", emailVerified: true, hostedDomain: "alu.uct.cl" };
  const staff = { email: "b@uct.cl", emailVerified: true, hostedDomain: "uct.cl" };

  test("acepta la cuenta verificada del dominio de su población", () => {
    expect(isAcceptedGoogleIdentity(student, "estudiante")).toBe(true);
    expect(isAcceptedGoogleIdentity(staff, "personal")).toBe(true);
  });

  test("rechaza la cuenta de la otra población", () => {
    expect(isAcceptedGoogleIdentity(student, "personal")).toBe(false);
    expect(isAcceptedGoogleIdentity(staff, "estudiante")).toBe(false);
  });

  test("rechaza el correo sin verificar o personal", () => {
    expect(isAcceptedGoogleIdentity({ ...student, emailVerified: false }, "estudiante")).toBe(
      false,
    );
    expect(isAcceptedGoogleIdentity({ ...student, emailVerified: "true" }, "estudiante")).toBe(
      false,
    );
    const personal = { email: "a@gmail.com", emailVerified: true, hostedDomain: undefined };
    expect(isAcceptedGoogleIdentity(personal, "estudiante")).toBe(false);
    expect(isAcceptedGoogleIdentity(personal, "personal")).toBe(false);
  });

  test("rechaza un claim hd distinto al de la población", () => {
    expect(isAcceptedGoogleIdentity({ ...student, hostedDomain: "uct.cl" }, "estudiante")).toBe(
      false,
    );
    expect(isAcceptedGoogleIdentity({ ...staff, hostedDomain: "evil.com" }, "personal")).toBe(
      false,
    );
    expect(isAcceptedGoogleIdentity({ ...staff, hostedDomain: "" }, "personal")).toBe(false);
  });

  test("rechaza la cuenta de estudiante sin claim hd", () => {
    expect(isAcceptedGoogleIdentity({ ...student, hostedDomain: undefined }, "estudiante")).toBe(
      false,
    );
  });

  test("tolera personal sin claim hd mientras se confirma @uct.cl", () => {
    expect(isAcceptedGoogleIdentity({ ...staff, hostedDomain: undefined }, "personal")).toBe(true);
  });
});
