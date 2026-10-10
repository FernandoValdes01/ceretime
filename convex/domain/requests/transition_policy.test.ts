import { assert, describe, expect, test } from "vitest";
import {
  CLOSURE_REQUEST_STATES,
  FUTURE_REQUEST_STATES,
  REQUEST_STATES,
  SPRINT_1_REQUEST_STATES,
} from "./state";
import {
  findRequestTransition,
  TRANSITION_REJECTION_CAUSES,
  transitionRequest,
  type RequestTransitionAttempt,
  type TransitionRejectionCause,
} from "./transition_policy";
import {
  ACCEPTANCE_STATE,
  CLOSURE_REQUEST_TRANSITIONS,
  REQUEST_TRANSITIONS,
  SPRINT_1_REQUEST_TRANSITIONS,
} from "./transitions";

/** Datos ficticios: el actor no corresponde a ninguna persona real. */
const actor = { actorId: "profesional-ficticio-1", occurredAt: 1_700_000_000_000 };

describe("findRequestTransition", () => {
  test("encuentra cada transición declarada en las tablas", () => {
    for (const row of REQUEST_TRANSITIONS) {
      expect(findRequestTransition(row.from, row.to)).toBe(row);
    }
  });

  test("devuelve undefined para cualquier par ausente", () => {
    expect(findRequestTransition("received", "accepted")).toBeUndefined();
    expect(findRequestTransition("accepted", "under_review")).toBeUndefined();
    expect(findRequestTransition("received", "received")).toBeUndefined();
    expect(findRequestTransition("accepted", "cancelled")).toBeUndefined();
    expect(findRequestTransition("received", "closed_without_accompaniment")).toBeUndefined();
    expect(findRequestTransition("cancelled", "received")).toBeUndefined();
    expect(findRequestTransition("under_review", "referred")).toBeUndefined();
  });
});

describe("transitionRequest", () => {
  test("aplica cada transición declarada registrando actor y fecha", () => {
    for (const row of REQUEST_TRANSITIONS) {
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
    for (const row of REQUEST_TRANSITIONS) {
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
    const declared = REQUEST_TRANSITIONS.map((row) => `${row.from} -> ${row.to}`);
    expect(applied.sort()).toEqual([...declared].sort());
    expect(causes).toEqual(new Set(["transition_not_allowed"]));
  });

  test("rechaza saltos, retrocesos y permanencias, incluida aceptar dos veces", () => {
    const pairs = [
      ["received", "accepted"],
      ["received", "awaiting_information_or_acceptance"],
      ["under_review", "received"],
      ["accepted", "under_review"],
      ["awaiting_information_or_acceptance", "under_review"],
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

  /**
   * El par `accepted -> accepted` de arriba está escrito a mano. Aquí el segundo
   * intento parte del estado que dejó el primero, que es lo que TI2-24 tendrá
   * que hacer al leer el estado persistido.
   */
  test.each(SPRINT_1_REQUEST_TRANSITIONS.filter((row) => row.to === ACCEPTANCE_STATE))(
    "tras aceptar desde $from, el segundo intento parte del estado real y se rechaza",
    (row) => {
      const first = transitionRequest({ ...actor, from: row.from, to: row.to });
      assert(first.status === "applied");
      expect(first.opensAccompaniment).toBe(true);

      const second = transitionRequest({ ...actor, from: first.change.to, to: ACCEPTANCE_STATE });
      expect(second).toStrictEqual({ status: "rejected", cause: "transition_not_allowed" });
    },
  );

  test.each(FUTURE_REQUEST_STATES)(
    "rechaza %s, sin reglas acordadas, como destino desde todo estado de Sprint 1",
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

  test("entre los pasos de Sprint 1, exige motivo solo en el paso a espera", () => {
    const toAwaiting = {
      ...actor,
      from: "under_review",
      to: "awaiting_information_or_acceptance",
    } as const;
    expect(transitionRequest(toAwaiting)).toStrictEqual({
      status: "rejected",
      cause: "reason_required",
    });
    expect(transitionRequest({ ...toAwaiting, reason: "   " })).toStrictEqual({
      status: "rejected",
      cause: "reason_required",
    });
    expect(transitionRequest({ ...actor, from: "under_review", to: "accepted" })).toMatchObject({
      status: "applied",
    });
  });

  test.each(REQUEST_TRANSITIONS)(
    "sin motivo, $from -> $to responde lo que la tabla declara",
    (row) => {
      expect(transitionRequest({ ...actor, from: row.from, to: row.to })).toMatchObject(
        row.requiresReason
          ? { status: "rejected", cause: "reason_required" }
          : { status: "applied" },
      );
    },
  );

  test("exige actor en toda transición", () => {
    for (const row of REQUEST_TRANSITIONS) {
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
        transitionRequest({ ...actor, occurredAt, from: "received", to: "under_review" }),
      ).toStrictEqual({ status: "rejected", cause: "occurred_at_invalid" });
    }
  });

  test("reporta la causa más general cuando hay varias", () => {
    const toAwaiting = { from: "under_review", to: "awaiting_information_or_acceptance" } as const;
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
      [{ ...actor, actorId: " ", from: "received", to: "under_review" }, "actor_required"],
      [
        { ...actor, occurredAt: Number.NaN, from: "received", to: "under_review" },
        "occurred_at_invalid",
      ],
      [
        { ...actor, from: "under_review", to: "awaiting_information_or_acceptance" },
        "reason_required",
      ],
    ];
    // Un intento por causa exportada: una causa nueva sin su intento hace fallar esto.
    expect(rejected.map(([, cause]) => cause)).toEqual([...TRANSITION_REJECTION_CAUSES]);
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

describe("cierres sin acompañamiento (TI2-85)", () => {
  test.each(CLOSURE_REQUEST_TRANSITIONS)(
    "$from -> $to se aplica con el motivo recortado y sin abrir acompañamiento",
    (row) => {
      const result = transitionRequest({
        ...actor,
        from: row.from,
        to: row.to,
        reason: "  Ya cuento con el apoyo por otra vía  ",
      });
      expect(result).toStrictEqual({
        status: "applied",
        change: {
          from: row.from,
          to: row.to,
          ...actor,
          reason: "Ya cuento con el apoyo por otra vía",
        },
        opensAccompaniment: false,
      });
    },
  );

  test.each(CLOSURE_REQUEST_TRANSITIONS)(
    "$from -> $to sin motivo o con motivo en blanco se rechaza sin registro",
    (row) => {
      for (const reason of [undefined, "", "   "]) {
        expect(transitionRequest({ ...actor, from: row.from, to: row.to, reason })).toStrictEqual({
          status: "rejected",
          cause: "reason_required",
        });
      }
    },
  );

  test("desde la aceptación no se cancela ni se cierra", () => {
    for (const to of CLOSURE_REQUEST_STATES) {
      expect(
        transitionRequest({ ...actor, from: ACCEPTANCE_STATE, to, reason: "motivo" }),
      ).toStrictEqual({ status: "rejected", cause: "transition_not_allowed" });
    }
  });

  /**
   * Repetir: el segundo intento parte del estado que dejó el primero, como lo
   * hará la capa de aplicación al leer el estado persistido.
   */
  test.each(CLOSURE_REQUEST_TRANSITIONS)(
    "tras $from -> $to, ningún intento posterior procede desde el estado real",
    (row) => {
      const first = transitionRequest({ ...actor, from: row.from, to: row.to, reason: "motivo" });
      assert(first.status === "applied");
      for (const to of REQUEST_STATES) {
        expect(
          transitionRequest({ ...actor, from: first.change.to, to, reason: "motivo" }),
        ).toStrictEqual({ status: "rejected", cause: "transition_not_allowed" });
      }
    },
  );
});
