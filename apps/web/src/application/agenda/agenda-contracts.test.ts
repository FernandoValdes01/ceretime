import { describe, expect, test } from "vitest";
import { AGENDA_CONTRACT_VERSION, SPACE_CATALOG_MAX_ITEMS } from "./agenda-contracts";

describe("Contratos canónicos de agenda en Web (TI2-87)", () => {
  test("la versión y el tope espejan el contrato sin duplicar la API", () => {
    expect(AGENDA_CONTRACT_VERSION).toBe("v1");
    expect(SPACE_CATALOG_MAX_ITEMS).toBe(50);
  });
});
