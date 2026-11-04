// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { BookingContextGate } from "./student-booking-context.tsx";

/**
 * Contexto de reserva del Estudiante (TI2-123): sin un contexto real no se
 * muestra la búsqueda y nunca se recurre a fixtures. Los datos son ficticios.
 */

let mockedOwned: { page: Array<Record<string, unknown>> } | undefined;
const findBookingProfessional = vi.fn();

vi.mock("convex/react", () => ({ useQuery: () => mockedOwned }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, search }: { children: string; search: { accompanimentId: string } }) => (
    <a href={`/estudiante/horarios?accompanimentId=${search.accompanimentId}`}>{children}</a>
  ),
}));

vi.mock("./schedule-search-data.ts", () => ({
  getAgendaPort: () => ({ findBookingProfessional }),
}));

const ACTIVO = { _id: "acompanamiento-1", status: "active", objective: "Objetivo ficticio uno" };
const OTRO_ACTIVO = {
  _id: "acompanamiento-2",
  status: "active",
  objective: "Objetivo ficticio dos",
};
const PAUSADO = { _id: "acompanamiento-3", status: "paused", objective: "Objetivo ficticio tres" };

function renderGate(requested?: string) {
  render(
    <BookingContextGate requestedAccompanimentId={requested}>
      {(context) => <p>{`${context.accompanimentId} con ${context.professionalId}`}</p>}
    </BookingContextGate>,
  );
}

beforeEach(() => {
  mockedOwned = { page: [ACTIVO] };
  findBookingProfessional.mockReset();
  findBookingProfessional.mockResolvedValue({ status: "ok", professionalId: "pro-1" });
});

afterEach(() => {
  cleanup();
});

describe("BookingContextGate (TI2-123)", () => {
  test("muestra carga mientras se leen los acompañamientos", () => {
    mockedOwned = undefined;
    renderGate();

    expect(screen.getByRole("status").textContent).toBe("Cargando tu acompañamiento…");
    expect(findBookingProfessional).not.toHaveBeenCalled();
  });

  test("con un único activo entrega el contexto sin pedir elección", async () => {
    renderGate();

    expect(await screen.findByText("acompanamiento-1 con pro-1")).toBeDefined();
    expect(findBookingProfessional).toHaveBeenCalledWith("acompanamiento-1");
  });

  test("sin activos explica el requisito y no consulta profesional", () => {
    mockedOwned = { page: [PAUSADO] };
    renderGate();

    expect(screen.getByText("No tienes un acompañamiento activo.")).toBeDefined();
    expect(findBookingProfessional).not.toHaveBeenCalled();
  });

  test("con varios activos pide elegir y respeta el de la URL", async () => {
    mockedOwned = { page: [ACTIVO, OTRO_ACTIVO] };
    renderGate();

    expect(screen.getByRole("link", { name: "Objetivo ficticio dos" }).getAttribute("href")).toBe(
      "/estudiante/horarios?accompanimentId=acompanamiento-2",
    );
    cleanup();

    renderGate("acompanamiento-2");
    expect(await screen.findByText("acompanamiento-2 con pro-1")).toBeDefined();
  });

  test("un identificador que no es propio y activo no se usa", async () => {
    mockedOwned = { page: [ACTIVO, OTRO_ACTIVO] };
    renderGate("ajeno");

    expect(screen.getByRole("heading", { name: "Elige un acompañamiento" })).toBeDefined();
    expect(findBookingProfessional).not.toHaveBeenCalled();
  });

  test("sin profesional disponible no muestra la búsqueda", async () => {
    findBookingProfessional.mockResolvedValue({ status: "none" });
    renderGate();

    expect(
      await screen.findByText("Aún no podemos mostrar horarios de este acompañamiento."),
    ).toBeDefined();
  });

  test("la denegación no revela el motivo", async () => {
    findBookingProfessional.mockResolvedValue({ status: "denied" });
    renderGate();

    expect(await screen.findByText("No tienes acceso a este acompañamiento.")).toBeDefined();
  });

  test("un fallo técnico permite reintentar", async () => {
    findBookingProfessional.mockRejectedValueOnce(new Error("caída de red"));
    renderGate();

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No pudimos cargar tu acompañamiento. Inténtalo de nuevo.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("acompanamiento-1 con pro-1")).toBeDefined();
  });
});
