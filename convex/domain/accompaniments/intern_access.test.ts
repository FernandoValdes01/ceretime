import { describe, expect, test } from "vitest";
import {
  checkGrantInternAccess,
  checkRevokeInternAccess,
  isAuthorizedProfessionalCaller,
  type InternAccessCaller,
  type InternAccessTarget,
} from "./intern_access";

function caller(overrides: Partial<InternAccessCaller>): InternAccessCaller {
  return {
    role: "professional",
    institutionalStatus: "enabled",
    accountStatus: "active",
    hasActiveProfessionalAssignment: true,
    ...overrides,
  };
}

function target(overrides: Partial<InternAccessTarget>): InternAccessTarget {
  return {
    role: "intern",
    institutionalStatus: "enabled",
    accountStatus: "active",
    ...overrides,
  };
}

describe("isAuthorizedProfessionalCaller", () => {
  test("exige profesional vigente con asignación activa", () => {
    expect(isAuthorizedProfessionalCaller(caller({}))).toBe(true);
    expect(isAuthorizedProfessionalCaller(caller({ role: "admin" }))).toBe(false);
    expect(isAuthorizedProfessionalCaller(caller({ role: "intern" }))).toBe(false);
    expect(isAuthorizedProfessionalCaller(caller({ institutionalStatus: "disabled" }))).toBe(false);
    expect(isAuthorizedProfessionalCaller(caller({ accountStatus: "inactive" }))).toBe(false);
    expect(isAuthorizedProfessionalCaller(caller({ hasActiveProfessionalAssignment: false }))).toBe(
      false,
    );
  });
});

describe("checkGrantInternAccess", () => {
  test("acepta al profesional autorizado con practicante habilitado", () => {
    expect(checkGrantInternAccess({ caller: caller({}), target: target({}) })).toEqual({
      ok: true,
    });
  });

  test("rechaza al llamante no profesional o no vigente antes que al objetivo", () => {
    expect(
      checkGrantInternAccess({ caller: caller({ role: "intern" }), target: target({}) }),
    ).toEqual({ ok: false, reason: "caller-not-professional" });
    expect(
      checkGrantInternAccess({
        caller: caller({ institutionalStatus: "disabled" }),
        target: target({}),
      }),
    ).toEqual({ ok: false, reason: "caller-not-active" });
    expect(
      checkGrantInternAccess({
        caller: caller({ hasActiveProfessionalAssignment: false }),
        target: target({ role: "student" }),
      }),
    ).toEqual({ ok: false, reason: "caller-not-assigned" });
  });

  test("rechaza al objetivo que no es practicante habilitado", () => {
    expect(
      checkGrantInternAccess({ caller: caller({}), target: target({ role: "student" }) }),
    ).toEqual({ ok: false, reason: "target-not-intern" });
    expect(
      checkGrantInternAccess({
        caller: caller({}),
        target: target({ institutionalStatus: "disabled" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
    expect(
      checkGrantInternAccess({
        caller: caller({}),
        target: target({ institutionalStatus: "pending" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
    expect(
      checkGrantInternAccess({
        caller: caller({}),
        target: target({ accountStatus: "inactive" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
  });
});

describe("checkRevokeInternAccess", () => {
  test("acepta al profesional autorizado con practicante habilitado", () => {
    expect(checkRevokeInternAccess({ caller: caller({}), target: target({}) })).toEqual({
      ok: true,
    });
  });

  test("rechaza al llamante no autorizado", () => {
    expect(
      checkRevokeInternAccess({ caller: caller({ role: "admin" }), target: target({}) }),
    ).toEqual({
      ok: false,
      reason: "caller-not-professional",
    });
    expect(
      checkRevokeInternAccess({
        caller: caller({ accountStatus: "inactive" }),
        target: target({}),
      }),
    ).toEqual({
      ok: false,
      reason: "caller-not-active",
    });
    expect(
      checkRevokeInternAccess({
        caller: caller({ hasActiveProfessionalAssignment: false }),
        target: target({}),
      }),
    ).toEqual({ ok: false, reason: "caller-not-assigned" });
  });

  test("rechaza al objetivo que no es practicante habilitado", () => {
    expect(
      checkRevokeInternAccess({ caller: caller({}), target: target({ role: "student" }) }),
    ).toEqual({ ok: false, reason: "target-not-intern" });
    expect(
      checkRevokeInternAccess({
        caller: caller({}),
        target: target({ institutionalStatus: "disabled" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
    expect(
      checkRevokeInternAccess({
        caller: caller({}),
        target: target({ institutionalStatus: "pending" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
    expect(
      checkRevokeInternAccess({
        caller: caller({}),
        target: target({ accountStatus: "inactive" }),
      }),
    ).toEqual({ ok: false, reason: "target-not-enabled" });
  });
});
