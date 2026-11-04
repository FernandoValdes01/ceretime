// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createAppRouter } from "../routes/router.tsx";
import type { WebSessionRole, WebSessionState } from "../session/session-state.ts";

/**
 * Pruebas del formulario de reserva del Estudiante (TI2-102, estados y
 * cancelación TI2-113).
 *
 * Integración por el router real (incluye guards). El adaptador se mockea
 * por módulo con promesas controladas; el cableado real lo cubren `tsc`, el
 * build y la verificación manual. Todos los datos son ficticios.
 */

let mockedSession: WebSessionState;
let mockedPair:
  | {
      session: WebSessionState;
      role: WebSessionRole;
    }
  | undefined;
let mockedBackendConfigured = true;

const searchSlotsMock = vi.fn();
const reserveSlotMock = vi.fn();
const cancelReservationMock = vi.fn();

vi.mock("convex/react", () => ({ useQuery: () => mockedSession }));

vi.mock("../session/session-state", () => ({
  useSessionState: () => mockedSession,
  useSessionAndRole: () => mockedPair,
}));

vi.mock("./student-booking-context.tsx", () => {
  const context = { accompanimentId: "acompanamiento-1", professionalIds: ["pro-1"] };
  return {
    BookingContextGate: ({ children }: { children: (value: typeof context) => ReactNode }) =>
      children(context),
  };
});

vi.mock("../../infrastructure/agenda/convex-agenda-adapter.ts", () => ({
  createConvexAgendaAdapter: () => ({
    searchSlots: searchSlotsMock,
    reserveSlot: reserveSlotMock,
    cancelReservation: cancelReservationMock,
  }),
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

function cupoFicticio() {
  return {
    id: "cupo-1",
    professionalId: "pro-ficticio-1",
    date: "2026-10-20",
    startAt: 1760925600000,
    endAt: 1760929200000,
    modality: "inPerson" as const,
    spaceLabel: "Campus Norte · Edificio A · Piso 1 · Sala 101",
  };
}

/** Confirmación ficticia del comprobante (fixture de TI2-102). */
function reservaFicticia() {
  return {
    id: "reserva-ficticia-cupo-1",
    slotId: "cupo-1",
    professionalId: "pro-ficticio-1",
    modality: "inPerson",
    startAt: 1760925600000,
    endAt: 1760929200000,
  };
}

beforeEach(() => {
  vi.stubEnv("VITE_CONVEX_URL", "https://test.convex.cloud");
  vi.stubEnv("VITE_CONVEX_SITE_URL", "https://test.convex.site");
  sessionStorage.clear();
  mockedSession = undefined;
  mockedPair = undefined;
  mockedBackendConfigured = true;
  searchSlotsMock.mockReset();
  reserveSlotMock.mockReset();
  cancelReservationMock.mockReset();
  searchSlotsMock.mockResolvedValue({ status: "ok", slots: [cupoFicticio()] });
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

describe("formulario de reserva (TI2-102)", () => {
  test("muestra el resumen y exige confirmación explícita", async () => {
    comoEstudiante();
    renderAt("/estudiante/reservar?slotId=cupo-1");

    expect(await screen.findByRole("heading", { name: "Confirmar reserva" })).toBeDefined();
    expect(await screen.findByText("Campus Norte", { exact: false })).toBeDefined();
    const confirmar = screen.getByRole("button", { name: "Confirmar reserva" });
    expect(confirmar.hasAttribute("disabled")).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    expect(confirmar.hasAttribute("disabled")).toBe(false);
  });

  test("éxito muestra confirmación con código y retorno", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({
      status: "confirmed",
      reservation: {
        id: "reserva-ficticia-cupo-1",
        slotId: "cupo-1",
        professionalId: "pro-ficticio-1",
        modality: "inPerson",
        startAt: 1760925600000,
        endAt: 1760929200000,
      },
    });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(reserveSlotMock).toHaveBeenCalledTimes(1);
    expect(reserveSlotMock).toHaveBeenCalledWith({
      slotId: "cupo-1",
      booking: { accompanimentId: "acompanamiento-1", slot: cupoFicticio() },
    });
    const confirmado = await screen.findByRole("heading", { name: "Reserva confirmada" });
    expect(screen.getByText("reserva-ficticia-cupo-1")).toBeDefined();
    // El foco cae una sola vez en el encabezado del estado; la única salida a
    // horarios vive al final de la tarjeta sin duplicarse.
    expect(document.activeElement).toBe(confirmado);
    const volverLinks = screen.getAllByRole("link", { name: "Volver a horarios" });
    expect(volverLinks).toHaveLength(1);
    for (const volver of volverLinks) {
      expect(volver.getAttribute("href")).toBe(
        "/estudiante/horarios?accompanimentId=acompanamiento-1",
      );
    }
  });

  test("fallo conserva la selección y permite reintento", async () => {
    comoEstudiante();
    reserveSlotMock.mockRejectedValueOnce(new Error("No autorizado"));
    reserveSlotMock.mockResolvedValue({
      status: "confirmed",
      reservation: {
        id: "reserva-ficticia-cupo-1",
        slotId: "cupo-1",
        professionalId: "pro-ficticio-1",
        modality: "inPerson",
        startAt: 1760925600000,
        endAt: 1760929200000,
      },
    });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(
      await screen.findByText("No pudimos confirmar la reserva. Inténtalo de nuevo."),
    ).toBeDefined();
    // La selección y el motivo se conservan: el checkbox sigue marcado.
    const casilla = screen.getByRole("checkbox", { name: /Confirmo que deseo reservar/ });
    expect((casilla as HTMLInputElement).checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(reserveSlotMock).toHaveBeenCalledTimes(2);
  });

  test("doble envío llama una sola vez", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({
      status: "confirmed",
      reservation: {
        id: "reserva-ficticia-cupo-1",
        slotId: "cupo-1",
        professionalId: "pro-ficticio-1",
        modality: "inPerson",
        startAt: 1760925600000,
        endAt: 1760929200000,
      },
    });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    const confirmar = screen.getByRole("button", { name: "Confirmar reserva" });
    fireEvent.click(confirmar);
    fireEvent.click(confirmar);

    expect(reserveSlotMock).toHaveBeenCalledTimes(1);
  });

  test("error tipado muestra mensaje y permite reintento conservando todo", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({
      status: "error",
      error: { code: "conflict", message: "El cupo ya fue tomado." },
    });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    expect(await screen.findByText("El cupo ya fue tomado.")).toBeDefined();
    const casilla = screen.getByRole("checkbox", { name: /Confirmo que deseo reservar/ });
    expect((casilla as HTMLInputElement).checked).toBe(true);

    reserveSlotMock.mockResolvedValue({
      status: "confirmed",
      reservation: {
        id: "reserva-ficticia-cupo-1",
        slotId: "cupo-1",
        professionalId: "pro-ficticio-1",
        modality: "inPerson",
        startAt: 1760925600000,
        endAt: 1760929200000,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(reserveSlotMock).toHaveBeenCalledTimes(2);
  });

  test("cambio de cupo antes de confirmar reinicia el formulario", async () => {
    comoEstudiante();
    searchSlotsMock.mockResolvedValue({
      status: "ok",
      slots: [
        cupoFicticio(),
        {
          ...cupoFicticio(),
          id: "cupo-2",
          modality: "online" as const,
          spaceLabel: undefined,
        },
      ],
    });
    const { router } = renderAt("/estudiante/reservar?slotId=cupo-1");

    const casilla = await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ });
    fireEvent.click(casilla);
    expect((casilla as HTMLInputElement).checked).toBe(true);

    await act(async () => {
      router.history.push("/estudiante/reservar?slotId=cupo-2");
    });

    const casillaNueva = await screen.findByRole("checkbox", {
      name: /Confirmo que deseo reservar/,
    });
    expect((casillaNueva as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();
  });

  test("envío pendiente no actualiza el cupo nuevo al resolverse", async () => {
    comoEstudiante();
    searchSlotsMock.mockResolvedValue({
      status: "ok",
      slots: [
        cupoFicticio(),
        {
          ...cupoFicticio(),
          id: "cupo-2",
          modality: "online" as const,
          spaceLabel: undefined,
        },
      ],
    });
    let resolveReserve!: (value: unknown) => void;
    reserveSlotMock.mockImplementation(
      () => new Promise((resolve) => (resolveReserve = resolve as (value: unknown) => void)),
    );
    const { router } = renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    await act(async () => {
      router.history.push("/estudiante/reservar?slotId=cupo-2");
    });
    expect(
      await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }),
    ).toBeDefined();

    await act(async () => {
      resolveReserve({
        status: "confirmed",
        reservation: {
          id: "reserva-ficticia-cupo-1",
          slotId: "cupo-1",
          professionalId: "pro-ficticio-1",
          modality: "inPerson",
          startAt: 1760925600000,
          endAt: 1760929200000,
        },
      });
    });

    expect(screen.queryByRole("heading", { name: "Reserva confirmada" })).toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar reserva" })).toBeDefined();
  });

  test("fallo de lectura muestra error con reintento conservando slotId", async () => {
    comoEstudiante();
    searchSlotsMock.mockRejectedValueOnce(new Error("caída de red"));
    searchSlotsMock.mockResolvedValue({ status: "ok", slots: [cupoFicticio()] });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    expect(await screen.findByText("No pudimos cargar el cupo. Inténtalo de nuevo.")).toBeDefined();
    expect(screen.queryByText("Cupo no disponible.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }),
    ).toBeDefined();
  });

  test("reintento pendiente muestra carga y no cupo ausente", async () => {
    comoEstudiante();
    searchSlotsMock.mockRejectedValueOnce(new Error("caída de red"));
    let resolveRetry!: (value: unknown) => void;
    searchSlotsMock.mockImplementationOnce(
      () => new Promise((resolve) => (resolveRetry = resolve as (value: unknown) => void)),
    );
    searchSlotsMock.mockResolvedValue({ status: "ok", slots: [cupoFicticio()] });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    expect(await screen.findByText("No pudimos cargar el cupo. Inténtalo de nuevo.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Cargando el cupo…")).toBeDefined();
    expect(screen.queryByText("Cupo no disponible.")).toBeNull();

    await act(async () => {
      resolveRetry({ status: "ok", slots: [cupoFicticio()] });
    });
    expect(
      await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }),
    ).toBeDefined();
  });

  test("respuesta de error de lectura muestra error con reintento", async () => {
    comoEstudiante();
    searchSlotsMock.mockResolvedValueOnce({ status: "error", message: "Fallo interno." });
    searchSlotsMock.mockResolvedValue({ status: "ok", slots: [cupoFicticio()] });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    expect(await screen.findByText("No pudimos cargar el cupo. Inténtalo de nuevo.")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(
      await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }),
    ).toBeDefined();
  });

  test("sin cupo muestra mensaje y vuelta sin formulario", async () => {
    comoEstudiante();
    renderAt("/estudiante/reservar");

    expect(await screen.findByText("Cupo no disponible.")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).toBeNull();
    const volver = screen.getByRole("link", { name: "Volver a horarios" });
    expect(volver.getAttribute("href")).toBe(
      "/estudiante/horarios?accompanimentId=acompanamiento-1",
    );
  });

  test("cupo inexistente muestra mensaje y vuelta", async () => {
    comoEstudiante();
    searchSlotsMock.mockResolvedValue({ status: "ok", slots: [] });
    renderAt("/estudiante/reservar?slotId=cupo-ajeno");

    expect(await screen.findByText("Cupo no disponible.")).toBeDefined();
  });
});

describe("conflicto, denegación y cancelación visible (TI2-113)", () => {
  test("conflicto conserva la selección y el reintento repite el mismo comando", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "conflict", code: "conflict" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    // Un solo elemento anunciable con el texto canónico del contrato y una
    // salida clara de la comprensible para elegir otro horario.
    await screen.findByRole("alert");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    const alerta = screen.getByRole("alert");
    expect(alerta.textContent).toContain("La solicitud entra en conflicto con el estado actual.");
    const salida = screen.getByRole("link", { name: "Elegir otro horario" });
    expect(salida.getAttribute("href")).toBe(
      "/estudiante/horarios?accompanimentId=acompanamiento-1",
    );

    // La selección sigue íntegra y sin botón alternativo: el mismo comando de
    // reserva vuelve a intentarse, sin rehacer búsqueda ni formulario.
    const casilla = screen.getByRole("checkbox", { name: /Confirmo que deseo reservar/ });
    expect((casilla as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

    reserveSlotMock.mockResolvedValue({ status: "confirmed", reservation: reservaFicticia() });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    expect(reserveSlotMock).toHaveBeenCalledTimes(2);
    for (const llamada of reserveSlotMock.mock.calls) {
      expect(llamada).toEqual([
        {
          slotId: "cupo-1",
          booking: { accompanimentId: "acompanamiento-1", slot: cupoFicticio() },
        },
      ]);
    }
  });

  test("denegación de la reserva es permanente y sin reintento", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "denied" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    // El foco no se pierde al desaparecer el botón: el encabezado del panel
    // lo recoge y es el único anuncio de este desenlace (sin alerta extra).
    const denegado = await screen.findByRole("heading", {
      name: "No tienes acceso a esta reserva.",
    });
    expect(document.activeElement).toBe(denegado);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(reserveSlotMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();

    const volverLinks = screen.getAllByRole("link", { name: "Volver a horarios" });
    expect(volverLinks).toHaveLength(1);
    for (const volver of volverLinks) {
      expect(volver.getAttribute("href")).toBe(
        "/estudiante/horarios?accompanimentId=acompanamiento-1",
      );
    }
  });

  test("falta de cupo tras el comando muestra la coordinación por canal oficial", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "no_availability", code: "no_availability" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));

    // El foco también recibe este desenlace: encabezado del panel y mensaje
    // canónico, sin ningún anuncio duplicado.
    const sinCupo = await screen.findByRole("heading", { name: "Cupo no disponible." });
    expect(document.activeElement).toBe(sinCupo);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("Sin cupo disponible.", { exact: false })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Confirmar reserva" })).toBeNull();

    const volverLinks = screen.getAllByRole("link", { name: "Volver a horarios" });
    expect(volverLinks).toHaveLength(1);
    for (const volver of volverLinks) {
      expect(volver.getAttribute("href")).toBe(
        "/estudiante/horarios?accompanimentId=acompanamiento-1",
      );
    }
  });

  test("cancelación visible muestra el resultado tipado sin aviso de demostración", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "confirmed", reservation: reservaFicticia() });
    cancelReservationMock.mockResolvedValue({ status: "cancelled" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    expect(await screen.findByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar esta reserva" }));

    expect(await screen.findByRole("heading", { name: "Reserva cancelada" })).toBeDefined();
    // Tras cancelar el encabezado del estado queda con el foco y es la única
    // salida a horarios de la tarjeta.
    const cancelado = screen.getByRole("heading", { name: "Reserva cancelada" });
    expect(document.activeElement).toBe(cancelado);
    expect(screen.queryByText(/demostración/)).toBeNull();
    expect(screen.getByText("reserva-ficticia-cupo-1")).toBeDefined();
    expect(cancelReservationMock).toHaveBeenCalledTimes(1);
    expect(cancelReservationMock).toHaveBeenCalledWith({
      reservationId: "reserva-ficticia-cupo-1",
    });
    // La cancelación visible no repite el comando de reserva.
    expect(reserveSlotMock).toHaveBeenCalledTimes(1);
  });

  test("denegación de la cancelación es permanente y sin botón", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "confirmed", reservation: reservaFicticia() });
    cancelReservationMock.mockResolvedValue({ status: "denied" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar esta reserva" }));

    // El foco no se pierde al desaparecer el botón de cancelación: el
    // encabezado del panel lo recoge como anuncio único del desenlace.
    const denegadoCancel = await screen.findByRole("heading", {
      name: "No tienes acceso a esta reserva.",
    });
    expect(document.activeElement).toBe(denegadoCancel);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(cancelReservationMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Cancelar esta reserva" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Reserva confirmada" })).toBeDefined();
  });

  test("fallo técnico de la cancelación conserva el comprobante y permite reintentar", async () => {
    comoEstudiante();
    reserveSlotMock.mockResolvedValue({ status: "confirmed", reservation: reservaFicticia() });
    cancelReservationMock.mockRejectedValueOnce(new Error("caída de red"));
    cancelReservationMock.mockResolvedValue({ status: "cancelled" });
    renderAt("/estudiante/reservar?slotId=cupo-1");

    fireEvent.click(await screen.findByRole("checkbox", { name: /Confirmo que deseo reservar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar reserva" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar esta reserva" }));

    expect(
      await screen.findByText("No pudimos cancelar la reserva. Inténtalo de nuevo."),
    ).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Cancelar esta reserva" }));
    expect(await screen.findByRole("heading", { name: "Reserva cancelada" })).toBeDefined();
    expect(cancelReservationMock).toHaveBeenCalledTimes(2);
    for (const llamada of cancelReservationMock.mock.calls) {
      expect(llamada).toEqual([{ reservationId: "reserva-ficticia-cupo-1" }]);
    }
  });
});

describe("guard del formulario (TI2-102)", () => {
  test("sin sesión redirige al acceso conservando el retorno", async () => {
    mockedSession = SIN_SESION;
    mockedPair = PAR_SIN_SESION;
    const { router } = renderAt("/estudiante/reservar?slotId=cupo-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toMatchObject({
      redirect: "/estudiante/reservar?slotId=cupo-1",
    });
    expect(screen.queryByRole("heading", { name: "Confirmar reserva" })).toBeNull();
  });

  test("otro rol va a denegado sin contenido del formulario", async () => {
    mockedSession = SESION_PERSONAL;
    mockedPair = PAR_PROFESIONAL;
    const { router } = renderAt("/estudiante/reservar?slotId=cupo-1");

    await waitFor(() => expect(router.state.location.pathname).toBe("/denegado"));
    expect(screen.queryByRole("heading", { name: "Confirmar reserva" })).toBeNull();
  });
});
