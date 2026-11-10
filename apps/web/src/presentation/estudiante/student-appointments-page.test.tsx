// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";
import type { Space } from "../../../../../convex/domain/index.ts";
import { formatAppointmentInstant } from "./agenda-labels.ts";

/**
 * Pruebas de la lista y el detalle de atenciones propias del Estudiante
 * (TI2-114).
 *
 * Integración por el router real (incluye el guard y la nav del portal). El
 * puerto vigente se simula en `getAgendaPort`, sin depender del adaptador que
 * lo implemente, y la respuesta simulada puede traer el motivo de cancelación
 * de la vista profesional: la prueba verifica que la pantalla no lo muestre,
 * como corresponde a la vista `shared` de TI2-112. El cableado real del puerto
 * lo cubren las pruebas del adaptador, `tsc` y el build. Los datos de estas
 * pruebas son ficticios; la página lee la API real desde TI2-123 y no muestra
 * aviso de demostración.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;

const listAppointmentsMock = vi.fn();
const getAppointmentMock = vi.fn();
const listSpacesMock = vi.fn();

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./schedule-search-data.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./schedule-search-data.ts")>()),
  getAgendaPort: () => ({
    listAppointments: listAppointmentsMock,
    getAppointment: getAppointmentMock,
    listSpaces: listSpacesMock,
  }),
}));

vi.mock("../../infrastructure/auth/auth-client", () => ({
  authClient: { useSession: () => ({ isPending: false }) },
}));

vi.mock("../../infrastructure/convex/convex-client", () => ({
  convexUrl: "https://test.convex.cloud",
  convexSiteUrl: "https://test.convex.site",
  get isBackendConfigured() {
    return true;
  },
  convexClient: {},
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

const SESION_PERSONAL: WebSessionState = {
  status: "authenticated",
  email: "pro@uct.cl",
  name: "Profesional Ficticio",
  population: "personal",
};

const PAR_PROFESIONAL = {
  session: SESION_PERSONAL,
  role: { status: "authenticated", role: "professional", email: "pro@uct.cl" },
} as const;

const SIN_SESION: WebSessionState = { status: "unauthenticated" };

const PAR_SIN_SESION = {
  session: SIN_SESION,
  role: { status: "unauthenticated" },
} as const;

/**
 * Atenciones ficticias del escenario (fixtures de TI2-114): una para cada
 * estado textual que el Estudiante debe reconocer, con instantes estables en
 * UTC por prueba. La cancelación por CERETI lleva el motivo de la vista
 * profesional a propósito, para probar que la vista del Estudiante no lo
 * muestra.
 */
const ATENCIONES_FICTICIAS: ReadonlyArray<AgendaAppointment> = [
  {
    id: "at-est-1",
    status: "scheduled",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: Date.UTC(2026, 9, 12, 14, 0),
    endAt: Date.UTC(2026, 9, 12, 15, 0),
  },
  {
    id: "at-est-2",
    status: "completed",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: Date.UTC(2026, 9, 5, 14, 0),
    endAt: Date.UTC(2026, 9, 5, 15, 0),
  },
  {
    id: "at-est-3",
    status: "rescheduled",
    modality: "online",
    startAt: Date.UTC(2026, 9, 19, 16, 0),
    endAt: Date.UTC(2026, 9, 19, 17, 0),
    originalStartAt: Date.UTC(2026, 9, 12, 16, 0),
  },
  {
    id: "at-est-4",
    status: "cancelled_by_student",
    modality: "online",
    startAt: Date.UTC(2026, 8, 28, 14, 0),
    endAt: Date.UTC(2026, 8, 28, 15, 0),
  },
  {
    id: "at-est-5",
    status: "cancelled_by_cereti",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: Date.UTC(2026, 8, 21, 14, 0),
    endAt: Date.UTC(2026, 8, 21, 15, 0),
    cancelReason: "Jornada de capacitación del equipo.",
  },
  {
    id: "at-est-6",
    status: "no_show",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: Date.UTC(2026, 8, 14, 14, 0),
    endAt: Date.UTC(2026, 8, 14, 15, 0),
  },
  {
    id: "at-est-7",
    status: "no_show_justified",
    modality: "inPerson",
    spaceId: "esp-1",
    startAt: Date.UTC(2026, 7, 31, 14, 0),
    endAt: Date.UTC(2026, 7, 31, 15, 0),
  },
  {
    id: "at-est-8",
    status: "no_show_unjustified",
    modality: "inPerson",
    spaceId: "esp-2",
    startAt: Date.UTC(2026, 7, 24, 14, 0),
    endAt: Date.UTC(2026, 7, 24, 15, 0),
  },
];

const ESPACIO_FICTICIO: Space = {
  id: "esp-1",
  campus: "Campus San Juan Pablo II",
  building: "Edificio A",
  floor: "Piso 1",
  room: "Sala 101",
  accessConditions: "Acceso con rampa.",
  arrivalInstructions: "Entrar por el acceso principal.",
  version: "v1",
};

const SEGUNDO_ESPACIO_FICTICIO: Space = { ...ESPACIO_FICTICIO, id: "esp-2", room: "Sala 102" };

const AVISO_SALA = "No pudimos cargar la información de la sala. Inténtalo de nuevo.";

/** Promesa resuelta a mano, para observar el estado mientras la lectura sigue en curso. */
function lecturaEnCurso<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/**
 * Pulsa un botón como lo haría el teclado: primero recibe el foco. Así la
 * prueba detecta si el foco queda en `document.body` cuando el botón
 * desaparece, en vez de pasar porque el título ya tenía el foco al montar.
 */
function pulsarConFoco(name: string) {
  const control = screen.getByRole("button", { name });
  control.focus();
  expect(document.activeElement).toBe(control);
  fireEvent.click(control);
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  listAppointmentsMock.mockReset();
  getAppointmentMock.mockReset();
  listSpacesMock.mockReset();
  listAppointmentsMock.mockResolvedValue({
    status: "ok",
    appointments: ATENCIONES_FICTICIAS,
  });
  getAppointmentMock.mockImplementation((appointmentId: string) => {
    const found = ATENCIONES_FICTICIAS.find((item) => item.id === appointmentId);
    return found === undefined
      ? Promise.resolve({ status: "denied" })
      : Promise.resolve({ status: "ok", appointment: found });
  });
  listSpacesMock.mockResolvedValue({
    status: "ok",
    spaces: [ESPACIO_FICTICIO, SEGUNDO_ESPACIO_FICTICIO],
  });
});

afterEach(() => {
  cleanup();
});

function renderAt(path: string) {
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const view = render(<RouterProvider router={router} />);
  return { router, unmount: view.unmount };
}

function comoEstudiante() {
  mockedSession = SESION_ESTUDIANTE;
  mockedPair = PAR_ESTUDIANTE;
}

describe("lista de atenciones propias (TI2-114)", () => {
  test("muestra estados textuales de atención e inasistencia con filas enlazadas", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones");

    const titulo = await screen.findByRole("heading", { name: "Atenciones" });
    expect(document.activeElement).toBe(titulo);
    expect(screen.getByText("Programada")).toBeDefined();
    expect(screen.getByText("Realizada")).toBeDefined();
    expect(screen.getByText("Reagendada")).toBeDefined();
    expect(screen.getByText("Cancelada por el Estudiante")).toBeDefined();
    expect(screen.getByText("Cancelada por CERETI")).toBeDefined();
    expect(screen.getByText("Inasistencia pendiente")).toBeDefined();
    expect(screen.getByText("Inasistencia justificada")).toBeDefined();
    expect(screen.getByText("Inasistencia no justificada")).toBeDefined();
    expect(screen.getAllByText("Presencial").length).toBeGreaterThan(0);
    expect(screen.getAllByText("En línea").length).toBeGreaterThan(0);
    expect(screen.getAllByText("America/Santiago", { exact: false }).length).toBeGreaterThan(0);
    const filas = screen.getAllByRole("link", { name: /Ver detalle/ });
    expect(filas).toHaveLength(ATENCIONES_FICTICIAS.length);
    for (const fila of filas) {
      expect(fila.getAttribute("href")).toContain("/estudiante/atenciones/");
    }
  });

  test("declara el período que cubre la lista, sin aviso de demostración", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones");

    expect(
      await screen.findByText(
        "Revisa tus atenciones de los últimos 45 días y los próximos 46, con el estado de cada una.",
      ),
    ).toBeDefined();
    expect(await screen.findByText("Realizada")).toBeDefined();
    expect(screen.queryByText(/ficticios|demostración/iu)).toBeNull();
  });

  test("el estado vacío se acota al período de la lista", async () => {
    comoEstudiante();
    listAppointmentsMock.mockResolvedValue({ status: "empty" });
    renderAt("/estudiante/atenciones");

    expect(
      await screen.findByText("No tienes atenciones en los últimos 45 días y los próximos 46."),
    ).toBeDefined();
    expect(screen.queryByText("Aún no tienes atenciones.")).toBeNull();
    expect(screen.queryByRole("link", { name: /Ver detalle/ })).toBeNull();
  });

  test("denegación de la lectura es genérica sin detalles", async () => {
    comoEstudiante();
    listAppointmentsMock.mockResolvedValue({ status: "denied" });
    renderAt("/estudiante/atenciones");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Presencial")).toBeNull();
  });

  test("fallo técnico de la lectura permite reintentar", async () => {
    comoEstudiante();
    listAppointmentsMock.mockRejectedValueOnce(new Error("caída de red"));
    renderAt("/estudiante/atenciones");

    expect(
      await screen.findByText("No pudimos cargar tus atenciones. Inténtalo de nuevo."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Realizada")).toBeDefined();
    expect(listAppointmentsMock).toHaveBeenCalledTimes(2);
  });

  test("error tipado de la lectura muestra el mensaje con reintento", async () => {
    comoEstudiante();
    listAppointmentsMock.mockResolvedValueOnce({ status: "error", message: "Fallo interno." });
    renderAt("/estudiante/atenciones");

    expect(await screen.findByText("Fallo interno.")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Realizada")).toBeDefined();
  });

  test("el reintento vuelve a la carga sin conservar el error y deja el foco en el título", async () => {
    comoEstudiante();
    const lectura = lecturaEnCurso<unknown>();
    listAppointmentsMock
      .mockResolvedValueOnce({ status: "error", message: "Fallo interno." })
      .mockReturnValueOnce(lectura.promise);
    renderAt("/estudiante/atenciones");

    expect(await screen.findByText("Fallo interno.")).toBeDefined();
    pulsarConFoco("Reintentar");

    expect(await screen.findByText("Cargando tus atenciones…")).toBeDefined();
    expect(screen.queryByText("Fallo interno.")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Atenciones" }));

    lectura.resolve({ status: "ok", appointments: ATENCIONES_FICTICIAS });
    expect(await screen.findByText("Realizada")).toBeDefined();
  });

  test("sin catálogo de salas avisa y su reintento recupera la sala", async () => {
    comoEstudiante();
    listSpacesMock.mockRejectedValueOnce(new Error("caída de red"));
    renderAt("/estudiante/atenciones");

    expect(await screen.findByText(AVISO_SALA)).toBeDefined();
    expect(screen.getByText("Realizada")).toBeDefined();
    pulsarConFoco("Reintentar cargar la sala");

    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Atenciones" }));
    expect((await screen.findAllByText(/Sala 101/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(AVISO_SALA)).toBeNull();
    expect(listSpacesMock).toHaveBeenCalledTimes(2);
  });

  test("con catálogo disponible no muestra aviso de sala", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones");

    expect((await screen.findAllByText(/Sala 102/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(AVISO_SALA)).toBeNull();
  });

  test("cada fila navega al detalle de su atención y deja el foco en el título", async () => {
    comoEstudiante();
    const { router } = renderAt("/estudiante/atenciones");

    const fila = await screen.findByRole("link", { name: /Reagendada/ });
    fireEvent.click(fila);

    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/estudiante/atenciones/at-est-3"),
    );
    const detalle = await screen.findByRole("heading", { name: "Detalle de la atención" });
    expect(document.activeElement).toBe(detalle);
  });
});

describe("detalle de la atención (TI2-114)", () => {
  test("muestra estado, modalidad y la fecha original conservada", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones/at-est-3");

    expect(await screen.findByText("Reagendada")).toBeDefined();
    expect(screen.getByText("En línea")).toBeDefined();
    // La fila muestra el inicio original (12 de octubre), no el nuevo (19 de octubre).
    const fechaOriginal = screen.getByText("Fecha original conservada").nextElementSibling;
    expect(fechaOriginal?.textContent).toBe(formatAppointmentInstant(Date.UTC(2026, 9, 12, 16, 0)));
    expect(fechaOriginal?.textContent).toContain("12 de octubre");
    expect(fechaOriginal?.textContent).not.toContain("19 de octubre");
    expect(screen.queryByText(/ficticios|demostración/iu)).toBeNull();
    expect(screen.getByRole("link", { name: "Volver a tus atenciones" }).getAttribute("href")).toBe(
      "/estudiante/atenciones",
    );
  });

  test("deja el foco en el título del detalle al entrar", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones/at-est-1");

    const detalle = await screen.findByRole("heading", { name: "Detalle de la atención" });
    expect(document.activeElement).toBe(detalle);
    expect(screen.getByText("Programada")).toBeDefined();
  });

  test("no muestra el motivo de cancelación de la vista profesional", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones/at-est-5");

    expect(await screen.findByText("Cancelada por CERETI")).toBeDefined();
    expect(screen.queryByText("Motivo de cancelación")).toBeNull();
    expect(screen.queryByText("Jornada de capacitación del equipo.")).toBeNull();
  });

  test("la inasistencia llega por texto sin plazo de justificación calculado", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones/at-est-6");

    expect(await screen.findByText("Inasistencia pendiente")).toBeDefined();
    expect(screen.queryByText(/días|hábil|plazo/iu)).toBeNull();
  });

  test("atención ajena o desconocida llega como denegación sin filtrar existencia", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones/at-ajena");

    expect(
      await screen.findByText("No autorizado. Pide acceso por el canal oficial si corresponde."),
    ).toBeDefined();
    expect(screen.queryByText("Programada")).toBeNull();
  });

  test("fallo técnico del detalle permite reintentar", async () => {
    comoEstudiante();
    getAppointmentMock.mockRejectedValueOnce(new Error("caída de red"));
    renderAt("/estudiante/atenciones/at-est-1");

    expect(
      await screen.findByText("No pudimos cargar la atención. Inténtalo de nuevo."),
    ).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByText("Programada")).toBeDefined();
    expect(getAppointmentMock).toHaveBeenCalledTimes(2);
  });

  test("el reintento del detalle vuelve a la carga y deja el foco en el título", async () => {
    comoEstudiante();
    const lectura = lecturaEnCurso<unknown>();
    getAppointmentMock
      .mockResolvedValueOnce({ status: "error", message: "Fallo interno." })
      .mockReturnValueOnce(lectura.promise);
    renderAt("/estudiante/atenciones/at-est-1");

    expect(await screen.findByText("Fallo interno.")).toBeDefined();
    pulsarConFoco("Reintentar");

    expect(await screen.findByText("Cargando la atención…")).toBeDefined();
    expect(screen.queryByText("Fallo interno.")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Detalle de la atención" }),
    );

    lectura.resolve({ status: "ok", appointment: ATENCIONES_FICTICIAS[0] });
    expect(await screen.findByText("Programada")).toBeDefined();
  });

  test("una atención presencial sin catálogo avisa y su reintento muestra la sala", async () => {
    comoEstudiante();
    listSpacesMock.mockResolvedValueOnce({ status: "error", message: "Fallo interno." });
    renderAt("/estudiante/atenciones/at-est-1");

    expect(await screen.findByText(AVISO_SALA)).toBeDefined();
    expect(screen.queryByText("Fallo interno.")).toBeNull();
    pulsarConFoco("Reintentar cargar la sala");

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Detalle de la atención" }),
    );
    expect(await screen.findByText(/Sala 101/)).toBeDefined();
    expect(screen.queryByText(AVISO_SALA)).toBeNull();
  });

  test("una atención en línea sin catálogo no avisa por la sala", async () => {
    comoEstudiante();
    listSpacesMock.mockRejectedValue(new Error("caída de red"));
    renderAt("/estudiante/atenciones/at-est-3");

    expect(await screen.findByText("Reagendada")).toBeDefined();
    await waitFor(() => expect(listSpacesMock).toHaveBeenCalled());
    expect(screen.queryByText(AVISO_SALA)).toBeNull();
  });
});

describe("navegación y protección (TI2-114)", () => {
  test("Atenciones queda enlazada en la nav del portal y operable", async () => {
    comoEstudiante();
    renderAt("/estudiante/atenciones");

    const nav = await screen.findByRole("navigation", { name: "Portal del Estudiante" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent?.trim())).toEqual([
      "Inicio",
      "Solicitudes",
      "Horarios",
      "Atenciones",
    ]);
    // La confirmación de reserva necesita el `slotId` que devuelve la
    // búsqueda de horarios: sin él la vista muestra «Cupo no disponible», así
    // que se llega desde Horarios y no se enlaza en el encabezado.
    expect(within(nav).queryByRole("link", { name: "Reservar" })).toBeNull();
    expect(within(nav).getByRole("link", { name: "Atenciones" }).getAttribute("aria-current")).toBe(
      "page",
    );
    for (const link of links) {
      link.focus();
      expect(document.activeElement).toBe(link);
    }
    expect(screen.getByRole("button", { name: "Cerrar sesión" })).toBeDefined();
  });

  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/estudiante/atenciones");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/estudiante/atenciones",
    });
    expect(screen.queryByRole("heading", { name: "Atenciones" })).toBeNull();
  });

  test("otra población va a denegado sin contenido de atenciones", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = PAR_PROFESIONAL;
    const { router } = renderAt("/estudiante/atenciones/at-est-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Detalle de la atención" })).toBeNull();
  });
});
