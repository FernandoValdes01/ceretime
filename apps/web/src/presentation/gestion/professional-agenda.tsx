import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  appointmentRejectionMessage,
  appointmentStatusLabel,
  formatAppointmentInstant,
  formatAppointmentWindow,
} from "./gestion-labels.ts";
import { availabilityModalityLabel } from "./professional-availability-labels.ts";
import {
  getAgendaPort,
  statusChangeOptions,
  useAgendaAppointment,
  useProfessionalAgenda,
  type StatusChangeOption,
} from "./professional-agenda-data.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";

/**
 * Clases Tailwind de las filas de gestión (TI2-91, TI2-103): 44px de alto
 * táctil mínimo, foco visible de 3px según DESIGN.md y reflujo en ventanas
 * estrechas. Comparte las mismas constantes que el resto del portal para
 * no duplicar el lenguaje visual.
 */
const GESTION_ROW = "flex flex-wrap items-center gap-2 min-h-[44px] min-w-0 px-3 py-2 text-inherit";
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/** Campos de gestión: alto táctil mínimo de 44px y foco visible compartido. */
const GESTION_FIELD = "min-h-[44px] w-full min-w-0 box-border px-3 py-2 text-base text-inherit";
const GESTION_FIELD_CLASS = `${GESTION_FIELD} ${GESTION_FOCUS_VISIBLE}`;

/**
 * Agenda del Profesional (TI2-115): lista de atenciones reservadas con
 * datos mínimos tipados y fechas legibles.
 *
 * Lee por el puerto común de agenda con el adaptador ficticio hasta
 * TI2-125; el modo simulado se declara en la página. No es un calendario
 * global ni muestra acompañamientos de otros profesionales: solo las
 * atenciones del Profesional vigente, y la autorización efectiva sigue
 * viva en el Backend. El detalle compone la misma representación: cambios
 * de estado visibles en la página de la atención.
 */
export function ProfessionalAgendaPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-agenda-title">
      <h1 id="professional-agenda-title" ref={headingRef} tabIndex={-1}>
        Agenda
      </h1>
      <p>Tus atenciones reservadas con la fecha vigente y su estado.</p>
      <p>Lectura simulada con datos ficticios hasta integrar la API real.</p>
      <StudentPanelErrorBoundary subject="la agenda" level="section">
        <AgendaBody attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AgendaBody({ attempt, onRetry }: { attempt: number; onRetry: () => void }) {
  const result = useProfessionalAgenda(attempt);

  if (result === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la agenda…
      </p>
    );
  }

  if (result.status === "error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          {result.message}
        </p>
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={onRetry}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (result.status === "denied") {
    return (
      <p role="alert" className="student-portal__error">
        No autorizado. Pide acceso por el canal oficial si corresponde.
      </p>
    );
  }

  if (result.status === "empty") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes atenciones agendadas.</p>
        <p>Cuando se reserve una atención contigo, aparecerá aquí.</p>
      </div>
    );
  }

  return (
    <ul className="student-portal__list">
      {result.appointments.map((appointment) => (
        <li key={appointment.id} className="student-portal__item">
          <Link
            to="/profesional/agenda/$appointmentId"
            params={{ appointmentId: appointment.id }}
            className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
          >
            <AppointmentRowContent appointment={appointment} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Contenido mínimo de una fila: estado como texto, ventana y modalidad. */
function AppointmentRowContent({ appointment }: { appointment: AgendaAppointment }) {
  return (
    <>
      <span className="student-portal__chip">{appointmentStatusLabel(appointment.status)}</span>
      <span className="student-portal__item-meta">
        {formatAppointmentWindow(appointment.startAt, appointment.endAt)}
      </span>
      <span>{availabilityModalityLabel(appointment.modality)}</span>
      {appointment.spaceId === undefined ? null : <span>Espacio {appointment.spaceId}</span>}
    </>
  );
}

/**
 * Detalle de una atención (TI2-115).
 *
 * Muestra la misma representación que la agenda con la fecha original
 * conservada y el motivo de cancelación propio, y registra cambios de
 * estado simulados sobre el puerto común. Un identificador ajeno o
 * desconocido llega como denegación genérica del Backend, sin filtrar
 * existencia. Los cambios visibles quedan anotados con foco al confirmar.
 */
export function ProfessionalAgendaDetailPage({ appointmentId }: { appointmentId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-agenda-detail-title">
      <h1 id="professional-agenda-detail-title" ref={headingRef} tabIndex={-1}>
        Detalle de la atención
      </h1>
      <p>
        <Link
          to="/profesional/agenda"
          className={`${GESTION_ROW} no-underline ${GESTION_FOCUS_VISIBLE}`}
        >
          Volver a la agenda
        </Link>
      </p>
      <StudentPanelErrorBoundary
        key={appointmentId}
        subject="el detalle de la atención"
        level="section"
      >
        <AppointmentDetailBody
          appointmentId={appointmentId}
          attempt={attempt}
          onRetry={() => setAttempt((value) => value + 1)}
        />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AppointmentDetailBody({
  appointmentId,
  attempt,
  onRetry,
}: {
  appointmentId: string;
  attempt: number;
  onRetry: () => void;
}) {
  const result = useAgendaAppointment(appointmentId, attempt);
  // El estado local mantiene el detalle vigente tras un cambio simulado:
  // la respuesta del puerto ya trae la atención actualizada.
  const [current, setCurrent] = useState<AgendaAppointment | undefined>(undefined);
  const appointment = result?.status === "ok" ? result.appointment : undefined;
  const shown = current ?? appointment;

  if (result === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando la atención…
      </p>
    );
  }

  if (result.status === "error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          {result.message}
        </p>
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={onRetry}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  if (result.status === "denied" || shown === undefined) {
    return (
      <p role="alert" className="student-portal__error">
        No autorizado. Pide acceso por el canal oficial si corresponde.
      </p>
    );
  }

  return (
    <>
      <dl>
        <div>
          <dt>Estado</dt>
          <dd className="student-portal__item-meta">{appointmentStatusLabel(shown.status)}</dd>
        </div>
        <div>
          <dt>Fecha vigente</dt>
          <dd>{formatAppointmentWindow(shown.startAt, shown.endAt)}</dd>
        </div>
        <div>
          <dt>Modalidad</dt>
          <dd>{availabilityModalityLabel(shown.modality)}</dd>
        </div>
        {shown.spaceId === undefined ? null : (
          <div>
            <dt>Espacio</dt>
            <dd>{shown.spaceId}</dd>
          </div>
        )}
        {shown.originalStartAt === undefined ? null : (
          <div>
            <dt>Fecha original conservada</dt>
            <dd>{formatAppointmentInstant(shown.originalStartAt)}</dd>
          </div>
        )}
        {shown.cancelReason === undefined ? null : (
          <div>
            <dt>Motivo de cancelación</dt>
            <dd>{shown.cancelReason}</dd>
          </div>
        )}
      </dl>
      <StatusChangeSection appointment={shown} onChanged={setCurrent} />
    </>
  );
}

/**
 * Cambios de estado simulados (TI2-115).
 *
 * Oferta visual derivada de la tabla canónica del dominio
 * (`statusChangeOptions`); el envío pasa por el puerto, que aplica la
 * política de transición del dominio como lo hará el Backend. Rechazo,
 * denegación y error quedan visibles; el éxito enfoca la confirmación.
 */
function StatusChangeSection({
  appointment,
  onChanged,
}: {
  appointment: AgendaAppointment;
  onChanged: (appointment: AgendaAppointment) => void;
}) {
  const options = statusChangeOptions(appointment.status);
  const [selectedTo, setSelectedTo] = useState("");
  const [reason, setReason] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmedLabel, setConfirmedLabel] = useState<string | null>(null);
  const confirmationRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (confirmedLabel !== null) {
      confirmationRef.current?.focus();
    }
  }, [confirmedLabel]);

  const selected: StatusChangeOption | undefined = options.find(
    (option) => option.to === selectedTo,
  );

  function clearFeedback() {
    setFieldError(null);
    setResultError(null);
    setDenied(false);
    setConfirmedLabel(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (pending || selected === undefined) {
      return;
    }
    clearFeedback();
    const reasonText = reason.trim();
    if (selected.requiresReason && reasonText === "") {
      setFieldError("El motivo es obligatorio para este cambio.");
      return;
    }
    setPending(true);
    try {
      const outcome = await getAgendaPort().changeAppointmentStatus({
        appointmentId: appointment.id,
        to: selected.to,
        ...(selected.requiresReason ? { reason: reasonText } : {}),
      });
      if (outcome.status === "changed") {
        onChanged(outcome.appointment);
        setConfirmedLabel(selected.label);
        setSelectedTo("");
        setReason("");
      } else if (outcome.status === "rejected") {
        setResultError(appointmentRejectionMessage(outcome.cause));
      } else if (outcome.status === "denied") {
        setDenied(true);
      } else {
        setResultError(outcome.error.message);
      }
    } catch {
      setResultError("No pudimos registrar el cambio. Inténtalo de nuevo.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="status-change-title" className="student-portal__section">
      <div className="student-portal__section-head">
        <h2 id="status-change-title">Cambiar estado</h2>
      </div>
      <p>Cambio simulado con datos ficticios; la autorización la decide el Backend.</p>
      {confirmedLabel !== null ? (
        <div>
          <h3 ref={confirmationRef} tabIndex={-1}>
            Cambio registrado
          </h3>
          <p role="status">
            {confirmedLabel}. Estado actual: {appointmentStatusLabel(appointment.status)}. Cambio
            simulado con datos ficticios.
          </p>
        </div>
      ) : null}
      {options.length === 0 ? (
        <p>
          No hay cambios disponibles desde {appointmentStatusLabel(appointment.status)}: este estado
          es final.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div>
            <label htmlFor="status-change-target">Cambiar a</label>
            <select
              className={GESTION_FIELD_CLASS}
              id="status-change-target"
              value={selectedTo}
              onChange={(event) => {
                setSelectedTo(event.target.value);
                clearFeedback();
              }}
              disabled={pending}
            >
              <option value="">Elige un cambio</option>
              {options.map((option) => (
                <option key={option.to} value={option.to}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {selected?.requiresReason ? (
            <div>
              <label htmlFor="status-change-reason">Motivo (obligatorio)</label>
              <textarea
                className={GESTION_FIELD_CLASS}
                id="status-change-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                aria-invalid={fieldError !== null}
                aria-describedby={fieldError !== null ? "status-change-reason-error" : undefined}
                disabled={pending}
              />
              {fieldError !== null ? (
                <p id="status-change-reason-error" role="alert" className="student-portal__error">
                  {fieldError}
                </p>
              ) : null}
            </div>
          ) : null}
          {denied ? (
            <p role="alert" className="student-portal__error">
              No autorizado. Pide acceso por el canal oficial si corresponde.
            </p>
          ) : null}
          {resultError !== null ? (
            <p role="alert" className="student-portal__error">
              {resultError}
            </p>
          ) : null}
          <div className="student-portal__cta">
            <button
              type="submit"
              className="student-portal__btn student-portal__btn--primary"
              disabled={pending || selectedTo === ""}
              aria-busy={pending}
            >
              {pending ? "Registrando…" : "Registrar cambio"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
