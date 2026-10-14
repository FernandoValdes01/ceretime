import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";
import { formatSlotDateTime, modalityLabel } from "./agenda-labels.ts";
import { useReservationSlot } from "./reservation-form-data.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";

/**
 * Formulario y confirmación de reserva (TI2-102).
 *
 * Extiende la búsqueda (mismo puerto y adaptador temporal): muestra el cupo
 * elegido, exige confirmación explícita, bloquea el doble envío y conserva
 * la selección ante el fallo para reintentar. La reserva es simulada hasta
 * TI2-123 y se declara como tal; sin reglas de compatibilidad en el cliente.
 */
const reservarRouteApi = getRouteApi("/estudiante/reservar");

export function ReservationFormPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const { slotId } = reservarRouteApi.useSearch();

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="reservation-form-title">
      <h1 id="reservation-form-title" ref={headingRef} tabIndex={-1}>
        Confirmar reserva
      </h1>
      <p>
        <Link to="/estudiante/horarios">Volver a horarios</Link>
      </p>
      <StudentPanelErrorBoundary subject="la confirmación de reserva" level="section">
        <ReservationFormBody slotId={slotId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function ReservationFormBody({ slotId }: { slotId: string | undefined }) {
  const slot = useReservationSlot(slotId);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (reservationId !== null) {
      confirmationRef.current?.focus();
    }
  }, [reservationId]);

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    if (pending || slot === undefined || slot === null) {
      return;
    }
    setSubmitError(null);
    setPending(true);
    try {
      const result = await getAgendaPort().reserveSlot({ slotId: slot.id });
      if (result.status === "confirmed") {
        setReservationId(result.reservation.id);
      } else {
        setSubmitError(result.message);
      }
    } catch {
      setSubmitError("No pudimos confirmar la reserva. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  if (slot === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando el cupo…
      </p>
    );
  }

  if (slot === null) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">Cupo no disponible.</p>
        <p>El cupo elegido ya no está publicado o el enlace es inválido.</p>
      </div>
    );
  }

  if (reservationId !== null) {
    return (
      <section aria-labelledby="reservation-confirmed-title">
        <h2 id="reservation-confirmed-title" ref={confirmationRef} tabIndex={-1}>
          Reserva confirmada
        </h2>
        <dl>
          <div>
            <dt>Código</dt>
            <dd>{reservationId}</dd>
          </div>
          <div>
            <dt>Fecha y hora</dt>
            <dd>{formatSlotDateTime(slot.startAt, slot.endAt)}</dd>
          </div>
          <div>
            <dt>Modalidad</dt>
            <dd>{modalityLabel(slot.modality)}</dd>
          </div>
        </dl>
        <p>Reserva simulada con datos ficticios.</p>
        <p>
          <Link to="/estudiante/horarios">Volver a horarios</Link>
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={handleConfirm}>
      <dl>
        <div>
          <dt>Fecha y hora</dt>
          <dd>{formatSlotDateTime(slot.startAt, slot.endAt)}</dd>
        </div>
        <div>
          <dt>Modalidad</dt>
          <dd>{modalityLabel(slot.modality)}</dd>
        </div>
        {slot.spaceLabel !== undefined && (
          <div>
            <dt>Espacio</dt>
            <dd>{slot.spaceLabel}</dd>
          </div>
        )}
      </dl>
      {submitError && (
        <p className="student-portal__error" role="alert">
          {submitError}
        </p>
      )}
      <div>
        <label>
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            disabled={pending}
          />{" "}
          Confirmo que deseo reservar este cupo
        </label>
      </div>
      <div className="student-portal__cta">
        <button
          type="submit"
          className="student-portal__btn student-portal__btn--primary"
          disabled={!confirmed || pending}
          aria-busy={pending}
        >
          {pending ? "Confirmando…" : "Confirmar reserva"}
        </button>
      </div>
    </form>
  );
}
