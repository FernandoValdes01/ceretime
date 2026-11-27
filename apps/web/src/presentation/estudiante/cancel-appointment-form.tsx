import { useEffect, useId, useRef, useState } from "react";
import type { StudentCancellation } from "./student-appointment-changes.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import {
  FOCUS_CLASS,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  fieldClass,
} from "./student-page-classes.ts";

/**
 * Cancelación de una atención por el Estudiante (TI2-113, TI2-163).
 *
 * Única para el comprobante de reserva y el detalle de la atención: pide
 * confirmar antes de cancelar y muestra el motivo como obligatorio solo cuando
 * la transición del dominio lo exige (`requiresReason`); el Backend lo exige de
 * nuevo. Un fallo conserva el motivo escrito y la atención sigue igual; la
 * denegación es permanente y no ofrece reintento.
 */

/** Longitud máxima del motivo: texto breve, sin datos sensibles. */
const REASON_MAX_LENGTH = 500;

const REASON_REQUIRED_MESSAGE = "Escribe el motivo de la cancelación.";
const CANCEL_FALLBACK = "No pudimos cancelar la reserva. Inténtalo de nuevo.";

type CancelFailure = { readonly status: "denied" } | { readonly status: "error"; message: string };

export function CancelAppointmentForm({
  appointmentId,
  cancellation,
  triggerLabel,
  headingLevel,
  onCancelled,
}: {
  appointmentId: string;
  cancellation: StudentCancellation;
  triggerLabel: string;
  /** Nivel de los títulos del formulario, según la sección que lo contiene. */
  headingLevel: "h2" | "h3";
  onCancelled: () => void;
}) {
  const Heading = headingLevel;
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [showReasonError, setShowReasonError] = useState(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<CancelFailure | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deniedRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef(false);
  const ids = useId();
  const reasonId = `${ids}-reason`;
  const reasonHintId = `${ids}-reason-hint`;
  const reasonErrorId = `${ids}-reason-error`;
  const titleId = `${ids}-title`;

  useEffect(() => {
    if (open) {
      titleRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    // La denegación reemplaza el formulario: el foco pasa a su encabezado.
    if (failure?.status === "denied") {
      deniedRef.current?.focus();
    }
  }, [failure]);

  if (failure?.status === "denied") {
    return (
      <section aria-labelledby={`${ids}-denied`} className="student-portal__error">
        <Heading id={`${ids}-denied`} ref={deniedRef} tabIndex={-1} className="m-0! text-lg!">
          No tienes acceso a esta reserva.
        </Heading>
      </section>
    );
  }

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        className={`${SECONDARY_BUTTON_CLASS} w-fit`}
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </button>
    );
  }

  const trimmed = reason.trim();
  const reasonInvalid = showReasonError && cancellation.reasonRequired && trimmed === "";

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) {
      return;
    }
    if (cancellation.reasonRequired && trimmed === "") {
      setShowReasonError(true);
      return;
    }
    setFailure(null);
    setPending(true);
    try {
      const result = await getAgendaPort().cancelReservation({
        reservationId: appointmentId,
        ...(trimmed === "" ? {} : { reason: trimmed }),
      });
      if (result.status === "cancelled") {
        onCancelled();
      } else if (result.status === "denied") {
        setFailure({ status: "denied" });
      } else {
        setFailure({ status: "error", message: result.error.message });
      }
    } catch {
      setFailure({ status: "error", message: CANCEL_FALLBACK });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-labelledby={titleId}
      onSubmit={handleSubmit}
      noValidate
      className="flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-5 text-left"
    >
      <Heading id={titleId} ref={titleRef} tabIndex={-1} className="m-0! text-lg! font-semibold!">
        ¿Cancelar esta atención?
      </Heading>
      <p className="m-0">
        Se libera el horario para otra persona. Si después necesitas una atención, tendrás que
        reservar de nuevo.
      </p>
      <div className="flex flex-col gap-1">
        <label htmlFor={reasonId} className="font-semibold">
          Motivo{cancellation.reasonRequired ? "" : " (opcional)"}
        </label>
        <p id={reasonHintId} className="m-0 text-sm text-on-surface-variant">
          Lo verá tu profesional. No escribas diagnósticos ni datos de salud.
        </p>
        <textarea
          id={reasonId}
          value={reason}
          maxLength={REASON_MAX_LENGTH}
          rows={3}
          required={cancellation.reasonRequired}
          aria-invalid={reasonInvalid}
          aria-describedby={reasonInvalid ? `${reasonHintId} ${reasonErrorId}` : reasonHintId}
          disabled={pending}
          onChange={(event) => setReason(event.target.value)}
          className={fieldClass(reasonInvalid)}
        />
        {reasonInvalid ? (
          <p id={reasonErrorId} className="m-0 font-semibold text-error">
            {REASON_REQUIRED_MESSAGE}
          </p>
        ) : null}
      </div>
      {failure?.status === "error" ? (
        <p role="alert" className="student-portal__error m-0">
          {failure.message} Tu atención sigue reservada.
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          className={`inline-flex min-h-12 items-center justify-center rounded-[0.5rem] px-6 font-semibold text-primary underline ${FOCUS_CLASS}`}
          disabled={pending}
          onClick={() => {
            returnFocus.current = true;
            setFailure(null);
            setShowReasonError(false);
            setOpen(false);
          }}
        >
          Volver sin cancelar
        </button>
        <button
          type="submit"
          className={PRIMARY_BUTTON_CLASS}
          disabled={pending}
          aria-busy={pending}
        >
          {pending ? "Cancelando…" : "Confirmar cancelación"}
        </button>
      </div>
    </form>
  );
}
