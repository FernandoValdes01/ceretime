import { describe, expect, test } from "vitest";
import { createFictitiousAgendaAdapter } from "./fictitious-agenda-adapter.ts";

/**
 * Reglas ficticias del adaptador de agenda (TI2-101, TI2-102, TI2-103).
 *
 * Fija el comportamiento documentado de los fixtures; la API real
 * (TI2-123/TI2-125) reemplaza este adaptador sin tocar presentación. Todos
 * los datos son ficticios.
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
});

describe("reserva ficticia (TI2-102)", () => {
  test("confirma el cupo publicado con proyección tipada", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.reserveSlot({ slotId: "cupo-1" });

    if (resultado.status !== "confirmed") {
      throw new Error("Se esperaba confirmación del cupo ficticio");
    }
    expect(resultado.reservation.slotId).toBe("cupo-1");
  });

  test("id ajeno responde falta de cupo", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.reserveSlot({ slotId: "cupo-ajeno" });

    expect(resultado).toMatchObject({
      status: "error",
      error: { code: "no_availability" },
    });
  });
});

describe("editor ficticio de disponibilidad (TI2-103)", () => {
  test("lista bloques y excepciones con contrato vigente", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.listAvailability();

    if (resultado.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia del editor");
    }
    expect(resultado.blocks.length).toBeGreaterThan(0);
    for (const block of resultado.blocks) {
      expect(block.version).toBe("v1");
      expect(block.professionalId).toBe("pro-ficticio-1");
    }
    for (const exception of resultado.exceptions) {
      expect(exception.version).toBe("v1");
    }
  });

  test("guarda bloque y excepción sin pedir propiedad al cliente", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const bloque = await adapter.saveBlock({
      weekday: 2,
      startMinute: 600,
      endMinute: 660,
      slotMinutes: 30,
      modality: "online",
    });
    const excepcion = await adapter.saveException({ date: "2026-05-04", kind: "cancelled" });

    if (bloque.status !== "saved" || excepcion.status !== "saved") {
      throw new Error("Se esperaba guardado ficticio del editor");
    }
    expect(bloque.block.version).toBe("v1");
    expect(bloque.block.professionalId).toBe("pro-ficticio-1");
    expect(excepcion.exception.version).toBe("v1");
  });
});
