import { useState } from "react";
import { toSpaceFields, type Space } from "../../../../../convex/domain/index.ts";
import type { AgendaAppointment } from "../../application/agenda/agenda-port.ts";
import { ErrorState, LoadingState } from "../shared/view-states.tsx";
import { SpaceAccessDetails } from "./space-access-details.tsx";
import { useOnlineAccess } from "./student-appointments-page-data.ts";
import { PRIMARY_LINK_CLASS, SECTION_TITLE_CLASS } from "./student-page-classes.ts";

/**
 * Cómo llegar a la atención (TI2-163).
 *
 * La presencial muestra la ubicación, las condiciones de acceso y las
 * instrucciones de llegada de su sala, del catálogo vigente. La atención en
 * línea consulta su acceso privado (TI2-142): el enlace solo aparece cuando un
 * profesional de la atención lo agregó. Los apoyos por atención no se muestran
 * porque la atención ya no los guarda (TI2-165).
 *
 * Solo se muestra mientras la atención sigue vigente: una cancelada o ya
 * resuelta no necesita instrucciones para llegar.
 */
export function AppointmentAccess({
  appointment,
  space,
  active,
}: {
  appointment: AgendaAppointment;
  /** Sala resuelta del catálogo; ausente si es en línea o no se pudo leer. */
  space: Space | undefined;
  /** Verdadero si la atención sigue programada o reagendada. */
  active: boolean;
}) {
  if (!active) {
    return null;
  }
  if (appointment.modality === "online") {
    return <OnlineAccess appointmentId={appointment.id} />;
  }
  if (space === undefined) {
    // La falta de sala ya la avisa el detalle con su propio reintento.
    return null;
  }
  return (
    <section aria-labelledby="appointment-access-title" className="mt-6 flex flex-col gap-3">
      <h2 id="appointment-access-title" className={SECTION_TITLE_CLASS}>
        Cómo llegar
      </h2>
      <SpaceAccessDetails space={toSpaceFields(space)} includePlace={false} />
    </section>
  );
}

function OnlineAccess({ appointmentId }: { appointmentId: string }) {
  const [attempt, setAttempt] = useState(0);
  const access = useOnlineAccess(appointmentId, attempt);

  return (
    <section aria-labelledby="appointment-online-title" className="mt-6 flex flex-col gap-3">
      <h2 id="appointment-online-title" className={SECTION_TITLE_CLASS}>
        Acceso en línea
      </h2>
      {access === undefined ? (
        <LoadingState label="Cargando el acceso en línea…" />
      ) : access.status === "error" ? (
        <ErrorState
          message={access.message}
          retryLabel="Reintentar cargar el acceso"
          onRetry={() => setAttempt((value) => value + 1)}
        />
      ) : access.status === "denied" ? (
        <p className="m-0">No tienes acceso al enlace de esta atención.</p>
      ) : access.status === "pending" ? (
        <p className="m-0">
          Tu profesional agregará el enlace privado de Google Meet antes de la atención. Te
          avisaremos cuando esté disponible.
        </p>
      ) : access.status === "available" ? (
        <>
          <p className="m-0">
            El enlace es solo para esta atención. No lo compartas con otras personas.
          </p>
          <a
            href={access.link}
            target="_blank"
            rel="noopener noreferrer"
            className={PRIMARY_LINK_CLASS}
          >
            Entrar a la atención en línea
            <span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </>
      ) : null}
    </section>
  );
}
