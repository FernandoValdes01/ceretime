import { describe, expect, test } from "vitest";
import { ATTENTION_STATUS_VALUES, INITIAL_ATTENTION_STATUS, isAttentionStatus } from "./attention";
import {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  isAvailabilityExceptionKind,
  isValidMinuteRange,
  isValidWeekday,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
} from "./availability";
import { isModality, MODALITY_VALUES } from "./modality";

/**
 * Dominio puro de agenda (TI2-83): literales persistidos y predicados de
 * rango. Sin Convex ni base de datos; la prueba de índices vive en
 * `convex/agenda.test.ts`.
 */

describe("modalidades de atención", () => {
  test("solo admite presencial y en línea, sin híbrida", () => {
    expect([...MODALITY_VALUES]).toEqual(["inPerson", "online"]);
    expect(isModality("inPerson")).toBe(true);
    expect(isModality("online")).toBe(true);
    expect(isModality("hybrid")).toBe(false);
    expect(isModality("")).toBe(false);
  });
});

describe("días y ventanas de disponibilidad", () => {
  test("la semana va de domingo (0) a sábado (6)", () => {
    expect(WEEKDAY_MIN).toBe(0);
    expect(WEEKDAY_MAX).toBe(6);
    expect(isValidWeekday(0)).toBe(true);
    expect(isValidWeekday(6)).toBe(true);
    expect(isValidWeekday(-1)).toBe(false);
    expect(isValidWeekday(7)).toBe(false);
    expect(isValidWeekday(1.5)).toBe(false);
    expect(isValidWeekday(Number.NaN)).toBe(false);
  });

  test("la ventana cabe en el día y el inicio precede al fin", () => {
    expect(DAY_START_MINUTE).toBe(0);
    expect(DAY_END_MINUTE).toBe(1440);
    expect(isValidMinuteRange(540, 600)).toBe(true);
    expect(isValidMinuteRange(0, 1440)).toBe(true);
    expect(isValidMinuteRange(600, 600)).toBe(false);
    expect(isValidMinuteRange(600, 540)).toBe(false);
    expect(isValidMinuteRange(-1, 600)).toBe(false);
    expect(isValidMinuteRange(540, 1441)).toBe(false);
    expect(isValidMinuteRange(540.5, 600)).toBe(false);
    expect(isValidMinuteRange(Number.NaN, 600)).toBe(false);
  });

  test("solo admite cancelar o agregar disponibilidad", () => {
    expect([...AVAILABILITY_EXCEPTION_KIND_VALUES]).toEqual(["cancelled", "added"]);
    expect(isAvailabilityExceptionKind("cancelled")).toBe(true);
    expect(isAvailabilityExceptionKind("added")).toBe(true);
    expect(isAvailabilityExceptionKind("moved")).toBe(false);
  });
});

describe("estados de la atención", () => {
  test("cubre reserva, cambio, cancelación e inasistencia", () => {
    expect([...ATTENTION_STATUS_VALUES]).toEqual([
      "scheduled",
      "completed",
      "cancelled_by_student",
      "cancelled_by_cereti",
      "rescheduled",
      "no_show",
    ]);
    expect(INITIAL_ATTENTION_STATUS).toBe("scheduled");
    expect(isAttentionStatus("no_show")).toBe(true);
    expect(isAttentionStatus("justified")).toBe(false);
  });
});
