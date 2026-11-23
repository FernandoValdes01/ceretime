import { describe, expect, expectTypeOf, test } from "vitest";
import {
  ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH,
  ACCOMPANIMENT_STATUS_VALUES,
  mustKeepAProfessional,
  toAccompanimentProjection,
  transitionAccompaniment,
} from "./accompaniment";
import { deriveCoordinationReferenceCode } from "../availability/official_channel";
import type {
  Accompaniment,
  AccompanimentProjection,
  AccompanimentRow,
  MinimizedAccompaniment,
} from "./accompaniment";

describe("Vistas de acompañamiento (TI2-8)", () => {
  test("la vista completa lleva studentId, accessNeeds y referenceCode", () => {
    expectTypeOf<Accompaniment>().toMatchTypeOf<{
      _id: string;
      studentId: string;
      status: string;
      objective: string;
      accessNeeds: string;
      referenceCode: string;
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
      referenceCode: deriveCoordinationReferenceCode("accompaniment-id"),
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

  test("solo la vista completa lleva el requestId de origen (TI2-183)", () => {
    const fromRequest: AccompanimentRow = { ...row, requestId: "request-id" };
    expect(toAccompanimentProjection(fromRequest, "full")).toMatchObject({
      requestId: "request-id",
    });
    expect("requestId" in toAccompanimentProjection(row, "full")).toBe(false);
    expect("requestId" in toAccompanimentProjection(fromRequest, "minimized")).toBe(false);
  });

  test("solo la vista completa lleva el referenceCode de la coordinación (TI2-183)", () => {
    expect(toAccompanimentProjection(row, "full")).toMatchObject({
      referenceCode: deriveCoordinationReferenceCode(row._id),
    });
    expect("referenceCode" in toAccompanimentProjection(row, "minimized")).toBe(false);
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

  test("pausar y reactivar solo cambian el estado", () => {
    expect(transitionAccompaniment({ ...attempt, from: "active", to: "paused" })).toEqual({
      status: "applied",
      change: { to: "paused" },
    });
    expect(transitionAccompaniment({ ...attempt, from: "paused", to: "active" })).toEqual({
      status: "applied",
      change: { to: "active" },
    });
  });

  test("pausar o reactivar con motivo se rechaza: el MER solo guarda el del cierre", () => {
    for (const [from, to] of [
      ["active", "paused"],
      ["paused", "active"],
    ] as const) {
      expect(transitionAccompaniment({ ...attempt, from, to, closureReason: "Receso" })).toEqual({
        status: "rejected",
        cause: "closure_reason_not_allowed",
      });
    }
    expect(
      transitionAccompaniment({ ...attempt, from: "active", to: "paused", closureReason: "  " }),
    ).toEqual({ status: "applied", change: { to: "paused" } });
  });

  test("el cierre guarda quién cerró, cuándo y el motivo recortado si se entregó", () => {
    const closure = { closedById: "professional-1", closedAt: 1_000 };
    for (const closureReason of [undefined, "   "]) {
      expect(
        transitionAccompaniment({
          ...attempt,
          from: "active",
          to: "closed",
          ...(closureReason === undefined ? {} : { closureReason }),
        }),
      ).toEqual({ status: "applied", change: { to: "closed", closure } });
    }
    expect(
      transitionAccompaniment({
        ...attempt,
        from: "paused",
        to: "closed",
        closureReason: "  Objetivo cumplido  ",
      }),
    ).toEqual({
      status: "applied",
      change: { to: "closed", closure: { ...closure, closureReason: "Objetivo cumplido" } },
    });
    expect(
      transitionAccompaniment({
        ...attempt,
        from: "active",
        to: "closed",
        closureReason: "a".repeat(ACCOMPANIMENT_CLOSURE_REASON_MAX_LENGTH + 1),
      }),
    ).toEqual({ status: "rejected", cause: "closure_reason_too_long" });
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

describe("mustKeepAProfessional (TI2-165)", () => {
  test("solo un acompañamiento cerrado puede quedar sin profesional", () => {
    expect(mustKeepAProfessional("active")).toBe(true);
    expect(mustKeepAProfessional("paused")).toBe(true);
    expect(mustKeepAProfessional("closed")).toBe(false);
  });
});
