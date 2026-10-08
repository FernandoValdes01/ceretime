import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_STATUS_VALUES,
  INITIAL_APPOINTMENT_STATUS,
  NO_SHOW_PENDING_STATE,
  transitionAppointment,
  type Appointment,
  type AppointmentPage,
} from "./appointment";
import {
  APPOINTMENT_CONTRACT_VERSION as BARREL_VERSION,
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
      occurredAt: 1000,
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
      occurredAt: 3000,
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
      occurredAt: 1000,
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
      occurredAt: 1000,
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
