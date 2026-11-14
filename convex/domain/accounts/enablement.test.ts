import { describe, expect, test } from "vitest";
import {
  canEnableAsAdmin,
  canEnableAsProfessional,
  canEnableInternAsProfessional,
  checkEnablement,
  checkProfessionalInternEnablement,
  checkTestProfessionalEnablement,
  validateBootstrapCandidate,
  validateEnablementTarget,
  validateStaffEnablementTarget,
  validateStaffRevocationTarget,
  validateTestProfessionalTarget,
  type EnablementCaller,
  type EnablementTarget,
} from "./enablement";

function caller(overrides: Partial<EnablementCaller>): EnablementCaller {
  return {
    role: "admin",
    institutionalStatus: "enabled",
    accountStatus: "active",
    ...overrides,
  };
}

function target(overrides: Partial<EnablementTarget>): EnablementTarget {
  return {
    role: "intern",
    email: "practicante@alu.uct.cl",
    institutionalStatus: "pending",
    accountStatus: "active",
    ...overrides,
  };
}

describe("canEnableAsAdmin", () => {
  test("solo el administrador vigente puede habilitar", () => {
    expect(canEnableAsAdmin(caller({}))).toBe(true);
    expect(canEnableAsAdmin(caller({ role: "professional" }))).toBe(false);
    expect(canEnableAsAdmin(caller({ role: "intern" }))).toBe(false);
    expect(canEnableAsAdmin(caller({ role: "student" }))).toBe(false);
    expect(canEnableAsAdmin(caller({ institutionalStatus: "disabled" }))).toBe(false);
    expect(canEnableAsAdmin(caller({ institutionalStatus: "pending" }))).toBe(false);
    expect(canEnableAsAdmin(caller({ accountStatus: "inactive" }))).toBe(false);
  });
});

describe("validateEnablementTarget", () => {
  test("acepta al practicante pendiente con correo institucional y cuenta vigente", () => {
    expect(validateEnablementTarget(target({}))).toEqual({ ok: true });
    expect(validateEnablementTarget(target({ email: "  PRACTICANTE@ALU.UCT.CL " }))).toEqual({
      ok: true,
    });
  });

  test("rechaza roles que no son practicante para impedir escalamiento", () => {
    expect(validateEnablementTarget(target({ role: "admin" }))).toEqual({
      ok: false,
      reason: "target-not-intern",
    });
    expect(validateEnablementTarget(target({ role: "professional" }))).toEqual({
      ok: false,
      reason: "target-not-intern",
    });
    expect(validateEnablementTarget(target({ role: "student" }))).toEqual({
      ok: false,
      reason: "target-not-intern",
    });
  });

  test("rechaza correo no institucional y cuenta no vigente", () => {
    expect(validateEnablementTarget(target({ email: "externo@gmail.com" }))).toEqual({
      ok: false,
      reason: "target-email-not-institutional",
    });
    expect(validateEnablementTarget(target({ accountStatus: "inactive" }))).toEqual({
      ok: false,
      reason: "target-account-not-active",
    });
  });

  test("rechaza la cuenta ya habilitada para no sobrescribir la auditoría", () => {
    expect(validateEnablementTarget(target({ institutionalStatus: "enabled" }))).toEqual({
      ok: false,
      reason: "target-already-enabled",
    });
    expect(validateEnablementTarget(target({ institutionalStatus: "disabled" }))).toEqual({
      ok: false,
      reason: "target-not-pending",
    });
  });
});

describe("checkEnablement", () => {
  test("prioriza el permiso del actor sobre el estado del objetivo", () => {
    expect(checkEnablement({ caller: caller({ role: "student" }), target: target({}) })).toEqual({
      ok: false,
      reason: "caller-not-admin",
    });
    expect(
      checkEnablement({
        caller: caller({ institutionalStatus: "disabled" }),
        target: target({}),
      }),
    ).toEqual({ ok: false, reason: "caller-not-active" });
    expect(checkEnablement({ caller: caller({}), target: target({}) })).toEqual({ ok: true });
  });
});

describe("validateBootstrapCandidate", () => {
  test("solo admite al administrador inicial con correo de personal", () => {
    expect(validateBootstrapCandidate({ email: "admin@uct.cl", role: "admin" })).toEqual({
      ok: true,
    });
    expect(validateBootstrapCandidate({ email: "admin@alu.uct.cl", role: "admin" })).toEqual({
      ok: false,
      reason: "bootstrap-email-not-institutional",
    });
    expect(validateBootstrapCandidate({ email: "admin@gmail.com", role: "admin" })).toEqual({
      ok: false,
      reason: "bootstrap-email-not-institutional",
    });
    expect(validateBootstrapCandidate({ email: "admin@uct.cl", role: "intern" })).toEqual({
      ok: false,
      reason: "bootstrap-role-not-admin",
    });
  });

  test("rechaza correos inválidos aunque terminen con el sufijo", () => {
    for (const email of ["@uct.cl", "usuario@@uct.cl", "sin-arroba", "", "  @uct.cl  "]) {
      expect(validateBootstrapCandidate({ email, role: "admin" })).toEqual({
        ok: false,
        reason: "bootstrap-email-not-institutional",
      });
    }
  });
});

describe("validateStaffEnablementTarget", () => {
  test("acepta profesional y administrador de personal pendientes o revocados", () => {
    expect(
      validateStaffEnablementTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
    expect(
      validateStaffEnablementTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "disabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
    expect(
      validateStaffEnablementTarget({
        role: "admin",
        email: "adm@uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
  });

  test("rechaza practicante, correo no personal y cuenta ya habilitada", () => {
    expect(
      validateStaffEnablementTarget({
        role: "intern",
        email: "practicante@alu.uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-not-staff" });
    expect(
      validateStaffEnablementTarget({
        role: "professional",
        email: "pro@alu.uct.cl",
        institutionalStatus: "disabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-email-not-institutional" });
    expect(
      validateStaffEnablementTarget({
        role: "admin",
        email: "adm@alu.uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-email-not-institutional" });
    expect(
      validateStaffEnablementTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "enabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-already-enabled" });
  });
});

describe("validateStaffRevocationTarget", () => {
  test("solo revoca profesional o administrador habilitado y vigente", () => {
    expect(
      validateStaffRevocationTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "enabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
    expect(
      validateStaffRevocationTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
    expect(
      validateStaffRevocationTarget({
        role: "intern",
        email: "practicante@alu.uct.cl",
        institutionalStatus: "enabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-not-staff" });
  });
});

describe("habilitación por el profesional y cuenta de prueba (TI2-140)", () => {
  test("solo el profesional vigente habilita practicantes", () => {
    expect(canEnableAsProfessional(caller({ role: "professional" }))).toBe(true);
    expect(canEnableInternAsProfessional(caller({ role: "professional" }))).toBe(true);
    expect(canEnableAsProfessional(caller({ role: "admin" }))).toBe(false);
    expect(
      canEnableAsProfessional(caller({ role: "professional", institutionalStatus: "disabled" })),
    ).toBe(false);
  });

  test("el profesional habilita al practicante pendiente", () => {
    expect(
      checkProfessionalInternEnablement({
        caller: caller({ role: "professional" }),
        target: target({}),
      }),
    ).toEqual({ ok: true });
    expect(
      checkProfessionalInternEnablement({
        caller: caller({ role: "admin" }),
        target: target({}),
      }),
    ).toEqual({ ok: false, reason: "caller-not-professional" });
    expect(
      checkProfessionalInternEnablement({
        caller: caller({ role: "professional", institutionalStatus: "disabled" }),
        target: target({}),
      }),
    ).toEqual({ ok: false, reason: "caller-not-active" });
  });

  test("la cuenta de prueba exige rol profesional con correo @alu.uct.cl", () => {
    expect(
      validateTestProfessionalTarget({
        role: "professional",
        email: "prueba@alu.uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
    expect(
      validateTestProfessionalTarget({
        role: "professional",
        email: "prueba@alu.uct.cl",
        institutionalStatus: "disabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: true });
    expect(
      validateTestProfessionalTarget({
        role: "professional",
        email: "pro@uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-email-not-test" });
    expect(
      validateTestProfessionalTarget({
        role: "intern",
        email: "prueba@alu.uct.cl",
        institutionalStatus: "pending",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-not-professional" });
    expect(
      validateTestProfessionalTarget({
        role: "professional",
        email: "prueba@alu.uct.cl",
        institutionalStatus: "enabled",
        accountStatus: "active",
      }),
    ).toEqual({ ok: false, reason: "target-already-enabled" });
  });

  test("administrador o profesional vigente habilita la cuenta de prueba", () => {
    const targetArg = {
      role: "professional" as const,
      email: "prueba@alu.uct.cl",
      institutionalStatus: "pending" as const,
      accountStatus: "active" as const,
    };
    expect(checkTestProfessionalEnablement({ caller: caller({}), target: targetArg })).toEqual({
      ok: true,
    });
    expect(
      checkTestProfessionalEnablement({
        caller: caller({ role: "professional" }),
        target: targetArg,
      }),
    ).toEqual({ ok: true });
    expect(
      checkTestProfessionalEnablement({
        caller: caller({ role: "student" }),
        target: targetArg,
      }),
    ).toEqual({ ok: false, reason: "caller-not-authorized" });
    expect(
      checkTestProfessionalEnablement({
        caller: caller({ role: "professional", institutionalStatus: "disabled" }),
        target: targetArg,
      }),
    ).toEqual({ ok: false, reason: "caller-not-active" });
  });
});
