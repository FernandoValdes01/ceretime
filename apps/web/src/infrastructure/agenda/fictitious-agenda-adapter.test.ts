import { describe, expect, test } from "vitest";
import { SPACE_CATALOG_CONTRACT_VERSION } from "../../../../../convex/domain/index.ts";
import { createFictitiousAgendaAdapter } from "./fictitious-agenda-adapter.ts";

/**
 * Reglas ficticias del adaptador de agenda (TI2-101, TI2-102, TI2-103, TI2-04).
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
    const excepción = await adapter.saveException({ date: "2026-05-04", kind: "cancelled" });

    if (bloque.status !== "saved" || excepción.status !== "saved") {
      throw new Error("Se esperaba guardado ficticio del editor");
    }
    expect(bloque.block.version).toBe("v1");
    expect(bloque.block.professionalId).toBe("pro-ficticio-1");
    expect(excepción.exception.version).toBe("v1");
  });
});

describe("catálogo ficticio de espacios (TI2-04)", () => {
  test("lista los espacios ficticios con los campos del contrato vigente", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.listSpaces();

    if (resultado.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia del catálogo");
    }
    expect(resultado.spaces.length).toBeGreaterThan(0);
    for (const space of resultado.spaces) {
      expect(space.version).toBe(SPACE_CATALOG_CONTRACT_VERSION);
      expect(space.campus.length).toBeGreaterThan(0);
      expect(space.building.length).toBeGreaterThan(0);
      expect(space.floor.length).toBeGreaterThan(0);
      expect(space.room.length).toBeGreaterThan(0);
      expect(space.accessConditions.length).toBeGreaterThan(0);
      expect(space.arrivalInstructions.length).toBeGreaterThan(0);
    }
  });

  test("guardado sin id crea identidad ficticia conservando los campos", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.saveSpace({
      campus: "Campus Ficticio",
      building: "Edificio Ficticio",
      floor: "Piso Ficticio",
      room: "Sala Ficticia",
      accessConditions: "Condiciones ficticias de acceso.",
      arrivalInstructions: "Instrucciones ficticias de llegada.",
    });

    if (resultado.status !== "saved") {
      throw new Error("Se esperaba guardado ficticio del espacio");
    }
    expect(resultado.space.id).toMatch(/^esp-ficticio-\d+$/);
    expect(resultado.space.campus).toBe("Campus Ficticio");
    expect(resultado.space.version).toBe(SPACE_CATALOG_CONTRACT_VERSION);
  });

  test("guardado con id conocido actualiza el espacio y conserva su identidad", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const guardado = await adapter.saveSpace({
      id: "esp-1",
      campus: "Campus Norte",
      building: "Edificio A",
      floor: "Piso 1",
      room: "Sala 101",
      accessConditions: "Rampa lateral y ascensor amplio en el hall.",
      arrivalInstructions: "Entrar por el acceso norte y seguir la señalización táctil.",
    });

    if (guardado.status !== "saved") {
      throw new Error("Se esperaba guardado ficticio del espacio");
    }
    expect(guardado.space.id).toBe("esp-1");
    expect(guardado.space.accessConditions).toBe("Rampa lateral y ascensor amplio en el hall.");

    const catalogo = await adapter.listSpaces();
    if (catalogo.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia del catálogo");
    }
    const actualizado = catalogo.spaces.find((space) => space.id === "esp-1");
    if (actualizado === undefined) {
      throw new Error("Se esperaba el espacio actualizado en el catálogo");
    }
    expect(actualizado.accessConditions).toBe("Rampa lateral y ascensor amplio en el hall.");
  });

  test("guardado con id desconocido crea identidad nueva sin afirmar propiedad", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.saveSpace({
      id: "esp-ajeno",
      campus: "Campus Ficticio",
      building: "Edificio Ficticio",
      floor: "Piso Ficticio",
      room: "Sala Ficticia",
      accessConditions: "Condiciones ficticias de acceso.",
      arrivalInstructions: "Instrucciones ficticias de llegada.",
    });

    if (resultado.status !== "saved") {
      throw new Error("Se esperaba guardado ficticio del espacio");
    }
    expect(resultado.space.id).not.toBe("esp-ajeno");
    expect(resultado.space.id).toMatch(/^esp-ficticio-\d+$/);
  });
});

describe("agenda ficticia del profesional (TI2-115)", () => {
  test("lista atenciones con estados del contrato, ordenadas y del mismo profesional", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const resultado = await adapter.listAppointments();

    if (resultado.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia de la agenda");
    }
    expect(resultado.appointments.length).toBeGreaterThan(0);
    for (let index = 1; index < resultado.appointments.length; index += 1) {
      expect(resultado.appointments[index].startAt).toBeGreaterThanOrEqual(
        resultado.appointments[index - 1].startAt,
      );
      expect(resultado.appointments[index].endAt).toBeGreaterThan(
        resultado.appointments[index].startAt,
      );
    }
    const estados = new Set(resultado.appointments.map((item) => item.status));
    expect(estados.has("scheduled")).toBe(true);
    expect(estados.has("completed")).toBe(true);
  });

  test("lee una atención por identificador y deniega un id ajeno sin filtrar", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const propia = await adapter.getAppointment("aten-ficticio-1");
    const ajena = await adapter.getAppointment("aten-ficticio-999");

    expect(propia.status).toBe("ok");
    expect(ajena.status).toBe("denied");
    if (propia.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia de la atención propia");
    }
    expect(propia.appointment).toMatchObject({
      id: "aten-ficticio-1",
      status: "scheduled",
      modality: "inPerson",
    });
  });

  test("cambio a un destino válido aplica la política de dominio y se refleja en la lista", async () => {
    const adapter = createFictitiousAgendaAdapter();
    const pasadas = await adapter.listAppointments();
    if (pasadas.status !== "ok") {
      throw new Error("Se esperaba lectura ficticia de la agenda");
    }
    const programada = pasadas.appointments.find((item) => item.id === "aten-ficticio-2");
    if (programada === undefined) {
      throw new Error("Se esperaba la atención programada ficticia");
    }

    const cambio = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-2",
      to: "completed",
    });

    if (cambio.status !== "changed") {
      throw new Error(`Se esperaba el cambio aplicado y llegó: ${JSON.stringify(cambio)}`);
    }
    expect(cambio.appointment.status).toBe("completed");

    const posterior = await adapter.listAppointments();
    if (posterior.status !== "ok") {
      throw new Error("Se esperaba lectura posterior ficticia de la agenda");
    }
    expect(posterior.appointments.find((item) => item.id === "aten-ficticio-2")?.status).toBe(
      "completed",
    );
  });

  test("salto inválido devuelve la causa canónica sin cambiar la atención", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const cambio = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-1",
      to: "no_show_justified",
    });

    expect(cambio).toMatchObject({ status: "rejected", cause: "transition_not_allowed" });
    const posterior = await adapter.listAppointments();
    if (posterior.status !== "ok") {
      throw new Error("Se esperaba lectura posterior ficticia de la agenda");
    }
    expect(posterior.appointments.find((item) => item.id === "aten-ficticio-1")?.status).toBe(
      "scheduled",
    );
  });

  test("cancelación por CERETI exige motivo y ocurrencia posterior al inicio", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const sinMotivo = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-1",
      to: "cancelled_by_cereti",
    });
    const antesDeHora = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-1",
      to: "completed",
    });

    expect(sinMotivo).toMatchObject({ status: "rejected", cause: "reason_required" });
    expect(antesDeHora).toMatchObject({ status: "rejected", cause: "occurred_before_start" });
  });

  test("reagendar sin nuevas fechas devuelve la causa canónica del dominio", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const cambio = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-1",
      to: "rescheduled",
    });

    expect(cambio).toMatchObject({ status: "rejected", cause: "reschedule_required" });
  });

  test("resuelve la justificación de una inasistencia pendiente", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const cambio = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-5",
      to: "no_show_justified",
    });

    if (cambio.status !== "changed") {
      throw new Error(`Se esperaba la justificación resuelta y llegó: ${JSON.stringify(cambio)}`);
    }
    expect(cambio.appointment.status).toBe("no_show_justified");
  });

  test("un id ajeno al cambiar estado responde denegación genérica", async () => {
    const adapter = createFictitiousAgendaAdapter();

    const cambio = await adapter.changeAppointmentStatus({
      appointmentId: "aten-ficticio-999",
      to: "completed",
    });

    expect(cambio).toMatchObject({ status: "denied" });
  });
});
