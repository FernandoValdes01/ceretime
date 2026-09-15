import { describe, expect, test } from "vitest";
import {
  canEnableAsAdmin,
  checkEnablement,
  validateBootstrapCandidate,
  validateEnablementTarget,
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
  test("prioriza el permiso del llamante sobre el estado del objetivo", () => {
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

  test("rechaza correos malformados aunque terminen con el sufijo", () => {
    for (const email of ["@uct.cl", "usuario@@uct.cl", "sin-arroba", "", "  @uct.cl  "]) {
      expect(validateBootstrapCandidate({ email, role: "admin" })).toEqual({
        ok: false,
        reason: "bootstrap-email-not-institutional",
      });
    }
  });
});
