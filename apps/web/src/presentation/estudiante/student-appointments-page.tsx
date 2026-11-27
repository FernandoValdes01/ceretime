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
import { DeniedState, EmptyState, ErrorState, LoadingState } from "../shared/view-states.tsx";
import { StudentAppointmentFollowUp } from "./student-follow-up.tsx";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";
import { AppointmentAccess } from "./appointment-access.tsx";
import { AppointmentJustification } from "./appointment-justification.tsx";
import { CancelAppointmentForm } from "./cancel-appointment-form.tsx";
import {
  isAppointmentUpcoming,
  justificationSituationOf,
  studentAppointmentChanges,
  type StudentAppointmentChanges,
} from "./student-appointment-changes.ts";
import { PRIMARY_LINK_CLASS, SECTION_TITLE_CLASS } from "./student-page-classes.ts";
import { useNow } from "../shared/use-now.ts";

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
 * estudiantil. El detalle (TI2-163) suma cómo llegar, el acceso en línea, el
 * cambio de horario, la cancelación y la justificación de la inasistencia.
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
    return <LoadingState label="Cargando tus atenciones…" />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} onRetry={onRetry} />;
  }

  if (result.status === "denied") {
    return <DeniedState />;
  }

  if (result.status === "empty") {
    return (
      <EmptyState title={`No tienes atenciones en ${PERIODO_LISTA}.`}>
        <p>Cuando reserves un horario, aparecerá aquí con su estado.</p>
      </EmptyState>
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
    <ErrorState
      message="No pudimos cargar la información de la sala. Inténtalo de nuevo."
      retryLabel="Reintentar cargar la sala"
      onRetry={() => {
        spaceLabels.retry();
        // El botón desaparece al reintentar: el foco pasa al título para no perderse.
        onFocusTitle();
      }}
    />
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
 * Recargar muestra lo mismo que la lista: ambas leen la misma atención del
 * Backend.
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
  // Relectura tras un cambio propio: conserva lo mostrado mientras llega la
  // respuesta, así la atención anterior sigue a la vista si el cambio falla.
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const result = useStudentAppointment(appointmentId, attempt, revision);
  const spaceLabels = useSpaceLabels();
  const nowMs = useNow();

  useEffect(() => {
    // El formulario que tenía el foco desaparece tras el cambio: el aviso lo recibe.
    if (notice !== null) {
      noticeRef.current?.focus();
    }
  }, [notice]);

  if (result === undefined) {
    return <LoadingState label="Cargando la atención…" />;
  }

  if (result.status === "error") {
    return <ErrorState message={result.message} onRetry={onRetry} />;
  }

  if (result.status === "denied") {
    return <DeniedState />;
  }

  const shown = result.appointment;
  const spaceLabel = spaceLabelOf(shown, spaceLabels.labels);
  const changes = studentAppointmentChanges(shown, nowMs);
  const justification = justificationSituationOf(shown, nowMs);

  function afterChange(message: string) {
    setNotice(message);
    setRevision((value) => value + 1);
  }

  return (
    // DESIGN.md: texto alineado a la izquierda; el bloque de compatibilidad de
    // `index.css` centra `#root` y las instrucciones de llegada son párrafos largos.
    <div className="text-left">
      {notice === null ? null : (
        <p
          ref={noticeRef}
          tabIndex={-1}
          role="status"
          className="rounded-lg border-t-4 border-primary bg-surface-container-low p-4"
        >
          {notice}
        </p>
      )}
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
      <AppointmentAccess
        appointment={shown}
        space={shown.spaceId === undefined ? undefined : spaceLabels.spaces.get(shown.spaceId)}
        active={isAppointmentUpcoming(shown.status)}
      />
      <AppointmentChangeActions
        appointment={shown}
        changes={changes}
        onCancelled={() => afterChange("Cancelaste la atención. El horario quedó libre.")}
      />
      {justification.kind === "none" ? null : (
        <AppointmentJustification
          appointmentId={shown.id}
          situation={justification}
          onSubmitted={() => afterChange("Enviamos tu justificación. Tu profesional la revisará.")}
        />
      )}
      <StudentAppointmentFollowUp appointmentId={shown.id} appointmentStatus={shown.status} />
    </div>
  );
}

/**
 * Reagendar y cancelar (TI2-163). Reagendar usa la misma búsqueda y la misma
 * confirmación de la reserva; la atención conserva su horario hasta que se
 * confirma el cambio.
 */
function AppointmentChangeActions({
  appointment,
  changes,
  onCancelled,
}: {
  appointment: AgendaAppointment;
  changes: StudentAppointmentChanges;
  onCancelled: () => void;
}) {
  const canReschedule = changes.canReschedule && appointment.accompanimentId !== undefined;
  if (!canReschedule && changes.cancellation === null) {
    return null;
  }
  return (
    <section aria-labelledby="appointment-changes-title" className="mt-6 flex flex-col gap-3">
      <h2 id="appointment-changes-title" className={SECTION_TITLE_CLASS}>
        Cambiar o cancelar
      </h2>
      <p className="m-0">Puedes hacerlo hasta antes del inicio de la atención.</p>
      <div className="flex flex-col gap-3">
        {canReschedule ? (
          <Link
            to="/estudiante/horarios"
            search={{
              accompanimentId: appointment.accompanimentId,
              rescheduleAppointmentId: appointment.id,
            }}
            className={PRIMARY_LINK_CLASS}
          >
            Cambiar horario
          </Link>
        ) : null}
        {changes.cancellation === null ? null : (
          <CancelAppointmentForm
            appointmentId={appointment.id}
            cancellation={changes.cancellation}
            triggerLabel="Cancelar la atención"
            onCancelled={onCancelled}
          />
        )}
      </div>
    </section>
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
