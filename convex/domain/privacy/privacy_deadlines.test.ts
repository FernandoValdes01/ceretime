import { describe, expect, test } from "vitest";
import {
  applyPrivacyResponseExtension,
  calculatePrivacyAgencyClaimDeadline,
  calculatePrivacyBlockingResponseDeadline,
  calculatePrivacyResponseDeadline,
  isWithinPrivacyDeadline,
  PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS,
  PRIVACY_RESPONSE_CALENDAR_DAYS,
  PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS,
  PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS,
} from "./privacy_deadlines";

/**
 * Pruebas de los plazos del procedimiento de privacidad (TI2-136), con reloj,
 * zona horaria y feriados inyectados. Sin Convex.
 */

const TIME_ZONE = "America/Santiago";

/** Instante epoch de una fecha y hora civil de Chile con su desplazamiento real. */
function chileIso(iso: string): number {
  return Date.parse(iso);
}

describe("plazos de privacidad (TI2-136)", () => {
  test("las constantes son las del procedimiento de prueba", () => {
    expect(PRIVACY_RESPONSE_CALENDAR_DAYS).toBe(30);
    expect(PRIVACY_RESPONSE_EXTENSION_CALENDAR_DAYS).toBe(30);
    expect(PRIVACY_TEMPORARY_BLOCK_BUSINESS_DAYS).toBe(2);
    expect(PRIVACY_AGENCY_CLAIM_BUSINESS_DAYS).toBe(30);
  });

  test("30 días corridos desde la recepción con vencimiento exclusivo", () => {
    const receivedAt = chileIso("2026-11-04T12:00:00-03:00");
    const deadline = calculatePrivacyResponseDeadline({
      kind: "access",
      receivedAt,
      timeZone: TIME_ZONE,
    });

    expect(deadline).toMatchObject({
      kind: "access",
      rule: "calendar_30",
      receivedDate: "2026-11-04",
      responseDate: "2026-12-04",
      responseDays: 30,
      extensionAllowed: true,
      extensionCalendarDays: 30,
      timeZone: TIME_ZONE,
      holidays: [],
    });
    expect(deadline.responseAt).toBe(chileIso("2026-12-05T00:00:00-03:00"));
  });

  test("el plazo de 30 días corridos cruza el cambio de horario de verano", () => {
    const receivedAt = chileIso("2026-08-31T12:00:00-04:00");
    const deadline = calculatePrivacyResponseDeadline({
      kind: "portability",
      receivedAt,
      timeZone: TIME_ZONE,
    });

    expect(deadline.receivedDate).toBe("2026-08-31");
    expect(deadline.responseDate).toBe("2026-09-30");
    // 00:00 local del 1 de octubre, ya con UTC-3: no son 30 bloques de 24 horas.
    expect(deadline.responseAt).toBe(chileIso("2026-10-01T00:00:00-03:00"));
  });

  test("el vencimiento empieza el día aunque la medianoche no exista", () => {
    // Chile adelanta el reloj el domingo 6 de septiembre de 2026: las 00:00 no existen.
    const deadline = calculatePrivacyResponseDeadline({
      kind: "access",
      receivedAt: chileIso("2026-08-06T12:00:00-04:00"),
      timeZone: TIME_ZONE,
    });

    expect(deadline.responseDate).toBe("2026-09-05");
    expect(deadline.responseAt).toBe(chileIso("2026-09-06T01:00:00-03:00"));
  });

  test("el bloqueo responde en dos días hábiles y no admite prórroga", () => {
    const receivedAt = chileIso("2026-11-06T15:00:00-03:00");
    const deadline = calculatePrivacyBlockingResponseDeadline({
      receivedAt,
      timeZone: TIME_ZONE,
    });

    expect(deadline).toMatchObject({
      kind: "blocking",
      rule: "business_2",
      receivedDate: "2026-11-06",
      responseDate: "2026-11-10",
      responseDays: 2,
      extensionAllowed: false,
      extensionCalendarDays: 0,
    });
    expect(deadline.responseAt).toBe(chileIso("2026-11-11T00:00:00-03:00"));
  });

  test("el bloqueo salta fin de semana y feriados explícitos", () => {
    const receivedAt = chileIso("2026-11-06T15:00:00-03:00");
    const deadline = calculatePrivacyBlockingResponseDeadline({
      receivedAt,
      timeZone: TIME_ZONE,
      holidays: ["2026-11-09", "2026-11-09"],
    });

    expect(deadline.responseDate).toBe("2026-11-11");
    expect(deadline.responseAt).toBe(chileIso("2026-11-12T00:00:00-03:00"));
    expect(deadline.holidays).toEqual(["2026-11-09"]);
  });

  test("una recepción en fin de semana cuenta desde el día hábil siguiente", () => {
    const receivedAt = chileIso("2026-11-07T10:00:00-03:00");
    const deadline = calculatePrivacyBlockingResponseDeadline({
      receivedAt,
      timeZone: TIME_ZONE,
    });

    expect(deadline.receivedDate).toBe("2026-11-07");
    expect(deadline.responseDate).toBe("2026-11-10");
  });

  test("la prórroga es única y suma hasta 30 días corridos al vencimiento", () => {
    const deadline = calculatePrivacyResponseDeadline({
      kind: "erasure",
      receivedAt: chileIso("2026-11-04T12:00:00-03:00"),
      timeZone: TIME_ZONE,
    });

    const extended = applyPrivacyResponseExtension(deadline, 30);
    expect(extended.status).toBe("applied");
    if (extended.status !== "applied") return;

    expect(extended.deadline.extension).toEqual({
      days: 30,
      extendedUntilDate: "2027-01-03",
      extendedUntilAt: chileIso("2027-01-04T00:00:00-03:00"),
    });
    expect(applyPrivacyResponseExtension(extended.deadline, 1)).toEqual({
      status: "rejected",
      cause: "extension_already_applied",
    });
  });

  test("la prórroga rechaza cero, más de 30 y un bloqueo", () => {
    const deadline = calculatePrivacyResponseDeadline({
      kind: "rectification",
      receivedAt: chileIso("2026-11-04T12:00:00-03:00"),
      timeZone: TIME_ZONE,
    });

    for (const days of [0, 31, 1.5, -1]) {
      expect(applyPrivacyResponseExtension(deadline, days)).toEqual({
        status: "rejected",
        cause: "extension_days_invalid",
      });
    }

    const blocking = calculatePrivacyBlockingResponseDeadline({
      receivedAt: chileIso("2026-11-06T15:00:00-03:00"),
      timeZone: TIME_ZONE,
    });
    expect(applyPrivacyResponseExtension(blocking, 1)).toEqual({
      status: "rejected",
      cause: "extension_not_allowed",
    });
  });

  test("el reclamo ante la Agencia vence a los 30 días hábiles de la notificación", () => {
    const notifiedAt = chileIso("2026-11-10T10:00:00-03:00");
    const claim = calculatePrivacyAgencyClaimDeadline({
      notifiedAt,
      timeZone: TIME_ZONE,
    });

    expect(claim).toMatchObject({
      notifiedDate: "2026-11-10",
      claimDate: "2026-12-22",
      businessDays: 30,
    });
    expect(claim.claimAt).toBe(chileIso("2026-12-23T00:00:00-03:00"));
  });

  test("un feriado mueve el reclamo al siguiente día hábil", () => {
    const claim = calculatePrivacyAgencyClaimDeadline({
      notifiedAt: chileIso("2026-11-10T10:00:00-03:00"),
      timeZone: TIME_ZONE,
      holidays: ["2026-12-08"],
    });

    expect(claim.claimDate).toBe("2026-12-23");
    expect(claim.claimAt).toBe(chileIso("2026-12-24T00:00:00-03:00"));
  });

  test("el vencimiento es exclusivo en el límite exacto", () => {
    const deadlineAt = chileIso("2026-12-05T00:00:00-03:00");

    expect(isWithinPrivacyDeadline(deadlineAt, deadlineAt - 1)).toBe(true);
    expect(isWithinPrivacyDeadline(deadlineAt, deadlineAt)).toBe(false);
    expect(isWithinPrivacyDeadline(deadlineAt, deadlineAt + 1)).toBe(false);
  });

  test("rechaza instantes, zonas y feriados inválidos", () => {
    const receivedAt = chileIso("2026-11-04T12:00:00-03:00");

    expect(() =>
      calculatePrivacyResponseDeadline({ kind: "access", receivedAt: 0, timeZone: TIME_ZONE }),
    ).toThrow(/instante válido/);
    expect(() =>
      calculatePrivacyResponseDeadline({
        kind: "access",
        receivedAt: Number.NaN,
        timeZone: TIME_ZONE,
      }),
    ).toThrow(/instante válido/);
    expect(() =>
      calculatePrivacyResponseDeadline({ kind: "access", receivedAt, timeZone: "Mars/Base" }),
    ).toThrow(/zona horaria/);
    expect(() =>
      calculatePrivacyResponseDeadline({
        kind: "access",
        receivedAt,
        timeZone: TIME_ZONE,
        holidays: ["2026-02-30"],
      }),
    ).toThrow(/feriado/);
    expect(() =>
      calculatePrivacyResponseDeadline({
        kind: "unknown" as never,
        receivedAt,
        timeZone: TIME_ZONE,
      }),
    ).toThrow(/derecho/);
  });
});
