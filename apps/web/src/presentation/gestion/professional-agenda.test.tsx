// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { AgendaPort } from "../../application/agenda/agenda-port.ts";
import { setAgendaPortForTests } from "./professional-agenda-data.ts";

/**
 * Pruebas de la agenda del Profesional (TI2-115).
 *
 * Integración por el router real (incluye guards): la sesión simulada es de
 * Profesional, salvo los casos de denegación. El puerto de agenda se inyecta
 * por pruebas porque el adaptador ficticio no distingue referencias; el
 * cableado real puerto→adaptador lo cubren las pruebas del adaptador, `tsc`
 * y el build. Todos los datos son ficticios y el modo se declara simulado.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

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
  get isBackendConfigured() {
    return mockedBackendConfigured;
  },
  convexClient: {},
}));

const SESION_PRO: WebSessionState = {
  status: "authenticated",
  email: "pro@uct.cl",
  name: "Profesional Ficticio",
  population: "personal",
};

const PAR_PRO: { session: WebSessionState; role: WebSessionRole } = {
  session: SESION_PRO,
  role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
};

const SESION_INTERN: WebSessionState = {
  status: "authenticated",
  email: "intern@uct.cl",
  name: "Practicante Ficticio",
  population: "personal",
};

const PAR_INTERN = {
  session: SESION_INTERN,
  role: { status: "authenticated", role: "intern", email: "intern@uct.cl" },
} as const;

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

const ATENCION_BASE = {
  id: "aten-ficticio-1",
  status: "scheduled",
  modality: "inPerson",
  spaceId: "esp-1",
  startAt: Date.UTC(2026, 4, 12, 14, 0),
  endAt: Date.UTC(2026, 4, 12, 15, 0),
} as const;

function puertoAgendaBase(): AgendaPort {
  return {
    searchSlots: () => Promise.resolve({ status: "empty" }),
    reserveSlot: () =>
      Promise.resolve({
        status: "error",
        error: { code: "no_availability", message: "El cupo ya no está disponible." },
      }),
    listAvailability: () => Promise.resolve({ status: "empty" }),
    saveBlock: () =>
      Promise.resolve({
        status: "saved",
        block: {
          id: "bloque-ficticio-1",
          professionalId: "pro-ficticio-1",
          weekday: 1,
          startMinute: 540,
          endMinute: 600,
          slotMinutes: 30,
          modality: "online",
          version: "v1",
        },
      }),
    saveException: () =>
      Promise.resolve({
        status: "saved",
        exception: { date: "2026-05-04", kind: "cancelled", version: "v1" },
      }),
    listAppointments: () => Promise.resolve({ status: "ok", appointments: [{ ...ATENCION_BASE }] }),
    getAppointment: () => Promise.resolve({ status: "ok", appointment: { ...ATENCION_BASE } }),
    changeAppointmentStatus: (input) =>
      Promise.resolve({
        status: "changed",
        appointment: { ...ATENCION_BASE, status: input.to },
      }),
    listSpaces: () => Promise.resolve({ status: "empty" }),
    saveSpace: () =>
      Promise.resolve({
        status: "denied",
      }),
  };
}

function comoProfesional(port: AgendaPort = puertoAgendaBase()) {
  mockedSession = SESION_PRO;
  mockedPair = PAR_PRO;
  setAgendaPortForTests(port);
}

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  setAgendaPortForTests(null);
});

afterEach(() => {
  cleanup();
  setAgendaPortForTests(null);
});

describe("agenda del Profesional (TI2-115)", () => {
  test("muestra carga y luego las atenciones con estado, ventana y modalidad", async () => {
    let resolveList!: (value: Awaited<ReturnType<AgendaPort["listAppointments"]>>) => void;
    const pendiente = new Promise<Awaited<ReturnType<AgendaPort["listAppointments"]>>>(
      (resolve) => {
        resolveList = resolve;
      },
    );
    const port = puertoAgendaBase();
    port.listAppointments = () => pendiente;
    comoProfesional(port);
    renderAt("/profesional/agenda");

    expect(await screen.findByText("Cargando la agenda…")).toBeDefined();

    resolveList({
      status: "ok",
      appointments: [{ ...ATENCION_BASE }],
    });

    expect(await screen.findByText("Programada")).toBeDefined();
    expect(screen.getByText("Presencial")).toBeDefined();
    expect(screen.getByText("Espacio esp-1")).toBeDefined();
    expect(screen.getByRole("link", { name: /Programada/ })).toBeDefined();
  });

  test("agenda vacía muestra el aviso de vacío sin filas", async () => {
    const port = puertoAgendaBase();
    port.listAppointments = () => Promise.resolve({ status: "empty" });
    comoProfesional(port);
    renderAt("/profesional/agenda");

    expect(await screen.findByText("No tienes atenciones agendadas.")).toBeDefined();
    expect(screen.queryByText("Presencial")).toBeNull();
  });

  test("fallo de lectura muestra error y reintenta", async () => {
    const port = puertoAgendaBase();
    port.listAppointments = () =>
      Promise.resolve({
        status: "error",
        message: "No pudimos cargar la agenda. Inténtalo de nuevo.",
      });
    comoProfesional(port);
    renderAt("/profesional/agenda");

    expect(
      await screen.findByText("No pudimos cargar la agenda. Inténtalo de nuevo."),
    ).toBeDefined();

    port.listAppointments = () => Promise.resolve({ status: "empty" });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("No tienes atenciones agendadas.")).toBeDefined();
  });

  test("denegación de lectura muestra aviso genérico sin detalles", async () => {
    const port = puertoAgendaBase();
    port.listAppointments = () => Promise.resolve({ status: "denied" });
    comoProfesional(port);
    renderAt("/profesional/agenda");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Presencial")).toBeNull();
  });

  test("el modo simulado se declara en la página", async () => {
    comoProfesional();
    renderAt("/profesional/agenda");

    expect(await screen.findByText(/Lectura simulada con datos ficticios/)).toBeDefined();
  });
});

describe("detalle de la atención (TI2-115)", () => {
  test("cambio de estado válido se refleja en el detalle con confirmación enfocada", async () => {
    comoProfesional();
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByRole("heading", { name: "Detalle de la atención" })).toBeDefined();
    expect(screen.getByText("Programada")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Cambiar a"), {
      target: { value: "completed" },
    });
    const registrar = screen.getByRole("button", { name: "Registrar cambio" });
    registrar.focus();
    expect(document.activeElement).toBe(registrar);
    fireEvent.click(registrar);

    expect(await screen.findByRole("heading", { name: "Cambio registrado" })).toBeDefined();
    expect(screen.getByText(/Estado actual: Realizada/)).toBeDefined();
    // El detalle de la confirmación vive junto al anuncio con foco.
    const confirmationHeading = screen.getByRole("heading", { name: "Cambio registrado" });
    const confirmation = confirmationHeading.closest("div");
    if (confirmation === null) {
      throw new Error("Se esperaba el bloque de confirmación del cambio");
    }
    expect(within(confirmation).getByText(/Cambio simulado con datos ficticios/)).toBeDefined();
    // El estado visible del detalle cambia con la misma representación.
    expect(screen.getByText("Realizada")).toBeDefined();
  });

  test("cancelación por CERETI muestra el motivo obligatorio y lo exige", async () => {
    comoProfesional();
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByRole("heading", { name: "Detalle de la atención" })).toBeDefined();

    expect(screen.queryByLabelText("Motivo (obligatorio)")).toBeNull();
    fireEvent.change(screen.getByLabelText("Cambiar a"), {
      target: { value: "cancelled_by_cereti" },
    });

    const motivo = screen.getByLabelText("Motivo (obligatorio)");
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));
    expect(await screen.findByText("El motivo es obligatorio para este cambio.")).toBeDefined();

    fireEvent.change(motivo, { target: { value: "Bloqueo de la sala." } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));

    expect(await screen.findByRole("heading", { name: "Cambio registrado" })).toBeDefined();
  });

  test("rechazo del cambio muestra la causa legible y conserva el estado", async () => {
    const port = puertoAgendaBase();
    port.changeAppointmentStatus = () =>
      Promise.resolve({ status: "rejected", cause: "transition_not_allowed" });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByText("Programada")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Cambiar a"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));

    expect(await screen.findByText("Cambio no permitido desde el estado actual.")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Cambio registrado" })).toBeNull();
    expect(screen.getByText("Programada")).toBeDefined();
  });

  test("denegación del cambio muestra aviso sin filtrar", async () => {
    const port = puertoAgendaBase();
    port.changeAppointmentStatus = () => Promise.resolve({ status: "denied" });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByText("Programada")).toBeDefined();

    fireEvent.change(screen.getByLabelText("Cambiar a"), { target: { value: "completed" } });
    fireEvent.click(screen.getByRole("button", { name: "Registrar cambio" }));

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
  });

  test("id ajeno llega como denegación genérica sin filtrar existencia", async () => {
    const port = puertoAgendaBase();
    port.getAppointment = () => Promise.resolve({ status: "denied" });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-999");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByLabelText("Cambiar a")).toBeNull();
  });

  test("fallo de lectura del detalle muestra error y reintenta", async () => {
    const port = puertoAgendaBase();
    port.getAppointment = () =>
      Promise.resolve({
        status: "error",
        message: "No pudimos cargar la atención. Inténtalo de nuevo.",
      });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(
      await screen.findByText("No pudimos cargar la atención. Inténtalo de nuevo."),
    ).toBeDefined();

    port.getAppointment = () =>
      Promise.resolve({ status: "ok", appointment: { ...ATENCION_BASE } });
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Programada")).toBeDefined();
  });

  test("estados finales no ofertan cambios", async () => {
    const port = puertoAgendaBase();
    port.getAppointment = () =>
      Promise.resolve({ status: "ok", appointment: { ...ATENCION_BASE, status: "completed" } });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByText("Realizada")).toBeDefined();
    expect(screen.getByText(/No hay cambios disponibles desde Realizada/)).toBeDefined();
    expect(screen.queryByLabelText("Cambiar a")).toBeNull();
  });
});

describe("detalles visibles con contrato conservado (TI2-115)", () => {
  test("la reagendada muestra la fecha original conservada y el estado", async () => {
    const port = puertoAgendaBase();
    port.getAppointment = () =>
      Promise.resolve({
        status: "ok",
        appointment: {
          ...ATENCION_BASE,
          status: "rescheduled",
          startAt: ATENCION_BASE.endAt,
          originalStartAt: ATENCION_BASE.startAt,
        },
      });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByText("Reagendada")).toBeDefined();
    expect(screen.getByText("Fecha original conservada")).toBeDefined();
  });

  test("la cancelación por CERETI conserva el motivo propio sin notas internas", async () => {
    const port = puertoAgendaBase();
    port.getAppointment = () =>
      Promise.resolve({
        status: "ok",
        appointment: {
          ...ATENCION_BASE,
          status: "cancelled_by_cereti",
          cancelReason: "Jornada de capacitación del equipo.",
        },
      });
    comoProfesional(port);
    renderAt("/profesional/agenda/aten-ficticio-1");

    expect(await screen.findByText("Cancelada por CERETI")).toBeDefined();
    expect(screen.getByText("Jornada de capacitación del equipo.")).toBeDefined();
  });
});

describe("navegación del portal con agenda (TI2-115)", () => {
  test("la agenda queda enlazada conservando enlaces visibles y operables", async () => {
    comoProfesional();
    renderAt("/profesional/agenda");

    const nav = await screen.findByRole("navigation", { name: "Portal del Profesional" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Inicio",
      "Solicitudes",
      "Agenda",
      "Disponibilidad",
      "Sesión",
    ]);
    for (const link of links) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
  });

  test("cada fila navega al detalle de su atención", async () => {
    comoProfesional();
    const { router } = renderAt("/profesional/agenda");

    const fila = await screen.findByRole("link", { name: /Programada/ });
    fireEvent.click(fila);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/profesional/agenda/aten-ficticio-1"),
    );
    expect(await screen.findByRole("heading", { name: "Detalle de la atención" })).toBeDefined();
  });
});

describe("guards de la agenda (TI2-115)", () => {
  test("sin sesión la agenda redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/profesional/agenda");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({ redirect: "/profesional/agenda" });
    expect(screen.queryByRole("heading", { name: "Agenda" })).toBeNull();
  });

  test("sin sesión el detalle también redirige al acceso", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/profesional/agenda/aten-ficticio-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/profesional/agenda/aten-ficticio-1",
    });
    expect(screen.queryByRole("heading", { name: "Detalle de la atención" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido de la agenda", async () => {
    mockedSession = SESION_INTERN;
    mockedPair = PAR_INTERN;
    const { router } = renderAt("/profesional/agenda");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Agenda" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido del detalle", async () => {
    mockedSession = SESION_INTERN;
    mockedPair = PAR_INTERN;
    const { router } = renderAt("/profesional/agenda/aten-ficticio-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Detalle de la atención" })).toBeNull();
  });
});
