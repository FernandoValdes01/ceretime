import { describe, expect, test } from "vitest";
import { createFictitiousAgendaAdapter } from "./fictitious-agenda-adapter.ts";

/**
 * Reglas ficticias del adaptador de agenda (TI2-101).
 *
 * Fija el comportamiento documentado de los fixtures; la API real (TI2-123)
 * reemplaza este adaptador sin tocar presentación. Todos los datos son
 * ficticios.
 */
describe("adaptador ficticio de agenda (TI2-101)", () => {
  test("todas e inPerson devuelven cupos tipados", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const todas = await adapter.searchSlots({ modality: "all" });
    const presencial = await adapter.searchSlots({ modality: "inPerson" });

    if (todas.status !== "ok" || presencial.status !== "ok") {
      throw new Error("Se esperaban cupos en ambas modalidades base");
    }
    expect(todas.slots.length).toBeGreaterThan(0);
    expect(presencial.slots.length).toBeGreaterThan(0);
    for (const slot of presencial.slots) {
      expect(slot.modality).toBe("inPerson");
      expect(typeof slot.spaceLabel).toBe("string");
    }
  });

  test("en línea responde falta de cupo con código canónico", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.searchSlots({ modality: "online" });

    expect(resultado).toMatchObject({ status: "no_availability", code: "no_availability" });
  });

  test("cada modalidad coincide con lo ofrecido en todas", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const todas = await adapter.searchSlots({ modality: "all" });
    if (todas.status !== "ok") {
      throw new Error("Se esperaban cupos en la vista general");
    }

    for (const modality of ["inPerson", "online"] as const) {
      const esperados = todas.slots
        .filter((item) => item.modality === modality)
        .map((item) => item.id);
      const filtrado = await adapter.searchSlots({ modality });
      const ofrecidos = filtrado.status === "ok" ? filtrado.slots.map((item) => item.id) : [];

      expect(filtrado.status).toBe(esperados.length === 0 ? "no_availability" : "ok");
      expect(ofrecidos).toEqual(esperados);
    }
  });
});
