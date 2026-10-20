import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ConvexError } from "convex/values";
// Fuente canónica del contrato de errores (TI2-23, TI2-88): el Backend
// responde toda denegación con este mensaje genérico, sin motivo ni
// existencia del recurso. Se importa del barrel, no se duplica el literal.
import { UNAUTHORIZED_ERROR_MESSAGE } from "../../../../../convex/domain/index.ts";
import { accompanimentStatusLabel } from "../routes/student-panel-labels.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { useOwnAccompanimentDetail } from "./student-accompaniments-data.ts";
import type { OwnAccompanimentDetail } from "./student-accompaniments-data.ts";

/**
 * Detalle del acompañamiento propio del Estudiante (TI2-90).
 *
 * Lee solo la query pública ya existente `getAccompaniment`, que el Backend
 * deniega sin filtrar existencia cuando el acompañamiento es ajeno o no
 * existe. La denegación muestra un estado permanente sin reintento; los
 * errores recuperables se lanzan al límite, que ofrece reintento acotado.
 * Muestra el estado con texto (nunca solo con color), el objetivo y
 * las necesidades de acceso propias cuando el contrato las entrega; la vista
 * minimizada no las trae y la fila se omite sin inventar contenido. Un
 * acompañamiento cerrado conserva su vista en solo lectura. No hay UI, texto
 * oculto ni llamada a `getInternalNotes`: las notas internas no pertenecen al
 * Estudiante. El historial básico se limita a la información disponible del
 * acompañamiento; el aviso final registra ese límite sin fabricar eventos.
 */
export function StudentAccompanimentDetailPage({ accompanimentId }: { accompanimentId: string }) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="student-accompaniment-detail-title" className="flex flex-col gap-6">
      <h1
        id="student-accompaniment-detail-title"
        ref={headingRef}
        tabIndex={-1}
        className="text-[1.75rem] leading-snug font-semibold text-primary"
      >
        Detalle del acompañamiento
      </h1>
      <p>
        <Link
          to="/estudiante"
          className="inline-flex min-h-[44px] items-center rounded-[0.5rem] px-3 py-2 no-underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
        >
          Volver al inicio
        </Link>
      </p>
      <StudentPanelErrorBoundary subject="el detalle del acompañamiento" level="section">
        <OwnAccompanimentDetailBody accompanimentId={accompanimentId} />
      </StudentPanelErrorBoundary>
    </section>
  );
}

/**
 * La denegación del Backend es el mensaje genérico documentado: no revela
 * si el acompañamiento existe ni de quién es. También cubre la sesión
 * expirada, que se recupera desde el acceso (el layout enlaza la sesión).
 *
 * El valor canónico viaja en `error.data`: el SDK del cliente decora
 * `error.message` con su contexto (query y request ID), así que comparar el
 * mensaje falla contra el Backend real.
 */
function isAuthorizationDenial(error: unknown): boolean {
  return error instanceof ConvexError && error.data === UNAUTHORIZED_ERROR_MESSAGE;
}

function OwnAccompanimentDetailBody({ accompanimentId }: { accompanimentId: string }) {
  let accompaniment: OwnAccompanimentDetail | undefined;
  try {
    // El hook se invoca primero y en todos los renders: el orden es estable
    // y el try solo clasifica el error ya lanzado, no condiciona la llamada.
    // eslint-disable-next-line react-hooks/rules-of-hooks
    accompaniment = useOwnAccompanimentDetail(accompanimentId);
  } catch (error) {
    if (isAuthorizationDenial(error)) {
      return (
        <div className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
          <p role="alert" className="mb-2 font-semibold text-on-surface">
            No tienes acceso a este acompañamiento.
          </p>
          <p>Si crees que deberías verlo, consulta los canales oficiales de CERETI.</p>
        </div>
      );
    }
    throw error;
  }

  if (accompaniment === undefined) {
    return (
      <p
        role="status"
        className="rounded-lg bg-surface-container-low p-6 text-lg text-on-surface-variant"
      >
        Cargando el detalle…
      </p>
    );
  }

  const closed = accompaniment.status === "closed";

  return (
    <>
      {closed ? (
        <p className="rounded-lg border-t-4 border-secondary-container bg-surface-container-low p-6 text-on-surface-variant">
          Este acompañamiento está cerrado y se muestra en solo lectura.
        </p>
      ) : null}
      <dl className="rounded-lg border border-border-low bg-surface-container-lowest p-8">
        <div className="py-2">
          <dt className="font-semibold text-on-surface">Estado</dt>
          <dd className="m-0 text-on-surface">{accompanimentStatusLabel(accompaniment.status)}</dd>
        </div>
        <div className="py-2">
          <dt className="font-semibold text-on-surface">Objetivo</dt>
          <dd className="m-0 text-on-surface">{accompaniment.objective}</dd>
        </div>
        {"accessNeeds" in accompaniment ? (
          <div className="py-2">
            <dt className="font-semibold text-on-surface">Necesidades de acceso</dt>
            <dd className="m-0 text-on-surface">{accompaniment.accessNeeds}</dd>
          </div>
        ) : null}
      </dl>
      <p className="text-base text-on-surface-variant">
        Historial básico: aquí ves el estado y el objetivo de tus acompañamientos. El detalle de
        atenciones y seguimiento aún no está disponible en el portal.
      </p>
    </>
  );
}
