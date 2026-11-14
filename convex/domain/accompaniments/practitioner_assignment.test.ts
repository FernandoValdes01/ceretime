import { describe, expect, test } from "vitest";
import {
  ASSIGNMENT_VIEW_BY_ROLE,
  isAssignmentWithinValidity,
  toAssignmentReadPermission,
  validateAssignmentValidity,
  type PractitionerAssignment,
} from "./practitioner_assignment";

function activeAssignment(overrides: Partial<PractitionerAssignment> = {}): PractitionerAssignment {
  return {
    _id: "assignment-id",
    accompanimentId: "accompaniment-id",
    userId: "user-id",
    assignedRole: "professional",
    status: "active",
    grantedBy: "grantor-id",
    grantedAt: 1000,
    revokedBy: null,
    revokedAt: null,
    ...overrides,
  };
}

describe("toAssignmentReadPermission", () => {
  test("concede lectura completa al Profesional mientras esté activa", () => {
    expect(toAssignmentReadPermission(activeAssignment())).toEqual({
      accompanimentId: "accompaniment-id",
      userId: "user-id",
      role: "professional",
      view: "full",
      grantedAt: 1000,
    });
  });

  test("concede lectura minimizada al Practicante sin accessNeeds", () => {
    expect(toAssignmentReadPermission(activeAssignment({ assignedRole: "intern" }))).toMatchObject({
      role: "intern",
      view: "minimized",
    });
  });

  test("una fila revocada no concede permiso de lectura", () => {
    expect(
      toAssignmentReadPermission(
        activeAssignment({
          status: "revoked",
          revokedBy: "grantor-id",
          revokedAt: 2000,
        }),
      ),
    ).toBeNull();
  });

  test("la vista por rol cubre todos los roles asignables", () => {
    expect(ASSIGNMENT_VIEW_BY_ROLE).toEqual({ professional: "full", intern: "minimized" });
  });

  test("una fila legacy sin trazabilidad también concede lectura si está activa", () => {
    const legacy: PractitionerAssignment = {
      _id: "assignment-id",
      accompanimentId: "accompaniment-id",
      userId: "user-id",
      assignedRole: "professional",
      status: "active",
    };
    expect(toAssignmentReadPermission(legacy)).toEqual({
      accompanimentId: "accompaniment-id",
      userId: "user-id",
      role: "professional",
      view: "full",
      grantedAt: undefined,
    });
  });

  test("una asignación nueva completa conserva toda la trazabilidad", () => {
    const fresh: PractitionerAssignment = {
      _id: "assignment-id",
      accompanimentId: "accompaniment-id",
      userId: "user-id",
      assignedRole: "intern",
      status: "active",
      grantedBy: "grantor-id",
      grantedAt: 1000,
    };
    const permission = toAssignmentReadPermission(fresh);
    expect(permission).toMatchObject({
      accompanimentId: "accompaniment-id",
      userId: "user-id",
      role: "intern",
      view: "minimized",
      grantedAt: 1000,
    });
  });
});

describe("validateAssignmentValidity", () => {
  test("acepta ausencia y ventanas coherentes", () => {
    expect(validateAssignmentValidity({})).toEqual({ ok: true });
    expect(validateAssignmentValidity({ validFrom: 1000 })).toEqual({ ok: true });
    expect(validateAssignmentValidity({ validUntil: 2000 })).toEqual({ ok: true });
    expect(validateAssignmentValidity({ validFrom: 1000, validUntil: 2000 })).toEqual({
      ok: true,
    });
    expect(validateAssignmentValidity({ validFrom: 2000, validUntil: 2000 })).toEqual({
      ok: true,
    });
  });

  test("rechaza rango invertido y valores no finitos", () => {
    expect(validateAssignmentValidity({ validFrom: 3000, validUntil: 2000 })).toEqual({
      ok: false,
      reason: "validity-range-invalid",
    });
    expect(validateAssignmentValidity({ validFrom: -1 })).toEqual({
      ok: false,
      reason: "validity-not-finite",
    });
    expect(validateAssignmentValidity({ validUntil: Number.NaN })).toEqual({
      ok: false,
      reason: "validity-not-finite",
    });
  });
});

describe("isAssignmentWithinValidity", () => {
  test("sin ventana declara vigente y con ventana acota", () => {
    expect(isAssignmentWithinValidity({}, 1500)).toBe(true);
    expect(isAssignmentWithinValidity({ validFrom: 1000, validUntil: 2000 }, 1500)).toBe(true);
    expect(isAssignmentWithinValidity({ validFrom: 1000, validUntil: 2000 }, 500)).toBe(false);
    expect(isAssignmentWithinValidity({ validFrom: 1000, validUntil: 2000 }, 2500)).toBe(false);
  });
});
