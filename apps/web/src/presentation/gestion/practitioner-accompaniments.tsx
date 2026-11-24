import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { accompanimentStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";
import {
  ACCOMPANIMENT_BACK_LINK,
  ACCOMPANIMENT_TITLE,
  AssignedAccompanimentsList,
} from "./assigned-accompaniments-list.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import {
  toMinimizedAccompaniment,
  useAssignedAccompanimentDetail,
} from "./practitioner-accompaniments-data.ts";
import { DeniedState, LoadingState } from "../shared/view-states.tsx";

/**
 * Acompañamientos asignados al Practicante en solo lectura (TI2-116).
 *
 * Lee solo las queries públicas ya existentes; la autorización vive en
 * Convex, que entrega la vista minimizada (`_id`, `status`, `objective`,
 * `view`) de los acompañamientos con asignación vigente y deniega sin
 * filtrar existencia en cualquier otro caso, también cuando la asignación
 * se revoca con la URL abierta. Sin acciones profesionales (tomar, notas,
 * cambios de estado) ni llamada a `getInternalNotes`: el Practicante no
 * hereda permisos del Profesional. El listado paginado lo comparte con el
 * Profesional (`assigned-accompaniments-list.tsx`).
 */

/**
 * Salida de la denegación: el aviso propio del Practicante y el canal donde
 * consultar, fuera del `role="alert"` para que el anuncio sea solo el título.
 */
const PRACTITIONER_DENIED_HINT =
  "Si crees que deberías verlo, consulta con el Profesional a cargo o con CERETI.";

export function PractitionerAccompanimentsPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="practitioner-accompaniments-title">
      <h1
        id="practitioner-accompaniments-title"
        ref={headingRef}
        tabIndex={-1}
        className={ACCOMPANIMENT_TITLE}
      >
        Acompañamientos asignados
      </h1>
      <p>
        Consulta en solo lectura el estado y el objetivo de los acompañamientos que te asignaron.
      </p>
      <StudentPanelErrorBoundary subject="tus acompañamientos asignados" level="section">
        <AssignedAccompanimentsList
          area="practitioner"
          texts={{
            loading: "Cargando tus acompañamientos…",
            deniedTitle: "No tienes acceso a acompañamientos asignados.",
            deniedHint: PRACTITIONER_DENIED_HINT,
            emptyTitle: "No tienes acompañamientos asignados.",
            emptyHint: "Cuando un Profesional te asigne un acompañamiento, aparecerá aquí.",
          }}
        />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/**
 * Detalle minimizado de un acompañamiento asignado (TI2-116).
 *
 * Solo estado y objetivo: el Backend no entrega al Practicante `studentId`,
 * `accessNeeds` ni notas internas. La denegación (sin asignación, revocada,
 * otra cuenta o inexistente) muestra el mismo aviso permanente sin revelar
 * si el acompañamiento existe; como la query es reactiva, una revocación
 * con la página abierta reemplaza el contenido por ese aviso.
 */
export function PractitionerAccompanimentDetailPage({
  accompanimentId,
}: {
  accompanimentId: string;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="practitioner-accompaniment-detail-title">
      <h1
        id="practitioner-accompaniment-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className={ACCOMPANIMENT_TITLE}
      >
        Detalle del acompañamiento
      </h1>
      <p>
        <Link to="/practicante/acompanamientos" className={ACCOMPANIMENT_BACK_LINK}>
          <span aria-hidden="true">←</span> Volver a acompañamientos
        </Link>
      </p>
      <StudentPanelErrorBoundary
        key={accompanimentId}
        subject="el detalle del acompañamiento"
        level="section"
      >
        <AssignedAccompanimentDetailBody accompanimentId={accompanimentId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function AssignedAccompanimentDetailBody({ accompanimentId }: { accompanimentId: string }) {
  let view: ReturnType<typeof useAssignedAccompanimentDetail>;
  try {
    // Mismo patrón que el listado: hook primero y en todos los renders.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    view = useAssignedAccompanimentDetail(accompanimentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <DeniedState
          title="No tienes acceso a este acompañamiento."
          description={PRACTITIONER_DENIED_HINT}
        />
      );
    }
    throw error;
  }

  if (view === undefined) {
    return <LoadingState label="Cargando el detalle…" />;
  }

  const accompaniment = toMinimizedAccompaniment(view);

  return (
    <>
      <p className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
        Vista de solo lectura: como Practicante consultas el estado y el objetivo del acompañamiento
        asignado.
      </p>
      <dl className="m-0 divide-y divide-(--ct-line)">
        <div className="py-3">
          <dt className="text-sm font-semibold text-on-surface">Estado</dt>
          <dd className="m-0 text-base text-on-surface">
            {accompanimentStatusLabel(accompaniment.status)}
          </dd>
        </div>
        <div className="py-3">
          <dt className="text-sm font-semibold text-on-surface">Objetivo</dt>
          <dd className="m-0 text-base text-on-surface">{accompaniment.objective}</dd>
        </div>
      </dl>
    </>
  );
}
