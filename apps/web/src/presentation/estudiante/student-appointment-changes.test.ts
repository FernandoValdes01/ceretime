import { describe, expect, test } from "vitest";
import {
  APPOINTMENT_STATUS_VALUES,
  findAppointmentTransition,
  justificationDeadlineFor,
} from "../../../../../convex/domain/index.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";
import {
  isAppointmentUpcoming,
  justificationSituationOf,
  studentAppointmentChanges,
  studentCancellationFrom,
} from "./student-appointment-changes.ts";

/**
 * Decisiones de presentación del Estudiante sobre su atención (TI2-163). Se
 * comprueba que salen de la tabla de transiciones y del plazo del dominio, sin
 * una regla propia. Datos ficticios con instantes fijos.
 */

const HORA = 3_600_000;
const INICIO = Date.UTC(2026, 10, 2, 14, 0);

function atencion(overrides: Partial<AgendaAppointment> = {}): AgendaAppointment {
  return {
    id: "at-1",
    status: "scheduled",
    modality: "inPerson",
    startAt: INICIO,
    endAt: INICIO + HORA,
    ...overrides,
  };
}

describe("cambios ofrecidos al Estudiante", () => {
  test("antes del inicio, una atención vigente se puede reagendar y cancelar sin motivo obligatorio", () => {
    for (const status of ["scheduled", "rescheduled"] as const) {
      const changes = studentAppointmentChanges(atencion({ status }), INICIO - HORA);
      expect(changes.canReschedule).toBe(true);
      expect(changes.cancellation).toEqual({
        reasonRequired: findAppointmentTransition(status, "cancelled_by_student")?.requiresReason,
      });
    }
  });

  test("desde el inicio no se ofrece ningún cambio, como rechaza el Backend", () => {
    expect(studentAppointmentChanges(atencion(), INICIO)).toEqual({
      canReschedule: false,
      cancellation: null,
    });
  });

  test("los estados terminales e inasistencias no se cambian", () => {
    for (const status of APPOINTMENT_STATUS_VALUES) {
      if (status === "scheduled" || status === "rescheduled") continue;
      expect(studentAppointmentChanges(atencion({ status }), INICIO - HORA)).toEqual({
        canReschedule: false,
        cancellation: null,
      });
      expect(studentCancellationFrom(status)).toBeNull();
      expect(isAppointmentUpcoming(status)).toBe(false);
    }
  });
});

describe("situación de la justificación", () => {
  const plazo = justificationDeadlineFor(INICIO);

  test("una atención que no es inasistencia no tiene justificación", () => {
    expect(justificationSituationOf(atencion(), INICIO)).toEqual({ kind: "none" });
  });

  test("la inasistencia sin entrega está abierta hasta el vencimiento exclusivo", () => {
    const inasistencia = atencion({ status: "no_show" });
    expect(justificationSituationOf(inasistencia, plazo.deadlineAt - 1)).toEqual({
      kind: "open",
      deadlineDate: plazo.deadlineDate,
    });
    expect(justificationSituationOf(inasistencia, plazo.deadlineAt)).toEqual({
      kind: "expired",
      deadlineDate: plazo.deadlineDate,
    });
  });

  test("una entrega muestra su recepción y revisión, aunque el plazo haya vencido", () => {
    const entregada = atencion({
      status: "no_show_unjustified",
      justificationSubmittedAt: INICIO + 24 * HORA,
      justificationReview: "rejected",
      justificationReviewExplanation: "Falta el respaldo.",
    });
    expect(justificationSituationOf(entregada, plazo.deadlineAt + HORA)).toEqual({
      kind: "submitted",
      deadlineDate: plazo.deadlineDate,
      submittedAt: INICIO + 24 * HORA,
      supportingDocumentReceived: false,
      review: "rejected",
      reviewExplanation: "Falta el respaldo.",
    });
  });

  test("una inasistencia resuelta sin entrega queda cerrada", () => {
    expect(justificationSituationOf(atencion({ status: "no_show_unjustified" }), INICIO)).toEqual({
      kind: "closed",
    });
  });
});
