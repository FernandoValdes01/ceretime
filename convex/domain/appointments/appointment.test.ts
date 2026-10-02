import { describe, expect, expectTypeOf, test } from "vitest";
import {
  APPOINTMENT_CONTRACT_VERSION,
  APPOINTMENT_STATUS_VALUES,
  INITIAL_APPOINTMENT_STATUS,
  type Appointment,
  type AppointmentPage,
} from "./appointment";
import {
  APPOINTMENT_CONTRACT_VERSION as BARREL_VERSION,
  type Appointment as BarrelAppointment,
} from "../index";

describe("Contratos públicos de la atención reservada (TI2-87)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(APPOINTMENT_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(APPOINTMENT_CONTRACT_VERSION);
    expectTypeOf<BarrelAppointment>().toEqualTypeOf<Appointment>();
  });

  test("los estados son los seis de TI2-83 con inicio en reserva creada", () => {
    expect([...APPOINTMENT_STATUS_VALUES]).toEqual([
      "scheduled",
      "completed",
      "cancelled_by_student",
      "cancelled_by_cereti",
      "rescheduled",
      "no_show",
    ]);
    expect(INITIAL_APPOINTMENT_STATUS).toBe("scheduled");
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
