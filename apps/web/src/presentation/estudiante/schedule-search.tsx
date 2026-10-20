import { useEffect, useRef, useState } from "react";
import { formatSlotDateTime, modalityFilterOptions, modalityLabel } from "./agenda-labels.ts";
import { useSlotSearch } from "./schedule-search-data.ts";
import {
  type AgendaSlot,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import "../routes/student-portal.css";

/**
 * Búsqueda de horarios del Estudiante (TI2-101).
 *
 * Lee el adaptador vigente (ficticio hasta TI2-123) por el puerto de agenda:
 * filtros por modalidad, estados tipados de carga/vacío/sin-cupo/error y
 * selección de un cupo que TI2-102 consume para reservar. Sin reglas de
 * compatibilidad ni autorización en el cliente; los datos son ficticios.
 */
export function ScheduleSearchPage() {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="schedule-search-title">
      <h1 id="schedule-search-title" ref={headingRef} tabIndex={-1}>
        Buscar horarios
      </h1>
      <p>Datos ficticios de demostración.</p>
      <StudentPanelErrorBoundary subject="la búsqueda de horarios" level="section">
        <ScheduleSearchBody />
      </StudentPanelErrorBoundary>
    </section>
  );
}

function ScheduleSearchBody() {
  const [modality, setModality] = useState<SlotModalityFilter>("all");
  const [attempt, setAttempt] = useState(0);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const result = useSlotSearch(modality, attempt);

  function handleModalityChange(next: SlotModalityFilter) {
    setModality(next);
    setSelectedSlotId(null);
  }

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
                onChange={() => handleModalityChange(option.value)}
              />{" "}
              {option.label}
            </label>
          ))}
        </div>
      </fieldset>
      <SlotSearchContent
        result={result}
        selectedSlotId={selectedSlotId}
        onSelect={setSelectedSlotId}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    </>
  );
}

function SlotSearchContent({
  result,
  selectedSlotId,
  onSelect,
  onRetry,
}: {
  result: ReturnType<typeof useSlotSearch>;
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
  onRetry: () => void;
}) {
  return (
    <>
      <span role="status" aria-live="polite" className="sr-only">
        {searchAnnouncement(result)}
      </span>
      <SlotSearchResult
        result={result}
        selectedSlotId={selectedSlotId}
        onSelect={onSelect}
        onRetry={onRetry}
      />
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
  return result.slots.length === 1
    ? "1 cupo disponible."
    : `${result.slots.length} cupos disponibles.`;
}

function SlotSearchResult({
  result,
  selectedSlotId,
  onSelect,
  onRetry,
}: {
  result: ReturnType<typeof useSlotSearch>;
  selectedSlotId: string | null;
  onSelect: (slotId: string) => void;
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

  const selected = result.slots.find((slot) => slot.id === selectedSlotId) ?? null;

  return (
    <>
      <ul className="student-portal__list">
        {result.slots.map((slot) => (
          <li key={slot.id} className="student-portal__item">
            <label className="student-portal__slot flex cursor-pointer items-start gap-2">
              <input
                type="radio"
                name="cupo"
                value={slot.id}
                checked={selectedSlotId === slot.id}
                onChange={() => onSelect(slot.id)}
              />
              <span>
                <span className="student-portal__chip">{modalityLabel(slot.modality)}</span>{" "}
                <span className="student-portal__item-meta">
                  {formatSlotDateTime(slot.startAt, slot.endAt)}
                  {slot.spaceLabel ? ` · ${slot.spaceLabel}` : ""}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {selected && <SelectedSlotSummary slot={selected} />}
    </>
  );
}

function SelectedSlotSummary({ slot }: { slot: AgendaSlot }) {
  return (
    <section aria-labelledby="slot-elegido-title" aria-live="polite">
      <h2 id="slot-elegido-title">Cupo elegido</h2>
      <dl>
        <div>
          <dt>Fecha y hora</dt>
          <dd>{formatSlotDateTime(slot.startAt, slot.endAt)}</dd>
        </div>
        <div>
          <dt>Modalidad</dt>
          <dd>{modalityLabel(slot.modality)}</dd>
        </div>
        {slot.spaceLabel !== undefined && (
          <div>
            <dt>Espacio</dt>
            <dd>{slot.spaceLabel}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
