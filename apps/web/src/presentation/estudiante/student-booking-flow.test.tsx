// @vitest-environment jsdom
import { useSyncExternalStore } from "react";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { getFunctionName, type FunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import {
  CONFLICT_ERROR_CODE,
  CONFLICT_ERROR_MESSAGE,
  NO_AVAILABILITY_ERROR_CODE,
  NO_AVAILABILITY_ERROR_MESSAGE,
  UNAUTHORIZED_ERROR_MESSAGE,
} from "../../../../../convex/domain/index.ts";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import { appointmentStatusLabel } from "./agenda-labels.ts";

/**
 * Flujo integrado de agenda del Estudiante (TI2-124).
 *
 * Qué es real aquí: router, guards, páginas, `BookingContextGate`, el puerto y
 * el adaptador Convex, incluida su traducción de errores públicos.
 *
 * Qué es simulado: el transporte. `convexClient` y `useQuery` llegan a un
 * Backend en memoria con datos ficticios, que despacha por el nombre público
 * de cada función. Sus reglas solo imitan las respuestas del contrato, así que
 * esta suite NO prueba OAuth, autorización ni concurrencia reales: esas reglas
 * las cubren `convex/tests/apiBackend.test.ts` y TI2-120, y el recorrido contra
 * un deployment se registra aparte como evidencia de la PR.
 */

type Args = Record<string, unknown>;
type Call = { readonly name: string; readonly args: Args };
type Interceptor = () => Promise<void> | void;

const OWN_ACCOMPANIMENT = "acompanamiento-propio";
const FOREIGN_ACCOMPANIMENT = "acompanamiento-ajeno";
const PROFESSIONAL = "pro-ficticio-1";

const BOOK = "presentation/appointments:bookAppointment";
const CANCEL = "presentation/appointments:cancelAppointment";
const SEARCH = "presentation/availability:searchSlots";
const BOOKABLE = "presentation/availability:listBookableProfessionals";
const SESSION_STATE = "presentation/session:getSessionState";

/** Martes 10 de noviembre de 2026, 10:00 en America/Santiago. */
const IN_PERSON_SLOT = {
  id: "cupo-presencial",
  professionalId: PROFESSIONAL,
  date: "2026-11-10",
  startAt: Date.UTC(2026, 10, 10, 13, 0),
  endAt: Date.UTC(2026, 10, 10, 14, 0),
  modality: "inPerson",
  spaceId: "espacio-1",
  version: "v1",
} as const;

/** Miércoles 11 de noviembre de 2026, 10:00 en America/Santiago. */
const ONLINE_SLOT = {
  id: "cupo-en-linea",
  professionalId: PROFESSIONAL,
  date: "2026-11-11",
  startAt: Date.UTC(2026, 10, 11, 13, 0),
  endAt: Date.UTC(2026, 10, 11, 14, 0),
  modality: "online",
  version: "v1",
} as const;

const SPACE = {
  id: "espacio-1",
  campus: "Campus Ficticio",
  building: "A",
  floor: "1",
  room: "101",
  accessConditions: "",
  arrivalInstructions: "",
  version: "v1",
} as const;

const OBJECTIVE = "Objetivo ficticio del acompañamiento";

const denied = () => new ConvexError(UNAUTHORIZED_ERROR_MESSAGE);
const conflict = () =>
  new ConvexError({ code: CONFLICT_ERROR_CODE, message: CONFLICT_ERROR_MESSAGE });

type StoredAppointment = {
  appointmentId: string;
  status: string;
  startAt: number;
  endAt: number;
  modality: string;
  calendarAdded: boolean;
  calendarNeedsUpdate: boolean;
};

/** Backend en memoria: despacha por nombre público y registra cada llamada. */
function createFakeBackend() {
  const calls: Call[] = [];
  const interceptors = new Map<string, Interceptor[]>();
  const listeners = new Set<() => void>();
  const appointments: StoredAppointment[] = [];
  let slots: ReadonlyArray<typeof IN_PERSON_SLOT | typeof ONLINE_SLOT> = [
    IN_PERSON_SLOT,
    ONLINE_SLOT,
  ];
  let version = 0;

  const notify = () => {
    version += 1;
    listeners.forEach((listener) => listener());
  };

  const assertOwn = (accompanimentId: unknown) => {
    if (accompanimentId !== OWN_ACCOMPANIMENT) {
      throw denied();
    }
  };

  const book = (args: Args): { appointmentId: string } => {
    assertOwn(args.accompanimentId);
    const slot = slots.find(
      (candidate) => candidate.startAt === args.startAt && candidate.modality === args.modality,
    );
    if (slot === undefined) {
      throw conflict();
    }
    slots = slots.filter((candidate) => candidate !== slot);
    const appointmentId = `atencion-ficticia-${appointments.length + 1}`;
    appointments.push({
      appointmentId,
      status: "scheduled",
      startAt: slot.startAt,
      endAt: slot.endAt,
      modality: slot.modality,
      calendarAdded: false,
      calendarNeedsUpdate: false,
    });
    notify();
    return { appointmentId };
  };

  const cancel = (args: Args): null => {
    const appointment = appointments.find((item) => item.appointmentId === args.appointmentId);
    if (appointment === undefined) {
      throw denied();
    }
    appointment.status = "cancelled_by_student";
    notify();
    return null;
  };

  const queries: Record<string, (args: Args) => unknown> = {
    [SESSION_STATE]: () => mockedSession,
    "presentation/accompaniments:listOwnedAccompaniments": () => ({
      page: [{ _id: OWN_ACCOMPANIMENT, status: "active", objective: OBJECTIVE }],
      isDone: true,
      continueCursor: "",
    }),
    "presentation/accompaniments:getAccompaniment": (args) => {
      assertOwn(args.accompanimentId);
      return { _id: OWN_ACCOMPANIMENT, status: "active", objective: OBJECTIVE, view: "full" };
    },
    "presentation/appointments:listAccompanimentAppointments": (args) => {
      assertOwn(args.accompanimentId);
      return appointments.map((appointment) => ({ ...appointment }));
    },
    "presentation/appointments:getCalendarConnection": () => ({ connected: false }),
    [BOOKABLE]: (args) => {
      assertOwn(args.accompanimentId);
      return { professionalIds: [PROFESSIONAL], version: "v1" };
    },
    [SEARCH]: (args) => {
      assertOwn(args.accompanimentId);
      if (slots.length === 0) {
        throw new ConvexError({
          code: NO_AVAILABILITY_ERROR_CODE,
          message: NO_AVAILABILITY_ERROR_MESSAGE,
        });
      }
      return { items: slots, hasMore: false, nextCursor: null, version: "v1" };
    },
    "presentation/spaces:listSpaces": () => ({
      items: [SPACE],
      hasMore: false,
      nextCursor: null,
      version: "v1",
    }),
  };

  const mutations: Record<string, (args: Args) => unknown> = { [BOOK]: book, [CANCEL]: cancel };

  const dispatch = async (
    handlers: Record<string, (args: Args) => unknown>,
    ref: FunctionReference<"query"> | FunctionReference<"mutation">,
    args: Args,
  ) => {
    const name = getFunctionName(ref);
    calls.push({ name, args });
    await interceptors.get(name)?.shift()?.();
    const handler = handlers[name];
    if (handler === undefined) {
      throw new Error(`Función no configurada en el doble: ${name}`);
    }
    return handler(args);
  };

  return {
    calls,
    callsTo: (name: string) => calls.filter((call) => call.name === name),
    client: {
      query: (ref: FunctionReference<"query">, args: Args = {}) => dispatch(queries, ref, args),
      mutation: (ref: FunctionReference<"mutation">, args: Args = {}) =>
        dispatch(mutations, ref, args),
    },
    /** Lectura reactiva: se vuelve a calcular en cada cambio, como una suscripción. */
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    readReactive: (ref: FunctionReference<"query">, args: Args = {}) => {
      const name = getFunctionName(ref);
      calls.push({ name, args });
      const handler = queries[name];
      if (handler === undefined) {
        throw new Error(`Función no configurada en el doble: ${name}`);
      }
      return handler(args);
    },
    /** La siguiente llamada a `name` falla con `error`. */
    failNext: (name: string, error: Error) => {
      const queue = interceptors.get(name) ?? [];
      queue.push(() => {
        throw error;
      });
      interceptors.set(name, queue);
    },
    /** La siguiente llamada a `name` queda pendiente hasta liberar. */
    holdNext: (name: string) => {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const queue = interceptors.get(name) ?? [];
      queue.push(() => gate);
      interceptors.set(name, queue);
      return release;
    },
    /** Otra persona toma el cupo: la próxima reserva responde conflicto. */
    takeSlot: (slotId: string) => {
      slots = slots.filter((slot) => slot.id !== slotId);
    },
    /** Cambio ocurrido fuera de esta pantalla, por ejemplo en otra pestaña. */
    bookElsewhere: (slot: typeof IN_PERSON_SLOT | typeof ONLINE_SLOT) =>
      book({
        accompanimentId: OWN_ACCOMPANIMENT,
        startAt: slot.startAt,
        modality: slot.modality,
      }),
    cancelElsewhere: (appointmentId: string) => cancel({ appointmentId }),
    appointments,
  };
}

let backend = createFakeBackend();
let mockedSession: WebSessionState;
let mockedPair: { session: WebSessionState; role: WebSessionRole } | undefined;

vi.mock("convex/react", () => ({
  useQuery: (ref: FunctionReference<"query">, args?: Args) => {
    useSyncExternalStore(backend.subscribe, backend.getVersion);
    return backend.readReactive(ref, args);
  },
  useAction: () => async () => null,
  useConvex: () => backend.client,
}));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  isBackendConfigured: true,
  // El adaptador real se crea una vez: delega para ver el Backend de cada prueba.
  convexClient: {
    query: (ref: FunctionReference<"query">, args?: Args) => backend.client.query(ref, args),
    mutation: (ref: FunctionReference<"mutation">, args?: Args) =>
      backend.client.mutation(ref, args),
  },
}));

const SESION_ESTUDIANTE: WebSessionState = {
  status: "authenticated",
  email: "estudiante@alu.uct.cl",
  name: "Estudiante Ficticio",
  population: "estudiante",
};

const PAR_ESTUDIANTE: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_ESTUDIANTE,
  role: { status: "authenticated", role: "student", email: "estudiante@alu.uct.cl" },
};

const HORARIOS = "/estudiante/horarios";
const RESERVAR_PRESENCIAL = `/estudiante/reservar?slotId=${IN_PERSON_SLOT.id}&accompanimentId=${OWN_ACCOMPANIMENT}`;
const DETALLE = `/estudiante/acompanamientos/${OWN_ACCOMPANIMENT}`;

/** Argumentos exactos del comando: sin identidad del cliente como prueba de propiedad. */
const BOOKING_ARGS = {
  accompanimentId: OWN_ACCOMPANIMENT,
  professionalId: PROFESSIONAL,
  modality: IN_PERSON_SLOT.modality,
  spaceId: IN_PERSON_SLOT.spaceId,
  startAt: IN_PERSON_SLOT.startAt,
  endAt: IN_PERSON_SLOT.endAt,
  version: expect.any(String),
};

/**
 * La primera consulta por rol de este archivo calcula estilos en frío sobre toda
 * la página y, con la suite completa en paralelo, supera por sí sola el límite
 * de 1 s de Testing Library. Es costo de jsdom, no una espera del flujo.
 */
beforeAll(() => {
  configure({ asyncUtilTimeout: 5000 });
  vi.setConfig({ testTimeout: 20_000 });
});

beforeEach(() => {
  backend = createFakeBackend();
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(<RouterProvider router={router} />);
  return router;
}

async function marcarCasilla() {
  fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
  return screen.getByRole("button", { name: "Confirmar reserva" });
}

async function confirmarCupo() {
  fireEvent.click(await marcarCasilla());
}

describe("selección, confirmación y lectura reactiva (TI2-124)", () => {
  test("busca, elige y confirma con los argumentos del contrato", async () => {
    const router = renderAt(HORARIOS);

    fireEvent.click(await screen.findByRole("link", { name: /Martes 10 de noviembre.*101/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/estudiante/reservar"));
    expect(router.state.location.search).toMatchObject({
      slotId: IN_PERSON_SLOT.id,
      accompanimentId: OWN_ACCOMPANIMENT,
    });
    expect(backend.callsTo(BOOK)).toHaveLength(0);

    await confirmarCupo();

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(screen.getByText("atencion-ficticia-1")).toBeDefined();
    expect(backend.callsTo(BOOK).map((call) => call.args)).toEqual([BOOKING_ARGS]);
  });

  test("la búsqueda pide los cupos del acompañamiento propio y del profesional reservable", async () => {
    renderAt(HORARIOS);
    await screen.findByRole("link", { name: /Martes 10 de noviembre/ });

    expect(backend.callsTo(BOOKABLE)[0]?.args).toMatchObject({
      accompanimentId: OWN_ACCOMPANIMENT,
    });
    expect(backend.callsTo(SEARCH)[0]?.args).toMatchObject({
      accompanimentId: OWN_ACCOMPANIMENT,
      professionalId: PROFESSIONAL,
    });
  });

  test("la atención confirmada aparece en el detalle con el mismo dato del Backend", async () => {
    const router = renderAt(RESERVAR_PRESENCIAL);
    await confirmarCupo();
    await screen.findByRole("heading", { name: "Reserva confirmada" });

    await act(() =>
      router.navigate({
        to: "/estudiante/acompanamientos/$accompanimentId",
        params: { accompanimentId: OWN_ACCOMPANIMENT },
      }),
    );

    expect(await screen.findByText(new RegExp(appointmentStatusLabel("scheduled")))).toBeDefined();
    expect(backend.appointments).toHaveLength(1);
  });

  test("el detalle abierto refleja reserva y cancelación sin recargar", async () => {
    renderAt(DETALLE);
    expect(
      await screen.findByText("Aún no tienes atenciones registradas en este acompañamiento."),
    ).toBeDefined();

    let appointmentId = "";
    act(() => {
      appointmentId = backend.bookElsewhere(ONLINE_SLOT).appointmentId;
    });
    expect(await screen.findByText(new RegExp(appointmentStatusLabel("scheduled")))).toBeDefined();

    act(() => {
      backend.cancelElsewhere(appointmentId);
    });
    expect(
      await screen.findByText(new RegExp(appointmentStatusLabel("cancelled_by_student"))),
    ).toBeDefined();
    expect(screen.queryByText(new RegExp(appointmentStatusLabel("scheduled")))).toBeNull();
  });

  test("cancelar desde el comprobante llega al Backend sin enviar motivo", async () => {
    renderAt(RESERVAR_PRESENCIAL);
    await confirmarCupo();

    fireEvent.click(await screen.findByRole("button", { name: "Cancelar esta reserva" }));

    expect(await screen.findByRole("heading", { name: "Reserva cancelada" })).toBeDefined();
    expect(backend.callsTo(CANCEL).map((call) => call.args)).toEqual([
      { appointmentId: "atencion-ficticia-1", version: expect.any(String) },
    ]);
    expect(backend.appointments[0]?.status).toBe("cancelled_by_student");
  });
});

describe("conflicto, red fallida, reintento y doble confirmación (TI2-124)", () => {
  test("un cupo tomado por otra persona responde conflicto y conserva la selección", async () => {
    renderAt(RESERVAR_PRESENCIAL);
    const enviar = await marcarCasilla();
    backend.takeSlot(IN_PERSON_SLOT.id);

    fireEvent.click(enviar);

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toContain(CONFLICT_ERROR_MESSAGE);
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();
    expect(screen.getByText(/101/)).toBeDefined();
    const casilla = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /Confirmo que deseo reservar/,
    });
    expect(casilla.checked).toBe(true);
    expect(backend.appointments).toHaveLength(0);
  });

  test("tras el conflicto se puede elegir otro horario y reservarlo", async () => {
    const router = renderAt(RESERVAR_PRESENCIAL);
    const enviar = await marcarCasilla();
    backend.takeSlot(IN_PERSON_SLOT.id);
    fireEvent.click(enviar);

    fireEvent.click(await screen.findByRole("link", { name: "Elegir otro horario" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(HORARIOS));

    expect(screen.queryByRole("link", { name: /Martes 10 de noviembre/ })).toBeNull();
    fireEvent.click(await screen.findByRole("link", { name: /Miércoles 11 de noviembre/ }));
    await confirmarCupo();

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(backend.appointments.map((item) => item.startAt)).toEqual([ONLINE_SLOT.startAt]);
  });

  test("un conflicto transitorio se recupera repitiendo el mismo comando", async () => {
    renderAt(RESERVAR_PRESENCIAL);
    backend.failNext(BOOK, conflict());
    fireEvent.click(await marcarCasilla());
    await screen.findByRole("alert");

    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    const enviados = backend.callsTo(BOOK).map((call) => call.args);
    expect(enviados).toEqual([BOOKING_ARGS, BOOKING_ARGS]);
    expect(backend.appointments).toHaveLength(1);
  });

  test("una red caída no confirma, no filtra el detalle y el reintento reserva una vez", async () => {
    const detalleInterno = "Server Error: notas internas de un tercero";
    renderAt(RESERVAR_PRESENCIAL);
    backend.failNext(BOOK, new Error(detalleInterno));
    fireEvent.click(await marcarCasilla());

    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).not.toContain(CONFLICT_ERROR_MESSAGE);
    expect(document.body.textContent).not.toContain(detalleInterno);
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Elegir otro horario" })).toBeNull();
    expect(backend.appointments).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(backend.appointments).toHaveLength(1);
  });

  test("la doble confirmación envía un solo comando mientras está pendiente", async () => {
    const liberar = backend.holdNext(BOOK);
    renderAt(RESERVAR_PRESENCIAL);
    const enviar = await marcarCasilla();
    const formulario = enviar.closest("form");
    expect(formulario).not.toBeNull();

    fireEvent.submit(formulario as HTMLFormElement);
    fireEvent.submit(formulario as HTMLFormElement);
    fireEvent.click(enviar);

    await screen.findByRole("button", { name: "Confirmando…" });
    expect(backend.callsTo(BOOK)).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();

    liberar();

    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(backend.callsTo(BOOK)).toHaveLength(1);
    expect(backend.appointments).toHaveLength(1);
  });

  test("una búsqueda caída no filtra el detalle y el reintento recupera los cupos", async () => {
    const detalleInterno = "Server Error: traza interna";
    backend.failNext(SEARCH, new Error(detalleInterno));
    renderAt(HORARIOS);

    await screen.findByRole("alert");
    expect(document.body.textContent).not.toContain(detalleInterno);

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByRole("link", { name: /Martes 10 de noviembre/ })).toBeDefined();
  });

  test("sin cupos publicados no se presenta como fallo técnico", async () => {
    backend.takeSlot(IN_PERSON_SLOT.id);
    backend.takeSlot(ONLINE_SLOT.id);
    renderAt(HORARIOS);

    expect(await screen.findByText("No hay cupos compatibles por ahora.")).toBeDefined();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("acceso directo y recursos de otro titular (TI2-124)", () => {
  test.each([HORARIOS, RESERVAR_PRESENCIAL, DETALLE])(
    "%s sin sesión va al acceso sin llamar a la API",
    async (path) => {
      mockedSession = { status: "unauthenticated" };
      mockedPair = { session: mockedSession, role: { status: "unauthenticated" } };

      const router = renderAt(path);

      await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
      // La pantalla de acceso solo consulta el estado de la sesión.
      expect(backend.calls.filter((call) => call.name !== SESSION_STATE)).toEqual([]);
    },
  );

  test.each([HORARIOS, RESERVAR_PRESENCIAL, DETALLE])(
    "%s con otro rol va a denegado sin llamar a la API",
    async (path) => {
      mockedSession = {
        status: "authenticated",
        email: "pro@uct.cl",
        name: "Profesional Ficticio",
        population: "personal",
      };
      mockedPair = {
        session: mockedSession,
        role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
      };

      const router = renderAt(path);

      await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
      expect(await screen.findByRole("heading", { name: "Acceso denegado" })).toBeDefined();
      expect(backend.calls).toHaveLength(0);
    },
  );

  test("un acompañamiento ajeno en la URL nunca llega al Backend", async () => {
    renderAt(
      `/estudiante/reservar?slotId=${IN_PERSON_SLOT.id}&accompanimentId=${FOREIGN_ACCOMPANIMENT}`,
    );
    await confirmarCupo();

    await screen.findByRole("heading", { name: "Reserva confirmada" });
    const enviados = backend.calls.filter(
      (call) => call.args.accompanimentId === FOREIGN_ACCOMPANIMENT,
    );
    expect(enviados).toEqual([]);
    expect(backend.callsTo(BOOK)[0]?.args.accompanimentId).toBe(OWN_ACCOMPANIMENT);
  });

  test("el detalle de un acompañamiento ajeno responde denegación sin datos", async () => {
    renderAt(`/estudiante/acompanamientos/${FOREIGN_ACCOMPANIMENT}`);

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
    expect(screen.queryByText(OBJECTIVE)).toBeNull();
    expect(screen.queryByText("Necesidades de acceso")).toBeNull();
  });

  test("una asignación revocada deniega la búsqueda sin mostrar cupos", async () => {
    backend.failNext(BOOKABLE, denied());
    renderAt(HORARIOS);

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
    expect(screen.queryByRole("link", { name: /noviembre/ })).toBeNull();
    expect(backend.callsTo(SEARCH)).toHaveLength(0);
  });

  test("la reserva denegada es permanente y no deja falsa confirmación", async () => {
    renderAt(RESERVAR_PRESENCIAL);
    backend.failNext(BOOK, denied());
    fireEvent.click(await marcarCasilla());

    const titulo = await screen.findByRole("heading", {
      name: "No tienes acceso a esta reserva.",
    });
    await waitFor(() => expect(document.activeElement).toBe(titulo));
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).toBeNull();
    expect(backend.appointments).toHaveLength(0);
  });

  test("la cancelación denegada conserva el comprobante y no se presenta como éxito", async () => {
    renderAt(RESERVAR_PRESENCIAL);
    await confirmarCupo();
    await screen.findByRole("heading", { name: "Reserva confirmada" });
    backend.failNext(CANCEL, denied());

    fireEvent.click(screen.getByRole("button", { name: "Cancelar esta reserva" }));

    expect(
      await screen.findByRole("heading", { name: "No tienes acceso a esta reserva." }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Reserva cancelada" })).toBeNull();
    expect(screen.getByText("atencion-ficticia-1")).toBeDefined();
    expect(backend.appointments[0]?.status).toBe("scheduled");
  });
});

describe("estados accesibles del flujo (TI2-124)", () => {
  test("el foco sigue al estado de la página en cada paso", async () => {
    const router = renderAt(HORARIOS);

    const buscar = await screen.findByRole("heading", { name: "Buscar horarios" });
    await waitFor(() => expect(document.activeElement).toBe(buscar));

    fireEvent.click(await screen.findByRole("link", { name: /Martes 10 de noviembre/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/estudiante/reservar"));

    const confirmar = await screen.findByRole("heading", { name: "Confirmar reserva" });
    await waitFor(() => expect(document.activeElement).toBe(confirmar));

    // Como con teclado: el foco está en el botón, que desaparece al confirmar.
    const enviar = await marcarCasilla();
    enviar.focus();
    expect(document.activeElement).toBe(enviar);
    fireEvent.click(enviar);

    const confirmada = await screen.findByRole("heading", { name: "Reserva confirmada" });
    await waitFor(() => expect(document.activeElement).toBe(confirmada));
  });

  test("cada cupo es un enlace con su día, hora y modalidad en el nombre", async () => {
    renderAt(HORARIOS);

    const enlace = await screen.findByRole("link", { name: /Miércoles 11 de noviembre/ });
    expect(enlace.textContent).toMatch(/En línea/);
    expect(enlace.getAttribute("href")).toContain(`slotId=${ONLINE_SLOT.id}`);
    expect(screen.getByRole("status").textContent).toBe("2 cupos disponibles.");
  });
});
