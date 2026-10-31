import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { describe, expect, test } from "vitest";
import { createConvexAgendaAdapter, type ConvexAgendaClient } from "./convex-agenda-adapter.ts";

/**
 * Pruebas del adaptador Convex de agenda (TI2-125).
 *
 * El cliente se sustituye por un doble que despacha por el nombre público de
 * la función y registra los argumentos reales. Así se verifica la ventana de
 * 92 días, el tope de 50 por página, el mapeo de errores públicos y que las
 * operaciones aún sin API sigan delegadas a fixtures. No hay llamadas a un
 * deployment: los datos son ficticios.
 */

const LIST_AVAILABILITY = "presentation/availability:listOwnAvailability";
const PUBLISH_BLOCK = "presentation/availability:publishBlock";
const PUBLISH_EXCEPTION = "presentation/availability:publishException";
const LIST_APPOINTMENTS = "presentation/appointments:listAppointments";
const GET_APPOINTMENT = "presentation/appointments:getAppointment";
const CANCEL_APPOINTMENT = "presentation/appointments:cancelAppointment";
const RECORD_ATTENDANCE = "presentation/appointments:recordAppointmentAttendance";

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
    ...(options.watches === undefined
      ? {}
      : {
          watchQuery: (ref: FunctionReference<"query">, args: Record<string, unknown>) => {
            const name = getFunctionName(ref);
            calls.push({ name, kind: "query", args });
            return {
              localQueryResult: () => options.watches?.()[name],
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
    let localPage: unknown = firstPage;
    const fake = createFakeClient({
      query: { [LIST_APPOINTMENTS]: () => secondPage },
      watches: () => ({ [LIST_APPOINTMENTS]: localPage }),
    });
    const results: string[] = [];
    const unsubscribe = fake.adapter().watchAppointments?.((result) => {
      results.push(result.status);
    });

    await flush();
    expect(results).toEqual(["ok"]);

    localPage = { items: [], hasMore: false, nextCursor: null, version: "v1" };
    fake.notify();
    await flush();
    expect(results).toEqual(["ok", "empty"]);

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

describe("operaciones aún simuladas (TI2-125)", () => {
  test("la búsqueda en línea sigue devolviendo la falta de cupo ficticia", async () => {
    const fake = createFakeClient();

    await expect(fake.adapter().searchSlots({ modality: "online" })).resolves.toEqual({
      status: "no_availability",
      code: "no_availability",
    });
    expect(fake.calls).toHaveLength(0);
  });

  test("el catálogo de espacios sigue leyéndose de fixtures", async () => {
    const fake = createFakeClient();

    const result = await fake.adapter().listSpaces();

    expect(result.status).toBe("ok");
    expect(fake.calls).toHaveLength(0);
  });
});
