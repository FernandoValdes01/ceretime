import { describe, expect, test } from "vitest";
import {
  canReadInternalNote,
  getAccompanimentView,
  isProfileActive,
  PERMISSION_MATRIX,
  type AuthorizationContext,
} from "./permissions";

function activeContext(overrides: Partial<AuthorizationContext>): AuthorizationContext {
  return {
    role: "student",
    institutionalStatus: "enabled",
    accountStatus: "active",
    isOwner: false,
    hasActiveProfessionalAssignment: false,
    hasActiveInternAssignment: false,
    ...overrides,
  };
}

describe("isProfileActive", () => {
  test("exige habilitación y vigencia", () => {
    expect(isProfileActive({ institutionalStatus: "enabled", accountStatus: "active" })).toBe(true);
    expect(isProfileActive({ institutionalStatus: "disabled", accountStatus: "active" })).toBe(
      false,
    );
    expect(isProfileActive({ institutionalStatus: "pending", accountStatus: "active" })).toBe(
      false,
    );
    expect(isProfileActive({ institutionalStatus: "enabled", accountStatus: "inactive" })).toBe(
      false,
    );
  });
});

describe("getAccompanimentView", () => {
  test("estudiante solo ve los propios en vista completa", () => {
    expect(getAccompanimentView(activeContext({ role: "student", isOwner: true }))).toBe("full");
    expect(getAccompanimentView(activeContext({ role: "student", isOwner: false }))).toBe(null);
  });

  test("profesional solo ve asignados activos en vista completa", () => {
    expect(
      getAccompanimentView(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe("full");
    expect(
      getAccompanimentView(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      ),
    ).toBe(null);
  });

  test("practicante solo ve asignados activos en vista minimizada", () => {
    expect(
      getAccompanimentView(activeContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe("minimized");
    expect(
      getAccompanimentView(activeContext({ role: "intern", hasActiveInternAssignment: false })),
    ).toBe(null);
  });

  test("administrador nunca accede a acompañamientos", () => {
    expect(
      getAccompanimentView(
        activeContext({
          role: "admin",
          isOwner: true,
          hasActiveProfessionalAssignment: true,
          hasActiveInternAssignment: true,
        }),
      ),
    ).toBe(null);
  });

  test("cuenta inhabilitada deniega aunque exista relación", () => {
    expect(
      getAccompanimentView(
        activeContext({
          role: "professional",
          institutionalStatus: "disabled",
          hasActiveProfessionalAssignment: true,
        }),
      ),
    ).toBe(null);
    expect(
      getAccompanimentView(
        activeContext({
          role: "student",
          accountStatus: "inactive",
          isOwner: true,
        }),
      ),
    ).toBe(null);
  });
});

describe("canReadInternalNote", () => {
  test("solo profesional asignado puede leer notas internas", () => {
    expect(
      canReadInternalNote(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: true }),
      ),
    ).toBe(true);
  });

  test("niega a estudiante dueño, practicante asignado y administrador", () => {
    expect(canReadInternalNote(activeContext({ role: "student", isOwner: true }))).toBe(false);
    expect(
      canReadInternalNote(activeContext({ role: "intern", hasActiveInternAssignment: true })),
    ).toBe(false);
    expect(
      canReadInternalNote(
        activeContext({
          role: "admin",
          hasActiveProfessionalAssignment: true,
          hasActiveInternAssignment: true,
        }),
      ),
    ).toBe(false);
    expect(
      canReadInternalNote(
        activeContext({ role: "professional", hasActiveProfessionalAssignment: false }),
      ),
    ).toBe(false);
  });
});

describe("PERMISSION_MATRIX", () => {
  test("documenta los dos casos de uso base", () => {
    expect(PERMISSION_MATRIX.map((row) => row.action)).toEqual([
      "accompaniment:read",
      "internalNote:read",
    ]);
  });
});
