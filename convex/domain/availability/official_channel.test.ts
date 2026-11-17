// cspell:ignore HJKMNP
import { describe, expect, test } from "vitest";
import {
  NO_COMPATIBLE_SLOT_EXPLANATIONS,
  NO_COMPATIBLE_SLOT_REASON_VALUES,
  OFFICIAL_CHANNELS,
  combineNoCompatibleSlotReasons,
  decideNoCompatibleSlotReason,
  deriveCoordinationReferenceCode,
  toOfficialChannelCoordination,
} from "./official_channel";

const REFERENCE_CODE_PATTERN = /^CER-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

describe("motivo de la ausencia de horario compatible (TI2-144)", () => {
  test("sin nada descartado no hay horarios publicados", () => {
    expect(decideNoCompatibleSlotReason({ occupied: 0, incompatible: 0 })).toBe(
      "no_published_slots",
    );
  });

  test("solo compatibles ocupados explica que están ocupados", () => {
    expect(decideNoCompatibleSlotReason({ occupied: 3, incompatible: 0 })).toBe("slots_occupied");
  });

  test("solo incompatibles explica la compatibilidad", () => {
    expect(decideNoCompatibleSlotReason({ occupied: 0, incompatible: 2 })).toBe("needs_not_met");
  });

  test("un compatible ocupado prima sobre los incompatibles: hay un horario que sirve", () => {
    expect(decideNoCompatibleSlotReason({ occupied: 1, incompatible: 3 })).toBe("slots_occupied");
  });

  test("varias búsquedas se resumen en el motivo de mayor prioridad", () => {
    expect(combineNoCompatibleSlotReasons(["no_published_slots", "needs_not_met"])).toBe(
      "needs_not_met",
    );
    expect(
      combineNoCompatibleSlotReasons(["needs_not_met", "slots_occupied", "no_published_slots"]),
    ).toBe("slots_occupied");
    expect(combineNoCompatibleSlotReasons([])).toBe("no_published_slots");
  });

  test("cada motivo tiene su explicación y ninguna promete rebajar necesidades", () => {
    for (const reason of NO_COMPATIBLE_SLOT_REASON_VALUES) {
      expect(NO_COMPATIBLE_SLOT_EXPLANATIONS[reason]).toContain("canal oficial");
    }
    expect(NO_COMPATIBLE_SLOT_EXPLANATIONS.needs_not_met).toContain("No las reducimos");
  });
});

describe("código de referencia (TI2-144)", () => {
  test("tiene formato legible y no contiene el identificador", () => {
    const code = deriveCoordinationReferenceCode("acc-ficticio-123");
    expect(code).toMatch(REFERENCE_CODE_PATTERN);
    expect(code).not.toContain("acc");
    expect(code).not.toContain("123");
  });

  test("es determinista y distingue acompañamientos", () => {
    expect(deriveCoordinationReferenceCode("acc-1")).toBe(deriveCoordinationReferenceCode("acc-1"));
    expect(deriveCoordinationReferenceCode(" acc-1 ")).toBe(
      deriveCoordinationReferenceCode("acc-1"),
    );
    const codes = new Set(
      Array.from({ length: 200 }, (_, index) => deriveCoordinationReferenceCode(`acc-${index}`)),
    );
    expect(codes.size).toBe(200);
  });

  test("conserva el código ya entregado a los estudiantes", () => {
    // Si la derivación cambia, el personal no reconocería un código que el
    // estudiante recibió antes.
    expect(deriveCoordinationReferenceCode("acc-ficticio-1")).toBe("CER-GF48-8D7W");
  });

  test("rechaza un acompañamiento vacío", () => {
    expect(() => deriveCoordinationReferenceCode("  ")).toThrow(
      "El código de referencia requiere un acompañamiento.",
    );
  });
});

describe("canales oficiales (TI2-144)", () => {
  test("el canal presencial trae campus, edificio, piso, sala, condiciones e instrucciones", () => {
    const inPerson = OFFICIAL_CHANNELS.filter((channel) => channel.kind === "inPerson");
    expect(inPerson.length).toBeGreaterThan(0);
    for (const channel of inPerson) {
      for (const field of Object.values(channel.location)) {
        expect(field.trim()).not.toBe("");
      }
    }
  });

  test("los canales tienen identificador único", () => {
    const ids = OFFICIAL_CHANNELS.map((channel) => channel.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("la coordinación reúne motivo, explicación, código y canales", () => {
    expect(toOfficialChannelCoordination("acc-1", "slots_occupied")).toEqual({
      reason: "slots_occupied",
      explanation: NO_COMPATIBLE_SLOT_EXPLANATIONS.slots_occupied,
      referenceCode: deriveCoordinationReferenceCode("acc-1"),
      channels: OFFICIAL_CHANNELS,
    });
  });
});
