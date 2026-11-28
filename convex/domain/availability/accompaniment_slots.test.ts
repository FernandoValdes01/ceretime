import { describe, expect, test } from "vitest";
import {
  civilWeekOf,
  compareSlotPositions,
  decodeSlotCursor,
  encodeSlotCursor,
  equivalentSlotKey,
  preferredSlotOrder,
} from "./accompaniment_slots";
import { civilDateOfInstant } from "../calendar/civil_days";

const ZONE = "America/Santiago";

describe("búsqueda de horarios por acompañamiento (TI4-84)", () => {
  test("la semana civil va de lunes a lunes en la zona de la agenda", () => {
    // Miércoles 28 de octubre de 2026, 15:00 UTC.
    const week = civilWeekOf(Date.UTC(2026, 9, 28, 15), ZONE);
    expect(civilDateOfInstant(week.startAt, ZONE)).toBe("2026-10-26");
    expect(civilDateOfInstant(week.endAt, ZONE)).toBe("2026-11-02");
    // Un domingo pertenece a la semana que empezó el lunes anterior.
    const domingo = civilWeekOf(Date.UTC(2026, 10, 1, 15), ZONE);
    expect(domingo).toEqual(week);
  });

  test("los cupos equivalentes comparten clave aunque sean de otro profesional", () => {
    const base = { startAt: 1, endAt: 2, modality: "inPerson" as const, spaceId: "sala-1" };
    expect(equivalentSlotKey(base)).toBe(equivalentSlotKey({ ...base }));
    expect(equivalentSlotKey(base)).not.toBe(equivalentSlotKey({ ...base, spaceId: "sala-2" }));
    expect(equivalentSlotKey(base)).not.toBe(equivalentSlotKey({ ...base, endAt: 3 }));
  });

  test("el cursor conserva la posición y rechaza lo que no emitió", () => {
    const position = { startAt: 10, key: "clave" };
    expect(decodeSlotCursor(encodeSlotCursor(position))).toEqual(position);
    for (const foreign of ["", "no-json", "{}", '{"v":2,"startAt":1,"key":"k"}']) {
      expect(decodeSlotCursor(foreign)).toBeNull();
    }
    expect(compareSlotPositions(position, { startAt: 10, key: "clave" })).toBe(0);
    expect(compareSlotPositions(position, { startAt: 11, key: "a" })).toBeLessThan(0);
  });

  test("ordena por menos atenciones y, si empatan, por menor identificador", () => {
    const slots = [{ professionalId: "b" }, { professionalId: "a" }, { professionalId: "c" }];
    const loads: Record<string, number> = { a: 2, b: 0, c: 0 };
    expect(preferredSlotOrder(slots, (id) => loads[id] ?? 0).map((s) => s.professionalId)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});
