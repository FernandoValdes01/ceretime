import { useEffect, useRef, useState } from "react";
import { useAccessibility } from "./accessibility-context.ts";
import type { TextSize } from "./accessibility-context.ts";
import "./accessibility.css";

const TEXT_SIZE_OPTIONS: { id: TextSize; label: string }[] = [
  { id: "normal", label: "Normal" },
  { id: "grande", label: "Grande" },
  { id: "muy-grande", label: "Muy grande" },
];

/**
 * Botón y panel de accesibilidad (rescate del mockup v0).
 *
 * Sin dependencias de iconos: controles de texto con objetivos de 44 px,
 * cierre con Escape o clic fuera y retorno del foco al botón.
 */
export function AccessibilityMenu() {
  const [open, setOpen] = useState(false);
  const {
    textSize,
    setTextSize,
    highContrast,
    toggleHighContrast,
    readAloud,
    toggleReadAloud,
    increaseText,
    decreaseText,
  } = useAccessibility();

  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (
        panelRef.current &&
        !panelRef.current.contains(event.target as Node) &&
        !buttonRef.current?.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open ]);

  return (
    <div className="a11y-wrap">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="Opciones de accesibilidad"
        className="a11y-button"
      >
        <span className="a11y-mark" aria-hidden="true">
          Aa
        </span>
        <span className="a11y-label">Accesibilidad</span>
      </button>

      {open ? (
        <div ref={panelRef} role="dialog" aria-label="Opciones de accesibilidad" className="a11y-panel">
          <div className="a11y-panel-head">
            <h2>Accesibilidad</h2>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar opciones de accesibilidad"
              className="a11y-icon-btn"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>

          <fieldset className="a11y-field">
            <legend>Tamaño del texto</legend>
            <div className="a11y-size-row">
              <button
                type="button"
                onClick={decreaseText}
                aria-label="Reducir tamaño del texto"
                className="a11y-step-btn"
              >
                <span aria-hidden="true">A−</span>
              </button>
              <div className="a11y-size-group" role="radiogroup" aria-label="Nivel de tamaño del texto">
                {TEXT_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={textSize === option.id}
                    onClick={() => setTextSize(option.id)}
                    className={["a11y-size-opt", textSize === option.id ? "is-active" : ""].join(" ")}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={increaseText}
                aria-label="Aumentar tamaño del texto"
                className="a11y-step-btn"
              >
                <span aria-hidden="true">A+</span>
              </button>
            </div>
          </fieldset>

          <div className="a11y-toggles">
            <ToggleRow
              active={highContrast}
              onToggle={toggleHighContrast}
              label="Alto contraste"
            />
            <ToggleRow
              active={readAloud}
              onToggle={toggleReadAloud}
              label="Lectura en voz alta"
              hint="Al activarla, toca un texto para escucharlo."
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToggleRow({
  active,
  onToggle,
  label,
  hint,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onToggle}
      className={["a11y-toggle", active ? "is-active" : ""].join(" ")}
    >
      <span className="a11y-toggle-text">
        <span className="a11y-toggle-label">{label}</span>
        {hint ? <span className="a11y-toggle-hint">{hint}</span> : null}
      </span>
      <span className="a11y-switch" aria-hidden="true">
        <span className="a11y-knob">{active ? "✓" : ""}</span>
      </span>
    </button>
  );
}
