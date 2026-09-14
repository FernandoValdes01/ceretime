import { describe, expect, test } from "vitest";
import {
  findSprint1Transition,
  transitionRequest,
  type RequestTransitionAttempt,
} from "./transition_policy";
import { SPRINT_1_REQUEST_TRANSITIONS } from "./transitions";

/** Datos ficticios: el actor no corresponde a ninguna persona real. */
const actor = { actorId: "profesional-ficticio-1", occurredAt: 1_700_000_000_000 };

describe("findSprint1Transition", () => {
  test("encuentra cada transición declarada en la tabla", () => {
    for (const row of SPRINT_1_REQUEST_TRANSITIONS) {
      expect(findSprint1Transition(row.from, row.to)).toBe(row);
    }
  });
});

describe("transitionRequest", () => {
  test("aplica cada transición de Sprint 1 registrando actor y fecha", () => {
    for (const row of SPRINT_1_REQUEST_TRANSITIONS) {
      const result = transitionRequest({ ...actor, from: row.from, to: row.to, reason: "motivo" });
      expect(result).toMatchObject({
        status: "applied",
        change: { from: row.from, to: row.to, ...actor },
      });
    }
  });

  test("conserva el motivo recortado en el paso a espera", () => {
    const result = transitionRequest({
      ...actor,
      from: "under_review",
      to: "awaiting_information_or_acceptance",
      reason: "  falta el certificado de matrícula  ",
    });
    expect(result).toEqual({
      status: "applied",
      change: {
        from: "under_review",
        to: "awaiting_information_or_acceptance",
        ...actor,
        reason: "falta el certificado de matrícula",
      },
      opensAccompaniment: false,
    });
  });

  test("conserva el motivo aunque la transición no lo exija", () => {
    const result = transitionRequest({
      ...actor,
      from: "received",
      to: "under_review",
      reason: "llegó por correo institucional",
    });
    expect(result).toMatchObject({ change: { reason: "llegó por correo institucional" } });
  });

  test("no agrega la clave reason cuando no llega motivo", () => {
    const result = transitionRequest({ ...actor, from: "received", to: "under_review" });
    expect(result).toStrictEqual({
      status: "applied",
      change: { from: "received", to: "under_review", ...actor },
      opensAccompaniment: false,
    });
  });

  test("recorta el actor antes de registrarlo", () => {
    const result = transitionRequest({
      ...actor,
      actorId: "  profesional-ficticio-1  ",
      from: "received",
      to: "under_review",
    });
    expect(result).toMatchObject({ change: { actorId: "profesional-ficticio-1" } });
  });

  test("señala la apertura del acompañamiento solo al llegar a accepted", () => {
    for (const row of SPRINT_1_REQUEST_TRANSITIONS) {
      const result = transitionRequest({ ...actor, from: row.from, to: row.to, reason: "motivo" });
      expect(result).toMatchObject({ opensAccompaniment: row.to === "accepted" });
    }
  });

  test("devuelve un resultado nuevo sin modificar el intento", () => {
    const attempt: RequestTransitionAttempt = {
      ...actor,
      from: "received",
      to: "under_review",
      reason: "  motivo  ",
    };
    Object.freeze(attempt);
    const copy = { ...attempt };
    transitionRequest(attempt);
    expect(attempt).toStrictEqual(copy);
  });
});
