import { describe, expect, expectTypeOf, test } from "vitest";
import {
  AVAILABILITY_CONTRACT_VERSION,
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
  type AvailabilityBlock,
  type AvailabilityException,
  type AvailabilitySlotPage,
  type ExpandAvailabilityInput,
  type ListAvailabilityInput,
} from "./availability";
import {
  AVAILABILITY_CONTRACT_VERSION as BARREL_VERSION,
  type AvailabilityBlock as BarrelAvailabilityBlock,
} from "../index";

/**
 * Espejo manual de los modelos provisionales de Mobile que tocan
 * disponibilidad (TI2-87): `ModalityPreference` y `GeneralAvailability` de
 * `apps/mobile/src/application/student-area-models.ts`. No es el tipo real:
 * esos modelos pertenecen a TI4, así que esta suite no depende de ellos. Si
 * Mobile cambia, el espejo no lo detecta; la conexión lo reemplaza por la
 * comprobación cableada.
 */
type MobileModalityMirror = "inPerson" | "online";

type MobileGeneralAvailabilityMirror = {
  readonly preferredWeekdays: readonly number[];
  readonly preferredTimeRange?: { readonly from: string; readonly to: string };
};

describe("Contratos públicos de disponibilidad (TI2-87)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(AVAILABILITY_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(AVAILABILITY_CONTRACT_VERSION);
    expectTypeOf<BarrelAvailabilityBlock>().toEqualTypeOf<AvailabilityBlock>();
  });

  test("las clases de excepción son las de TI2-81, sin otra representación", () => {
    expect([...AVAILABILITY_EXCEPTION_KIND_VALUES]).toEqual(["cancelled", "added"]);
  });

  test("la modalidad comparte los literales provisionales de Mobile", () => {
    const modality: MobileModalityMirror = "inPerson";
    const block: AvailabilityBlock = {
      id: "bloque-ficticio-1",
      professionalId: "profesional-ficticio-1",
      weekday: 4,
      startMinute: 540,
      endMinute: 600,
      slotMinutes: 60,
      modality,
      spaceId: "espacio-ficticio-c204",
      version: "v1",
    };
    expect(block.modality).toBe("inPerson");
  });

  test("el rango de Mobile cabe en la entrada mínima sin conversión", () => {
    const availability: MobileGeneralAvailabilityMirror = { preferredWeekdays: [4] };
    const input: ListAvailabilityInput = {
      professionalId: "profesional-ficticio-1",
      from: "2026-10-26",
      to: "2026-10-30",
      timeZone: "America/Santiago",
      limit: 20,
      version: "v1",
    };
    expect(input.professionalId).toBe("profesional-ficticio-1");
    expect(availability.preferredWeekdays).toContain(4);
  });

  test("los DTO ficticios viajan como datos planos (ida y vuelta JSON)", () => {
    const exception: AvailabilityException = {
      date: "2026-10-28",
      kind: "cancelled",
      version: "v1",
    };
    const page: AvailabilitySlotPage = {
      items: [
        {
          id: "cupo-ficticio-1",
          professionalId: "profesional-ficticio-1",
          date: "2026-10-26",
          startAt: 1000,
          endAt: 2000,
          modality: "online",
          version: "v1",
        },
      ],
      hasMore: false,
      nextCursor: null,
      version: "v1",
    };
    expect(JSON.parse(JSON.stringify(exception))).toEqual(exception);
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    expect(page.items[0]?.version).toBe("v1");
  });
});

const TIME_ZONE = "America/Santiago";
const PROFESSIONAL_ID = "profesional-ficticio-1";

/** Miércoles 2026-07-01, invierno (UTC-4): las 09:00 locales son las 13:00 UTC. */
const WINTER_WEDNESDAY = "2026-07-01";
const WINTER_0900 = 1782910800000;

/** Miércoles 2026-01-07, verano (UTC-3): las 09:00 locales son las 12:00 UTC. */
const SUMMER_WEDNESDAY = "2026-01-07";
const SUMMER_0900 = 1767787200000;

/** Lunes 2026-07-06, invierno (UTC-4): las 09:00 locales son las 13:00 UTC. */
const WINTER_MONDAY = "2026-07-06";
const MONDAY_0900 = 1783342800000;

function slotId(date: string, startAt: number): string {
  return `${PROFESSIONAL_ID}:${date}:${startAt}`;
}

function block(overrides: Partial<AvailabilityBlock> = {}): AvailabilityBlock {
  return {
    id: "bloque-ficticio-1",
    professionalId: PROFESSIONAL_ID,
    weekday: 3,
    startMinute: 540,
    endMinute: 660,
    slotMinutes: 60,
    modality: "inPerson",
    spaceId: "sala-1",
    version: AVAILABILITY_CONTRACT_VERSION,
    ...overrides,
  };
}

function input(overrides: Partial<ExpandAvailabilityInput> = {}): ExpandAvailabilityInput {
  return {
    professionalId: PROFESSIONAL_ID,
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
      id: slotId(WINTER_WEDNESDAY, WINTER_0900),
      professionalId: PROFESSIONAL_ID,
      date: WINTER_WEDNESDAY,
      startAt: WINTER_0900,
      endAt: WINTER_0900 + 3_600_000,
      modality: "inPerson",
      spaceId: "sala-1",
      version: AVAILABILITY_CONTRACT_VERSION,
    });
    expect(slots[1]).toMatchObject({
      id: slotId(WINTER_WEDNESDAY, WINTER_0900 + 3_600_000),
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
    expect(slots[0]).toMatchObject({
      id: slotId(SUMMER_WEDNESDAY, SUMMER_0900),
      startAt: SUMMER_0900,
      endAt: SUMMER_0900 + 3_600_000,
    });
    expect(slots[0]).not.toHaveProperty("spaceId");
  });

  test("los días sin bloque no aportan cupos", () => {
    const slots = expandAvailabilitySlots(input({ from: WINTER_WEDNESDAY, to: "2026-07-03" }));

    expect(slots).toHaveLength(2);
    expect(slots.every((slot) => slot.date === WINTER_WEDNESDAY)).toBe(true);
  });

  test("la cancelación elimina el día completo", () => {
    const slots = expandAvailabilitySlots(
      input({
        exceptions: [{ date: WINTER_WEDNESDAY, kind: "cancelled", version: "v1" }],
      }),
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
            version: "v1",
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

  test("los cupos duran exacto aunque la madrugada no exista por el cambio de hora", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), weekday: 0, startMinute: 0, endMinute: 180 }],
        from: "2026-09-06",
        to: "2026-09-06",
      }),
    );

    expect(slots).toHaveLength(3);
    for (const slot of slots) {
      expect(slot.endAt - slot.startAt).toBe(3_600_000);
    }
  });

  test("los cupos duran exacto aunque la hora se repita por el cambio de hora", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), weekday: 6, startMinute: 1320, endMinute: 1440 }],
        from: "2026-04-04",
        to: "2026-04-04",
      }),
    );

    expect(slots).toHaveLength(2);
    for (const slot of slots) {
      expect(slot.endAt - slot.startAt).toBe(3_600_000);
    }
  });

  test("el día de la semana no depende de la zona horaria", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [{ ...block(), weekday: 1 }],
        from: WINTER_MONDAY,
        to: WINTER_MONDAY,
        timeZone: "Pacific/Kiritimati",
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]).toMatchObject({ date: WINTER_MONDAY, startAt: 1783278000000 });
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

  test("el solape entre bloques se preserva con identidad única por cupo", () => {
    const slots = expandAvailabilitySlots(
      input({
        blocks: [
          { ...block(), weekday: 1, startMinute: 540, endMinute: 600, slotMinutes: 30 },
          {
            ...block(),
            id: "bloque-ficticio-2",
            weekday: 1,
            startMinute: 570,
            endMinute: 630,
            slotMinutes: 30,
          },
        ],
        from: WINTER_MONDAY,
        to: WINTER_MONDAY,
      }),
    );

    expect(slots).toHaveLength(4);
    expect(slots[1]?.startAt).toBe(slots[2]?.startAt);
    expect(slots[1]?.endAt).toBeGreaterThan(slots[2]?.startAt ?? 0);
    expect(slots[1]?.id).not.toBe(slots[2]?.id);
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
            version: "v1",
          },
        ],
      }),
    );

    expect(slots).toHaveLength(2);
    expect(slots[0]?.startAt).toBe(slots[1]?.startAt);
    expect(slots[0]?.id).not.toBe(slots[1]?.id);
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

  test("rechaza bloques de otro profesional y profesional vacío", () => {
    expect(() =>
      expandAvailabilitySlots(input({ blocks: [block({ professionalId: "otro-profesional" })] })),
    ).toThrow("mismo profesional");
    expect(() => expandAvailabilitySlots(input({ professionalId: "  " }))).toThrow(
      "profesional dueño",
    );
  });

  test("el rango gigante se rechaza sin expandir", () => {
    expect(() => expandAvailabilitySlots(input({ from: "1900-01-01", to: "9999-12-31" }))).toThrow(
      "92 días",
    );
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
      expandAvailabilitySlots(
        input({ exceptions: [{ date: "2026-07-32", kind: "cancelled", version: "v1" }] }),
      ),
    ).toThrow("fecha civil válida");
    expect(() =>
      expandAvailabilitySlots(
        input({
          exceptions: [{ date: WINTER_WEDNESDAY, kind: "cancelled", windows: [], version: "v1" }],
        }),
      ),
    ).toThrow("no trae ventanas");
    expect(() =>
      expandAvailabilitySlots(
        input({ exceptions: [{ date: WINTER_WEDNESDAY, kind: "added", version: "v1" }] }),
      ),
    ).toThrow("al menos una ventana");
    expect(() =>
      expandAvailabilitySlots(
        input({
          exceptions: [
            { date: WINTER_WEDNESDAY, kind: "cancelled", version: "v1" },
            { date: WINTER_WEDNESDAY, kind: "cancelled", version: "v1" },
          ],
        }),
      ),
    ).toThrow("más de una excepción");
  });
});
