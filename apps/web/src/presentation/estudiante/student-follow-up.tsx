import { Link } from "@tanstack/react-router";
import { admitsFollowUp, type AppointmentStatus } from "../../../../../convex/domain/index.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import { useFollowUpRecord } from "../shared/follow-up/follow-up-data.ts";
import {
  FollowUpHistory,
  FollowUpRecordContent,
  type FollowUpHistoryAudience,
} from "../shared/follow-up/follow-up-record.tsx";
import { DeniedState, LoadingState } from "../shared/view-states.tsx";
import { appointmentStatusLabel } from "./agenda-labels.ts";

/**
 * Seguimiento visto por el Estudiante (TI2-166).
 *
 * Usa la misma representación que el Profesional, con la vista `shared` que
 * el Backend entrega al Estudiante dueño: acuerdos, tareas, próximos pasos y
 * fecha sugerida, nunca la nota interna. El historial recorre solo el
 * acompañamiento pedido, y cada atención enlaza a su detalle, que a su vez
 * enlaza de vuelta al acompañamiento.
 */

const FOCUS_VISIBLE =
  "focus-visible:outline-[3px] focus-visible:outline-solid focus-visible:outline-focus-ring focus-visible:outline-offset-[2px]";

const LINK = `inline-flex min-h-[44px] w-fit items-center rounded-[0.5rem] text-base font-semibold text-primary underline ${FOCUS_VISIBLE}`;

const STUDENT_FOLLOW_UP_HISTORY: FollowUpHistoryAudience = {
  audience: "student",
  appointmentStatusLabel,
  renderAppointmentLink: (appointmentId) => (
    <Link to="/estudiante/atenciones/$appointmentId" params={{ appointmentId }} className={LINK}>
      Ver la atención
    </Link>
  ),
  emptyHint: "Tu profesional registra el seguimiento después de cada atención.",
};

/** Historial de seguimiento del acompañamiento propio. */
export function StudentFollowUpHistory({ accompanimentId }: { accompanimentId: string }) {
  return (
    <StudentPanelErrorBoundary subject="el historial de seguimiento" level="section">
      <FollowUpHistory accompanimentId={accompanimentId} view={STUDENT_FOLLOW_UP_HISTORY} />
    </StudentPanelErrorBoundary>
  );
}

/**
 * Seguimiento de una atención propia. Solo se consulta cuando el estado de la
 * atención lo admite (realizada o inasistencia): en las demás no puede haber
 * seguimiento y la sección no aparece.
 */
export function StudentAppointmentFollowUp({
  appointmentId,
  appointmentStatus,
}: {
  appointmentId: string;
  appointmentStatus: AppointmentStatus;
}) {
  if (!admitsFollowUp(appointmentStatus)) return null;
  return (
    <section aria-labelledby="student-appointment-follow-up-title" className="mt-6">
      <h2 id="student-appointment-follow-up-title" className="text-2xl font-semibold text-primary">
        Seguimiento de esta atención
      </h2>
      <StudentPanelErrorBoundary subject="el seguimiento de la atención" level="section">
        <AppointmentFollowUpBody appointmentId={appointmentId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AppointmentFollowUpBody({ appointmentId }: { appointmentId: string }) {
  let record: ReturnType<typeof useFollowUpRecord>;
  try {
    // Hook primero y en todos los renders: el try solo clasifica el error.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    record = useFollowUpRecord(appointmentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return <DeniedState title="No tienes acceso al seguimiento de esta atención." />;
    }
    throw error;
  }

  if (record === undefined) return <LoadingState label="Cargando el seguimiento…" />;
  if (record === null) {
    return <p>Esta atención todavía no tiene seguimiento registrado.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <FollowUpRecordContent record={record} audience="student" />
      {/* La vista `shared` del Estudiante trae el acompañamiento; la minimizada no. */}
      {"accompanimentId" in record ? (
        <Link
          to="/estudiante/acompanamientos/$accompanimentId"
          params={{ accompanimentId: record.accompanimentId }}
          className={LINK}
        >
          Ver el acompañamiento
        </Link>
      ) : null}
    </div>
  );
}
