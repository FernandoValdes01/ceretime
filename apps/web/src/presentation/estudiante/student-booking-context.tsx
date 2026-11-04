import { useEffect, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "../../../../../convex/_generated/api";
import type {
  BookingProfessionalResult,
  SlotSearchContext,
} from "../../application/agenda/agenda-port.ts";
import { getAgendaPort } from "./schedule-search-data.ts";

/**
 * Contexto que la API real exige para buscar y reservar (TI2-123).
 *
 * El acompañamiento sale de los propios y activos: el de la URL si está entre
 * ellos, el único si hay uno y, si hay varios, una elección explícita. El
 * profesional lo entrega el puerto. La autorización de ambos identificadores
 * vive en el Backend: aquí solo se decide qué pantalla mostrar, sin fixtures.
 */

/** Tope de acompañamientos leídos; un Estudiante tiene muy pocos activos. */
const OWNED_ACCOMPANIMENTS_LIMIT = 50;

function useOwnActiveAccompaniments() {
  const owned = useQuery(api.presentation.accompaniments.listOwnedAccompaniments, {
    paginationOpts: { numItems: OWNED_ACCOMPANIMENTS_LIMIT, cursor: null },
  });
  return owned?.page.filter((accompaniment) => accompaniment.status === "active");
}

function useBookingProfessional(accompanimentId: string | undefined, attempt: number) {
  const [entry, setEntry] = useState<{
    key: string;
    result: BookingProfessionalResult;
  } | null>(null);
  const key = `${accompanimentId ?? ""}:${attempt}`;

  useEffect(() => {
    if (accompanimentId === undefined) {
      return;
    }
    let cancelled = false;
    getAgendaPort()
      .findBookingProfessional(accompanimentId)
      .then(
        (result) => {
          if (!cancelled) {
            setEntry({ key, result });
          }
        },
        () => {
          if (!cancelled) {
            setEntry({
              key,
              result: {
                status: "error",
                message: "No pudimos cargar tu acompañamiento. Inténtalo de nuevo.",
              },
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [accompanimentId, key]);

  return entry?.key === key ? entry.result : undefined;
}

/** Muestra `children` solo con un contexto real; si no, explica qué falta. */
export function BookingContextGate({
  requestedAccompanimentId,
  children,
}: {
  requestedAccompanimentId: string | undefined;
  children: (context: SlotSearchContext) => ReactNode;
}) {
  const [attempt, setAttempt] = useState(0);
  const active = useOwnActiveAccompaniments();
  const accompanimentId =
    active?.find((accompaniment) => accompaniment._id === requestedAccompanimentId)?._id ??
    (active?.length === 1 ? active[0]._id : undefined);
  const professional = useBookingProfessional(accompanimentId, attempt);

  if (active === undefined) {
    return <BookingContextLoading />;
  }

  if (active.length === 0) {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes un acompañamiento activo.</p>
        <p>Para reservar una hora necesitas un acompañamiento activo.</p>
      </div>
    );
  }

  if (accompanimentId === undefined) {
    return (
      <section aria-labelledby="booking-accompaniment-title">
        <h2 id="booking-accompaniment-title">Elige un acompañamiento</h2>
        <ul className="student-portal__list">
          {active.map((accompaniment) => (
            <li key={accompaniment._id} className="student-portal__item">
              <Link to="/estudiante/horarios" search={{ accompanimentId: accompaniment._id }}>
                {accompaniment.objective}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  if (professional === undefined) {
    return <BookingContextLoading />;
  }

  if (professional.status === "none") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">
          Aún no podemos mostrar horarios de este acompañamiento.
        </p>
        <p>Inténtalo más tarde.</p>
      </div>
    );
  }

  if (professional.status === "denied") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes acceso a este acompañamiento.</p>
      </div>
    );
  }

  if (professional.status === "error") {
    return (
      <div>
        <p role="alert" className="student-portal__error">
          {professional.message}
        </p>
        <div className="student-portal__cta">
          <button
            type="button"
            className="student-portal__btn student-portal__btn--primary"
            onClick={() => setAttempt((count) => count + 1)}
          >
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  return <>{children({ accompanimentId, professionalId: professional.professionalId })}</>;
}

function BookingContextLoading() {
  return (
    <p role="status" className="student-portal__loading">
      Cargando tu acompañamiento…
    </p>
  );
}
