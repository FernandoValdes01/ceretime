import { describe, expect, test } from "vitest";
import {
  addBusinessDays,
  addCivilDays,
  civilDateOfInstant,
  civilWeekday,
  isUsableInstant,
  midnightToEpochMs,
  normalizeHolidays,
} from "./civil_days";

/**
 * Pruebas del calendario civil compartido por los plazos de agenda y
 * privacidad (TI2-136). Sin Convex y con la zona horaria como dato.
 */

const TIME_ZONE = "America/Santiago";

describe("calendario civil (TI2-136)", () => {
  test("la medianoche local se convierte al instante correcto en invierno y verano", () => {
    expect(midnightToEpochMs("2026-11-04", TIME_ZONE)).toBe(
      Date.parse("2026-11-04T00:00:00-03:00"),
    );
    expect(midnightToEpochMs("2026-07-01", TIME_ZONE)).toBe(
      Date.parse("2026-07-01T00:00:00-04:00"),
    );
  });

  test("el día sin medianoche empieza en el salto de primavera", () => {
    // Chile adelanta el reloj el domingo 6 de septiembre de 2026: las 00:00 no existen.
    const startOfDay = midnightToEpochMs("2026-09-06", TIME_ZONE);
    expect(startOfDay).toBe(Date.parse("2026-09-06T01:00:00-03:00"));
    expect(civilDateOfInstant(startOfDay, TIME_ZONE)).toBe("2026-09-06");
    expect(civilDateOfInstant(startOfDay - 1, TIME_ZONE)).toBe("2026-09-05");
  });

  test("sumar días corridos no depende de la zona horaria", () => {
    expect(addCivilDays("2026-11-04", 30)).toBe("2026-12-04");
    expect(addCivilDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addCivilDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  test("el día de la semana civil va de domingo 0 a sábado 6", () => {
    expect(civilWeekday("2026-11-04")).toBe(3);
    expect(civilWeekday("2026-11-07")).toBe(6);
    expect(civilWeekday("2026-11-08")).toBe(0);
  });

  test("los días hábiles saltan fin de semana y feriados, sin contar el inicio", () => {
    expect(addBusinessDays("2026-11-06", 2, new Set())).toBe("2026-11-10");
    expect(addBusinessDays("2026-11-06", 2, new Set(["2026-11-09"]))).toBe("2026-11-11");
    expect(addBusinessDays("2026-11-09", 1, new Set())).toBe("2026-11-10");
  });

  test("los feriados se validan, se ordenan y no se repiten", () => {
    expect(normalizeHolidays(["2026-12-08", "2026-11-09", "2026-12-08"])).toEqual([
      "2026-11-09",
      "2026-12-08",
    ]);
    expect(normalizeHolidays(undefined)).toEqual([]);
    expect(() => normalizeHolidays(["2026-02-30"])).toThrow(/feriado/);
  });

  test("solo se aceptan instantes finitos, positivos y representables", () => {
    expect(isUsableInstant(Date.parse("2026-11-04T12:00:00-03:00"))).toBe(true);
    expect(isUsableInstant(0)).toBe(false);
    expect(isUsableInstant(-1)).toBe(false);
    expect(isUsableInstant(Number.NaN)).toBe(false);
    expect(isUsableInstant(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isUsableInstant(1e30)).toBe(false);
  });
});
