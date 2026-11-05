import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  appointmentStatusLabel,
  formatAppointmentDateTime,
  formatAppointmentInstant,
  modalityLabel,
} from "./agenda-labels.ts";
import {
  AGENDA_DAYS_AFTER,
  AGENDA_DAYS_BEFORE,
  useSpaceLabels,
  useStudentAppointment,
  useStudentAppointments,
  type SpaceLabels,
} from "./student-appointments-page-data.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";

/**
 * Foco visible de 3px según DESIGN.md, compartido por enlaces y acciones.
 * El título interlinea con su propio ancho de línea, como la agenda.
 */
const ATENCIONES_TITLE = "leading-[1.2]";

const ATENCIONES_FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

/**
 * Enlace de retorno al listado: en verde y subrayado, con el ancho de su
 * contenido y 44px de alto táctil mínimo, como el detalle de la agenda.
 */
const ATENCIONES_BACK_LINK = `flex min-h-[44px] w-fit items-center gap-1 rounded-[0.5rem] text-base font-semibold text-primary underline ${ATENCIONES_FOCUS_VISIBLE}`;

/**
 * Fila de atención como tarjeta enlazada: el área completa es el enlace y el
 * foco es visible, siguiendo la fila de la agenda por el puerto común.
 */
const ATENCION_ITEM =
  "rounded-lg border border-border-low bg-surface-container-lowest transition-colors hover:border-outline";

const ATENCION_ITEM_LINK = `flex min-h-[44px] flex-col gap-2 rounded-lg px-5 py-4 text-left text-base text-on-surface no-underline ${ATENCIONES_FOCUS_VISIBLE}`;

/**
 * Período que cubre la lista, en días civiles. La lectura real pide una
 * ventana acotada: lo dice en pantalla para que el vacío no se lea como
 * "nunca tuviste atenciones".
 */
const PERIODO_LISTA = `los últimos ${AGENDA_DAYS_BEFORE} días y los próximos ${AGENDA_DAYS_AFTER}`;

/**
 * Lista de las atenciones propias del Estudiante (TI2-114).
 *
 * Reutiliza el puerto común de agenda (`listAppointments`), conectado a la
 * API por TI2-123: el Backend entrega solo las atenciones propias dentro de
 * la ventana de lectura del adaptador. Los estados textuales de Realizada,
 * Cancelada e Inasistencia salen de las etiquetas compartidas de la agenda
 * estudiantil, y ni el plazo de justificación (TI2-94) ni su presentación
 * o revisión (TI2-119) se calculan o muestran acá.
 */
export function StudentAppointmentsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-appointments-title">
      <h1
        id="student-appointments-title"
        ref={headingRef}
        tabIndex={-1}
        className={ATENCIONES_TITLE}
      >
        Atenciones
      </h1>
      <p>Revisa tus atenciones de {PERIODO_LISTA}, con el estado de cada una.</p>
      <StudentPanelErrorBoundary subject="tus atenciones" level="section">
        <AppointmentsBody
          attempt={attempt}
          // El botón desaparece al reintentar: el foco pasa al título para no perderse.
          onRetry={() => {
            setAttempt((value) => value + 1);
            headingRef.current?.focus();
          }}
          onFocusTitle={() => headingRef.current?.focus()}
        />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AppointmentsBody({
  attempt,
  onRetry,
  onFocusTitle,
}: {
  attempt: number;
  onRetry: () => void;
  onFocusTitle: () => void;
}) {
  const result = useStudentAppointments(attempt);
  const spaceLabels = useSpaceLabels();

  if (result === undefined) {
    return (
      <p role="status" className="student-portal__loading">
        Cargando tus atenciones…
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
        <p className="student-portal__empty-title">No tienes atenciones en {PERIODO_LISTA}.</p>
        <p>Cuando reserves un horario, aparecerá aquí con su estado.</p>
      </div>
    );
  }

  return (
    <>
      {result.appointments.some((appointment) => isSpaceUnresolved(appointment, spaceLabels)) ? (
        <SpaceNotice spaceLabels={spaceLabels} onFocusTitle={onFocusTitle} />
      ) : null}
      <ul className="mt-4 grid list-none gap-3 p-0">
        {result.appointments.map((appointment) => (
          <li key={appointment.id} className={ATENCION_ITEM}>
            <Link
              to="/estudiante/atenciones/$appointmentId"
              params={{ appointmentId: appointment.id }}
              className={ATENCION_ITEM_LINK}
            >
              <AppointmentRowContent
                appointment={appointment}
                spaceLabel={spaceLabelOf(appointment, spaceLabels.labels)}
              />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Etiqueta del espacio propio de la atención, sin identificador interno. */
function spaceLabelOf(
  appointment: AgendaAppointment,
  labels: ReadonlyMap<string, string>,
): string | undefined {
  return appointment.spaceId === undefined ? undefined : labels.get(appointment.spaceId);
}

/** Verdadero si la lectura del catálogo terminó sin resolver la sala de la atención. */
function isSpaceUnresolved(appointment: AgendaAppointment, spaceLabels: SpaceLabels): boolean {
  return (
    spaceLabels.settled &&
    appointment.spaceId !== undefined &&
    !spaceLabels.labels.has(appointment.spaceId)
  );
}

/**
 * Aviso de una sala sin resolver. Para una atención presencial la sala es un
 * dato necesario: se declara su ausencia en vez de omitirla en silencio, y el
 * reintento lee solo el catálogo.
 */
function SpaceNotice({
  spaceLabels,
  onFocusTitle,
}: {
  spaceLabels: SpaceLabels;
  onFocusTitle: () => void;
}) {
  return (
    <div>
      <p role="alert" className="student-portal__error">
        No pudimos cargar la información de la sala. Inténtalo de nuevo.
      </p>
      <div className="student-portal__cta">
        <button
          type="button"
          className="student-portal__btn student-portal__btn--primary"
          onClick={() => {
            spaceLabels.retry();
            // El botón desaparece al reintentar: el foco pasa al título para no perderse.
            onFocusTitle();
          }}
        >
          Reintentar cargar la sala
        </button>
      </div>
    </div>
  );
}

/**
 * Contenido de una fila en tres niveles: fecha y estado, modalidad y espacio
 * como datos secundarios, y la acción de abrir el detalle. El estado y la
 * fecha son texto, nunca solo color.
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
          {formatAppointmentDateTime(appointment.startAt, appointment.endAt)}
        </span>
        <span className="inline-flex w-fit items-center rounded-full bg-surface-container-low px-3 py-1 text-sm font-bold">
          {appointmentStatusLabel(appointment.status)}
        </span>
      </span>
      <span className="flex flex-col text-base text-on-surface-variant sm:flex-row sm:flex-wrap sm:gap-x-2">
        <span>{modalityLabel(appointment.modality)}</span>
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
 * Detalle de una atención propia del Estudiante (TI2-114).
 *
 * Muestra la misma lectura por el puerto común, conectado a la API. Una
 * atención fuera de la ventana de la lista sigue disponible por su
 * identificador. El detalle corresponde a la vista `shared` de TI2-112: no
 * muestra el motivo de cancelación, que queda en la vista del Profesional.
 */
export function StudentAppointmentDetailPage({ appointmentId }: { appointmentId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-appointment-detail-title">
      <h1
        id="student-appointment-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={ATENCIONES_TITLE}
      >
        Detalle de la atención
      </h1>
      <p>
        <Link to="/estudiante/atenciones" className={ATENCIONES_BACK_LINK}>
          <span aria-hidden="true">←</span> Volver a tus atenciones
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
          // El botón desaparece al reintentar: el foco pasa al título para no perderse.
          onRetry={() => {
            setAttempt((value) => value + 1);
            headingRef.current?.focus();
          }}
          onFocusTitle={() => headingRef.current?.focus()}
        />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AppointmentDetailBody({
  appointmentId,
  attempt,
  onRetry,
  onFocusTitle,
}: {
  appointmentId: string;
  attempt: number;
  onRetry: () => void;
  onFocusTitle: () => void;
}) {
  const result = useStudentAppointment(appointmentId, attempt);
  const spaceLabels = useSpaceLabels();

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

  if (result.status === "denied") {
    return (
      <p role="alert" className="student-portal__error">
        No autorizado. Pide acceso por el canal oficial si corresponde.
      </p>
    );
  }

  const shown = result.appointment;
  const spaceLabel = spaceLabelOf(shown, spaceLabels.labels);

  return (
    <>
      <dl className="m-0 divide-y divide-(--ct-line)">
        <DetailRow label="Estado">{appointmentStatusLabel(shown.status)}</DetailRow>
        <DetailRow label="Fecha y hora">
          {formatAppointmentDateTime(shown.startAt, shown.endAt)}
        </DetailRow>
        <DetailRow label="Modalidad">{modalityLabel(shown.modality)}</DetailRow>
        {spaceLabel === undefined ? null : <DetailRow label="Espacio">{spaceLabel}</DetailRow>}
        {shown.originalStartAt === undefined ? null : (
          <DetailRow label="Fecha original conservada">
            {formatAppointmentInstant(shown.originalStartAt)}
          </DetailRow>
        )}
      </dl>
      {isSpaceUnresolved(shown, spaceLabels) ? (
        <SpaceNotice spaceLabels={spaceLabels} onFocusTitle={onFocusTitle} />
      ) : null}
    </>
  );
}

/**
 * Dato del detalle con su etiqueta en negrita arriba y una línea suave entre
 * renglones, como el detalle de la agenda.
 */
function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-sm font-semibold text-on-surface">{label}</dt>
      <dd className="m-0 text-base text-on-surface">{children}</dd>
    </div>
  );
}
