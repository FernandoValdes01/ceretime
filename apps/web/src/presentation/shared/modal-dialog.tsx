import { useEffect, useEffectEvent, useId, useRef, type ReactNode, type RefObject } from "react";

const FOCUSABLE =
  'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo modal accesible de la Web (TI2-153).
 *
 * Se monta solo mientras está abierto. Al abrir lleva el foco a
 * `initialFocusRef` (o al primer control), mantiene Tab en ambos sentidos dentro
 * del diálogo y cierra con Escape salvo mientras `busy` indica una operación
 * en curso. Al desmontarse devuelve el foco a `returnFocusRef` cuando existe
 * y sigue en el documento, o al elemento que tenía el foco al abrir. Si ese
 * elemento también desapareció (el contenido detrás cambió mientras estaba
 * abierto), usa `fallbackFocusRef` para que el foco no caiga en `<body>`.
 *
 * Usa `role="dialog"` en vez de `<dialog>.showModal()` porque jsdom no lo
 * implementa y las pruebas no podrían recorrer el foco.
 */
export function ModalDialog({
  title,
  description,
  onClose,
  busy = false,
  initialFocusRef,
  returnFocusRef,
  fallbackFocusRef,
  children,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  busy?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  // Se lee al desmontar: el destino que eligió el consumidor al cerrar, no el del primer render.
  const returnFocusTarget = useEffectEvent(() => returnFocusRef?.current ?? null);
  const fallbackFocusTarget = useEffectEvent(() => fallbackFocusRef?.current ?? null);

  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const initial =
      initialFocusRef?.current ?? dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    initial?.focus();
    return () => {
      const target = returnFocusTarget();
      if (target?.isConnected) {
        target.focus();
      } else if (opener?.isConnected) {
        opener.focus();
      } else {
        fallbackFocusTarget()?.focus();
      }
    };
    // Solo al abrir y al cerrar: el foco inicial no se vuelve a calcular en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      if (!busy) onClose();
      return;
    }
    if (event.key !== "Tab" || dialogRef.current === null) {
      return;
    }
    const focusableElements = Array.from(
      dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusableElements[0];
    const last = focusableElements[focusableElements.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        onKeyDown={handleKeyDown}
        className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto rounded-lg border border-border-low bg-surface-container-lowest p-6 text-left text-on-surface shadow-[0_4px_12px_rgb(0_0_0/0.05)]"
      >
        <h2 id={titleId} className="m-0! font-sans! text-xl! leading-snug! font-semibold!">
          {title}
        </h2>
        {description === undefined ? null : (
          <div id={descriptionId} className="text-base text-on-surface-variant">
            {description}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
