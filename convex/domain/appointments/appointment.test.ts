import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_STATUS_VALUES,
  INITIAL_APPOINTMENT_STATUS,
  JUSTIFICATION_BUSINESS_DAYS,
  NO_SHOW_PENDING_STATE,
  calculateJustificationDeadline,
  decideJustificationTimeliness,
  transitionAppointment,
  type Appointment,
  type AppointmentPage,
} from "./appointment";
import {
  APPOINTMENT_CONTRACT_VERSION as BARREL_VERSION,
  JUSTIFICATION_BUSINESS_DAYS as BARREL_BUSINESS_DAYS,
  calculateJustificationDeadline as barrelDeadline,
  decideJustificationTimeliness as barrelTimeliness,
  transitionAppointment as barrelTransition,
  type Appointment as BarrelAppointment,
} from "../index";

describe("Contratos públicos de la atención reservada (TI2-87, TI2-93)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(APPOINTMENT_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(APPOINTMENT_CONTRACT_VERSION);
    expectTypeOf<BarrelAppointment>().toEqualTypeOf<Appointment>();
    expect(barrelTransition).toBe(transitionAppointment);
  });

  test("los estados conservan los seis de TI2-83 y agregan la resolución de inasistencia", () => {
    expect([...APPOINTMENT_STATUS_VALUES]).toEqual([
      "scheduled",
      "completed",
      "cancelled_by_student",
      "cancelled_by_cereti",
      "rescheduled",
      "no_show",
      "no_show_justified",
      "no_show_unjustified",
    ]);
    expect(INITIAL_APPOINTMENT_STATUS).toBe("scheduled");
    expect(NO_SHOW_PENDING_STATE).toBe("no_show");
  });

  test("reserva y atención son una sola entidad con identificadores genéricos", () => {
    const appointment: Appointment = {
      id: "atencion-ficticia-1",
      accompanimentId: "acompanamiento-ficticio-1",
      professionalId: "profesional-ficticio-1",
      modality: "inPerson",
      spaceId: "espacio-ficticio-c204",
      slotId: "cupo-ficticio-1",
      startAt: 1000,
      endAt: 2000,
      status: "scheduled",
      version: "v1",
    };
    expect(appointment.accompanimentId).toBe("acompanamiento-ficticio-1");
    expect(appointment.status).toBe(INITIAL_APPOINTMENT_STATUS);
  });

  test("la página ficticia viaja como datos planos (ida y vuelta JSON)", () => {
    const page: AppointmentPage = {
      items: [],
      hasMore: false,
      nextCursor: null,
      version: "v1",
    };
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
  });
});

describe("Política de transición de la atención (TI2-93)", () => {
  test("realización y cancelación del estudiante avanzan sin motivo obligatorio", () => {
    const completed = transitionAppointment({
      from: "scheduled",
      to: "completed",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      currentStartAt: 2000,
    });
    expect(completed.status).toBe("applied");
    if (completed.status !== "applied") return;
    expect(completed.change.to).toBe("completed");
    expect(completed.effectiveStartAt).toBe(2000);
    expect(completed.originalStartAt).toBeUndefined();

    const studentCancel = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_student",
      actorId: "estudiante-ficticio-1",
      occurredAt: 1000,
      currentStartAt: 2000,
    });
    expect(studentCancel.status).toBe("applied");
    if (studentCancel.status !== "applied") return;
    expect(studentCancel.cancelReason).toBeUndefined();
  });

  test("cancelación CERETI exige motivo y la del estudiante lo conserva cuando viene", () => {
    const missing = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_cereti",
      actorId: "profesional-ficticio-1",
      occurredAt: 1000,
      currentStartAt: 2000,
    });
    expect(missing).toEqual({ status: "rejected", cause: "reason_required" });

    const blank = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_cereti",
      actorId: "profesional-ficticio-1",
      occurredAt: 1000,
      reason: "   ",
      currentStartAt: 2000,
    });
    expect(blank).toEqual({ status: "rejected", cause: "reason_required" });

    const cereti = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_cereti",
      actorId: "profesional-ficticio-1",
      occurredAt: 1000,
      reason: "  Sala no disponible  ",
      currentStartAt: 2000,
    });
    expect(cereti.status).toBe("applied");
    if (cereti.status !== "applied") return;
    expect(cereti.cancelReason).toBe("Sala no disponible");

    const studentWithReason = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_student",
      actorId: "estudiante-ficticio-1",
      occurredAt: 1000,
      reason: "Tope de horario",
      currentStartAt: 2000,
    });
    expect(studentWithReason.status).toBe("applied");
    if (studentWithReason.status !== "applied") return;
    expect(studentWithReason.cancelReason).toBe("Tope de horario");
  });

  test("reagendamiento fija la fecha original y no la sobrescribe al encadenar", () => {
    const first = transitionAppointment({
      from: "scheduled",
      to: "rescheduled",
      actorId: "profesional-ficticio-1",
      occurredAt: 1000,
      currentStartAt: 2000,
      newStartAt: 3000,
      newEndAt: 4000,
    });
    expect(first.status).toBe("applied");
    if (first.status !== "applied") return;
    expect(first.effectiveStartAt).toBe(3000);
    expect(first.effectiveEndAt).toBe(4000);
    expect(first.originalStartAt).toBe(2000);

    const second = transitionAppointment({
      from: "rescheduled",
      to: "rescheduled",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      currentStartAt: 3000,
      currentOriginalStartAt: first.originalStartAt,
      newStartAt: 5000,
      newEndAt: 6000,
    });
    expect(second.status).toBe("applied");
    if (second.status !== "applied") return;
    expect(second.effectiveStartAt).toBe(5000);
    expect(second.originalStartAt).toBe(2000);

    const completedAfterReschedule = transitionAppointment({
      from: "rescheduled",
      to: "completed",
      actorId: "profesional-ficticio-1",
      occurredAt: 5000,
      currentStartAt: 5000,
      currentOriginalStartAt: second.originalStartAt,
    });
    expect(completedAfterReschedule.status).toBe("applied");
    if (completedAfterReschedule.status !== "applied") return;
    expect(completedAfterReschedule.effectiveStartAt).toBe(5000);
    expect(completedAfterReschedule.originalStartAt).toBe(2000);
  });

  test("inasistencia pendiente solo se resuelve a justificada o sin justificar", () => {
    const pending = transitionAppointment({
      from: "scheduled",
      to: "no_show",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      currentStartAt: 2000,
    });
    expect(pending.status).toBe("applied");

    const justified = transitionAppointment({
      from: "no_show",
      to: "no_show_justified",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      currentStartAt: 2000,
    });
    expect(justified.status).toBe("applied");
    if (justified.status !== "applied") return;
    expect(justified.change.to).toBe("no_show_justified");

    const unjustified = transitionAppointment({
      from: "no_show",
      to: "no_show_unjustified",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      currentStartAt: 2000,
    });
    expect(unjustified.status).toBe("applied");
  });

  test("rechaza saltos inválidos y salidas desde estados terminales", () => {
    expect(
      transitionAppointment({
        from: "scheduled",
        to: "no_show_justified",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(
      transitionAppointment({
        from: "no_show",
        to: "completed",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(
      transitionAppointment({
        from: "completed",
        to: "scheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(
      transitionAppointment({
        from: "cancelled_by_student",
        to: "rescheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
        newStartAt: 3000,
        newEndAt: 4000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });
  });

  test("el motivo fuera de cancelación no se devuelve como motivo de cancelación", () => {
    const completedWithNote = transitionAppointment({
      from: "scheduled",
      to: "completed",
      actorId: "profesional-ficticio-1",
      occurredAt: 2000,
      reason: "Sesión realizada",
      currentStartAt: 2000,
    });
    expect(completedWithNote.status).toBe("applied");
    if (completedWithNote.status !== "applied") return;
    expect(completedWithNote.change.reason).toBe("Sesión realizada");
    expect(completedWithNote.cancelReason).toBeUndefined();

    const rescheduledWithNote = transitionAppointment({
      from: "scheduled",
      to: "rescheduled",
      actorId: "profesional-ficticio-1",
      occurredAt: 1000,
      reason: "Ajuste de agenda",
      currentStartAt: 2000,
      newStartAt: 3000,
      newEndAt: 4000,
    });
    expect(rescheduledWithNote.status).toBe("applied");
    if (rescheduledWithNote.status !== "applied") return;
    expect(rescheduledWithNote.change.reason).toBe("Ajuste de agenda");
    expect(rescheduledWithNote.cancelReason).toBeUndefined();
    expect(rescheduledWithNote.originalStartAt).toBe(2000);
  });

  test("los estados de justificación y cancelación CERETI son terminales", () => {
    expect(
      transitionAppointment({
        from: "no_show_justified",
        to: "completed",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(
      transitionAppointment({
        from: "no_show_unjustified",
        to: "no_show_justified",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });

    expect(
      transitionAppointment({
        from: "cancelled_by_cereti",
        to: "scheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "transition_not_allowed" });
  });

  test("rechaza realización e inasistencia anteriores al inicio vigente", () => {
    expect(
      transitionAppointment({
        from: "scheduled",
        to: "completed",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_before_start" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "no_show",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_before_start" });

    expect(
      transitionAppointment({
        from: "no_show",
        to: "no_show_justified",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_before_start" });

    const cancelBeforeStart = transitionAppointment({
      from: "scheduled",
      to: "cancelled_by_student",
      actorId: "estudiante-ficticio-1",
      occurredAt: 1000,
      currentStartAt: 2000,
    });
    expect(cancelBeforeStart.status).toBe("applied");
  });

  test("rechaza fecha vigente inválida en vez de devolver fecha efectiva corrupta", () => {
    expect(
      transitionAppointment({
        from: "scheduled",
        to: "completed",
        actorId: "profesional-ficticio-1",
        occurredAt: 2000,
        currentStartAt: Number.NaN,
      }),
    ).toEqual({ status: "rejected", cause: "current_start_invalid" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "no_show",
        actorId: "profesional-ficticio-1",
        occurredAt: 2000,
        currentStartAt: 0,
      }),
    ).toEqual({ status: "rejected", cause: "current_start_invalid" });
  });

  test("rechaza reagendamiento a una fecha que ya pasó", () => {
    expect(
      transitionAppointment({
        from: "scheduled",
        to: "rescheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 5000,
        currentStartAt: 6000,
        newStartAt: 4000,
        newEndAt: 4600,
      }),
    ).toEqual({ status: "rejected", cause: "reschedule_invalid" });

    const atPresent = transitionAppointment({
      from: "scheduled",
      to: "rescheduled",
      actorId: "profesional-ficticio-1",
      occurredAt: 5000,
      currentStartAt: 6000,
      newStartAt: 5000,
      newEndAt: 5600,
    });
    expect(atPresent.status).toBe("applied");
    if (atPresent.status !== "applied") return;
    expect(atPresent.effectiveStartAt).toBe(5000);
    expect(atPresent.originalStartAt).toBe(6000);
  });

  test("rechaza actor, fecha y fechas de reagendamiento inválidas", () => {
    expect(
      transitionAppointment({
        from: "scheduled",
        to: "completed",
        actorId: "   ",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "actor_required" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "completed",
        actorId: "profesional-ficticio-1",
        occurredAt: Number.NaN,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "occurred_at_invalid" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "rescheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
      }),
    ).toEqual({ status: "rejected", cause: "reschedule_required" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "rescheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
        newStartAt: 2000,
        newEndAt: 3000,
      }),
    ).toEqual({ status: "rejected", cause: "reschedule_invalid" });

    expect(
      transitionAppointment({
        from: "scheduled",
        to: "rescheduled",
        actorId: "profesional-ficticio-1",
        occurredAt: 1000,
        currentStartAt: 2000,
        newStartAt: 4000,
        newEndAt: 3000,
      }),
    ).toEqual({ status: "rejected", cause: "reschedule_invalid" });
  });
});

describe("Plazo de cinco días hábiles de justificación (TI2-94)", () => {
  const TIME_ZONE = "America/Santiago";
  /** Lunes 2026-10-12 12:00 UTC: 09:00 en Santiago, mismo día civil. */
  const MONDAY = Date.UTC(2026, 9, 12, 12);
  /** Viernes 2026-10-16 12:00 UTC. */
  const FRIDAY = Date.UTC(2026, 9, 16, 12);

  test("sale por el barrel sin duplicar la fuente y cuenta cinco días hábiles", () => {
    expect(JUSTIFICATION_BUSINESS_DAYS).toBe(5);
    expect(BARREL_BUSINESS_DAYS).toBe(JUSTIFICATION_BUSINESS_DAYS);
    expect(barrelDeadline).toBe(calculateJustificationDeadline);
    expect(barrelTimeliness).toBe(decideJustificationTimeliness);
  });

  test("cuenta días hábiles posteriores a la inasistencia, no cinco corridos", () => {
    const deadline = calculateJustificationDeadline({ missedAt: MONDAY, timeZone: TIME_ZONE });
    expect(deadline.absenceDate).toBe("2026-10-12");
    // Mar 13 (1), mié 14 (2), jue 15 (3), vie 16 (4), lun 19 (5): salta el finde.
    expect(deadline.deadlineDate).toBe("2026-10-19");
    expect(deadline.businessDays).toBe(5);
    expect(deadline.timeZone).toBe(TIME_ZONE);
    expect(deadline.holidays).toEqual([]);
    expect(Number.isFinite(deadline.deadlineAt)).toBe(true);
    // Cinco corridos habrían vencido el sábado 2026-10-17.
    expect(deadline.deadlineDate).not.toBe("2026-10-17");
  });

  test("mismos inputs dan el mismo plazo sin reloj implícito", () => {
    const input = { missedAt: MONDAY, timeZone: TIME_ZONE } as const;
    expect(calculateJustificationDeadline(input)).toEqual(calculateJustificationDeadline(input));
    const withHolidays = {
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-14"],
    } as const;
    expect(calculateJustificationDeadline(withHolidays)).toEqual(
      calculateJustificationDeadline({
        missedAt: MONDAY,
        timeZone: TIME_ZONE,
        holidays: ["2026-10-14"],
      }),
    );
  });

  test("el viernes salta el fin de semana completo", () => {
    const deadline = calculateJustificationDeadline({ missedAt: FRIDAY, timeZone: TIME_ZONE });
    expect(deadline.absenceDate).toBe("2026-10-16");
    // Lun 19 (1), mar 20 (2), mié 21 (3), jue 22 (4), vie 23 (5).
    expect(deadline.deadlineDate).toBe("2026-10-23");
  });

  test("el feriado explícito corre el plazo y el de fin de semana no", () => {
    const withHoliday = calculateJustificationDeadline({
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-14"],
    });
    // Mar 13 (1), jue 15 (2), vie 16 (3), lun 19 (4), mar 20 (5).
    expect(withHoliday.deadlineDate).toBe("2026-10-20");
    expect(withHoliday.holidays).toEqual(["2026-10-14"]);

    const weekendHoliday = calculateJustificationDeadline({
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-17"],
    });
    expect(weekendHoliday.deadlineDate).toBe("2026-10-19");
  });

  test("cruza mes y año contando solo hábiles", () => {
    const monthCross = calculateJustificationDeadline({
      missedAt: Date.UTC(2026, 9, 30, 12),
      timeZone: TIME_ZONE,
    });
    expect(monthCross.absenceDate).toBe("2026-10-30");
    // Lun 02-11 (1), mar 03 (2), mié 04 (3), jue 05 (4), vie 06 (5).
    expect(monthCross.deadlineDate).toBe("2026-11-06");

    const yearCross = calculateJustificationDeadline({
      missedAt: Date.UTC(2026, 11, 28, 12),
      timeZone: TIME_ZONE,
    });
    expect(yearCross.absenceDate).toBe("2026-12-28");
    // Mar 29 (1), mié 30 (2), jue 31 (3), vie 01-01 (4), lun 04-01 (5).
    expect(yearCross.deadlineDate).toBe("2027-01-04");

    const yearCrossWithHoliday = calculateJustificationDeadline({
      missedAt: Date.UTC(2026, 11, 28, 12),
      timeZone: TIME_ZONE,
      holidays: ["2027-01-01"],
    });
    expect(yearCrossWithHoliday.deadlineDate).toBe("2027-01-05");
  });

  test("el orden y los duplicados de feriados no cambian el plazo", () => {
    const first = calculateJustificationDeadline({
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-20", "2026-10-14"],
    });
    const second = calculateJustificationDeadline({
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-14", "2026-10-14", "2026-10-20"],
    });
    expect(first).toEqual(second);
    expect(first.holidays).toEqual(["2026-10-14", "2026-10-20"]);
    // Mar 13 (1), jue 15 (2), vie 16 (3), lun 19 (4), mié 21 (5).
    expect(first.deadlineDate).toBe("2026-10-21");
  });

  test("la zona horaria es explícita: el mismo instante cambia de día civil", () => {
    // 2026-10-12 02:00 UTC es domingo 2026-10-11 en Santiago y lunes en UTC.
    const instant = Date.UTC(2026, 9, 12, 2);
    const santiago = calculateJustificationDeadline({ missedAt: instant, timeZone: TIME_ZONE });
    const utc = calculateJustificationDeadline({ missedAt: instant, timeZone: "UTC" });
    expect(santiago.absenceDate).toBe("2026-10-11");
    expect(utc.absenceDate).toBe("2026-10-12");
    expect(santiago.deadlineDate).toBe("2026-10-16");
    expect(utc.deadlineDate).toBe("2026-10-19");
    expect(santiago.deadlineDate).not.toBe(utc.deadlineDate);
  });

  test("límite exclusivo: instante exacto fuera y milisegundo anterior dentro", () => {
    const deadline = calculateJustificationDeadline({ missedAt: MONDAY, timeZone: TIME_ZONE });
    const exact = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: deadline.deadlineAt,
      timeZone: TIME_ZONE,
    });
    expect(exact.deadlineDate).toBe(deadline.deadlineDate);
    expect(exact.withinDeadline).toBe(false);

    const before = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: deadline.deadlineAt - 1,
      timeZone: TIME_ZONE,
    });
    expect(before.withinDeadline).toBe(true);

    const after = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: deadline.deadlineAt + 1,
      timeZone: TIME_ZONE,
    });
    expect(after.withinDeadline).toBe(false);
  });

  test("devuelve cálculo y decisión para TI2-119 sin persistir", () => {
    const deadline = calculateJustificationDeadline({ missedAt: MONDAY, timeZone: TIME_ZONE });
    const timely = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: MONDAY,
      timeZone: TIME_ZONE,
    });
    expect(timely.absenceDate).toBe(deadline.absenceDate);
    expect(timely.deadlineDate).toBe(deadline.deadlineDate);
    expect(timely.deadlineAt).toBe(deadline.deadlineAt);
    expect(timely.submittedAt).toBe(MONDAY);
    expect(timely.submittedDate).toBe("2026-10-12");
    expect(timely.withinDeadline).toBe(true);

    const early = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: MONDAY - 1,
      timeZone: TIME_ZONE,
    });
    expect(early.withinDeadline).toBe(false);
  });

  test("el feriado el mismo día de la inasistencia no desplaza el plazo", () => {
    const deadline = calculateJustificationDeadline({
      missedAt: MONDAY,
      timeZone: TIME_ZONE,
      holidays: ["2026-10-12"],
    });
    expect(deadline.absenceDate).toBe("2026-10-12");
    expect(deadline.deadlineDate).toBe("2026-10-19");
  });

  test("la entrega en fin de semana dentro del plazo cuenta como dentro", () => {
    // Sábado 2026-10-17 12:00 UTC: 09:00 en Santiago, antes del vencimiento.
    const saturday = Date.UTC(2026, 9, 17, 12);
    const decision = decideJustificationTimeliness({
      missedAt: MONDAY,
      submittedAt: saturday,
      timeZone: TIME_ZONE,
    });
    expect(decision.submittedDate).toBe("2026-10-17");
    expect(decision.withinDeadline).toBe(true);
  });

  test("rechaza instantes fuera del rango representable de fecha", () => {
    expect(() => calculateJustificationDeadline({ missedAt: 1e30, timeZone: TIME_ZONE })).toThrow(
      "instante válido",
    );
    expect(() =>
      decideJustificationTimeliness({ missedAt: MONDAY, submittedAt: 1e30, timeZone: TIME_ZONE }),
    ).toThrow("entrega");
  });

  test("rechaza instantes, zonas y feriados inválidos", () => {
    expect(() => calculateJustificationDeadline({ missedAt: 0, timeZone: TIME_ZONE })).toThrow(
      "instante válido",
    );
    expect(() => calculateJustificationDeadline({ missedAt: MONDAY, timeZone: "" })).toThrow(
      "zona horaria",
    );
    expect(() =>
      calculateJustificationDeadline({ missedAt: MONDAY, timeZone: "Mars/Olympus" }),
    ).toThrow("desconocida");
    expect(() =>
      calculateJustificationDeadline({
        missedAt: MONDAY,
        timeZone: TIME_ZONE,
        holidays: ["2026-13-40"],
      }),
    ).toThrow("feriado");
    expect(() =>
      decideJustificationTimeliness({
        missedAt: MONDAY,
        submittedAt: Number.NaN,
        timeZone: TIME_ZONE,
      }),
    ).toThrow("entrega");
  });
});
