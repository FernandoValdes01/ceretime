import { useEffect, useRef, useState, type KeyboardEvent } from "react";

export type RowMenuItem = {
  readonly label: string;
  readonly onSelect: () => void;
  readonly disabled?: boolean;
  /** La opción abre un diálogo: se anuncia para que no sorprenda. */
  readonly hasPopup?: boolean;
};

/**
 * Menú de acciones de una fila de administración (TI2-169).
 *
 * Botón de tres puntos verticales que abre las acciones de la fila: anuncia
 * `aria-haspopup="menu"`, mueve el foco a la primera opción al abrir, se
 * recorre con flechas, se cierra con Escape o Tab y devuelve el foco al botón
 * al cerrar o elegir. Las etiquetas de las opciones ya nombran su objetivo,
 * así el lector anuncia la acción completa.
 */
export function RowMenu({
  label,
  items,
  disabled = false,
}: {
  label: string;
  items: ReadonlyArray<RowMenuItem>;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Cierra con un toque fuera mientras está abierto.
  useEffect(() => {
    if (!open) {
      return;
    }
    function onPointerDown(event: PointerEvent) {
      const root = panelRef.current?.parentElement;
      if (root !== undefined && root !== null && !root.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Al abrir, el foco va a la primera opción disponible.
  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }
  }, [open]);

  function closeAndRefocus() {
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [],
    );
    const current = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndRefocus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      options[(current + 1) % options.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      options[(current - 1 + options.length) % options.length]?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="row-menu">
      <button
        ref={buttonRef}
        type="button"
        className="row-menu__button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="3" r="1.6" />
          <circle cx="8" cy="8" r="1.6" />
          <circle cx="8" cy="13" r="1.6" />
        </svg>
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="menu"
          aria-label={label}
          className="row-menu__panel"
          onKeyDown={onPanelKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className="row-menu__item"
              disabled={item.disabled}
              aria-haspopup={item.hasPopup === true ? "dialog" : undefined}
              onClick={() => {
                closeAndRefocus();
                item.onSelect();
              }}
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
