import { describe, expect, test } from "vitest";
import {
  ASSIGNMENT_VIEW_BY_ROLE,
  toAssignmentReadPermission,
  type PractitionerAssignment,
} from "./practitioner-assignment";

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
});
