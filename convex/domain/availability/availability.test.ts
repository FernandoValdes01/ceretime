import { describe, expect, test } from "vitest";
import {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  DAY_END_MINUTE,
  DAY_START_MINUTE,
  MAX_EXPANSION_DAYS,
  WEEKDAY_MAX,
  WEEKDAY_MIN,
  expandAvailabilitySlots,
  isAvailabilityExceptionKind,
  isValidCivilDate,
  isValidMinuteRange,
  isValidWeekday,
  type ExpandAvailabilityInput,
  type RecurringBlock,
} from "./availability";

const TIME_ZONE = "America/Santiago";

/** Miércoles 2026-07-01, invierno (UTC-4): las 09:00 locales son las 13:00 UTC. */
const WINTER_WEDNESDAY = "2026-07-01";
const WINTER_0900 = 1782910800000;

/** Miércoles 2026-01-07, verano (UTC-3): las 09:00 locales son las 12:00 UTC. */
const SUMMER_WEDNESDAY = "2026-01-07";
const SUMMER_0900 = 1767787200000;

/** Lunes 2026-07-06, invierno (UTC-4): las 09:00 locales son las 13:00 UTC. */
const WINTER_MONDAY = "2026-07-06";
const MONDAY_0900 = 1783342800000;

function block(overrides: Partial<RecurringBlock> = {}): RecurringBlock {
  return {
    weekday: 3,
    startMinute: 540,
    endMinute: 660,
    slotMinutes: 60,
    modality: "inPerson",
    spaceId: "sala-1",
    ...overrides,
  };
}

function input(overrides: Partial<ExpandAvailabilityInput> = {}): ExpandAvailabilityInput {
  return {
    blocks: [block()],
    from: WINTER_WEDNESDAY,
    to: WINTER_WEDNESDAY,
    timeZone: TIME_ZONE,
    ...overrides,
  };
}

describe("predicados de disponibilidad (TI2-81)", () => {
  test("los días van de domingo (0) a sábado (6)", () => {
    expect(WEEKDAY_MIN).toBe(0);
    expect(WEEKDAY_MAX).toBe(6);
    expect(isValidWeekday(0)).toBe(true);
    expect(isValidWeekday(6)).toBe(true);
    expect(isValidWeekday(7)).toBe(false);
    expect(isValidWeekday(-1)).toBe(false);
    expect(isValidWeekday(1.5)).toBe(false);
    expect(isValidWeekday(Number.NaN)).toBe(false);
  });

  test("la ventana cabe en el día con el fin posterior al inicio", () => {
    expect(DAY_START_MINUTE).toBe(0);
    expect(DAY_END_MINUTE).toBe(1440);
    expect(isValidMinuteRange(540, 660)).toBe(true);
    expect(isValidMinuteRange(1380, 1440)).toBe(true);
    expect(isValidMinuteRange(660, 540)).toBe(false);
    expect(isValidMinuteRange(540, 540)).toBe(false);
    expect(isValidMinuteRange(-1, 60)).toBe(false);
    expect(isValidMinuteRange(0, 1441)).toBe(false);
    expect(isValidMinuteRange(Number.NaN, 660)).toBe(false);
    expect(isValidMinuteRange(540, Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("la fecha civil exige calendario real con formato YYYY-MM-DD", () => {
    expect(isValidCivilDate("2026-07-01")).toBe(true);
    expect(isValidCivilDate("2026-02-30")).toBe(false);
    expect(isValidCivilDate("01-07-2026")).toBe(false);
    expect(isValidCivilDate("2026-13-01")).toBe(false);
    expect(isValidCivilDate("no-fecha")).toBe(false);
  });

  test("la excepción es cancelación o agregado", () => {
    expect([...AVAILABILITY_EXCEPTION_KIND_VALUES]).toEqual(["cancelled", "added"]);
    expect(isAvailabilityExceptionKind("cancelled")).toBe(true);
    expect(isAvailabilityExceptionKind("added")).toBe(true);
    expect(isAvailabilityExceptionKind("moved")).toBe(false);
  });
});

describe("expandAvailabilitySlots (TI2-81)", () => {
  test("expande un bloque semanal en el día exacto con instantes de invierno", () => {
    const slots = expandAvailabilitySlots(input());

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({
      date: WINTER_WEDNESDAY,
      startAt: WINTER_0900,
      endAt: WINTER_0900 + 3_600_000,
      modality: "inPerson",
      spaceId: "sala-1",
    });
    expect(slots[1]).toMatchObject({
      date: WINTER_WEDNESDAY,
      startAt: WINTER_0900 + 3_600_000,
      endAt: WINTER_0900 + 7_200_000,
    });
  });

  test("respeta el horario de verano de la zona horaria", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), modality: "online", spaceId: undefined }],
        from: SUMMER_WEDNESDAY,
        to: SUMMER_WEDNESDAY,
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ startAt: SUMMER_0900, endAt: SUMMER_0900 + 3_600_000 });
    expect(slots[0]).not.toHaveProperty("spaceId");
  });

  test("los días sin bloque no aportan cupos", () => {
    const slots = expandAvailabilitySlots(input({ from: WINTER_WEDNESDAY, to: "2026-07-03" }));

    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.date === WINTER_WEDNESDAY)).toBe(true);
  });

  test("la cancelación elimina el día completo", () => {
    const slots = expandAvailabilitySlots(
      input({ exceptions: [{ date: WINTER_WEDNESDAY, kind: "cancelled" }] }),
    );

    expect(slots).toEqual([]);
  });

  test("el agregado suma ventanas en un día sin bloques", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [],
        from: "2026-07-06",
        to: "2026-07-06",
        exceptions: [
          {
            date: "2026-07-06",
            kind: "added",
            windows: [{ startMinute: 540, endMinute: 600, slotMinutes: 60, modality: "online" }],
          },
        ],
      }),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ date: "2026-07-06", startAt: MONDAY_0900 });
  });

  test("sin bloques ni agregados el resultado es vacío", () => {
    expect(
      expandAvailabilitySlots(input({ blocks: [], from: "2026-07-01", to: "2026-07-05" })),
    ).toEqual([]);
  });

  test("el borde del día admite un bloque que cierra a las 24:00", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), weekday: 1, startMinute: 1380, endMinute: 1440 }],
        from: WINTER_MONDAY,
        to: WINTER_MONDAY,
      }),
    );

    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ startAt: 1783393200000, endAt: 1783396800000 });
  });

  test("los cupos consecutivos quedan adyacentes sin traslape ni hueco", () => {
    const slots = expandAvailabilitySlots(input());

    for (let index = 0; index < slots.length - 1; index += 1) {
      expect(slots[index]?.endAt).toBe(slots[index + 1]?.startAt);
    }
  });

  test("el resto menor a la duración se descarta sin alterar la ventana", () => {
    const slots = expandAvailabilitySlots(
      input({ blocks: [block({ startMinute: 540, endMinute: 630, slotMinutes: 40 })] }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[1]).toMatchObject({ startAt: WINTER_0900 + 2_400_000, endAt: 1782915600000 });
  });

  test("el solape entre bloques se preserva para la ocupación", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [
          { ...block(), weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 30 },
          { ...block(), weekday: 1, startMinute: 570, endMinute: 630, slotMinutes: 30 },
        ],
        from: WINTER_MONDAY,
        to: WINTER_MONDAY,
      }),
    );

    expect(slots).toHaveLength(4);
    expect(slots[1]?.startAt).toBe(slots[2]?.startAt);
    expect(slots[1]?.endAt).toBeGreaterThan(slots[2]?.startAt ?? 0);
  });

  test("el agregado que solapa un bloque suma sin reemplazar", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 60 }],
        from: WINTER_MONDAY,
        to: WINTER_MONDAY,
        exceptions: [
          {
            date: WINTER_MONDAY,
            kind: "added",
            windows: [{ startMinute: 540, endMinute: 600, slotMinutes: 60, modality: "online" }],
          },
        ],
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startAt).toBe(slots[1]?.startAt);
    expect(slots.map((slot) => slot.modality).sort()).toEqual(["inPerson", "online"]);
  });

  test("el rango de 92 días exactos se acepta", () => {
    expect(MAX_EXPANSION_DAYS).toBe(92);
    const slots = expandAvailabilitySlots(
      input({ blocks: [], from: "2026-07-01", to: "2026-09-30" }),
    );

    expect(slots).toEqual([]);
  });
});

describe("rechazos de disponibilidad (TI2-81)", () => {
  test("rechaza minutos no finitos y fin anterior al inicio", () => {
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ startMinute: Number.NaN })] })),
    ).toThrow("minutos enteros dentro del día");
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ endMinute: Number.POSITIVE_INFINITY })] })),
    ).toThrow("minutos enteros dentro del día");
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ startMinute: 660, endMinute: 540 })] })),
    ).toThrow("fin posterior al inicio");
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ startMinute: 0, endMinute: 1500 })] })),
    ).toThrow("dentro del día");
    expect(() => expandAvailabilitySlots(input({ blocks: [block({ weekday: 7 })] }))).toThrow(
      "entre 0 y 6",
    );
  });

  test("rechaza duraciones no positivas o que no caben en la ventana", () => {
    expect(() => expandAvailabilitySlots(input({ blocks: [block({ slotMinutes: 0 })] }))).toThrow(
      "entero positivo",
    );
    expect(() => expandAvailabilitySlots(input({ blocks: [block({ slotMinutes: -30 })] }))).toThrow(
      "entero positivo",
    );
    expect(() => expandAvailabilitySlots(input({ blocks: [block({ slotMinutes: 121 })] }))).toThrow(
      "no cabe en la ventana",
    );
  });

  test("rechaza modalidad o espacio inconsistentes", () => {
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ modality: "hybrid" as never })] })),
    ).toThrow("presencial o en línea");
    expect(() => expandAvailabilitySlots(input({ blocks: [block({ spaceId: "  " })] }))).toThrow(
      "requiere referencia al espacio",
    );
    expect(() =>
      expandAvailabilitySlots(
        input({ blocks: [{ ...block(), modality: "online", spaceId: "sala-1" }] }),
      ),
    ).toThrow("no lleva referencia a espacio");
  });

  test("rechaza rango invertido, fechas inválidas y rango mayor al máximo", () => {
    expect(() => expandAvailabilitySlots(input({ from: "2026-07-02", to: "2026-07-01" }))).toThrow(
      "anterior a su inicio",
    );
    expect(() => expandAvailabilitySlots(input({ from: "2026-02-30", to: "2026-03-01" }))).toThrow(
      "fechas civiles válidas",
    );
    expect(() => expandAvailabilitySlots(input({ from: "2026-07-01", to: "2026-10-02" }))).toThrow(
      "92 días",
    );
    expect(() => expandAvailabilitySlots(input({ timeZone: "Mars/Olympus" }))).toThrow(
      "zona horaria",
    );
  });

  test("rechaza excepciones mal formadas o duplicadas", () => {
    expect(() =>
      expandAvailabilitySlots(input({ exceptions: [{ date: "2026-07-32", kind: "cancelled" }] })),
    ).toThrow("fecha civil válida");
    expect(() =>
      expandAvailabilitySlots(
        input({ exceptions: [{ date: WINTER_WEDNESDAY, kind: "cancelled", windows: [] }] }),
      ),
    ).toThrow("no trae ventanas");
    expect(() =>
      expandAvailabilitySlots(input({ exceptions: [{ date: WINTER_WEDNESDAY, kind: "added" }] })),
    ).toThrow("al menos una ventana");
    expect(() =>
      expandAvailabilitySlots(
        input({
          exceptions: [
            { date: WINTER_WEDNESDAY, kind: "cancelled" },
            { date: WINTER_WEDNESDAY, kind: "cancelled" },
          ],
        }),
      ),
    ).toThrow("más de una excepción");
  });
});
