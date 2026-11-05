import { useEffect, useRef, useState } from "react";
import { Link, getRouteApi } from "@tanstack/react-router";
import {
  formatSlotTimeRange,
  groupSlotsByWeek,
  modalityFilterOptions,
  modalityLabel,
} from "./agenda-labels.ts";
import { useSlotSearch } from "./schedule-search-data.ts";
import { BookingContextGate } from "./student-booking-context.tsx";
import {
  type AgendaSlot,
  type SlotSearchContext,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";

/**
 * Búsqueda de horarios del Estudiante (TI2-101).
 *
 * Lee la API real (TI2-123) por el puerto de agenda:
 * filtros por modalidad, estados tipados de carga/vacío/sin-cupo/error y cupos
 * por semana, cada uno con enlace directo a la confirmación de TI2-102. Sin
 * reglas de compatibilidad ni autorización en el cliente.
 */
const horariosRouteApi = getRouteApi("/estudiante/horarios");

export function ScheduleSearchPage() {
  const { accompanimentId } = horariosRouteApi.useSearch();
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="schedule-search-title">
      <h1 id="schedule-search-title" ref={headingRef} tabIndex={-1}>
        Buscar horarios
      </h1>
      <StudentPanelErrorBoundary subject="la búsqueda de horarios" level="section">
        <BookingContextGate requestedAccompanimentId={accompanimentId}>
          {(context) => <ScheduleSearchBody context={context} />}
        </BookingContextGate>
      </StudentPanelErrorBoundary>
    </section>
  );
}

function ScheduleSearchBody({ context }: { context: SlotSearchContext }) {
  const [modality, setModality] = useState<SlotModalityFilter>("all");
  const [attempt, setAttempt] = useState(0);
  const result = useSlotSearch(modality, attempt, context);

  return (
    <>
      <fieldset>
        <legend>Modalidad</legend>
        <div className="flex flex-wrap gap-2">
          {modalityFilterOptions().map((option) => (
            <label
              key={option.value}
              className="student-portal__chip student-portal__chip--control"
            >
              <input
                type="radio"
                name="modalidad"
                value={option.value}
                checked={modality === option.value}
                onChange={() => setModality(option.value)}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <SlotSearchContent
        accompanimentId={context.accompanimentId}
        result={result}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    </>
  );
}

function SlotSearchContent({
  accompanimentId,
  result,
  onRetry,
}: {
  accompanimentId: string;
  result: ReturnType<typeof useSlotSearch>;
  onRetry: () => void;
}) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {searchAnnouncement(result)}
      </span>
      <SlotSearchResult accompanimentId={accompanimentId} result={result} onRetry={onRetry} />
    </>
  );
}

/**
 * Anuncia el desenlace de cada búsqueda sin duplicar el texto visible: el foco
 * sigue en el filtro, así que el cambio solo llega por esta región viva.
 */
function searchAnnouncement(result: SlotSearchResult | undefined): string {
  if (result === undefined) {
    return "Buscando horarios disponibles.";
  }
  if (result.status === "error") {
    return "Error al cargar los horarios.";
  }
  if (result.status === "empty") {
    return "Sin resultados para la modalidad elegida.";
  }
  if (result.status === "no_availability") {
    return "Sin cupos compatibles en este momento.";
  }
  if (result.status === "denied") {
    return "Sin acceso a los horarios.";
  }
  return result.slots.length === 1
    ? "1 cupo disponible."
    : `${result.slots.length} cupos disponibles.`;
}

function SlotSearchResult({
  accompanimentId,
  result,
  onRetry,
}: {
  accompanimentId: string;
  result: ReturnType<typeof useSlotSearch>;
  onRetry: () => void;
}) {
  if (result === undefined) {
    return <p className="student-portal__loading">Cargando horarios…</p>;
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

  if (result.status === "empty") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No hay horarios para esta modalidad.</p>
        <p>Prueba con otra modalidad.</p>
      </div>
    );
  }

  if (result.status === "no_availability") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No hay cupos compatibles por ahora.</p>
        <p>Puedes probar con otra modalidad o volver más tarde.</p>
      </div>
    );
  }

  if (result.status === "denied") {
    return (
      <div className="student-portal__empty">
        <p className="student-portal__empty-title">No tienes acceso a estos horarios.</p>
      </div>
    );
  }

  return <SlotWeeks slots={result.slots} accompanimentId={accompanimentId} />;
}

/**
 * Una semana a la vez: cada cupo es un enlace directo a la confirmación. Al
 * cambiar de semana el foco va al encabezado, que se anuncia una sola vez y
 * evita perderlo cuando el botón pulsado queda deshabilitado en un extremo.
 */
function SlotWeeks({
  slots,
  accompanimentId,
}: {
  slots: ReadonlyArray<AgendaSlot>;
  accompanimentId: string;
}) {
  const weeks = groupSlotsByWeek(slots);
  const [requestedStart, setRequestedStart] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  const found = weeks.findIndex((week) => week.start === requestedStart);
  const index = found === -1 ? 0 : found;
  const week = weeks[index];

  useEffect(() => {
    if (focusPending.current) {
      focusPending.current = false;
      headingRef.current?.focus();
    }
  }, [week.start]);

  function goTo(next: number) {
    focusPending.current = true;
    setRequestedStart(weeks[next].start);
  }

  return (
    <section aria-labelledby="slot-week-title" className="student-portal__weeks">
      <h2 id="slot-week-title" ref={headingRef} tabIndex={-1}>
        Semana del {week.label}
      </h2>
      <div className="student-portal__week-nav">
        <button
          type="button"
          className="student-portal__btn student-portal__btn--ghost"
          disabled={index === 0}
          onClick={() => goTo(index - 1)}
        >
          Semana anterior
        </button>
        <button
          type="button"
          className="student-portal__btn student-portal__btn--ghost"
          disabled={index === weeks.length - 1}
          onClick={() => goTo(index + 1)}
        >
          Semana siguiente
        </button>
      </div>
      {week.days.map((day) => (
        <section key={day.date} aria-labelledby={`slot-day-${day.date}`}>
          <h3 id={`slot-day-${day.date}`} className="student-portal__day-title">
            {day.label}
          </h3>
          <ul className="student-portal__list">
            {day.slots.map((slot) => (
              <li key={slot.id} className="student-portal__item">
                <Link
                  to="/estudiante/reservar"
                  search={{ slotId: slot.id, accompanimentId }}
                  className="student-portal__item-link student-portal__slot-link"
                >
                  <span className="sr-only">{day.label}, </span>
                  <span>{formatSlotTimeRange(slot.startAt, slot.endAt)}</span>
                  <span className="student-portal__chip">{modalityLabel(slot.modality)}</span>
                  {slot.spaceLabel && (
                    <span className="student-portal__item-meta">{slot.spaceLabel}</span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
