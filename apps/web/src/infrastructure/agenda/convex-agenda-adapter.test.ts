import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import {
  toOfficialChannelCoordination,
  type NoCompatibleSlotReason,
} from "../../../../../convex/domain/index.ts";
import { createConvexAgendaAdapter, type ConvexAgendaClient } from "./convex-agenda-adapter.ts";

/**
 * Pruebas del adaptador Convex de agenda (TI2-125, escritura de espacios TI2-169).
 *
 * El cliente se sustituye por un doble que despacha por el nombre público de
 * la función y registra los argumentos reales. Así se verifica la ventana de
 * 92 días, el tope de 50 por página, el mapeo de errores públicos y que la
 * escritura del catálogo va contra `api.presentation.spaces`. No hay llamadas
 * a un deployment: los datos son ficticios.
 */

const LIST_AVAILABILITY = "presentation/availability:listOwnAvailability";
const PUBLISH_BLOCK = "presentation/availability:publishBlock";
const PUBLISH_EXCEPTION = "presentation/availability:publishException";
const LIST_APPOINTMENTS = "presentation/appointments:listAppointments";
const GET_APPOINTMENT = "presentation/appointments:getAppointment";
const CANCEL_APPOINTMENT = "presentation/appointments:cancelAppointment";
const RECORD_ATTENDANCE = "presentation/appointments:recordAppointmentAttendance";
const SEARCH_SLOTS = "presentation/availability:searchSlots";
const LIST_BOOKABLE = "presentation/availability:listBookableProfessionals";
const BOOK_APPOINTMENT = "presentation/appointments:bookAppointment";
const LIST_SPACES = "presentation/spaces:listSpaces";
const RESCHEDULE_APPOINTMENT = "presentation/appointments:rescheduleAppointment";
const SUBMIT_JUSTIFICATION = "presentation/appointments:submitAppointmentJustification";
const GET_ONLINE_ACCESS = "presentation/appointments:getOnlineAccess";

/** 2026-10-31 09:00 en America/Santiago (UTC-3 en esa fecha). */
const NOW = Date.UTC(2026, 9, 31, 12, 0);

type Call = {
  readonly name: string;
  readonly kind: "query" | "mutation";
  readonly args: Record<string, unknown>;
};

type Handler = (args: Record<string, unknown>) => unknown;

/** Deja correr las promesas encadenadas del adaptador. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type FakeOptions = {
  readonly query?: Readonly<Record<string, Handler>>;
  readonly mutation?: Readonly<Record<string, Handler>>;
  readonly watches?: () => Readonly<Record<string, unknown>>;
  /** Resultado local por función y argumentos: distingue páginas por cursor. */
  readonly watchResult?: (name: string, args: Record<string, unknown>) => unknown;
};

function createFakeClient(options: FakeOptions = {}) {
  const calls: Call[] = [];
  const updates: Array<() => void> = [];

  const run = (
    kind: "query" | "mutation",
    ref: FunctionReference<"query"> | FunctionReference<"mutation">,
    args: Record<string, unknown>,
    handlers: Readonly<Record<string, Handler>> | undefined,
  ): Promise<unknown> => {
    const name = getFunctionName(ref);
    calls.push({ name, kind, args });
    const handler = handlers?.[name];
    if (handler === undefined) {
      return Promise.reject(new Error(`Función no configurada en el doble: ${name}`));
    }
    return Promise.resolve().then(() => handler(args));
  };

  const client = {
    query: (ref: FunctionReference<"query">, args: Record<string, unknown> = {}) =>
      run("query", ref, args, options.query),
    mutation: (ref: FunctionReference<"mutation">, args: Record<string, unknown> = {}) =>
      run("mutation", ref, args, options.mutation),
    ...(options.watches === undefined && options.watchResult === undefined
      ? {}
      : {
          // `ConvexReactClient.watchQuery` depende de `this`: el doble usa un
          // método, no una función flecha, para detectar si se pierde el
          // receptor al extraerlo.
          sync: true,
          watchQuery(
            this: { sync?: boolean },
            ref: FunctionReference<"query">,
            args: Record<string, unknown>,
          ) {
            if (this?.sync !== true) {
              throw new Error("watchQuery perdió el contexto del cliente");
            }
            const name = getFunctionName(ref);
            calls.push({ name, kind: "query", args });
            return {
              localQueryResult: () =>
                options.watchResult !== undefined
                  ? options.watchResult(name, args)
                  : options.watches?.()[name],
              onUpdate: (callback: () => void) => {
                updates.push(callback);
                return () => {
                  updates.splice(updates.indexOf(callback), 1);
                };
              },
            };
          },
        }),
  } as unknown as ConvexAgendaClient;

  return {
    client,
    calls,
    notify: () => updates.forEach((callback) => callback()),
    adapter: (now: () => number = () => NOW) => createConvexAgendaAdapter(client, now),
  };
}

const BLOCK = {
  id: "bloque-9",
  professionalId: "pro-1",
  weekday: 1,
  startMinute: 540,
  endMinute: 660,
  slotMinutes: 30,
  modality: "inPerson",
  spaceId: "esp-1",
  version: "v1",
} as const;

const EXCEPTION = {
  id: "excepcion-9",
  professionalId: "pro-1",
  date: "2026-12-24",
  kind: "cancelled",
  version: "v1",
} as const;

function fullProjection(overrides: Record<string, unknown> = {}) {
  return {
    id: "aten-1",
    accompanimentId: "acompanamiento-1",
    professionalId: "pro-1",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: Date.UTC(2026, 4, 12, 14, 0),
    endAt: Date.UTC(2026, 4, 12, 15, 0),
    status: "scheduled",
    version: "v1",
    view: "full",
    ...overrides,
  };
}

describe("disponibilidad contra la API (TI2-125)", () => {
  test("lee el rango de 92 días en la zona de la agenda y devuelve las entidades reales", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_AVAILABILITY]: () => ({
          blocks: [BLOCK],
          exceptions: [EXCEPTION],
          version: "v1",
        }),
      },
    });

    const result = await fake.adapter().listAvailability();

    expect(result).toEqual({
      status: "ok",
      blocks: [BLOCK],
      exceptions: [EXCEPTION],
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].args).toEqual({
      from: "2026-10-31",
      to: "2027-01-30",
      version: "v1",
    });
  });

  test("sin bloques ni excepciones responde vacío, no error", async () => {
    const fake = createFakeClient({
      query: { [LIST_AVAILABILITY]: () => ({ blocks: [], exceptions: [], version: "v1" }) },
    });

    await expect(fake.adapter().listAvailability()).resolves.toEqual({ status: "empty" });
  });

  test("una denegación del Backend se traduce a denied sin detalles", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_AVAILABILITY]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });

    await expect(fake.adapter().listAvailability()).resolves.toEqual({ status: "denied" });
  });

  test("un fallo no público no filtra el texto interno", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_AVAILABILITY]: () => {
          throw new Error("detalle interno del servidor");
        },
      },
    });

    const result = await fake.adapter().listAvailability();

    expect(result).toEqual({
      status: "error",
      message: "No pudimos cargar la disponibilidad. Inténtalo de nuevo.",
    });
  });

  test("guardar un bloque publica y relee la entidad real por identificador", async () => {
    const fake = createFakeClient({
      mutation: { [PUBLISH_BLOCK]: () => ({ blockId: "bloque-9" }) },
      query: { [LIST_AVAILABILITY]: () => ({ blocks: [BLOCK], exceptions: [], version: "v1" }) },
    });

    const result = await fake.adapter().saveBlock({
      weekday: 1,
      startMinute: 540,
      endMinute: 660,
      slotMinutes: 30,
      modality: "inPerson",
      spaceId: "esp-1",
    });

    expect(result).toEqual({ status: "saved", block: BLOCK });
    expect(fake.calls.map((call) => call.name)).toEqual([PUBLISH_BLOCK, LIST_AVAILABILITY]);
    expect(fake.calls[0].args).toEqual({
      weekday: 1,
      startMinute: 540,
      endMinute: 660,
      slotMinutes: 30,
      modality: "inPerson",
      spaceId: "esp-1",
      version: "v1",
    });
  });

  test("guardar una excepción la relee en su propia fecha", async () => {
    const fake = createFakeClient({
      mutation: { [PUBLISH_EXCEPTION]: () => ({ exceptionId: "excepcion-9" }) },
      query: {
        [LIST_AVAILABILITY]: () => ({ blocks: [], exceptions: [EXCEPTION], version: "v1" }),
      },
    });

    const result = await fake.adapter().saveException({
      date: "2026-12-24",
      kind: "cancelled",
    });

    expect(result).toEqual({ status: "saved", exception: EXCEPTION });
    expect(fake.calls[0].args).toEqual({ date: "2026-12-24", kind: "cancelled", version: "v1" });
    expect(fake.calls[1].args).toEqual({
      from: "2026-12-24",
      to: "2026-12-24",
      version: "v1",
    });
  });

  test("un guardado denegado no se convierte en éxito", async () => {
    const fake = createFakeClient({
      mutation: {
        [PUBLISH_BLOCK]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });

    await expect(
      fake.adapter().saveBlock({
        weekday: 2,
        startMinute: 600,
        endMinute: 660,
        slotMinutes: 30,
        modality: "online",
      }),
    ).resolves.toEqual({ status: "denied" });
  });
});

describe("agenda y detalle contra la API (TI2-125)", () => {
  const firstPage = {
    items: [fullProjection({ id: "aten-2", startAt: Date.UTC(2026, 10, 2, 14, 0) })],
    hasMore: true,
    nextCursor: "aten-2",
    version: "v1",
  };
  const secondPage = {
    items: [fullProjection({ id: "aten-1", startAt: Date.UTC(2026, 10, 1, 14, 0) })],
    hasMore: false,
    nextCursor: null,
    version: "v1",
  };

  test("pagina la agenda con el tope de 50 y ordena el resultado por inicio", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_APPOINTMENTS]: (args) => (args.cursor === undefined ? firstPage : secondPage),
      },
    });

    const result = await fake.adapter().listAppointments();

    if (result.status !== "ok") {
      throw new Error("Se esperaba la agenda paginada");
    }
    expect(result.appointments.map((appointment) => appointment.id)).toEqual(["aten-1", "aten-2"]);
    expect(fake.calls[0].args).toEqual({
      from: "2026-09-16",
      to: "2026-12-16",
      limit: 50,
      version: "v1",
    });
    expect(fake.calls[1].args).toMatchObject({ cursor: "aten-2", limit: 50 });
  });

  test("una página vacía responde vacío", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_APPOINTMENTS]: () => ({ items: [], hasMore: false, nextCursor: null, version: "v1" }),
      },
    });

    await expect(fake.adapter().listAppointments()).resolves.toEqual({ status: "empty" });
  });

  test("el detalle minimizado no inventa vínculos ni motivos", async () => {
    const minimized = {
      id: "aten-3",
      status: "scheduled",
      startAt: Date.UTC(2026, 10, 3, 14, 0),
      endAt: Date.UTC(2026, 10, 3, 15, 0),
      modality: "online",
      view: "minimized",
    };
    const fake = createFakeClient({
      query: { [GET_APPOINTMENT]: () => minimized },
    });

    const result = await fake.adapter().getAppointment("aten-3");

    expect(result).toEqual({
      status: "ok",
      appointment: {
        id: "aten-3",
        status: "scheduled",
        startAt: minimized.startAt,
        endAt: minimized.endAt,
        modality: "online",
      },
    });
    expect(fake.calls[0].args).toEqual({ appointmentId: "aten-3", version: "v1" });
  });

  test("un id ajeno responde denegación genérica", async () => {
    const fake = createFakeClient({
      query: {
        [GET_APPOINTMENT]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });

    await expect(fake.adapter().getAppointment("aten-ajena")).resolves.toEqual({
      status: "denied",
    });
  });

  test("registrar la atención usa la mutación de asistencia y relee la atención", async () => {
    const fake = createFakeClient({
      mutation: { [RECORD_ATTENDANCE]: () => ({ appointmentId: "aten-1" }) },
      query: { [GET_APPOINTMENT]: () => fullProjection({ status: "completed" }) },
    });

    const result = await fake.adapter().changeAppointmentStatus({
      appointmentId: "aten-1",
      to: "completed",
    });

    expect(result.status).toBe("changed");
    expect(fake.calls[0].args).toEqual({
      appointmentId: "aten-1",
      outcome: "completed",
      version: "v1",
    });
    expect(fake.calls[1].name).toBe(GET_APPOINTMENT);
  });

  test("cancelar por CERETI envía el motivo obligatorio", async () => {
    const fake = createFakeClient({
      mutation: { [CANCEL_APPOINTMENT]: () => ({ appointmentId: "aten-1" }) },
      query: {
        [GET_APPOINTMENT]: () =>
          fullProjection({ status: "cancelled_by_cereti", cancelReason: "Bloqueo de la sala." }),
      },
    });

    const result = await fake.adapter().changeAppointmentStatus({
      appointmentId: "aten-1",
      to: "cancelled_by_cereti",
      reason: "Bloqueo de la sala.",
    });

    expect(result.status).toBe("changed");
    expect(fake.calls[0].args).toEqual({
      appointmentId: "aten-1",
      reason: "Bloqueo de la sala.",
      version: "v1",
    });
  });

  test("un cambio sin API publicada responde error tipado y no muta nada", async () => {
    const fake = createFakeClient();

    const result = await fake.adapter().changeAppointmentStatus({
      appointmentId: "aten-1",
      to: "no_show_justified",
    });

    expect(result.status).toBe("error");
    expect(fake.calls).toHaveLength(0);
  });

  test("una denegación de la mutación responde denied", async () => {
    const fake = createFakeClient({
      mutation: {
        [RECORD_ATTENDANCE]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });

    await expect(
      fake.adapter().changeAppointmentStatus({ appointmentId: "aten-1", to: "no_show" }),
    ).resolves.toEqual({ status: "denied" });
  });

  test("la suscripción de agenda emite la primera página y luego los cambios", async () => {
    let localFirst: unknown = firstPage;
    let localSecond: unknown = secondPage;
    const fake = createFakeClient({
      query: { [LIST_APPOINTMENTS]: () => secondPage },
      watchResult: (_name, args) => (args.cursor === undefined ? localFirst : localSecond),
    });
    const results: string[] = [];
    const unsubscribe = fake.adapter().watchAppointments?.((result) => {
      results.push(result.status);
    });

    await flush();
    expect(results).toEqual(["ok"]);

    localFirst = { items: [], hasMore: false, nextCursor: null, version: "v1" };
    localSecond = { items: [], hasMore: false, nextCursor: null, version: "v1" };
    fake.notify();
    await flush();
    expect(results.at(-1)).toBe("empty");

    unsubscribe?.();
  });

  test("la suscripción cubre las páginas cargadas y reacciona a un cambio de la segunda", async () => {
    let second = secondPage;
    const fake = createFakeClient({
      query: {
        [LIST_APPOINTMENTS]: (args) => (args.cursor === undefined ? firstPage : secondPage),
      },
      watchResult: (_name, args) => (args.cursor === undefined ? firstPage : second),
    });
    const emissions: Array<ReadonlyArray<string>> = [];
    const unsubscribe = fake.adapter().watchAppointments?.((result) => {
      if (result.status === "ok") {
        emissions.push(result.appointments.map((item) => `${item.id}:${item.status}`));
      }
    });

    await flush();
    expect(emissions.at(-1)).toEqual(["aten-1:scheduled", "aten-2:scheduled"]);
    // La segunda página se suscribe con su propio cursor.
    expect(fake.calls.some((call) => call.args.cursor === "aten-2")).toBe(true);

    second = {
      ...secondPage,
      items: [
        fullProjection({
          id: "aten-1",
          status: "completed",
          startAt: Date.UTC(2026, 10, 1, 14, 0),
        }),
      ],
    };
    fake.notify();
    await flush();

    expect(emissions.at(-1)).toEqual(["aten-1:completed", "aten-2:scheduled"]);

    unsubscribe?.();
  });

  test("la suscripción del detalle emite la atención vigente", async () => {
    const fake = createFakeClient({
      watches: () => ({ [GET_APPOINTMENT]: fullProjection() }),
    });
    const results: Array<string> = [];
    const unsubscribe = fake.adapter().watchAppointment?.("aten-1", (result) => {
      results.push(result.status);
    });

    await Promise.resolve();
    expect(results).toEqual(["ok"]);

    unsubscribe?.();
  });
});

describe("catálogo de espacios contra la API (TI2-125)", () => {
  const SPACE = {
    id: "esp-backend-1",
    campus: "Campus San Juan Pablo II",
    building: "Edificio A",
    floor: "Piso 1",
    room: "Sala 101",
    accessConditions: "Acceso con rampa.",
    arrivalInstructions: "Entrar por la puerta principal.",
    version: "v1",
  } as const;

  test("lee el catálogo paginado del Backend con el tope de 100 por página", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_SPACES]: (args) =>
          args.cursor === undefined
            ? { items: [SPACE], hasMore: true, nextCursor: "esp-backend-1", version: "v1" }
            : {
                items: [{ ...SPACE, id: "esp-backend-2", room: "Sala 102" }],
                hasMore: false,
                nextCursor: null,
                version: "v1",
              },
      },
    });

    const result = await fake.adapter().listSpaces();

    expect(result).toEqual({
      status: "ok",
      spaces: [SPACE, { ...SPACE, id: "esp-backend-2", room: "Sala 102" }],
    });
    expect(fake.calls[0].args).toEqual({ limit: 100, version: "v1" });
    expect(fake.calls[1].args).toMatchObject({ cursor: "esp-backend-1", limit: 100 });
  });

  test("sin salas vigentes responde vacío, no error", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_SPACES]: () => ({ items: [], hasMore: false, nextCursor: null, version: "v1" }),
      },
    });

    await expect(fake.adapter().listSpaces()).resolves.toEqual({ status: "empty" });
  });

  test("una denegación del catálogo se traduce a denied sin detalles", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_SPACES]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });

    await expect(fake.adapter().listSpaces()).resolves.toEqual({ status: "denied" });
  });
});

describe("búsqueda y reserva del Estudiante contra la API (TI2-123)", () => {
  const CONTEXT = { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1"] };
  const SEARCH_ARGS = { accompanimentId: "acompanamiento-1", professionalId: "pro-1" };
  const IN_PERSON = {
    id: "cupo-1",
    professionalId: "pro-1",
    date: "2026-11-02",
    startAt: Date.UTC(2026, 10, 2, 13, 0),
    endAt: Date.UTC(2026, 10, 2, 14, 0),
    modality: "inPerson",
    spaceId: "esp-1",
  } as const;
  const SLOT_IN_PERSON = { ...IN_PERSON, version: "v1" } as const;
  const ONLINE = {
    id: "cupo-2",
    professionalId: "pro-1",
    date: "2026-11-03",
    startAt: Date.UTC(2026, 10, 3, 13, 0),
    endAt: Date.UTC(2026, 10, 3, 14, 0),
    modality: "online",
  } as const;
  const SLOT_ONLINE = { ...ONLINE, version: "v1" } as const;
  const SPACE = {
    id: "esp-1",
    campus: "San Juan Pablo II",
    building: "A",
    floor: "1",
    room: "101",
    accessConditions: "",
    arrivalInstructions: "",
    version: "v1",
  } as const;
  const page = (items: ReadonlyArray<unknown>, nextCursor: string | null = null) => ({
    items,
    hasMore: nextCursor !== null,
    nextCursor,
    version: "v1",
  });
  /** Búsqueda con cupos: la forma `available` de TI2-144. */
  const slotsPage = (items: ReadonlyArray<unknown>, nextCursor: string | null = null) => ({
    status: "available",
    ...page(items, nextCursor),
  });
  /** Búsqueda sin horario compatible, como la entrega el Backend (TI2-144). */
  const noCompatibleSlot = (reason: NoCompatibleSlotReason) => () => ({
    status: "no_compatible_slot",
    coordination: toOfficialChannelCoordination("acompanamiento-1", reason),
    version: "v1",
  });
  const publicError = (code: string, message: string) => () => {
    throw new ConvexError({ code, message });
  };
  const BOOKING = {
    accompanimentId: "acompanamiento-1",
    slot: { ...SLOT_IN_PERSON },
  };

  test("recorre las páginas con la ventana de 92 días y resuelve la sala", async () => {
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: (args) =>
          args.cursor === undefined ? slotsPage([SLOT_IN_PERSON], "c2") : slotsPage([SLOT_ONLINE]),
        [LIST_SPACES]: () => page([SPACE]),
      },
    });

    const result = await fake.adapter().searchSlots({ modality: "all", context: CONTEXT });

    const searches = fake.calls.filter((call) => call.name === SEARCH_SLOTS);
    expect(searches.map((call) => call.args)).toEqual([
      {
        ...SEARCH_ARGS,
        from: "2026-10-31",
        to: "2027-01-30",
        limit: 50,
        version: "v1",
      },
      {
        ...SEARCH_ARGS,
        from: "2026-10-31",
        to: "2027-01-30",
        limit: 50,
        cursor: "c2",
        version: "v1",
      },
    ]);
    expect(result).toEqual({
      status: "ok",
      slots: [{ ...IN_PERSON, spaceLabel: expect.stringContaining("101") }, ONLINE],
    });
  });

  test("junta los cupos de todos los profesionales por hora de inicio", async () => {
    const OTHER = { ...ONLINE, id: "cupo-3", professionalId: "pro-2", startAt: 1, endAt: 2 };
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: (args) =>
          args.professionalId === "pro-1"
            ? slotsPage([SLOT_ONLINE])
            : slotsPage([{ ...OTHER, version: "v1" }]),
      },
    });

    await expect(
      fake.adapter().searchSlots({
        modality: "all",
        context: { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1", "pro-2"] },
      }),
    ).resolves.toEqual({ status: "ok", slots: [OTHER, ONLINE] });
  });

  test("dos profesionales a la misma hora se muestran como una sola opción", async () => {
    const OTRO_PROFESIONAL = { ...SLOT_ONLINE, id: "cupo-3", professionalId: "pro-2" };
    const OTRO_FIN = {
      ...SLOT_ONLINE,
      id: "cupo-4",
      professionalId: "pro-2",
      endAt: SLOT_ONLINE.endAt + 1_800_000,
    };
    const OTRA_SALA = {
      ...SLOT_IN_PERSON,
      id: "cupo-5",
      professionalId: "pro-2",
      spaceId: "esp-2",
    };
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: (args) =>
          args.professionalId === "pro-1"
            ? slotsPage([SLOT_IN_PERSON, SLOT_ONLINE])
            : slotsPage([OTRA_SALA, OTRO_PROFESIONAL, OTRO_FIN]),
        [LIST_SPACES]: () => page([SPACE]),
      },
    });

    const result = await fake.adapter().searchSlots({
      modality: "all",
      context: { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1", "pro-2"] },
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(result.status === "ok" ? result.slots.map((slot) => slot.id) : []).toEqual([
      "cupo-1",
      "cupo-5",
      "cupo-2",
      "cupo-4",
    ]);
  });

  test("superar el tope de páginas responde error y nunca una lista parcial", async () => {
    const fake = createFakeClient({
      query: { [SEARCH_SLOTS]: () => slotsPage([SLOT_ONLINE], "siguiente") },
    });

    await expect(
      fake.adapter().searchSlots({ modality: "all", context: CONTEXT }),
    ).resolves.toEqual({
      status: "error",
      message: "Hay más horarios de los que esta vista puede cargar. Inténtalo de nuevo más tarde.",
    });
    expect(fake.calls).toHaveLength(40);
  });

  test("un profesional sin cupo no oculta los cupos de los demás", async () => {
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: (args) =>
          args.professionalId === "pro-1"
            ? noCompatibleSlot("slots_occupied")()
            : slotsPage([SLOT_ONLINE]),
      },
    });

    await expect(
      fake.adapter().searchSlots({
        modality: "all",
        context: { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1", "pro-2"] },
      }),
    ).resolves.toEqual({ status: "ok", slots: [ONLINE] });
  });

  test("sin cupo con ningún profesional entrega la coordinación del motivo de mayor prioridad", async () => {
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: (args) =>
          noCompatibleSlot(args.professionalId === "pro-1" ? "needs_not_met" : "slots_occupied")(),
      },
    });

    await expect(
      fake.adapter().searchSlots({
        modality: "all",
        context: { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1", "pro-2"] },
      }),
    ).resolves.toEqual({
      status: "no_availability",
      code: "no_availability",
      coordination: toOfficialChannelCoordination("acompanamiento-1", "slots_occupied"),
    });
  });

  test("filtrar una modalidad sin filas responde vacío, no falta de cupo", async () => {
    const fake = createFakeClient({ query: { [SEARCH_SLOTS]: () => slotsPage([SLOT_ONLINE]) } });

    await expect(
      fake.adapter().searchSlots({ modality: "inPerson", context: CONTEXT }),
    ).resolves.toEqual({ status: "empty" });
  });

  test("si falla el catálogo, el cupo sigue disponible sin etiqueta", async () => {
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: () => slotsPage([SLOT_IN_PERSON]),
        [LIST_SPACES]: publicError("unauthorized", "No autorizado"),
      },
    });

    const result = await fake.adapter().searchSlots({ modality: "all", context: CONTEXT });

    expect(result).toEqual({ status: "ok", slots: [IN_PERSON] });
  });

  test.each([
    [
      "falta de cupo",
      noCompatibleSlot("no_published_slots"),
      {
        status: "no_availability",
        code: "no_availability",
        coordination: toOfficialChannelCoordination("acompanamiento-1", "no_published_slots"),
      },
    ],
    ["denegación", publicError("unauthorized", "No autorizado"), { status: "denied" }],
    [
      "error público",
      publicError("conflict", "Pide un rango menor."),
      { status: "error", message: "Pide un rango menor." },
    ],
    [
      "fallo técnico sin filtrar el detalle",
      () => {
        throw new Error("detalle interno");
      },
      { status: "error", message: "No pudimos cargar los horarios. Inténtalo de nuevo." },
    ],
  ])("la búsqueda traduce %s", async (_name, handler, expected) => {
    const fake = createFakeClient({ query: { [SEARCH_SLOTS]: handler } });

    await expect(
      fake.adapter().searchSlots({ modality: "all", context: CONTEXT }),
    ).resolves.toEqual(expected);
  });

  test("sin contexto no busca ni inventa fixtures", async () => {
    const fake = createFakeClient();

    const result = await fake.adapter().searchSlots({ modality: "all" });

    expect(result.status).toBe("error");
    expect(fake.calls).toHaveLength(0);
  });

  test("la reserva envía el cupo elegido y confirma con el id del Backend", async () => {
    const fake = createFakeClient({
      mutation: { [BOOK_APPOINTMENT]: () => ({ appointmentId: "aten-9" }) },
    });

    const result = await fake.adapter().reserveSlot({ slotId: "cupo-1", booking: BOOKING });

    expect(fake.calls).toEqual([
      {
        name: BOOK_APPOINTMENT,
        kind: "mutation",
        args: {
          accompanimentId: "acompanamiento-1",
          professionalId: "pro-1",
          modality: "inPerson",
          spaceId: "esp-1",
          startAt: SLOT_IN_PERSON.startAt,
          endAt: SLOT_IN_PERSON.endAt,
          version: "v1",
        },
      },
    ]);
    expect(result).toEqual({
      status: "confirmed",
      reservation: {
        id: "aten-9",
        slotId: "cupo-1",
        professionalId: "pro-1",
        modality: "inPerson",
        startAt: SLOT_IN_PERSON.startAt,
        endAt: SLOT_IN_PERSON.endAt,
      },
    });
  });

  test.each([
    ["conflicto", publicError("conflict", "Conflicto"), { status: "conflict", code: "conflict" }],
    [
      "falta de cupo",
      publicError("no_availability", "Sin cupo"),
      { status: "no_availability", code: "no_availability" },
    ],
    ["denegación", publicError("unauthorized", "No autorizado"), { status: "denied" }],
  ])("la reserva traduce %s", async (_name, handler, expected) => {
    const fake = createFakeClient({ mutation: { [BOOK_APPOINTMENT]: handler } });

    await expect(
      fake.adapter().reserveSlot({ slotId: "cupo-1", booking: BOOKING }),
    ).resolves.toEqual(expected);
  });

  test("un fallo técnico de la reserva no se presenta como conflicto", async () => {
    const fake = createFakeClient({
      mutation: {
        [BOOK_APPOINTMENT]: () => {
          throw new Error("detalle interno");
        },
      },
    });

    const result = await fake.adapter().reserveSlot({ slotId: "cupo-1", booking: BOOKING });

    expect(result).toMatchObject({
      status: "error",
      error: { message: "No pudimos confirmar la reserva. Inténtalo de nuevo." },
    });
  });

  test("sin datos del cupo la reserva no llama a la API ni confirma", async () => {
    const fake = createFakeClient();

    const result = await fake.adapter().reserveSlot({ slotId: "cupo-1" });

    expect(result.status).toBe("error");
    expect(fake.calls).toHaveLength(0);
  });

  test("cancelar usa la mutación real sin enviar motivo", async () => {
    const fake = createFakeClient({
      mutation: { [CANCEL_APPOINTMENT]: () => ({ appointmentId: "aten-9" }) },
    });

    await expect(fake.adapter().cancelReservation({ reservationId: "aten-9" })).resolves.toEqual({
      status: "cancelled",
    });
    expect(fake.calls[0]?.args).toEqual({ appointmentId: "aten-9", version: "v1" });
  });

  test("una cancelación ajena responde denegación", async () => {
    const fake = createFakeClient({
      mutation: { [CANCEL_APPOINTMENT]: publicError("unauthorized", "No autorizado") },
    });

    await expect(fake.adapter().cancelReservation({ reservationId: "ajena" })).resolves.toEqual({
      status: "denied",
    });
  });

  test("cancelar con motivo lo envía tal cual a la mutación (TI2-163)", async () => {
    const fake = createFakeClient({
      mutation: { [CANCEL_APPOINTMENT]: () => ({ appointmentId: "aten-9" }) },
    });

    await fake.adapter().cancelReservation({ reservationId: "aten-9", reason: "Viaje" });

    expect(fake.calls[0]?.args).toEqual({
      appointmentId: "aten-9",
      reason: "Viaje",
      version: "v1",
    });
  });

  test("el cupo presencial trae la ubicación y el acceso de su sala (TI2-163)", async () => {
    const LOCATION = {
      campus: "San Juan Pablo II",
      building: "A",
      floor: "1",
      room: "101",
      accessConditions: "Rampa en la entrada.",
      arrivalInstructions: "Primera puerta a la derecha.",
    };
    const fake = createFakeClient({
      query: {
        [SEARCH_SLOTS]: () => slotsPage([{ ...SLOT_IN_PERSON, space: LOCATION }]),
        [LIST_SPACES]: () => page([SPACE]),
      },
    });

    const result = await fake.adapter().searchSlots({ modality: "all", context: CONTEXT });

    expect(result).toEqual({
      status: "ok",
      slots: [{ ...IN_PERSON, spaceLabel: expect.stringContaining("101"), space: LOCATION }],
    });
  });

  test("reagendar envía el cupo elegido con la forma de la reserva (TI2-163)", async () => {
    const fake = createFakeClient({
      mutation: { [RESCHEDULE_APPOINTMENT]: () => ({ appointmentId: "aten-9" }) },
    });

    const result = await fake
      .adapter()
      .rescheduleAppointment({ appointmentId: "aten-9", slot: { ...SLOT_IN_PERSON } });

    expect(fake.calls).toEqual([
      {
        name: RESCHEDULE_APPOINTMENT,
        kind: "mutation",
        args: {
          appointmentId: "aten-9",
          professionalId: "pro-1",
          modality: "inPerson",
          spaceId: "esp-1",
          startAt: SLOT_IN_PERSON.startAt,
          endAt: SLOT_IN_PERSON.endAt,
          version: "v1",
        },
      },
    ]);
    expect(result).toEqual({ status: "rescheduled", appointmentId: "aten-9" });
  });

  test.each([
    ["conflicto", publicError("conflict", "Conflicto"), { status: "conflict", code: "conflict" }],
    [
      "falta de cupo",
      publicError("no_availability", "Sin cupo"),
      { status: "no_availability", code: "no_availability" },
    ],
    ["denegación", publicError("unauthorized", "No autorizado"), { status: "denied" }],
  ])("reagendar traduce %s (TI2-163)", async (_name, handler, expected) => {
    const fake = createFakeClient({ mutation: { [RESCHEDULE_APPOINTMENT]: handler } });

    await expect(
      fake.adapter().rescheduleAppointment({ appointmentId: "aten-9", slot: { ...SLOT_ONLINE } }),
    ).resolves.toEqual(expected);
  });

  test("un fallo técnico al reagendar usa un mensaje seguro (TI2-163)", async () => {
    const fake = createFakeClient({
      mutation: {
        [RESCHEDULE_APPOINTMENT]: () => {
          throw new Error("detalle interno");
        },
      },
    });

    const result = await fake
      .adapter()
      .rescheduleAppointment({ appointmentId: "aten-9", slot: { ...SLOT_ONLINE } });

    expect(result).toMatchObject({
      status: "error",
      error: { message: "No pudimos cambiar el horario. Inténtalo de nuevo." },
    });
    expect(JSON.stringify(result)).not.toContain("detalle interno");
  });

  test("la justificación envía la explicación y la recepción del respaldo (TI2-163)", async () => {
    const fake = createFakeClient({
      mutation: { [SUBMIT_JUSTIFICATION]: () => ({ appointmentId: "aten-9" }) },
    });

    const result = await fake.adapter().submitAppointmentJustification({
      appointmentId: "aten-9",
      explanation: "Se suspendió el transporte.",
      supportingDocumentReceived: true,
    });

    expect(result).toEqual({ status: "submitted" });
    expect(fake.calls[0]?.args).toEqual({
      appointmentId: "aten-9",
      explanation: "Se suspendió el transporte.",
      supportingDocumentReceived: true,
      version: "v1",
    });
  });

  test("una justificación fuera de plazo conserva el error público (TI2-163)", async () => {
    const fake = createFakeClient({
      mutation: { [SUBMIT_JUSTIFICATION]: publicError("conflict", "Conflicto público") },
    });

    await expect(
      fake.adapter().submitAppointmentJustification({
        appointmentId: "aten-9",
        explanation: "Tarde",
        supportingDocumentReceived: false,
      }),
    ).resolves.toEqual({
      status: "error",
      error: { code: "conflict", message: "Conflicto público" },
    });
  });

  test.each([
    [{ status: "pending", version: "v1" }, { status: "pending" }],
    [
      { status: "available", link: "https://meet.google.com/sol-casa-pan", version: "v1" },
      { status: "available", link: "https://meet.google.com/sol-casa-pan" },
    ],
    [{ status: "not_applicable", version: "v1" }, { status: "not_applicable" }],
  ])("el acceso en línea traduce %o (TI2-163)", async (view, expected) => {
    const fake = createFakeClient({ query: { [GET_ONLINE_ACCESS]: () => view } });

    await expect(fake.adapter().getOnlineAccess("aten-9")).resolves.toEqual(expected);
    expect(fake.calls[0]?.args).toEqual({ appointmentId: "aten-9", version: "v1" });
  });

  test("el acceso en línea de quien no participa responde denegación (TI2-163)", async () => {
    const fake = createFakeClient({
      query: { [GET_ONLINE_ACCESS]: publicError("unauthorized", "No autorizado") },
    });

    await expect(fake.adapter().getOnlineAccess("ajena")).resolves.toEqual({ status: "denied" });
  });
});

describe("vista del Estudiante con justificación (TI2-163)", () => {
  test("el detalle compartido trae el acompañamiento y la revisión, sin motivo profesional", async () => {
    const shared = {
      ...fullProjection(),
      status: "no_show",
      justificationExplanation: "Se suspendió el transporte.",
      justificationSubmittedAt: Date.UTC(2026, 4, 13, 12, 0),
      justificationReview: "rejected",
      justificationReviewExplanation: "Falta el respaldo.",
      supportingDocumentReceived: false,
      view: "shared",
    };
    const fake = createFakeClient({ query: { [GET_APPOINTMENT]: () => shared } });

    const result = await fake.adapter().getAppointment("aten-1");

    expect(result).toEqual({
      status: "ok",
      appointment: {
        id: "aten-1",
        accompanimentId: "acompanamiento-1",
        status: "no_show",
        modality: "inPerson",
        spaceId: "esp-1",
        startAt: shared.startAt,
        endAt: shared.endAt,
        justificationExplanation: "Se suspendió el transporte.",
        justificationSubmittedAt: shared.justificationSubmittedAt,
        justificationReview: "rejected",
        justificationReviewExplanation: "Falta el respaldo.",
        supportingDocumentReceived: false,
      },
    });
  });
});

describe("profesionales con quienes reservar (TI2-123)", () => {
  test("entrega los profesionales reservables del Backend", async () => {
    const fake = createFakeClient({
      query: {
        [LIST_BOOKABLE]: () => ({ professionalIds: ["pro-1", "pro-2"], version: "v1" }),
      },
    });

    await expect(fake.adapter().findBookingProfessionals("acompanamiento-1")).resolves.toEqual({
      status: "ok",
      professionalIds: ["pro-1", "pro-2"],
    });
    expect(fake.calls[0].args).toEqual({ accompanimentId: "acompanamiento-1", version: "v1" });
  });

  test("sin profesionales responde none y no inventa uno", async () => {
    const fake = createFakeClient({
      query: { [LIST_BOOKABLE]: () => ({ professionalIds: [], version: "v1" }) },
    });

    await expect(fake.adapter().findBookingProfessionals("acompanamiento-1")).resolves.toEqual({
      status: "none",
    });
  });

  test("traduce denegación y fallo técnico sin filtrar detalles", async () => {
    const denied = createFakeClient({
      query: {
        [LIST_BOOKABLE]: () => {
          throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
        },
      },
    });
    const failed = createFakeClient({
      query: {
        [LIST_BOOKABLE]: () => {
          throw new Error("detalle interno");
        },
      },
    });

    await expect(denied.adapter().findBookingProfessionals("ajeno")).resolves.toEqual({
      status: "denied",
    });
    await expect(failed.adapter().findBookingProfessionals("acompanamiento-1")).resolves.toEqual({
      status: "error",
      message: "No pudimos cargar tu acompañamiento. Inténtalo de nuevo.",
    });
  });
});

describe("escritura real del catálogo (TI2-169)", () => {
  const CREATE_SPACE = "presentation/spaces:createSpace";
  const UPDATE_SPACE = "presentation/spaces:updateSpace";
  const SET_SPACE_ACTIVE = "presentation/spaces:setSpaceActive";
  const SPACE_FIELDS = {
    campus: "Campus San Juan Pablo II",
    building: "Edificio A",
    floor: "Piso 9",
    room: "Sala 901",
    accessConditions: "Rampa lateral.",
    arrivalInstructions: "Entrar por el acceso norte.",
  };
  const MANAGED = {
    space: { id: "esp-backend-9", ...SPACE_FIELDS, version: "v1" },
    label: "Campus San Juan Pablo II · Edificio A · Piso 9 · Sala 901",
    isActive: true,
  };

  test("crear sin id llama a createSpace y devuelve el espacio persistido", async () => {
    const fake = createFakeClient({
      mutation: { [CREATE_SPACE]: () => MANAGED },
    });

    const result = await fake.adapter().saveSpace(SPACE_FIELDS);

    expect(result).toEqual({ status: "saved", space: MANAGED.space });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toMatchObject({
      kind: "mutation",
      args: { ...SPACE_FIELDS, version: "v1" },
    });
  });

  test("actualizar con id llama a updateSpace con el identificador", async () => {
    const fake = createFakeClient({
      mutation: { [UPDATE_SPACE]: () => MANAGED },
    });

    const result = await fake.adapter().saveSpace({ id: "esp-backend-9", ...SPACE_FIELDS });

    expect(result).toEqual({ status: "saved", space: MANAGED.space });
    expect(fake.calls[0].args).toMatchObject({ spaceId: "esp-backend-9", version: "v1" });
  });

  test("deshabilitar llama a setSpaceActive y devuelve vigencia", async () => {
    const fake = createFakeClient({
      mutation: { [SET_SPACE_ACTIVE]: () => ({ ...MANAGED, isActive: false }) },
    });

    const result = await fake.adapter().setSpaceActive({ spaceId: "esp-1", isActive: false });

    expect(result).toEqual({ status: "saved", space: MANAGED.space, isActive: false });
    expect(fake.calls[0].args).toEqual({
      spaceId: "esp-1",
      isActive: false,
      version: "v1",
    });
  });

  test("denegación de escritura se traduce a denied sin detalles", async () => {
    const denied = () => {
      throw new ConvexError({ code: "unauthorized", message: "No autorizado" });
    };
    const fakeSave = createFakeClient({ mutation: { [CREATE_SPACE]: denied } });
    const fakeActive = createFakeClient({ mutation: { [SET_SPACE_ACTIVE]: denied } });

    await expect(fakeSave.adapter().saveSpace(SPACE_FIELDS)).resolves.toEqual({
      status: "denied",
    });
    await expect(
      fakeActive.adapter().setSpaceActive({ spaceId: "esp-1", isActive: false }),
    ).resolves.toEqual({ status: "denied" });
  });
});
