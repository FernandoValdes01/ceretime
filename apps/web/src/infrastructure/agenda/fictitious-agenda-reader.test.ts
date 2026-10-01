import { describe, expect, test } from "vitest";
import {
  createFictitiousAvailabilityReader,
  createFictitiousSpaceCatalogReader,
  FICTITIOUS_AGENDA_ERROR,
  FICTITIOUS_SPACE_CATALOG_ERROR,
} from "./fictitious-agenda-reader";

describe("Adaptadores ficticios de agenda en Web (TI2-87)", () => {
  test("la disponibilidad ficticia llega versionada sin decidir cruces", async () => {
    const reader = createFictitiousAvailabilityReader();
    const blocks = await reader.readAvailability();
    expect(blocks).toHaveLength(2);
    expect(blocks.every((block) => block.version === "v1")).toBe(true);
    expect(blocks[0]?.spaceId).toBe("space-ficticio-c204");
  });

  test("el catálogo ficticio llega con la forma del backend y sin filtrar", async () => {
    const reader = createFictitiousSpaceCatalogReader();
    const page = await reader.readSpaceCatalog();
    expect(page.version).toBe("v1");
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.room).toBe("Sala C-204");
    expect(page.hasMore).toBe(false);
  });

  test("los modos vacío y error conservan carga, vacío y error", async () => {
    const emptyAgenda = createFictitiousAvailabilityReader({ mode: "empty" });
    expect(await emptyAgenda.readAvailability()).toEqual([]);
    const emptyCatalog = createFictitiousSpaceCatalogReader({ mode: "empty" });
    expect((await emptyCatalog.readSpaceCatalog()).items).toEqual([]);

    const failingAgenda = createFictitiousAvailabilityReader({ mode: "error" });
    await expect(failingAgenda.readAvailability()).rejects.toThrow(FICTITIOUS_AGENDA_ERROR);
    const failingCatalog = createFictitiousSpaceCatalogReader({ mode: "error" });
    await expect(failingCatalog.readSpaceCatalog()).rejects.toThrow(FICTITIOUS_SPACE_CATALOG_ERROR);
  });

  test("los mensajes genéricos no revelan datos sensibles", () => {
    for (const message of [FICTITIOUS_AGENDA_ERROR, FICTITIOUS_SPACE_CATALOG_ERROR]) {
      expect(message).not.toContain("CERETI");
      expect(message).not.toContain("@");
    }
  });
});
