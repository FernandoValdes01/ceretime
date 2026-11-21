// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, test } from "vitest";
import { ModalDialog } from "./modal-dialog.tsx";

/**
 * Devolución del foco al cerrar el diálogo (TI2-153). El arnés permite quitar
 * el botón que abrió el diálogo mientras sigue abierto, como ocurre cuando la
 * query reactiva cambia el estado de la solicitud detrás del diálogo.
 */
function Harness() {
  const [open, setOpen] = useState(false);
  const [openerVisible, setOpenerVisible] = useState(true);
  const fallbackRef = useRef<HTMLParagraphElement>(null);
  return (
    <>
      <p ref={fallbackRef} tabIndex={-1}>
        Estado estable
      </p>
      {openerVisible ? (
        <button type="button" onClick={() => setOpen(true)}>
          Abrir
        </button>
      ) : null}
      {open ? (
        <ModalDialog
          title="Diálogo de prueba"
          fallbackFocusRef={fallbackRef}
          onClose={() => setOpen(false)}
        >
          <button type="button" onClick={() => setOpenerVisible(false)}>
            Quitar el botón de apertura
          </button>
          <button type="button" onClick={() => setOpen(false)}>
            Cerrar
          </button>
        </ModalDialog>
      ) : null}
    </>
  );
}

afterEach(() => {
  cleanup();
});

describe("ModalDialog", () => {
  test("al cerrar devuelve el foco al botón que lo abrió", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));

    expect(document.activeElement).toBe(opener);
  });

  test("si el botón que lo abrió desapareció, el foco va al respaldo y no a body", () => {
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Abrir" });
    opener.focus();
    fireEvent.click(opener);

    fireEvent.click(screen.getByRole("button", { name: "Quitar el botón de apertura" }));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByText("Estado estable"));
  });
});
