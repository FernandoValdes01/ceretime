// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "./view-states.tsx";

/**
 * Pruebas de los estados de vista comunes (TI2-134).
 *
 * Cada estado dice en texto qué ocurre y cómo seguir, y se anuncia a lectores
 * de pantalla: la carga y el error por `role="status"` y `role="alert"`, y la
 * denegación por `role="alert"`. Ninguno depende solo del color.
 */

afterEach(() => {
  cleanup();
});

describe("estados de vista compartidos", () => {
  test("la carga se anuncia como estado sin bloquear la vista", () => {
    render(<LoadingState label="Cargando la agenda…" />);

    expect(screen.getByRole("status").textContent).toBe("Cargando la agenda…");
  });

  test("el vacío explica por qué no hay datos y qué hacer", () => {
    render(
      <EmptyState title="No tienes atenciones agendadas.">
        <p>Cuando se reserve una atención contigo, aparecerá aquí.</p>
      </EmptyState>,
    );

    expect(screen.getByRole("status").textContent).toContain("No tienes atenciones agendadas.");
    expect(
      screen.getByText("Cuando se reserve una atención contigo, aparecerá aquí."),
    ).toBeDefined();
  });

  test("el error se anuncia y permite reintentar la operación", () => {
    const onRetry = vi.fn();
    render(<ErrorState message="No pudimos cargar la agenda." onRetry={onRetry} />);

    expect(screen.getByRole("alert").textContent).toBe("No pudimos cargar la agenda.");

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("el error sin reintento no ofrece una acción falsa", () => {
    render(<ErrorState message="No pudimos cargar la agenda." />);

    expect(screen.queryByRole("button", { name: "Reintentar" })).toBeNull();
  });

  test("la denegación usa el aviso genérico y una salida clara", () => {
    render(<DeniedState description="Consulta con el Profesional a cargo." />);

    expect(screen.getByRole("alert").textContent).toBe(ACCESS_DENIED_MESSAGE);
    expect(screen.getByText("Consulta con el Profesional a cargo.")).toBeDefined();
  });
});
