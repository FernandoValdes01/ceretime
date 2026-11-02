import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";
// Mensajes canónicos del contrato compartido (TI2-88): conflicto y falta de
// cupo se muestran con el mismo texto que Web y Mobile; no se duplican
// literales ni se interpreta un código por su texto.
import {
  CONFLICT_ERROR_MESSAGE,
  NO_AVAILABILITY_ERROR_MESSAGE,
} from "../../../../../convex/domain/index.ts";
import type { AgendaSlot } from "../../application/agenda/agenda-port.ts";
import { formatSlotDateTime, modalityLabel } from "./agenda-labels.ts";
import { useReservationSlot } from "./reservation-form-data.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";

/**
 * Formulario, comprobante y cancelación visible de la reserva (TI2-102,
 * completado TI2-113).
 *
 * Extiende la búsqueda (mismo puerto y adaptador temporal): muestra el cupo
 * elegido, exige confirmación explícita, bloquea el doble envío y conserva
 * la selección ante el fallo para reintentar. La reserva es simulada hasta
 * TI2-123 y se declara como tal; sin reglas de compatibilidad en el cliente.
 *
 * TI2-113 completa los desenlaces: conflicto con recuperación sin perder la
 * selección, denegación permanente sin reintento y falta de cupo con la
 * coordinación por canal oficial son estados distintos del mismo único
 * comando de reserva. La cancelación visible es un escenario tipado del
 * comprobante reutilizado de TI2-102 y se declara simulada: no afirma una
 * mutation real. Cada desenlace se anuncia una sola vez, por foco o por la
 * alerta visible; ninguna región adicional lo duplica.
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
      <StudentPanelErrorBoundary
        key={slotId ?? "sin-cupo"}
        subject="la confirmación de reserva"
        level="section"
      >
        <ReservationFormBody slotId={slotId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/**
 * Desenlace tipado de la confirmación (TI2-113): conflicto, falta de cupo y
 * denegación llegan como estados del puerto; el fallo técnico conserva el
 * mensaje del error público compartido sin interpretar su código.
 */
type ReserveOutcome =
  | { status: "conflict" }
  | { status: "no_availability" }
  | { status: "denied" }
  | { status: "error"; message: string };

/**
 * Desenlace tipado de la cancelación visible (TI2-113): escenario declarado
 * del adaptador vigente y sin mutation real; el fallo técnico conserva el
 * mensaje del error público compartido.
 */
type CancelOutcome =
  | { status: "cancelled" }
  | { status: "denied" }
  | { status: "error"; message: string };

function ReservationFormBody({ slotId }: { slotId: string | undefined }) {
  const { state, retry } = useReservationSlot(slotId);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReserveOutcome | null>(null);

  async function handleConfirm(event: React.FormEvent) {
    event.preventDefault();
    if (pending || state.status !== "ready") {
      return;
    }
    const slot = state.slot;
    // El desenlace previo se limpia al iniciar el envío: el panel de cada
    // respuesta se anuncia una vez al aparecer y no vuelve a anunciarse al reenviar.
    setOutcome(null);
    setPending(true);
    try {
      const result = await getAgendaPort().reserveSlot({ slotId: slot.id });
      // El puerto entrega los estados tipados; el resto (`error`) guarda el
      // mensaje público compartido sin deducir nada del código.
      if (result.status === "confirmed") {
        setReservationId(result.reservation.id);
      } else if (result.status === "error") {
        setOutcome({ status: "error", message: result.error.message });
      } else {
        setOutcome({ status: result.status });
      }
    } catch {
      setOutcome({
        status: "error",
        message: "No pudimos confirmar la reserva. Inténtalo de nuevo.",
      });
    } finally {
      setPending(false);
    }
  }

  if (state.status === "loading") {
    return (
      <p role="status" className="student-portal__loading">
        Cargando el cupo…
      </p>
    );
  }

  if (state.status === "read-error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          No pudimos cargar el cupo. Inténtalo de nuevo.
        </p>
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={retry}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (state.status === "missing") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">Cupo no disponible.</p>
        <p>El cupo elegido ya no está publicado o el enlace es inválido.</p>
      </div>
    );
  }

  const slot = state.slot;

  // Denegación de la reserva: estado permanente, sin reintento (reintentar
  // no sana la autorización) y sin motivo interno. La autorización efectiva
  // la comprueba el Backend; la UI no prueba propiedad con el cliente.
  if (outcome?.status === "denied") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          No tienes acceso a esta reserva. Si crees que es un error, contáctanos por los canales
          oficiales.
        </p>
        <p>
          <Link to="/estudiante/horarios">Volver a horarios</Link>
        </p>
      </div>
    );
  }

  // Falta de cupo tras el comando: el mensaje canónico dirige a la
  // coordinación por canal oficial. Retener el formulario no ayuda: obtener
  // un cupo exige una búsqueda nueva.
  if (outcome?.status === "no_availability") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          {NO_AVAILABILITY_ERROR_MESSAGE}
        </p>
        <p>
          <Link to="/estudiante/horarios">Volver a horarios</Link>
        </p>
      </div>
    );
  }

  if (reservationId !== null) {
    return <ReservationReceipt slot={slot} reservationId={reservationId} />;
  }

  // Conflicto y fallo técnico dejan el formulario operativo con la selección
  // íntegra: reintentar es repetir el mismo comando de reserva, sin rehacer
  // búsqueda ni formulario. Cada alerta aparece una vez por envío.
  return (
    <>
      {outcome?.status === "conflict" && (
        <p role="alert" className="student-portal__error">
          <strong>Conflicto al confirmar la reserva.</strong> {CONFLICT_ERROR_MESSAGE} La selección
          se conserva: puedes reintentar ahora o volver a horarios más tarde.
        </p>
      )}
      {outcome?.status === "error" && (
        <p role="alert" className="student-portal__error">
          {outcome.message}
        </p>
      )}
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
    </>
  );
}

/**
 * Comprobante de la reserva confirmada (TI2-102), reutilizado por la
 * cancelación visible (TI2-113). La cancelación es un escenario tipado del
 * adaptador vigente y declara su simulación en pantalla: no afirma una
 * mutation real. El desenlace se anuncia una sola vez: el foco llega al
 * encabezado de la confirmación al montar y al de la cancelación cuando
 * ocurre; los fallos leen por la alerta visible sin regiones adicionales.
 */
function ReservationReceipt({ slot, reservationId }: { slot: AgendaSlot; reservationId: string }) {
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelOutcome, setCancelOutcome] = useState<CancelOutcome | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);
  const cancellationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    confirmationRef.current?.focus();
  }, []);

  useEffect(() => {
    if (cancelOutcome?.status === "cancelled") {
      cancellationRef.current?.focus();
    }
  }, [cancelOutcome]);

  async function handleCancel() {
    if (
      cancelPending ||
      cancelOutcome?.status === "cancelled" ||
      cancelOutcome?.status === "denied"
    ) {
      return;
    }
    setCancelOutcome(null);
    setCancelPending(true);
    try {
      const result = await getAgendaPort().cancelReservation({ reservationId });
      // Estados tipados del puerto; el resto (`error`) conserva el mensaje
      // público compartido sin deducir nada del código.
      if (result.status === "error") {
        setCancelOutcome({ status: "error", message: result.error.message });
      } else {
        setCancelOutcome({ status: result.status });
      }
    } catch {
      setCancelOutcome({
        status: "error",
        message: "No pudimos cancelar la reserva. Inténtalo de nuevo.",
      });
    } finally {
      setCancelPending(false);
    }
  }

  if (cancelOutcome?.status === "cancelled") {
    return (
      <section aria-labelledby="reservation-cancelled-title">
        <h2 id="reservation-cancelled-title" ref={cancellationRef} tabIndex={-1}>
          Reserva cancelada
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
        <p>
          Cancelación simulada con datos ficticios: no se realizó una escritura real en el Backend.
        </p>
        <p>
          <Link to="/estudiante/horarios">Volver a horarios</Link>
        </p>
      </section>
    );
  }

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
      {cancelOutcome?.status === "denied" && (
        <p role="alert" className="student-portal__error">
          No tienes acceso a esta reserva. Si crees que es un error, contáctanos por los canales
          oficiales.
        </p>
      )}
      {cancelOutcome?.status === "error" && (
        <p role="alert" className="student-portal__error">
          {cancelOutcome.message}
        </p>
      )}
      <p>Reserva simulada con datos ficticios.</p>
      <p>
        <Link to="/estudiante/horarios">Volver a horarios</Link>
      </p>
      {cancelOutcome?.status === "denied" ? null : (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost"
            onClick={handleCancel}
            disabled={cancelPending}
            aria-busy={cancelPending}
          >
            {cancelPending ? "Cancelando…" : "Cancelar esta reserva"}
          </button>
        </div>
      )}
    </section>
  );
}
