import { describe, expect, test } from "vitest";
import { FUTURE_REQUEST_STATES, REQUEST_STATES, SPRINT_1_REQUEST_STATES } from "./state";
import {
  findSprint1Transition,
  transitionRequest,
  type RequestTransitionAttempt,
  type TransitionRejectionCause,
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

  test("devuelve undefined para cualquier par ausente", () => {
    expect(findSprint1Transition("received", "accepted")).toBeUndefined();
    expect(findSprint1Transition("accepted", "underReview")).toBeUndefined();
    expect(findSprint1Transition("received", "received")).toBeUndefined();
    expect(findSprint1Transition("underReview", "cancelled")).toBeUndefined();
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
      from: "underReview",
      to: "awaitingInformationOrAcceptance",
      reason: "  falta el certificado de matrícula  ",
    });
    expect(result).toEqual({
      status: "applied",
      change: {
        from: "underReview",
        to: "awaitingInformationOrAcceptance",
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
      to: "underReview",
      reason: "llegó por correo institucional",
    });
    expect(result).toMatchObject({ change: { reason: "llegó por correo institucional" } });
  });

  test("no agrega la clave reason cuando no llega motivo", () => {
    const result = transitionRequest({ ...actor, from: "received", to: "underReview" });
    expect(result).toStrictEqual({
      status: "applied",
      change: { from: "received", to: "underReview", ...actor },
      opensAccompaniment: false,
    });
  });

  test("recorta el actor antes de registrarlo", () => {
    const result = transitionRequest({
      ...actor,
      actorId: "  profesional-ficticio-1  ",
      from: "received",
      to: "underReview",
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
      to: "underReview",
      reason: "  motivo  ",
    };
    Object.freeze(attempt);
    const copy = { ...attempt };
    transitionRequest(attempt);
    expect(attempt).toStrictEqual(copy);
  });

  test("aplica únicamente los pares de la tabla y rechaza cualquier otro", () => {
    const applied: string[] = [];
    const causes = new Set<string>();
    for (const from of REQUEST_STATES) {
      for (const to of REQUEST_STATES) {
        const result = transitionRequest({ ...actor, from, to, reason: "motivo" });
        if (result.status === "applied") applied.push(`${from} -> ${to}`);
        else causes.add(result.cause);
      }
    }
    const declared = SPRINT_1_REQUEST_TRANSITIONS.map((row) => `${row.from} -> ${row.to}`);
    expect(applied.sort()).toEqual([...declared].sort());
    expect(REQUEST_STATES.length ** 2 - applied.length).toBe(45);
    expect(causes).toEqual(new Set(["transition_not_allowed"]));
  });

  test("rechaza saltos, retrocesos y permanencias, incluida aceptar dos veces", () => {
    const pairs = [
      ["received", "accepted"],
      ["received", "awaitingInformationOrAcceptance"],
      ["underReview", "received"],
      ["accepted", "underReview"],
      ["awaitingInformationOrAcceptance", "underReview"],
      ["received", "received"],
      ["accepted", "accepted"],
    ] as const;
    for (const [from, to] of pairs) {
      expect(transitionRequest({ ...actor, from, to, reason: "motivo" })).toStrictEqual({
        status: "rejected",
        cause: "transition_not_allowed",
      });
    }
  });

  test.each(FUTURE_REQUEST_STATES)(
    "rechaza %s como destino desde todo estado de Sprint 1",
    (future) => {
      for (const from of SPRINT_1_REQUEST_STATES) {
        expect(transitionRequest({ ...actor, from, to: future, reason: "motivo" })).toStrictEqual({
          status: "rejected",
          cause: "transition_not_allowed",
        });
      }
    },
  );

  test.each(FUTURE_REQUEST_STATES)("rechaza %s como origen hacia cualquier estado", (future) => {
    for (const to of REQUEST_STATES) {
      expect(transitionRequest({ ...actor, from: future, to, reason: "motivo" })).toStrictEqual({
        status: "rejected",
        cause: "transition_not_allowed",
      });
    }
  });

  test("exige motivo solo en el paso a espera", () => {
    const toAwaiting = {
      ...actor,
      from: "underReview",
      to: "awaitingInformationOrAcceptance",
    } as const;
    expect(transitionRequest(toAwaiting)).toStrictEqual({
      status: "rejected",
      cause: "reason_required",
    });
    expect(transitionRequest({ ...toAwaiting, reason: "   " })).toStrictEqual({
      status: "rejected",
      cause: "reason_required",
    });
    expect(transitionRequest({ ...actor, from: "underReview", to: "accepted" })).toMatchObject({
      status: "applied",
    });
  });

  test("exige actor en toda transición", () => {
    for (const row of SPRINT_1_REQUEST_TRANSITIONS) {
      for (const actorId of ["", "   "]) {
        expect(
          transitionRequest({ ...actor, actorId, from: row.from, to: row.to, reason: "motivo" }),
        ).toStrictEqual({ status: "rejected", cause: "actor_required" });
      }
    }
  });

  test("rechaza una fecha que no es un instante válido", () => {
    for (const occurredAt of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
      expect(
        transitionRequest({ ...actor, occurredAt, from: "received", to: "underReview" }),
      ).toStrictEqual({ status: "rejected", cause: "occurred_at_invalid" });
    }
  });

  test("reporta la causa más general cuando hay varias", () => {
    const toAwaiting = { from: "underReview", to: "awaitingInformationOrAcceptance" } as const;
    // Par inválido, sin actor, sin fecha y sin motivo: gana el par.
    expect(
      transitionRequest({ actorId: "", occurredAt: Number.NaN, from: "received", to: "accepted" }),
    ).toStrictEqual({ status: "rejected", cause: "transition_not_allowed" });
    // Par válido, sin actor, sin fecha y sin motivo: gana el actor.
    expect(transitionRequest({ ...toAwaiting, actorId: "", occurredAt: Number.NaN })).toStrictEqual(
      { status: "rejected", cause: "actor_required" },
    );
    // Par válido con actor, sin fecha y sin motivo: gana la fecha.
    expect(
      transitionRequest({ ...toAwaiting, actorId: actor.actorId, occurredAt: Number.NaN }),
    ).toStrictEqual({ status: "rejected", cause: "occurred_at_invalid" });
    // Par válido con actor y fecha, sin motivo: queda el motivo.
    expect(transitionRequest({ ...actor, ...toAwaiting })).toStrictEqual({
      status: "rejected",
      cause: "reason_required",
    });
  });

  test("un rechazo no trae registro de cambio y deja el intento intacto", () => {
    const rejected: ReadonlyArray<readonly [RequestTransitionAttempt, TransitionRejectionCause]> = [
      [{ ...actor, from: "received", to: "accepted" }, "transition_not_allowed"],
      [{ ...actor, actorId: " ", from: "received", to: "underReview" }, "actor_required"],
      [
        { ...actor, occurredAt: Number.NaN, from: "received", to: "underReview" },
        "occurred_at_invalid",
      ],
      [{ ...actor, from: "underReview", to: "awaitingInformationOrAcceptance" }, "reason_required"],
    ];
    for (const [attempt, cause] of rejected) {
      Object.freeze(attempt);
      const copy = { ...attempt };
      const result = transitionRequest(attempt);
      expect(result).toStrictEqual({ status: "rejected", cause });
      expect(result).not.toHaveProperty("change");
      expect(attempt).toStrictEqual(copy);
    }
  });
});
