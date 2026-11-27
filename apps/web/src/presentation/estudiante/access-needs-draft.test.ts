import { describe, expect, test } from "vitest";
import { ACCESS_NEEDS_MAX_LENGTH } from "../../../../../convex/domain/index.ts";
import { toAccessNeedsDraft, toAccessNeedsText } from "./access-needs-draft.ts";

/** Borrador de necesidades de acceso del acompañamiento (TI2-166). Datos ficticios. */
describe("toAccessNeedsDraft", () => {
  test("marca las líneas que son opciones y deja el resto como necesidad libre", () => {
    expect(
      toAccessNeedsDraft("Persona de apoyo\n\n  Comunicación escrita \nNecesito pausas\nOtra más"),
    ).toEqual({
      accessNeedIds: ["support-person", "written-communication"],
      otherAccessNeed: "Necesito pausas\nOtra más",
    });
  });

  test("un texto anterior sin opciones queda completo como necesidad libre", () => {
    expect(toAccessNeedsDraft("Apoyo ficticio para la prueba")).toEqual({
      accessNeedIds: [],
      otherAccessNeed: "Apoyo ficticio para la prueba",
    });
  });

  test("una opción repetida se marca una sola vez", () => {
    expect(toAccessNeedsDraft("Persona de apoyo\nPersona de apoyo").accessNeedIds).toEqual([
      "support-person",
    ]);
  });
});

describe("toAccessNeedsText", () => {
  test("arma el texto en el orden de las opciones, con la necesidad libre al final", () => {
    expect(
      toAccessNeedsText({
        accessNeedIds: ["support-person", "written-communication"],
        otherAccessNeed: "  Necesito pausas  ",
      }),
    ).toEqual({ status: "ok", text: "Comunicación escrita\nPersona de apoyo\nNecesito pausas" });
  });

  test("vacío o demasiado largo devuelve un mensaje para el campo", () => {
    expect(toAccessNeedsText({ accessNeedIds: [], otherAccessNeed: "   " })).toEqual({
      status: "error",
      message: "Elige al menos una necesidad o describe otra.",
    });
    expect(
      toAccessNeedsText({
        accessNeedIds: [],
        otherAccessNeed: "a".repeat(ACCESS_NEEDS_MAX_LENGTH + 1),
      }).status,
    ).toBe("error");
  });
});
