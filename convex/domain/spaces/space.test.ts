import { describe, expect, expectTypeOf, test } from "vitest";
import {
  SPACE_CATALOG_CONTRACT_VERSION,
  toSpaceLabel,
  type Space,
  type SpaceCatalogPage,
} from "./space";
import {
  SPACE_CATALOG_CONTRACT_VERSION as BARREL_VERSION,
  type Space as BarrelSpace,
} from "../index";

describe("Contratos públicos de espacios (TI2-87)", () => {
  test("la versión vigente es v1 y sale por el barrel sin duplicar la fuente", () => {
    expect(SPACE_CATALOG_CONTRACT_VERSION).toBe("v1");
    expect(BARREL_VERSION).toBe(SPACE_CATALOG_CONTRACT_VERSION);
    expectTypeOf<BarrelSpace>().toEqualTypeOf<Space>();
  });

  test("el espacio ficticio trae campus, edificio, piso, sala, acceso e instrucciones", () => {
    const space: Space = {
      id: "espacio-ficticio-c204",
      campus: "Campus San Francisco (ficticio)",
      building: "Edificio C (ficticio)",
      floor: "Piso 2",
      room: "Sala C-204",
      accessConditions: "Acceso por rampa lateral (ficticio).",
      arrivalInstructions: "Siga a la derecha 20 metros (ficticio).",
      version: "v1",
    };
    expect(toSpaceLabel(space)).toBe(
      "Campus San Francisco (ficticio) · Edificio C (ficticio) · Piso 2 · Sala C-204",
    );
  });

  test("la página ficticia viaja como datos planos (ida y vuelta JSON)", () => {
    const page: SpaceCatalogPage = {
      items: [
        {
          id: "espacio-ficticio-c204",
          campus: "Campus San Francisco (ficticio)",
          building: "Edificio C (ficticio)",
          floor: "Piso 2",
          room: "Sala C-204",
          accessConditions: "Acceso por rampa lateral (ficticio).",
          arrivalInstructions: "Siga a la derecha 20 metros (ficticio).",
          version: "v1",
        },
      ],
      hasMore: false,
      nextCursor: null,
      version: "v1",
    };
    expect(JSON.parse(JSON.stringify(page))).toEqual(page);
    expect(page.items.every((item) => item.version === "v1")).toBe(true);
  });
});
