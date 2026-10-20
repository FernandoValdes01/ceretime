import { useEffect, useState } from "react";
import {
  type AgendaPort,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { createFictitiousAgendaAdapter } from "../../infrastructure/agenda/fictitious-agenda-adapter.ts";

/**
 * Lectura de horarios del Estudiante (TI2-101).
 *
 * Un solo adaptador vigente: el ficticio hasta TI2-123, que lo sustituye por
 * la API real sin tocar presentación. Cada búsqueda responde `undefined`
 * mientras carga; los fallos técnicos del adaptador se traducen al estado
 * `error` tipado (la UI nunca muestra excepciones en crudo).
 */

let agendaPort: AgendaPort | null = null;

/** Adaptador vigente (ficticio hasta TI2-123). Exportado para pruebas. */
export function getAgendaPort(): AgendaPort {
  if (agendaPort === null) {
    agendaPort = createFictitiousAgendaAdapter();
  }
  return agendaPort;
}

export function useSlotSearch(modality: SlotModalityFilter, attempt: number) {
  // El resultado guardado recuerda a qué búsqueda pertenece: al cambiar de
  // modalidad o reintentar se deriva `loading` en el render, sin conservar los
  // cupos del filtro anterior mientras llega la respuesta nueva.
  const [entry, setEntry] = useState<{
    modality: SlotModalityFilter;
    attempt: number;
    result?: SlotSearchResult;
  }>({ modality, attempt });
  const result =
    entry.modality === modality && entry.attempt === attempt ? entry.result : undefined;

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .searchSlots({ modality })
      .then(
        (next) => {
          if (!cancelled) {
            setEntry({ modality, attempt, result: next });
          }
        },
        () => {
          if (!cancelled) {
            setEntry({
              modality,
              attempt,
              result: {
                status: "error",
                message: "No pudimos cargar los horarios. Inténtalo de nuevo.",
              },
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [modality, attempt]);

  return result;
}
