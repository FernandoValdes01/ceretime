// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import {
  AGENDA_TIME_ZONE_LABEL,
  civilDateIssue,
  formatAgendaDateTime,
  formatAgendaDate,
  formatAgendaInstant,
  formatAgendaTime,
  formatCivilDate,
  formatCivilDateRange,
  formatCivilDateWithYear,
  formatCivilDay,
  isValidCivilDate,
} from "./date-format.ts";

/**
 * Pruebas del formato único de fechas de la Web (TI2-134).
 *
 * Cubren el cambio de hora de Chile y el cambio de año: son los casos donde
 * leer un instante con la zona del navegador movería la fecha o la hora. Las
 * fechas civiles se comprueban aparte porque no representan un instante.
 */

describe("formato de la agenda en America/Santiago", () => {
  test("la zona de la agenda se muestra junto a la hora", () => {
    expect(AGENDA_TIME_ZONE_LABEL).toBe("America/Santiago");
    expect(formatAgendaDateTime(Date.UTC(2026, 4, 12, 14, 0), Date.UTC(2026, 4, 12, 15, 0))).toBe(
      "martes, 12 de mayo de 2026, 10:00 a. m. – 11:00 a. m. (America/Santiago)",
    );
    expect(formatAgendaInstant(Date.UTC(2026, 4, 12, 14, 0))).toBe(
      "martes, 12 de mayo de 2026, 10:00 a. m. (America/Santiago)",
    );
  });

  test("el cambio de hora de septiembre no mueve el día ni la hora", () => {
    // 2026-09-06: Chile adelanta el reloj de -04 a -03 a las 24:00 del día 5.
    expect(formatAgendaDate(Date.UTC(2026, 8, 6, 13, 0))).toBe("domingo, 6 de septiembre de 2026");
    expect(formatAgendaTime(Date.UTC(2026, 8, 6, 13, 0))).toBe("10:00 a. m.");
    // 03:30 UTC todavía es la noche del sábado 5 en Santiago.
    expect(formatAgendaDate(Date.UTC(2026, 8, 6, 3, 30))).toBe("sábado, 5 de septiembre de 2026");
    expect(formatAgendaTime(Date.UTC(2026, 8, 6, 3, 30))).toBe("11:30 p. m.");
  });

  test("el cambio de hora de abril tampoco desplaza la fecha", () => {
    // 2026-04-05: Chile atrasa el reloj de -03 a -04 a las 24:00 del día 4.
    expect(formatAgendaDate(Date.UTC(2026, 3, 5, 3, 30))).toBe("sábado, 4 de abril de 2026");
    expect(formatAgendaDate(Date.UTC(2026, 3, 5, 4, 30))).toBe("domingo, 5 de abril de 2026");
  });

  test("el cambio de año conserva el día de cada extremo", () => {
    expect(formatAgendaDate(Date.UTC(2027, 0, 1, 2, 30))).toBe("jueves, 31 de diciembre de 2026");
    expect(formatAgendaTime(Date.UTC(2027, 0, 1, 2, 30))).toBe("11:30 p. m.");
    expect(formatAgendaDate(Date.UTC(2027, 0, 1, 3, 30))).toBe("viernes, 1 de enero de 2027");
    expect(formatAgendaTime(Date.UTC(2027, 0, 1, 3, 30))).toBe("12:30 a. m.");
  });
});

describe("fechas civiles sin instante", () => {
  test("se leen sin que la zona del navegador las mueva de día", () => {
    expect(formatCivilDay("2026-09-06")).toBe("Domingo 6 de septiembre");
    expect(formatCivilDate("2026-11-08")).toBe("8 de noviembre");
    expect(formatCivilDateWithYear("2027-01-01")).toBe("1 de enero de 2027");
  });

  test("el rango omite el mes repetido y lo conserva al cambiar de mes", () => {
    expect(formatCivilDateRange("2026-11-02", "2026-11-08")).toBe("2 al 8 de noviembre");
    expect(formatCivilDateRange("2026-11-30", "2026-12-06")).toBe(
      "30 de noviembre al 6 de diciembre",
    );
  });
});

describe("validación de fechas escritas a mano", () => {
  test("acepta una fecha real del calendario", () => {
    expect(civilDateIssue("2026-05-12")).toBeNull();
    expect(isValidCivilDate("2026-05-12")).toBe(true);
  });

  test("distingue el formato inválido de una fecha imposible", () => {
    expect(civilDateIssue("12-05-2026")).toBe("format");
    expect(civilDateIssue("2026-5-12")).toBe("format");
    expect(civilDateIssue("")).toBe("format");
    expect(civilDateIssue("2026-02-29")).toBe("impossible");
    expect(civilDateIssue("2026-04-31")).toBe("impossible");
    expect(civilDateIssue("2026-13-01")).toBe("impossible");
  });

  test("acepta el 29 de febrero de un año bisiesto", () => {
    expect(civilDateIssue("2024-02-29")).toBeNull();
    expect(isValidCivilDate("2024-02-29")).toBe(true);
  });
});
