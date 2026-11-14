import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  appointmentRejectionMessage,
  appointmentStatusLabel,
  formatAppointmentDate,
  formatAppointmentTime,
  formatAppointmentTimeRange,
} from "./gestion-labels.ts";
import { AGENDA_TIME_ZONE_LABEL } from "../shared/date-format.ts";
import {
  ACCESS_DENIED_MESSAGE,
  DeniedState,
  EmptyState,
  ErrorState,
  LoadingState,
} from "../shared/view-states.tsx";
import { availabilityModalityLabel } from "./professional-availability-labels.ts";
import {
  getAgendaPort,
  statusChangeOptions,
  useAgendaAppointment,
  useProfessionalAgenda,
  useSpaceLabels,
  type StatusChangeOption,
} from "./professional-agenda-data.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";

/** Foco visible de 3px según DESIGN.md, compartido por enlaces y campos. */
const GESTION_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * El título fija su interlineado: el heredado de `:root` ya viene calculado
 * para 18px y haría que dos líneas se superpongan. La alineación del título y
 * del contenido es la del resto de las páginas del portal.
 */
const AGENDA_TITLE = "leading-[1.2]";

/**
 * Enlace de retorno al listado: verde y subrayado como "Ver detalle", con el
 * ancho de su contenido para que no parezca ocupar toda la fila, y 44px de
 * alto táctil mínimo.
 */
const AGENDA_BACK_LINK = `flex min-h-[44px] w-fit items-center gap-1 rounded-[0.5rem] text-base font-semibold text-primary underline ${GESTION_FOCUS_VISIBLE}`;

/**
 * Campos de gestión según DESIGN.md: etiqueta visible arriba, borde de 1px
 * en el tono `outline` para que el campo se reconozca antes del foco, radio
 * de 0.5rem, fondo blanco, alto táctil mínimo de 44px y foco visible. El
 * error suma borde rojo al mensaje de texto, sin depender solo del color.
 */
const GESTION_LABEL = "mb-2 block text-sm font-semibold text-on-surface";
const GESTION_FIELD = `min-h-[44px] w-full min-w-0 box-border rounded-[0.5rem] border bg-surface-container-lowest px-3 py-2 text-base text-on-surface ${GESTION_FOCUS_VISIBLE}`;
// El color del borde va solo en una clase: dos en el mismo elemento compiten
// por el orden del CSS generado y el rojo del error podría no aplicarse.
const GESTION_FIELD_CLASS = `${GESTION_FIELD} border-outline`;
const GESTION_TEXTAREA = `${GESTION_FIELD} min-h-32 resize-y`;
const GESTION_TEXTAREA_CLASS = `${GESTION_TEXTAREA} border-outline`;
const GESTION_TEXTAREA_ERROR_CLASS = `${GESTION_TEXTAREA} border-error`;

/**
 * Fila de atención como tarjeta enlazada: la fecha encabeza en negrita, el
 * estado va como etiqueta de texto y "Ver detalle" deja claro que abre la
 * atención. El área completa es el enlace, con foco visible.
 */
const AGENDA_ITEM =
  "rounded-lg border border-border-low bg-surface-container-lowest transition-colors hover:border-outline";
const AGENDA_ITEM_LINK = `flex min-h-[44px] flex-col gap-2 rounded-lg px-5 py-4 text-left text-on-surface no-underline ${GESTION_FOCUS_VISIBLE}`;

/**
 * Agenda del Profesional (TI2-115/TI2-125): lista de atenciones reservadas
 * con datos mínimos tipados y fechas legibles.
 *
 * Lee por el puerto común de agenda contra `api.presentation.appointments`;
 * la vista se declara como consulta a la API y las fechas se leen en la zona
 * de la agenda. No es un calendario global ni muestra acompañamientos de
 * otros profesionales: solo las atenciones del Profesional vigente, y la
 * autorización efectiva sigue viva en el Backend. El detalle compone la misma
 * representación: cambios de estado visibles en la página de la atención.
 */
export function ProfessionalAgendaPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="professional-agenda-title">
      <h1 id="professional-agenda-title" ref={headingRef} tabIndex={-1} className={AGENDA_TITLE}>
        Agenda
      </h1>
      <p>Tus atenciones reservadas con la fecha vigente y su estado.</p>
      <p>Agenda consultada a la API; la autorización la decide el Backend.</p>
      <p>Horarios en {AGENDA_TIME_ZONE_LABEL}.</p>
      <StudentPanelErrorBoundary subject="la agenda" level="section">
        <AgendaBody attempt={attempt} onRetry={() => setAttempt((value) => value + 1)} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AgendaBody({ attempt, onRetry }: { attempt: number; onRetry: () => void }) {
  const result = useProfessionalAgenda(attempt);
  const spaceLabels = useSpaceLabels();

  if (result === undefined) {
    return <LoadingState label="Cargando la agenda…" />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} onRetry={onRetry} />;
  }

  if (result.status === "denied") {
    return <DeniedState />;
  }

  if (result.status === "empty") {
    return (
      <EmptyState title="No tienes atenciones agendadas.">
        <p>Cuando se reserve una atención contigo, aparecerá aquí.</p>
      </EmptyState>
    );
  }

  return (
    <ul className="mt-4 grid list-none gap-3 p-0">
      {result.appointments.map((appointment) => (
        <li key={appointment.id} className={AGENDA_ITEM}>
          <Link
            to="/profesional/agenda/$appointmentId"
            params={{ appointmentId: appointment.id }}
            className={AGENDA_ITEM_LINK}
          >
            <AppointmentRowContent
              appointment={appointment}
              spaceLabel={spaceLabelOf(appointment, spaceLabels)}
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}

function spaceLabelOf(
  appointment: AgendaAppointment,
  spaceLabels: ReadonlyMap<string, string>,
): string | undefined {
  return appointment.spaceId === undefined ? undefined : spaceLabels.get(appointment.spaceId);
}

/**
 * Contenido de una fila en tres niveles: fecha y estado, modalidad y
 * espacio como datos secundarios, y la acción de abrir el detalle.
 */
function AppointmentRowContent({
  appointment,
  spaceLabel,
}: {
  appointment: AgendaAppointment;
  spaceLabel: string | undefined;
}) {
  return (
    <>
      <span className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-semibold">
          <span className="block">{formatAppointmentDate(appointment.startAt)}</span>
          <span className="block">
            {formatAppointmentTimeRange(appointment.startAt, appointment.endAt)}
          </span>
        </span>
        <span className="inline-flex w-fit items-center rounded-full bg-surface-container-low px-3 py-1 text-sm font-bold">
          {appointmentStatusLabel(appointment.status)}
        </span>
      </span>
      <span className="flex flex-col text-base text-on-surface-variant sm:flex-row sm:flex-wrap sm:gap-x-2">
        <span>{availabilityModalityLabel(appointment.modality)}</span>
        {spaceLabel === undefined ? null : (
          <>
            <span aria-hidden="true" className="hidden sm:inline">
              ·
            </span>
            <span>{spaceLabel}</span>
          </>
        )}
      </span>
      <span className="text-base font-semibold text-primary underline">
        Ver detalle<span aria-hidden="true"> →</span>
      </span>
    </>
  );
}

/**
 * Detalle de una atención (TI2-115).
 *
 * Muestra la misma representación que la agenda con la fecha original
 * conservada y el motivo de cancelación propio, y registra cambios de
 * estado contra la API sobre el puerto común. Un identificador ajeno o
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
      <h1
        id="professional-agenda-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={AGENDA_TITLE}
      >
        Detalle de la atención
      </h1>
      <p>
        <Link to="/profesional/agenda" className={AGENDA_BACK_LINK}>
          <span aria-hidden="true">←</span> Volver a la agenda
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
  const spaceLabels = useSpaceLabels();
  // El estado local mantiene el detalle vigente tras un cambio: la respuesta
  // del puerto ya trae la atención actualizada.
  const [current, setCurrent] = useState<AgendaAppointment | undefined>(undefined);
  const appointment = result?.status === "ok" ? result.appointment : undefined;
  const shown = current ?? appointment;

  if (result === undefined) {
    return <LoadingState label="Cargando la atención…" />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} onRetry={onRetry} />;
  }

  if (result.status === "denied" || shown === undefined) {
    return <DeniedState />;
  }

  const spaceLabel = spaceLabelOf(shown, spaceLabels);

  return (
    <>
      <dl className="m-0 divide-y divide-(--ct-line)">
        <DetailRow label="Estado">{appointmentStatusLabel(shown.status)}</DetailRow>
        <DetailRow label="Fecha vigente">
          <span className="block">{formatAppointmentDate(shown.startAt)}</span>
          <span className="block">{formatAppointmentTimeRange(shown.startAt, shown.endAt)}</span>
        </DetailRow>
        <DetailRow label="Modalidad">{availabilityModalityLabel(shown.modality)}</DetailRow>
        <DetailRow label="Zona horaria">{AGENDA_TIME_ZONE_LABEL}</DetailRow>
        {spaceLabel === undefined ? null : <DetailRow label="Espacio">{spaceLabel}</DetailRow>}
        {shown.originalStartAt === undefined ? null : (
          <DetailRow label="Fecha original conservada">
            <span className="block">{formatAppointmentDate(shown.originalStartAt)}</span>
            <span className="block">{formatAppointmentTime(shown.originalStartAt)}</span>
          </DetailRow>
        )}
        {shown.cancelReason === undefined ? null : (
          <DetailRow label="Motivo de cancelación">{shown.cancelReason}</DetailRow>
        )}
      </dl>
      <StatusChangeSection appointment={shown} onChanged={setCurrent} />
    </>
  );
}

/**
 * Dato del detalle con su etiqueta en negrita arriba. Una línea suave separa
 * cada dato (la del tono `--ct-line`, que se refuerza en alto contraste) para
 * que no se pierda el renglón al leer.
 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-sm font-semibold text-on-surface">{label}</dt>
      <dd className="m-0 text-base text-on-surface">{children}</dd>
    </div>
  );
}

/**
 * Cambios de estado (TI2-115/TI2-125).
 *
 * Oferta visual derivada de la tabla canónica del dominio
 * (`statusChangeOptions`); el envío pasa por el puerto y la API aplica la
 * política de transición y la autorización. Rechazo, denegación y error
 * quedan visibles; el éxito enfoca la confirmación.
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
      <p>El cambio se registra en el Backend, que decide la autorización.</p>
      {confirmedLabel !== null ? (
        <div>
          <h3 ref={confirmationRef} tabIndex={-1}>
            Cambio registrado
          </h3>
          <p role="status">
            {confirmedLabel}. Estado actual: {appointmentStatusLabel(appointment.status)}. Cambio
            registrado por el Backend.
          </p>
        </div>
      ) : null}
      {options.length === 0 ? (
        <p>
          No hay cambios disponibles desde {appointmentStatusLabel(appointment.status)}: este estado
          es final.
        </p>
      ) : (
        <form onSubmit={handleSubmit} noValidate className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="status-change-target" className={GESTION_LABEL}>
              Cambiar a
            </label>
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
              <label htmlFor="status-change-reason" className={GESTION_LABEL}>
                Motivo (obligatorio)
              </label>
              <textarea
                className={
                  fieldError !== null ? GESTION_TEXTAREA_ERROR_CLASS : GESTION_TEXTAREA_CLASS
                }
                rows={4}
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
              {ACCESS_DENIED_MESSAGE}
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
