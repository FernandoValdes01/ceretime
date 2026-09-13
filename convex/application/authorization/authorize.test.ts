import { describe, expect, test } from "vitest";
import {
  authorizeAccompanimentRead,
  authorizeInternalNoteRead,
  AUTHORIZATION_DENIED_MESSAGE,
  type AuthorizableAssignment,
  type AuthorizableProfile,
} from "./authorize";

const accompaniment = { _id: "acc-1", studentId: "user-student" };

function profile(overrides: Partial<AuthorizableProfile>): AuthorizableProfile {
  return {
    _id: "user-student",
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
    ...overrides,
  };
}

function assignment(overrides: Partial<AuthorizableAssignment>): AuthorizableAssignment {
  return {
    accompanimentId: "acc-1",
    userId: "user-pro",
    assignedRole: "professional",
    status: "active",
    ...overrides,
  };
}

describe("authorizeAccompanimentRead", () => {
  test("asignación revocada no autoriza", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ status: "revoked" })],
      }),
    ).toBe(null);
  });

  test("asignación de otro acompañamiento no autoriza", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ accompanimentId: "acc-otro" })],
      }),
    ).toBe(null);
  });

  test("rol cruzado no autoriza (profesional con asignación de practicante)", () => {
    expect(
      authorizeAccompanimentRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ assignedRole: "intern" })],
      }),
    ).toBe(null);
  });

  test("mensaje genérico único para denegación", () => {
    expect(AUTHORIZATION_DENIED_MESSAGE).toBe("No autorizado");
  });
});

describe("authorizeInternalNoteRead", () => {
  test("revocación quita acceso a notas", () => {
    expect(
      authorizeInternalNoteRead({
        profile: profile({ _id: "user-pro", role: "professional" }),
        accompaniment,
        assignments: [assignment({ status: "revoked" })],
      }),
    ).toBe(false);
  });
});
