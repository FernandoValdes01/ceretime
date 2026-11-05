import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";
// Mensajes canónicos del contrato compartido (TI2-88): conflicto y falta de
// cupo se muestran con el mismo texto que Web y Mobile; no se duplican
// literales ni se interpreta un código por su texto.
import {
  CONFLICT_ERROR_MESSAGE,
  NO_AVAILABILITY_ERROR_MESSAGE,
} from "../../../../../convex/domain/index.ts";
import type { AgendaSlot, SlotSearchContext } from "../../application/agenda/agenda-port.ts";
import { formatSlotDateTime, modalityLabel } from "./agenda-labels.ts";
import { useReservationSlot } from "./reservation-form-data.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import { BookingContextGate } from "./student-booking-context.tsx";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";

/**
 * Confirmación de reserva con comprobante y cancelación visible (TI2-102,
 * composición de TI2-113).
 *
 * Extiende la búsqueda (mismo puerto y adaptador temporal): muestra el cupo
 * elegido, exige confirmación explícita y bloquea el doble envío. La reserva y
 * la cancelación usan la API real (TI2-123).
 *
 * TI2-113 completa los desenlaces: conflicto con recuperación sin perder la
 * selección, denegación permanente sin reintento y falta de cupo son estados
 * distintos del mismo único comando de reserva. La cancelación visible vive en
 * el comprobante reutilizado de TI2-102.
 *
 * Composición (DESIGN.md, ajustes acotados a esta superficie): la tarjeta
 * restaura la alineación a la izquierda y la escala tipográfica sobre los
 * estilos heredados del bloque de compatibilidad (TI2-130). El encabezado
 * principal refleja el estado actual y el foco llega a un solo destino por
 * desenlace: el encabezado del estado tras confirmar y cancelar, y el
 * encabezado del panel de denegación o falta de cupo cuando esos estados
 * reemplazan controles. El conflicto conserva el formulario y entra por la
 * alerta única; los paneles permanentes no repiten un segundo anuncio.
 *
 * El área completa vive bajo el mismo límite por cupo: cambiar de cupo
 * reinicia el formulario y un envío pendiente no traslada su resultado al
 * cupo nuevo.
 */
const reservarRouteApi = getRouteApi("/estudiante/reservar");

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
 * Desenlace tipado de la cancelación visible (TI2-113): el fallo técnico
 * conserva el mensaje del error público compartido.
 */
type CancelOutcome =
  | { status: "cancelled" }
  | { status: "denied" }
  | { status: "error"; message: string };

export function ReservationFormPage() {
  const { slotId, accompanimentId } = reservarRouteApi.useSearch();

  return (
    <StudentPanelErrorBoundary
      key={`${accompanimentId ?? "sin-acompanamiento"}:${slotId ?? "sin-cupo"}`}
      subject="la confirmación de reserva"
      level="section"
    >
      <BookingContextGate requestedAccompanimentId={accompanimentId}>
        {(context) => <ReservationFormArea slotId={slotId} context={context} />}
      </BookingContextGate>
    </StudentPanelErrorBoundary>
  );
}

function ReservationFormArea({
  slotId,
  context,
}: {
  slotId: string | undefined;
  context: SlotSearchContext;
}) {
  const { state, retry } = useReservationSlot(slotId, context);
  const schedule = { accompanimentId: context.accompanimentId };

  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReserveOutcome | null>(null);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelOutcome, setCancelOutcome] = useState<CancelOutcome | null>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);
  const cancelDeniedRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // El título del estado es el primer destino del teclado al entrar.
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    // Tras confirmar el encabezado pasa a Reserva confirmada: el foco se
    // traslada una sola vez al resultado, sin región ni alerta adicional.
    if (reservationId !== null) {
      titleRef.current?.focus();
    }
  }, [reservationId]);

  useEffect(() => {
    // Tras cancelar el encabezado pasa a Reserva cancelada con el mismo
    // destino único: no se duplica el anuncio con una región extra.
    if (cancelOutcome?.status === "cancelled") {
      titleRef.current?.focus();
    }
  }, [cancelOutcome]);

  useEffect(() => {
    // Denegación y falta de cupo reemplazan controles: el foco cae en el
    // encabezado del panel en lugar del body; el panel no lleva role de
    // alerta para no anunciar el mismo texto dos veces.
    if (outcome?.status === "denied" || outcome?.status === "no_availability") {
      resultRef.current?.focus();
    }
  }, [outcome]);

  useEffect(() => {
    // La denegación de la cancelación desaparece el botón que tenía el foco:
    // el foco va al encabezado de ese panel, sin alerta duplicada.
    if (cancelOutcome?.status === "denied") {
      cancelDeniedRef.current?.focus();
    }
  }, [cancelOutcome]);

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
      const result = await getAgendaPort().reserveSlot({
        slotId: slot.id,
        booking: { accompanimentId: context.accompanimentId, slot },
      });
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

  async function handleCancel() {
    if (
      cancelPending ||
      reservationId === null ||
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

  /**
   * Encabezado principal con el estado actual: la confirmación, la
   * cancelación y el formulario comparten la misma tarjeta y el título dice
   * siempre qué hay en pantalla.
   */
  const pageTitle =
    cancelOutcome?.status === "cancelled"
      ? "Reserva cancelada"
      : reservationId !== null
        ? "Reserva confirmada"
        : "Confirmar reserva";

  const slot = state.status === "ready" ? state.slot : null;

  return (
    <section aria-labelledby="reservation-form-title" className="student-portal__res">
      <h1 id="reservation-form-title" ref={titleRef} tabIndex={-1}>
        {pageTitle}
      </h1>

      {state.status === "loading" && (
        <p role="status" className="student-portal__loading">
          Cargando el cupo…
        </p>
      )}

      {state.status === "read-error" && (
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
      )}

      {state.status === "missing" && (
        <div className="student-portal__empty">
          <p className="student-portal__empty-title">Cupo no disponible.</p>
          <p>El cupo elegido ya no está publicado o el enlace es inválido.</p>
        </div>
      )}

      {slot !== null && state.status === "ready" && (
        <>
          {reservationId !== null && outcome === null ? (
            <ReservationReceiptBody
              slot={slot}
              reservationId={reservationId}
              cancelPending={cancelPending}
              cancelOutcome={cancelOutcome}
              onConfirmCancel={handleCancel}
              cancelDeniedRef={cancelDeniedRef}
            />
          ) : outcome?.status === "denied" ? (
            /* Denegación de la reserva: estado permanente y sin reintento
                (reintentar no sana la autorización) y sin motivo interno: la
                autorización efectiva la comprueba el Backend. Reemplaza al
                formulario; el encabezado del panel es el destino del foco y
                su único anuncio. */
            <section
              aria-labelledby="reservation-denied-title"
              className="student-portal__error student-portal__res-state"
            >
              <h2 id="reservation-denied-title" tabIndex={-1} ref={resultRef}>
                No tienes acceso a esta reserva.
              </h2>
            </section>
          ) : outcome?.status === "no_availability" ? (
            /* Falta de cupo tras el comando: el mensaje canónico dirige a la
                coordinación por canal oficial. Reemplaza al formulario:
                obtener un cupo exige una búsqueda nueva, no reintentar. */
            <section
              aria-labelledby="reservation-no-availability-title"
              className="student-portal__error student-portal__res-state"
            >
              <h2 id="reservation-no-availability-title" tabIndex={-1} ref={resultRef}>
                Cupo no disponible.
              </h2>
              <p className="student-portal__res-state-note">{NO_AVAILABILITY_ERROR_MESSAGE}</p>
            </section>
          ) : (
            <>
              {/* Conflicto y fallo técnico dejan el formulario operativo con
                  la selección íntegra: reintentar repite el mismo comando de
                  reserva, sin rehacer búsqueda ni formulario. Cada alerta
                  aparece una vez por envío; el conflicto agrega la salida
                  para elegir otro horario. */}
              {outcome?.status === "conflict" && (
                <div role="alert" className="student-portal__error student-portal__res-state">
                  <p className="student-portal__res-state-note">
                    {CONFLICT_ERROR_MESSAGE} La selección se conserva.
                  </p>
                  <p className="student-portal__res-state-actions">
                    <Link to="/estudiante/horarios" search={schedule}>
                      Elegir otro horario
                    </Link>
                  </p>
                </div>
              )}
              {outcome?.status === "error" && (
                <p role="alert" className="student-portal__error">
                  {outcome.message}
                </p>
              )}
              <form onSubmit={handleConfirm}>
                <dl className="student-portal__res-dl">
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
                <div className="student-portal__res-confirm">
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      disabled={pending}
                    />{" "}
                    Confirmo que deseo reservar este cupo
                  </label>
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
                </div>
              </form>
            </>
          )}
        </>
      )}

      {/* Una sola salida a horarios al final de la tarjeta; con conflicto la
          salida ya vive junto al mensaje como Elegir otro horario. */}
      {outcome?.status !== "conflict" && (
        <p className="student-portal__res-return">
          <Link to="/estudiante/horarios" search={schedule}>
            Volver a horarios
          </Link>
        </p>
      )}
    </section>
  );
}

/**
 * Contenido del comprobante tras la confirmación (TI2-102), con la
 * cancelación visible tipada de TI2-113. La denegación es permanente y el fallo
 * técnico conserva el comprobante y permite reintentar. El título del estado
 * vive en el h1 de la tarjeta; aquí solo está el contenido y los paneles de
 * desenlace con su foco único.
 */
function ReservationReceiptBody({
  slot,
  reservationId,
  cancelPending,
  cancelOutcome,
  onConfirmCancel,
  cancelDeniedRef,
}: {
  slot: AgendaSlot;
  reservationId: string;
  cancelPending: boolean;
  cancelOutcome: CancelOutcome | null;
  onConfirmCancel: () => void;
  cancelDeniedRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  if (cancelOutcome?.status === "cancelled") {
    return (
      <>
        <dl className="student-portal__res-dl">
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
      </>
    );
  }

  return (
    <>
      <dl className="student-portal__res-dl">
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

      {/* Denegación de la cancelación: permanente y sin botón; el encabezado
          de este panel recibe el foco y es su único anuncio. */}
      {cancelOutcome?.status === "denied" && (
        <section
          aria-labelledby="reservation-cancel-denied-title"
          className="student-portal__error student-portal__res-state"
        >
          <h2 id="reservation-cancel-denied-title" tabIndex={-1} ref={cancelDeniedRef}>
            No tienes acceso a esta reserva.
          </h2>
        </section>
      )}

      {cancelOutcome?.status === "error" && (
        <p role="alert" className="student-portal__error">
          {cancelOutcome.message}
        </p>
      )}

      {cancelOutcome?.status === "denied" ? null : (
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--ghost"
            onClick={onConfirmCancel}
            disabled={cancelPending}
            aria-busy={cancelPending}
          >
            {cancelPending ? "Cancelando…" : "Cancelar esta reserva"}
          </button>
        </div>
      )}
    </>
  );
}
