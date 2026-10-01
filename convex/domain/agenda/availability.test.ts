import { describe, expect, test } from "vitest";
import {
  AGENDA_CONTRACT_VERSION,
  AVAILABILITY_MAX_ITEMS_PER_READ,
  AVAILABILITY_SLOT_MINUTES_MAX,
  AVAILABILITY_SLOT_MINUTES_MIN,
  isAvailabilityModality,
  isDurationWithinLimit,
  isTimeRangeOrdered,
  isValidDateLabel,
  isValidTimeLabel,
  isValidWeekday,
  toVersionedAvailabilityBlock,
} from "./availability";

describe("Contratos de disponibilidad versionados (TI2-87)", () => {
  test("la versión vigente es v1", () => {
    expect(AGENDA_CONTRACT_VERSION).toBe("v1");
  });

  test("los topes de forma quedan fijados sin duplicar la API", () => {
    expect(AVAILABILITY_SLOT_MINUTES_MIN).toBe(15);
    expect(AVAILABILITY_SLOT_MINUTES_MAX).toBe(480);
    expect(AVAILABILITY_MAX_ITEMS_PER_READ).toBe(50);
  });

  test("valida día, hora, modalidad y duración solo por forma", () => {
    expect(isValidWeekday(0)).toBe(true);
    expect(isValidWeekday(6)).toBe(true);
    expect(isValidWeekday(7)).toBe(false);
    expect(isValidTimeLabel("09:00")).toBe(true);
    expect(isValidTimeLabel("24:00")).toBe(false);
    expect(isValidDateLabel("2026-10-24")).toBe(true);
    expect(isValidDateLabel("24-10-2026")).toBe(false);
    expect(isAvailabilityModality("inPerson")).toBe(true);
    expect(isAvailabilityModality("hybrid")).toBe(false);
    expect(isDurationWithinLimit(30)).toBe(true);
    expect(isDurationWithinLimit(481)).toBe(false);
    expect(isTimeRangeOrdered("09:00", "10:00")).toBe(true);
    expect(isTimeRangeOrdered("10:00", "09:00")).toBe(false);
  });

  test("un bloque válido se versiona sin decidir cruces", () => {
    const result = toVersionedAvailabilityBlock({
      id: "block-ficticio-1",
      professionalId: "profesional-ficticio-1",
      weekday: 4,
      from: "09:00",
      to: "10:00",
      durationMinutes: 60,
      modality: "inPerson",
      spaceId: "space-ficticio-c204",
    });
    expect(result).toEqual({
      status: "ok",
      data: {
        id: "block-ficticio-1",
        professionalId: "profesional-ficticio-1",
        weekday: 4,
        from: "09:00",
        to: "10:00",
        durationMinutes: 60,
        modality: "inPerson",
        spaceId: "space-ficticio-c204",
        version: "v1",
      },
    });
  });

  test("los casos de error o límite devuelven códigos estables en español", () => {
    const base = {
      id: "block-ficticio-2",
      professionalId: "profesional-ficticio-1",
      weekday: 1,
      from: "09:00",
      to: "10:00",
      durationMinutes: 60,
      modality: "inPerson" as const,
    };
    expect(toVersionedAvailabilityBlock({ ...base, weekday: 8 })).toEqual({
      status: "error",
      error: {
        code: "availability_invalid_weekday",
        message: "El día de la semana debe estar entre 0 y 6.",
      },
    });
    expect(toVersionedAvailabilityBlock({ ...base, from: "11:00", to: "10:00" })).toEqual({
      status: "error",
      error: {
        code: "availability_invalid_time_range",
        message: "El rango horario debe avanzar en formato HH:MM.",
      },
    });
    expect(toVersionedAvailabilityBlock({ ...base, durationMinutes: 5 })).toEqual({
      status: "error",
      error: {
        code: "availability_invalid_duration",
        message: "La duración debe estar entre 15 y 480 minutos.",
      },
    });
  });
});
