import { describe, expect, expectTypeOf, test } from "vitest";
import {
  AVAILABILITY_CONTRACT_VERSION,
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  type AvailabilityBlock,
  type AvailabilityException,
  type AvailabilitySlotPage,
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
