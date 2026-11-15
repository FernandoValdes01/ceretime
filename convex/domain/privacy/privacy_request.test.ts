import { describe, expect, test } from "vitest";
import {
  findPrivacyRequestTransition,
  INITIAL_PRIVACY_REQUEST_STATUS,
  isPrivacyRequestKind,
  isPrivacyRequestResponsibleRole,
  isTerminalPrivacyRequestStatus,
  PENDING_INSTITUTIONAL_DECISIONS,
  PRIVACY_REQUEST_KIND_LABELS,
  PRIVACY_REQUEST_KIND_VALUES,
  PRIVACY_REQUEST_REJECTION_CAUSES,
  PRIVACY_REQUEST_REASON_MAX_LENGTH,
  PRIVACY_REQUEST_STATUS_VALUES,
  PRIVACY_REQUEST_TRANSITIONS,
  privacyRequestChannelForRole,
  transitionPrivacyRequest,
  type PrivacyRequestTransitionAttempt,
} from "./privacy_request";

/**
 * Pruebas puras del procedimiento de privacidad (TI2-136), con datos ficticios
 * y sin Convex.
 */

const OCCURRED_AT = Date.parse("2026-11-04T12:00:00-03:00");

const base: PrivacyRequestTransitionAttempt = {
  kind: "access",
  from: "in_review",
  to: "resolved",
  actorId: "user-admin",
  occurredAt: OCCURRED_AT,
  response: {
    outcome: "granted",
    reasons: "Se entrega una copia de los datos ficticios del titular.",
    responsibleId: "user-admin",
  },
};

function attempt(overrides: Partial<PrivacyRequestTransitionAttempt>) {
  return transitionPrivacyRequest({ ...base, ...overrides });
}

describe("solicitud de privacidad (TI2-136)", () => {
  test("los derechos son los seis de la Ley 21.719 y tienen etiqueta única", () => {
    expect(PRIVACY_REQUEST_KIND_VALUES).toEqual([
      "access",
      "rectification",
      "erasure",
      "objection",
      "blocking",
      "portability",
    ]);
    expect(new Set(Object.values(PRIVACY_REQUEST_KIND_LABELS)).size).toBe(6);
    expect(isPrivacyRequestKind("blocking")).toBe(true);
    expect(isPrivacyRequestKind("deletion")).toBe(false);
  });

  test("el estudiante usa la aplicación y los demás roles el canal institucional", () => {
    expect(privacyRequestChannelForRole("student")).toBe("student_app");
    expect(privacyRequestChannelForRole("professional")).toBe("institutional_channel");
    expect(privacyRequestChannelForRole("intern")).toBe("institutional_channel");
    expect(privacyRequestChannelForRole("admin")).toBe("institutional_channel");
  });

  test("solo el rol responsable puede responder y las decisiones institucionales quedan marcadas", () => {
    expect(isPrivacyRequestResponsibleRole("admin")).toBe(true);
    expect(isPrivacyRequestResponsibleRole("professional")).toBe(false);
    expect(isPrivacyRequestResponsibleRole("intern")).toBe(false);
    expect(isPrivacyRequestResponsibleRole("student")).toBe(false);
    expect(PENDING_INSTITUTIONAL_DECISIONS.length).toBeGreaterThan(0);
  });

  test("la solicitud nace recibida y su primer paso es la revisión", () => {
    expect(INITIAL_PRIVACY_REQUEST_STATUS).toBe("received");
    expect(PRIVACY_REQUEST_STATUS_VALUES).toEqual([
      "received",
      "in_review",
      "awaiting_information",
      "resolved",
      "withdrawn",
    ]);
    expect(findPrivacyRequestTransition("received", "in_review")).toBeDefined();
    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "received",
        to: "in_review",
        actorId: "  user-admin  ",
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual({
      status: "applied",
      change: {
        from: "received",
        to: "in_review",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
      },
    });
  });

  test("los saltos y las salidas de estados terminales se rechazan", () => {
    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "received",
        to: "resolved",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
        response: base.response,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(isTerminalPrivacyRequestStatus("resolved")).toBe(true);
    expect(isTerminalPrivacyRequestStatus("withdrawn")).toBe(true);
    expect(isTerminalPrivacyRequestStatus("in_review")).toBe(false);

    for (const from of ["resolved", "withdrawn"] as const) {
      expect(
        transitionPrivacyRequest({
          kind: "access",
          from,
          to: "in_review",
          actorId: "user-admin",
          occurredAt: OCCURRED_AT,
        }),
      ).toEqual({ status: "rejected", cause: "transition_not_allowed" });
    }
  });

  test("pedir información exige motivo y volver a revisión también", () => {
    expect(
      transitionPrivacyRequest({
        kind: "rectification",
        from: "in_review",
        to: "awaiting_information",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual({ status: "rejected", cause: "reason_required" });

    expect(
      transitionPrivacyRequest({
        kind: "rectification",
        from: "awaiting_information",
        to: "in_review",
        actorId: "user-student",
        occurredAt: OCCURRED_AT,
        reason: "  Envío el dato correcto.  ",
      }),
    ).toEqual({
      status: "applied",
      change: {
        from: "awaiting_information",
        to: "in_review",
        actorId: "user-student",
        occurredAt: OCCURRED_AT,
        reason: "Envío el dato correcto.",
      },
    });
  });

  test("retirar exige motivo y no admite respuesta fundada", () => {
    expect(
      transitionPrivacyRequest({
        kind: "objection",
        from: "in_review",
        to: "withdrawn",
        actorId: "user-student",
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual({ status: "rejected", cause: "reason_required" });

    expect(
      transitionPrivacyRequest({
        kind: "objection",
        from: "in_review",
        to: "withdrawn",
        actorId: "user-student",
        occurredAt: OCCURRED_AT,
        reason: "Ya no necesito el acompañamiento.",
        response: base.response,
      }),
    ).toEqual({ status: "rejected", cause: "response_not_allowed" });
  });

  test("toda transición que exige motivo se rechaza sin él", () => {
    const transitionsWithReason = PRIVACY_REQUEST_TRANSITIONS.filter(
      (transition) => transition.requiresReason,
    );

    expect(transitionsWithReason).toHaveLength(5);
    for (const transition of transitionsWithReason) {
      expect(
        transitionPrivacyRequest({
          kind: "access",
          from: transition.from,
          to: transition.to,
          actorId: "user-admin",
          occurredAt: OCCURRED_AT,
        }),
      ).toEqual({ status: "rejected", cause: "reason_required" });
    }
  });

  test("resolver exige una respuesta fundada y completa", () => {
    expect(attempt({ response: undefined })).toEqual({
      status: "rejected",
      cause: "response_required",
    });
    expect(attempt({ response: { ...base.response!, outcome: "other" as never } })).toEqual({
      status: "rejected",
      cause: "outcome_invalid",
    });
    expect(attempt({ response: { ...base.response!, responsibleId: "   " } })).toEqual({
      status: "rejected",
      cause: "responsible_required",
    });
    expect(attempt({ response: { ...base.response!, responsibleId: "user-other" } })).toEqual({
      status: "rejected",
      cause: "responsible_mismatch",
    });
    expect(attempt({ response: { ...base.response!, reasons: "   " } })).toEqual({
      status: "rejected",
      cause: "response_reasons_required",
    });
    expect(
      attempt({
        response: {
          ...base.response!,
          reasons: "x".repeat(PRIVACY_REQUEST_REASON_MAX_LENGTH + 1),
        },
      }),
    ).toEqual({ status: "rejected", cause: "response_too_long" });
  });

  test("la resolución normaliza el texto y registra el instante del cambio", () => {
    expect(
      attempt({
        response: {
          outcome: "partially_granted",
          reasons: "  Se corrigen los datos de contacto; el resto no se modifica.  ",
          responsibleId: "  user-admin  ",
        },
      }),
    ).toEqual({
      status: "applied",
      change: {
        from: "in_review",
        to: "resolved",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
        response: {
          outcome: "partially_granted",
          reasons: "Se corrigen los datos de contacto; el resto no se modifica.",
          responsibleId: "user-admin",
          respondedAt: OCCURRED_AT,
        },
      },
    });
  });

  test("el bloqueo temporal solo vive en una solicitud de bloqueo", () => {
    expect(
      attempt({
        response: {
          ...base.response!,
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      }),
    ).toEqual({ status: "rejected", cause: "temporary_block_not_allowed" });

    expect(
      attempt({
        kind: "blocking",
        response: { ...base.response!, outcome: "granted" },
      }),
    ).toEqual({ status: "rejected", cause: "temporary_block_required" });

    expect(
      attempt({
        kind: "blocking",
        response: {
          ...base.response!,
          outcome: "denied",
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      }),
    ).toEqual({ status: "rejected", cause: "temporary_block_not_allowed" });

    expect(
      attempt({
        kind: "blocking",
        response: {
          ...base.response!,
          temporaryBlockUntil: OCCURRED_AT,
        },
      }),
    ).toEqual({ status: "rejected", cause: "temporary_block_invalid" });

    expect(
      attempt({
        kind: "blocking",
        response: {
          ...base.response!,
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      }),
    ).toEqual({
      status: "applied",
      change: {
        from: "in_review",
        to: "resolved",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
        response: {
          outcome: "granted",
          reasons: "Se entrega una copia de los datos ficticios del titular.",
          responsibleId: "user-admin",
          respondedAt: OCCURRED_AT,
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      },
    });
  });

  test("el bloqueo parcialmente concedido también exige plazo de bloqueo", () => {
    expect(
      attempt({
        kind: "blocking",
        response: { ...base.response!, outcome: "partially_granted" },
      }),
    ).toEqual({ status: "rejected", cause: "temporary_block_required" });

    expect(
      attempt({
        kind: "blocking",
        response: {
          ...base.response!,
          outcome: "partially_granted",
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      }),
    ).toMatchObject({
      status: "applied",
      change: {
        response: {
          outcome: "partially_granted",
          temporaryBlockUntil: OCCURRED_AT + 86_400_000,
        },
      },
    });
  });

  test("toda transición declarada se aplica con los datos mínimos", () => {
    const results = PRIVACY_REQUEST_TRANSITIONS.map((transition) => {
      return transitionPrivacyRequest({
        kind: "access",
        from: transition.from,
        to: transition.to,
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
        ...(transition.requiresReason ? { reason: "Motivo ficticio." } : {}),
        ...(transition.requiresResponse
          ? {
              response: {
                outcome: "granted",
                reasons: "Decisión ficticia.",
                responsibleId: "user-admin",
              },
            }
          : {}),
      });
    });

    expect(results.map((result) => result.status)).toEqual(
      PRIVACY_REQUEST_TRANSITIONS.map(() => "applied"),
    );
  });

  test("la identidad del actor, el instante y el motivo se validan antes de aplicar", () => {
    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "received",
        to: "in_review",
        actorId: "   ",
        occurredAt: OCCURRED_AT,
      }),
    ).toEqual({ status: "rejected", cause: "actor_required" });

    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "received",
        to: "in_review",
        actorId: "user-admin",
        occurredAt: 0,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_at_invalid" });

    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "received",
        to: "in_review",
        actorId: "user-admin",
        occurredAt: 1e30,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_at_invalid" });

    expect(
      transitionPrivacyRequest({
        kind: "access",
        from: "in_review",
        to: "awaiting_information",
        actorId: "user-admin",
        occurredAt: OCCURRED_AT,
        reason: "x".repeat(PRIVACY_REQUEST_REASON_MAX_LENGTH + 1),
      }),
    ).toEqual({ status: "rejected", cause: "reason_too_long" });
  });

  test("las causas de rechazo declaradas son únicas", () => {
    expect(new Set(PRIVACY_REQUEST_REJECTION_CAUSES).size).toBe(
      PRIVACY_REQUEST_REJECTION_CAUSES.length,
    );
  });
});
