import { describe, expect, test } from "vitest";
import {
  isSpaceLimitWithinCatalog,
  SPACE_CATALOG_CONTRACT_VERSION,
  SPACE_CATALOG_MAX_ITEMS,
  toSpaceLabel,
  toVersionedSpace,
} from "./space";

describe("Catálogo de espacios versionado (TI2-87)", () => {
  test("la versión vigente es v1 con tope 50", () => {
    expect(SPACE_CATALOG_CONTRACT_VERSION).toBe("v1");
    expect(SPACE_CATALOG_MAX_ITEMS).toBe(50);
    expect(isSpaceLimitWithinCatalog(1)).toBe(true);
    expect(isSpaceLimitWithinCatalog(50)).toBe(true);
    expect(isSpaceLimitWithinCatalog(51)).toBe(false);
  });

  test("un espacio válido se versiona con campus, edificio, piso y sala", () => {
    const result = toVersionedSpace({
      id: "space-ficticio-c204",
      campus: "Campus San Francisco (ficticio)",
      building: "Edificio C (ficticio)",
      floor: "Piso 2",
      room: "Sala C-204",
      accessConditions: "Acceso por rampa lateral (ficticio).",
      arrivalInstructions: "Siga a la derecha 20 metros (ficticio).",
    });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("Se esperaba un espacio válido");
    expect(result.data.version).toBe("v1");
    expect(toSpaceLabel(result.data)).toContain("Sala C-204");
  });

  test("el límite vacío se rechaza con código estable en español", () => {
    const result = toVersionedSpace({
      id: "space-ficticio-vacio",
      campus: "Campus San Francisco (ficticio)",
      building: "Edificio C (ficticio)",
      floor: "Piso 2",
      room: "   ",
      accessConditions: "Acceso ficticio.",
      arrivalInstructions: "Instrucciones ficticias.",
    });
    expect(result).toEqual({
      status: "error",
      error: {
        code: "space_invalid_field",
        message: "El espacio debe traer campus, edificio, piso, sala, acceso e instrucciones.",
      },
    });
  });
});
