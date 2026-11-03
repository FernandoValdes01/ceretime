import { describe, expect, test } from "vitest";
import {
  APPOINTMENT_AUDIT_ACTION_VALUES,
  isAppointmentAuditAction,
  toAppointmentAuditEvent,
  type AppointmentAuditEvent,
} from "./audit";

/**
 * Pruebas puras del evento mínimo de auditoría de agenda (TI2-128), con datos
 * ficticios y sin Convex.
 */

const OCCURRED_AT = Date.UTC(2026, 9, 1, 12);

const base: AppointmentAuditEvent = {
  action: "cancelled",
  actorId: "user-student",
  appointmentId: "appointment-1",
  result: "cancelled_by_student",
  occurredAt: OCCURRED_AT,
};

describe("evento de auditoría de agenda (TI2-128)", () => {
  test("las acciones auditadas son las cuatro operaciones de agenda", () => {
    expect(APPOINTMENT_AUDIT_ACTION_VALUES).toEqual([
      "booked",
      "cancelled",
      "rescheduled",
      "attendance_recorded",
    ]);
    expect(isAppointmentAuditAction("booked")).toBe(true);
    expect(isAppointmentAuditAction("deleted")).toBe(false);
  });

  test("el evento conserva exactamente cinco campos y descarta texto extra", () => {
    const withExtras = {
      ...base,
      actorId: "  user-student  ",
      reason: "Motivo ficticio sensible",
      body: "Nota ficticia",
    } as AppointmentAuditEvent;

    const event = toAppointmentAuditEvent(withExtras);

    expect(event).toEqual(base);
    expect(Object.keys(event).sort()).toEqual(
      ["action", "actorId", "appointmentId", "occurredAt", "result"].sort(),
    );
  });

  test("cada acción solo acepta su resultado coherente", () => {
    expect(toAppointmentAuditEvent({ ...base, action: "booked", result: "scheduled" }).result).toBe(
      "scheduled",
    );
    expect(
      toAppointmentAuditEvent({ ...base, action: "attendance_recorded", result: "no_show" }).result,
    ).toBe("no_show");
    expect(() =>
      toAppointmentAuditEvent({ ...base, action: "booked", result: "completed" }),
    ).toThrow("El resultado no corresponde a la acción auditada.");
    expect(() =>
      toAppointmentAuditEvent({
        ...base,
        action: "attendance_recorded",
        result: "no_show_justified",
      }),
    ).toThrow("El resultado no corresponde a la acción auditada.");
  });

  test("referencias vacías, instantes inválidos y acciones desconocidas son error", () => {
    expect(() => toAppointmentAuditEvent({ ...base, actorId: " " })).toThrow(
      "El evento de auditoría requiere un actor.",
    );
    expect(() => toAppointmentAuditEvent({ ...base, appointmentId: "" })).toThrow(
      "El evento de auditoría requiere una atención.",
    );
    for (const occurredAt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => toAppointmentAuditEvent({ ...base, occurredAt })).toThrow(
        "El evento de auditoría requiere un instante epoch válido.",
      );
    }
    expect(() =>
      toAppointmentAuditEvent({ ...base, action: "deleted" as AppointmentAuditEvent["action"] }),
    ).toThrow("La acción auditada es desconocida.");
  });
});
