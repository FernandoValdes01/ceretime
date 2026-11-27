import { useEffect, useId, useRef, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";
// Mensajes canónicos del contrato compartido (TI2-88): conflicto y falta de
// cupo se muestran con el mismo texto que Web y Mobile; no se duplican
// literales ni se interpreta un código por su texto.
import {
  CONFLICT_ERROR_MESSAGE,
  INITIAL_APPOINTMENT_STATUS,
  NO_AVAILABILITY_ERROR_MESSAGE,
} from "../../../../../convex/domain/index.ts";
import type {
  AgendaSlot,
  SlotModalityFilter,
  SlotSearchContext,
} from "../../application/agenda/agenda-port.ts";
import {
  appointmentStatusLabel,
  formatAppointmentDateTime,
  formatSlotDateTime,
  modalityLabel,
} from "./agenda-labels.ts";
import { CancelAppointmentForm } from "./cancel-appointment-form.tsx";
import { useReservationSlot } from "./reservation-form-data.ts";
import { getAgendaPort } from "./schedule-search-data.ts";
import { SpaceAccessDetails } from "./space-access-details.tsx";
import { studentCancellationFrom } from "./student-appointment-changes.ts";
import { useStudentAppointment } from "./student-appointments-page-data.ts";
import { BookingContextGate } from "./student-booking-context.tsx";
import { SECTION_TITLE_CLASS } from "./student-page-classes.ts";
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
 * TI2-163: la misma confirmación sirve para cambiar el horario de una
 * atención (`rescheduleAppointmentId`), sin otro formulario; muestra el
 * horario actual junto al nuevo y, si el cambio falla, recuerda que la
 * atención conserva su horario. También muestra cómo llegar a la sala del cupo
 * y la cancelación pide motivo solo si el dominio lo exige.
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

/** Lo que vuelve a la búsqueda para no perder la modalidad ni el cambio en curso. */
type ScheduleSearch = {
  readonly accompanimentId: string;
  readonly modality: Exclude<SlotModalityFilter, "all"> | undefined;
  readonly rescheduleAppointmentId: string | undefined;
};

const KEEPS_CURRENT_SCHEDULE = "Tu atención conserva su horario actual.";

export function ReservationFormPage() {
  const { slotId, accompanimentId, modality, rescheduleAppointmentId } =
    reservarRouteApi.useSearch();

  return (
    <StudentPanelErrorBoundary
      key={`${accompanimentId ?? "sin-acompanamiento"}:${slotId ?? "sin-cupo"}:${rescheduleAppointmentId ?? ""}`}
      subject="la confirmación de reserva"
      level="section"
    >
      <BookingContextGate requestedAccompanimentId={accompanimentId}>
        {(context) => (
          <ReservationFormArea
            slotId={slotId}
            context={context}
            schedule={{
              accompanimentId: context.accompanimentId,
              modality: modality === "all" ? undefined : modality,
              rescheduleAppointmentId,
            }}
          />
        )}
      </BookingContextGate>
    </StudentPanelErrorBoundary>
  );
}

function ReservationFormArea({
  slotId,
  context,
  schedule,
}: {
  slotId: string | undefined;
  context: SlotSearchContext;
  schedule: ScheduleSearch;
}) {
  const { state, retry } = useReservationSlot(slotId, context);
  const rescheduleAppointmentId = schedule.rescheduleAppointmentId;
  const rescheduling = rescheduleAppointmentId !== undefined;

  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [reservationId, setReservationId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ReserveOutcome | null>(null);
  const [cancelled, setCancelled] = useState(false);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const resultRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // El título del estado es el primer destino del teclado al entrar.
    titleRef.current?.focus();
  }, []);

  useEffect(() => {
    // Tras confirmar el encabezado pasa a Reserva confirmada (u Horario
    // cambiado): el foco se traslada una sola vez al resultado, sin región ni
    // alerta adicional.
    if (reservationId !== null) {
      titleRef.current?.focus();
    }
  }, [reservationId]);

  useEffect(() => {
    // Tras cancelar el encabezado pasa a Reserva cancelada con el mismo
    // destino único: no se duplica el anuncio con una región extra.
    if (cancelled) {
      titleRef.current?.focus();
    }
  }, [cancelled]);

  useEffect(() => {
    // Denegación y falta de cupo reemplazan controles: el foco cae en el
    // encabezado del panel en lugar del body; el panel no lleva role de
    // alerta para no anunciar el mismo texto dos veces.
    if (outcome?.status === "denied" || outcome?.status === "no_availability") {
      resultRef.current?.focus();
    }
  }, [outcome]);

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
      const port = getAgendaPort();
      const result =
        rescheduleAppointmentId === undefined
          ? await port.reserveSlot({
              slotId: slot.id,
              booking: { accompanimentId: context.accompanimentId, slot },
            })
          : await port.rescheduleAppointment({ appointmentId: rescheduleAppointmentId, slot });
      // El puerto entrega los estados tipados; el resto (`error`) guarda el
      // mensaje público compartido sin deducir nada del código.
      if (result.status === "confirmed") {
        setReservationId(result.reservation.id);
      } else if (result.status === "rescheduled") {
        setReservationId(result.appointmentId);
      } else if (result.status === "error") {
        setOutcome({ status: "error", message: result.error.message });
      } else {
        setOutcome({ status: result.status });
      }
    } catch {
      setOutcome({
        status: "error",
        message: rescheduling
          ? "No pudimos cambiar el horario. Inténtalo de nuevo."
          : "No pudimos confirmar la reserva. Inténtalo de nuevo.",
      });
    } finally {
      setPending(false);
    }
  }

  /**
   * Encabezado principal con el estado actual: la confirmación, la
   * cancelación y el formulario comparten la misma tarjeta y el título dice
   * siempre qué hay en pantalla.
   */
  const pageTitle = rescheduling
    ? reservationId !== null
      ? "Horario cambiado"
      : "Confirmar cambio de horario"
    : cancelled
      ? "Reserva cancelada"
      : reservationId !== null
        ? "Reserva confirmada"
        : "Confirmar reserva";

  const slot = state.status === "ready" ? state.slot : null;
  const keepsCurrent = rescheduling ? ` ${KEEPS_CURRENT_SCHEDULE}` : "";

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
            rescheduleAppointmentId === undefined ? (
              <ReservationReceiptBody
                slot={slot}
                reservationId={reservationId}
                cancelled={cancelled}
                onCancelled={() => setCancelled(true)}
              />
            ) : (
              <RescheduleReceiptBody slot={slot} appointmentId={rescheduleAppointmentId} />
            )
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
              <p className="student-portal__res-state-note">
                {NO_AVAILABILITY_ERROR_MESSAGE}
                {keepsCurrent}
              </p>
            </section>
          ) : (
            <>
              {/* Conflicto y fallo técnico dejan el formulario operativo con
                  la selección íntegra: reintentar repite el mismo comando, sin
                  rehacer búsqueda ni formulario. Cada alerta aparece una vez
                  por envío; el conflicto agrega la salida para elegir otro
                  horario con la modalidad y el cambio en curso. */}
              {outcome?.status === "conflict" && (
                <div role="alert" className="student-portal__error student-portal__res-state">
                  <p className="student-portal__res-state-note">
                    {CONFLICT_ERROR_MESSAGE}{" "}
                    {rescheduling ? KEEPS_CURRENT_SCHEDULE : "La selección se conserva."}
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
                  {keepsCurrent}
                </p>
              )}
              {rescheduleAppointmentId === undefined ? null : (
                <CurrentAppointmentSummary appointmentId={rescheduleAppointmentId} />
              )}
              <form onSubmit={handleConfirm}>
                <SlotDetails slot={slot} title={rescheduling ? "Nuevo horario" : undefined} />
                <div className="student-portal__res-confirm">
                  <label>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(event) => setConfirmed(event.target.checked)}
                      disabled={pending}
                    />{" "}
                    {rescheduling
                      ? "Confirmo que deseo cambiar mi atención a este horario"
                      : "Confirmo que deseo reservar este cupo"}
                  </label>
                  <div className="student-portal__cta">
                    <button
                      type="submit"
                      className="student-portal__btn student-portal__btn--primary"
                      disabled={!confirmed || pending}
                      aria-busy={pending}
                    >
                      {pending
                        ? rescheduling
                          ? "Cambiando…"
                          : "Confirmando…"
                        : rescheduling
                          ? "Confirmar cambio"
                          : "Confirmar reserva"}
                    </button>
                  </div>
                </div>
              </form>
            </>
          )}
        </>
      )}

      {/* Una sola salida a horarios al final de la tarjeta; con conflicto la
          salida ya vive junto al mensaje como Elegir otro horario. Tras
          cambiar el horario, la salida es la propia atención. */}
      {outcome?.status !== "conflict" && !(rescheduling && reservationId !== null) && (
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
 * Fecha, modalidad y sala del cupo, con cómo llegar cuando es presencial
 * (TI2-163). `title` nombra el bloque cuando se muestra junto a otro horario.
 */
function SlotDetails({ slot, title }: { slot: AgendaSlot; title?: string }) {
  const headingId = `${useId()}-access`;
  return (
    <>
      {title === undefined ? null : <h2 className={SECTION_TITLE_CLASS}>{title}</h2>}
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
      {slot.space === undefined ? null : (
        <section aria-labelledby={headingId} className="mt-4 mb-4 flex flex-col gap-2">
          <h3 id={headingId} className="m-0! text-lg! font-semibold! text-on-surface!">
            Cómo llegar
          </h3>
          <SpaceAccessDetails space={slot.space} includePlace={slot.spaceLabel === undefined} />
        </section>
      )}
    </>
  );
}

/**
 * Horario vigente de la atención que se cambia: se lee de la misma atención y
 * sigue visible si el cambio falla, porque el Backend no la modifica.
 */
function CurrentAppointmentSummary({ appointmentId }: { appointmentId: string }) {
  const result = useStudentAppointment(appointmentId, 0);
  return (
    <section aria-labelledby="current-appointment-title" className="mb-4">
      <h2 id="current-appointment-title" className={SECTION_TITLE_CLASS}>
        Horario actual
      </h2>
      {result === undefined ? (
        <p role="status">Cargando tu atención…</p>
      ) : result.status === "ok" ? (
        <dl className="student-portal__res-dl">
          <div>
            <dt>Fecha y hora</dt>
            <dd>
              {formatAppointmentDateTime(result.appointment.startAt, result.appointment.endAt)}
            </dd>
          </div>
          <div>
            <dt>Modalidad</dt>
            <dd>{modalityLabel(result.appointment.modality)}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{appointmentStatusLabel(result.appointment.status)}</dd>
          </div>
        </dl>
      ) : (
        <p>No pudimos mostrar tu horario actual. El cambio se revisa igual en el servidor.</p>
      )}
    </section>
  );
}

/** Comprobante del cambio de horario: el nuevo horario y la salida a la atención. */
function RescheduleReceiptBody({
  slot,
  appointmentId,
}: {
  slot: AgendaSlot;
  appointmentId: string;
}) {
  return (
    <>
      <SlotDetails slot={slot} />
      <p>
        La fecha original queda registrada en tu atención.{" "}
        <Link to="/estudiante/atenciones/$appointmentId" params={{ appointmentId }}>
          Ver la atención
        </Link>
      </p>
    </>
  );
}

/**
 * Contenido del comprobante tras la confirmación (TI2-102), con la
 * cancelación visible de TI2-113 en el formulario compartido de TI2-163: pide
 * confirmar y el motivo solo si el dominio lo exige. El título del estado vive
 * en el h1 de la tarjeta; aquí solo están el contenido y la cancelación.
 */
function ReservationReceiptBody({
  slot,
  reservationId,
  cancelled,
  onCancelled,
}: {
  slot: AgendaSlot;
  reservationId: string;
  cancelled: boolean;
  onCancelled: () => void;
}) {
  // La reserva recién confirmada queda en el estado inicial del dominio.
  const cancellation = studentCancellationFrom(INITIAL_APPOINTMENT_STATUS);

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
      {cancelled || slot.space === undefined ? null : (
        <section aria-labelledby="receipt-access-title" className="mt-4 mb-4 flex flex-col gap-2">
          <h2 id="receipt-access-title" className={SECTION_TITLE_CLASS}>
            Cómo llegar
          </h2>
          <SpaceAccessDetails space={slot.space} includePlace />
        </section>
      )}
      {cancelled || cancellation === null ? null : (
        <CancelAppointmentForm
          appointmentId={reservationId}
          cancellation={cancellation}
          triggerLabel="Cancelar esta reserva"
          onCancelled={onCancelled}
        />
      )}
    </>
  );
}
