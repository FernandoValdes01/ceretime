import { describe, expect, test } from "vitest";
import {
  MAX_APPOINTMENT_PROFESSIONALS,
  appointmentProfessionalIds,
  isAppointmentParticipant,
  isAppointmentProfessional,
  normalizeAppointmentProfessionals,
  type AppointmentParticipants,
} from "./participants";
import {
  appointmentProfessionalIds as barrelProfessionalIds,
  normalizeAppointmentProfessionals as barrelNormalize,
} from "../index";

const RESPONSIBLE = "profesional-ficticio-1";
const SECOND = "profesional-ficticio-2";
const THIRD = "profesional-ficticio-3";
const STUDENT = "estudiante-ficticio-1";

const participants: AppointmentParticipants = {
  studentId: STUDENT,
  professionalId: RESPONSIBLE,
  additionalProfessionalIds: [SECOND],
};

describe("Profesionales de la atención (TI2-142)", () => {
  test("sale por el barrel sin duplicar la fuente", () => {
    expect(barrelNormalize).toBe(normalizeAppointmentProfessionals);
    expect(barrelProfessionalIds).toBe(appointmentProfessionalIds);
  });

  test("una atención de un solo profesional sigue siendo válida sin adicionales", () => {
    expect(normalizeAppointmentProfessionals({ professionalId: ` ${RESPONSIBLE} ` })).toEqual({
      status: "valid",
      professionalId: RESPONSIBLE,
      additionalProfessionalIds: [],
    });
  });

  test("recorta y descarta repeticiones, incluido el responsable entre los adicionales", () => {
    expect(
      normalizeAppointmentProfessionals({
        professionalId: RESPONSIBLE,
        additionalProfessionalIds: [` ${SECOND}`, RESPONSIBLE, SECOND],
      }),
    ).toEqual({
      status: "valid",
      professionalId: RESPONSIBLE,
      additionalProfessionalIds: [SECOND],
    });
  });

  test("rechaza el responsable vacío y el adicional vacío", () => {
    expect(normalizeAppointmentProfessionals({ professionalId: " " })).toEqual({
      status: "rejected",
      cause: "professional_required",
    });
    expect(
      normalizeAppointmentProfessionals({
        professionalId: RESPONSIBLE,
        additionalProfessionalIds: [SECOND, " "],
      }),
    ).toEqual({ status: "rejected", cause: "professional_invalid" });
  });

  test("el total con el responsable no supera el máximo provisional", () => {
    expect(MAX_APPOINTMENT_PROFESSIONALS).toBe(3);
    expect(
      normalizeAppointmentProfessionals({
        professionalId: RESPONSIBLE,
        additionalProfessionalIds: [SECOND, THIRD],
      }).status,
    ).toBe("valid");
    expect(
      normalizeAppointmentProfessionals({
        professionalId: RESPONSIBLE,
        additionalProfessionalIds: [SECOND, THIRD, "profesional-ficticio-4"],
      }),
    ).toEqual({ status: "rejected", cause: "too_many_professionals" });
  });

  test("la detección de cruces recorre a todos, responsable primero", () => {
    expect(appointmentProfessionalIds({ professionalId: RESPONSIBLE })).toEqual([RESPONSIBLE]);
    expect(
      appointmentProfessionalIds({
        professionalId: RESPONSIBLE,
        additionalProfessionalIds: [SECOND, RESPONSIBLE, THIRD],
      }),
    ).toEqual([RESPONSIBLE, SECOND, THIRD]);
  });

  test("participan el estudiante y cada profesional; nadie más", () => {
    expect(isAppointmentParticipant(STUDENT, participants)).toBe(true);
    expect(isAppointmentParticipant(RESPONSIBLE, participants)).toBe(true);
    expect(isAppointmentParticipant(SECOND, participants)).toBe(true);
    expect(isAppointmentParticipant(THIRD, participants)).toBe(false);
    expect(isAppointmentParticipant("practicante-ficticio-1", participants)).toBe(false);
    expect(isAppointmentParticipant(" ", participants)).toBe(false);
    expect(isAppointmentProfessional(STUDENT, participants)).toBe(false);
    expect(isAppointmentProfessional(SECOND, participants)).toBe(true);
  });
});
