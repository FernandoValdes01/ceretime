import { describe, expect, expectTypeOf, test } from "vitest";
import {
  ACCOMPANIMENT_REASON_MAX_LENGTH,
  ACCOMPANIMENT_STATUS_VALUES,
  toAccompanimentProjection,
  transitionAccompaniment,
} from "./accompaniment";
import type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  MinimizedAccompaniment,
} from "./accompaniment";

describe("Vistas de acompañamiento (TI2-8)", () => {
  test("la vista completa lleva studentId y accessNeeds", () => {
    expectTypeOf<Accompaniment>().toMatchTypeOf<{
      _id: string;
      studentId: string;
      status: string;
      objective: string;
      accessNeeds: string;
      view: "full";
    }>();
  });

  test("la vista minimizada no es la completa: sin studentId ni accessNeeds", () => {
    expectTypeOf<MinimizedAccompaniment>().toMatchTypeOf<{
      _id: string;
      status: string;
      objective: string;
      view: "minimized";
    }>();
    expectTypeOf<MinimizedAccompaniment>().not.toEqualTypeOf<Accompaniment>();
  });

  test("ambas vistas se consumen como una sola proyección", () => {
    expectTypeOf<Accompaniment>().toMatchTypeOf<AccompanimentProjection>();
    expectTypeOf<MinimizedAccompaniment>().toMatchTypeOf<AccompanimentProjection>();
  });

  test("la vista minimizada no expone studentId ni accessNeeds", () => {
    const minimized: MinimizedAccompaniment = {
      _id: "a",
      status: "active",
      objective: "O",
      view: "minimized",
    };
    expect("studentId" in minimized).toBe(false);
    expect("accessNeeds" in minimized).toBe(false);
  });
});

describe("toAccompanimentProjection (TI2-8)", () => {
  const row: AccompanimentRow = {
    _id: "accompaniment-id",
    studentId: "student-id",
    status: "active",
    objective: "Objetivo ficticio",
    accessNeeds: "Acceso ficticio",
  };

  test("la vista completa conserva todos los campos de la fila", () => {
    expect(toAccompanimentProjection(row, "full")).toEqual({
      _id: "accompaniment-id",
      studentId: "student-id",
      status: "active",
      objective: "Objetivo ficticio",
      accessNeeds: "Acceso ficticio",
      view: "full",
    });
  });

  test("la vista minimizada recorta studentId y accessNeeds aunque la fila los traiga", () => {
    const projected = toAccompanimentProjection(row, "minimized");
    expect(projected).toEqual({
      _id: "accompaniment-id",
      status: "active",
      objective: "Objetivo ficticio",
      view: "minimized",
    });
    expect("studentId" in projected).toBe(false);
    expect("accessNeeds" in projected).toBe(false);
  });
});

describe("Cambios de estado del acompañamiento (TI2-152)", () => {
  const attempt = { actorId: "professional-1", occurredAt: 1_000 };

  test("pausar, reactivar y cerrar son los únicos cambios válidos", () => {
    const allowed = new Set(["active>paused", "paused>active", "active>closed", "paused>closed"]);
    for (const from of ACCOMPANIMENT_STATUS_VALUES) {
      for (const to of ACCOMPANIMENT_STATUS_VALUES) {
        const result = transitionAccompaniment({ ...attempt, from, to });
        expect(result.status).toBe(allowed.has(`${from}>${to}`) ? "applied" : "rejected");
      }
    }
  });

  test("un acompañamiento cerrado no se reabre ni vuelve a pausarse", () => {
    for (const to of ACCOMPANIMENT_STATUS_VALUES) {
      expect(transitionAccompaniment({ ...attempt, from: "closed", to })).toEqual({
        status: "rejected",
        cause: "transition_not_allowed",
      });
    }
  });

  test("el motivo es opcional: sin texto o en blanco no queda en el cambio", () => {
    expect(transitionAccompaniment({ ...attempt, from: "active", to: "paused" })).toEqual({
      status: "applied",
      change: { from: "active", to: "paused", ...attempt },
    });
    const blank = transitionAccompaniment({
      ...attempt,
      from: "active",
      to: "closed",
      reason: "   ",
    });
    expect(blank).toEqual({
      status: "applied",
      change: { from: "active", to: "closed", ...attempt },
    });
  });

  test("el motivo entregado se guarda recortado y respeta el tope", () => {
    const result = transitionAccompaniment({
      ...attempt,
      from: "paused",
      to: "active",
      reason: "  Retoma el semestre  ",
    });
    expect(result).toEqual({
      status: "applied",
      change: { from: "paused", to: "active", ...attempt, reason: "Retoma el semestre" },
    });
    expect(
      transitionAccompaniment({
        ...attempt,
        from: "active",
        to: "paused",
        reason: "a".repeat(ACCOMPANIMENT_REASON_MAX_LENGTH + 1),
      }),
    ).toEqual({ status: "rejected", cause: "reason_too_long" });
  });

  test("sin actor o sin instante válido no hay cambio", () => {
    expect(
      transitionAccompaniment({ from: "active", to: "paused", actorId: " ", occurredAt: 1_000 }),
    ).toEqual({ status: "rejected", cause: "actor_required" });
    for (const occurredAt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(
        transitionAccompaniment({ from: "active", to: "paused", actorId: "p", occurredAt }),
      ).toEqual({ status: "rejected", cause: "occurred_at_invalid" });
    }
  });
});
