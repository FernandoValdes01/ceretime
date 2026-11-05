import { useEffect, useState } from "react";
import {
  type AgendaPort,
  type SlotSearchContext,
  type SlotModalityFilter,
  type SlotSearchResult,
} from "../../application/agenda/agenda-port.ts";
import { createConvexAgendaAdapter } from "../../infrastructure/agenda/convex-agenda-adapter.ts";
import { convexClient } from "../../infrastructure/convex/convex-client.ts";

/**
 * Lectura de horarios del Estudiante (TI2-101).
 *
 * Un solo adaptador vigente: el de Convex (TI2-123), con la API real. Los
 * fixtures quedan solo para pruebas. Cada búsqueda responde `undefined`
 * mientras carga; los fallos técnicos del adaptador se traducen al estado
 * `error` tipado (la UI nunca muestra excepciones en crudo).
 */

let agendaPort: AgendaPort | null = null;

/** Adaptador vigente. Exportado para pruebas. */
export function getAgendaPort(): AgendaPort {
  if (agendaPort === null) {
    agendaPort = createConvexAgendaAdapter(convexClient);
  }
  return agendaPort;
}

export function useSlotSearch(
  modality: SlotModalityFilter,
  attempt: number,
  context?: SlotSearchContext,
) {
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

  const accompanimentId = context?.accompanimentId;
  const professionalIds = context?.professionalIds;

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .searchSlots({
        modality,
        ...(accompanimentId === undefined || professionalIds === undefined
          ? {}
          : { context: { accompanimentId, professionalIds } }),
      })
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
  }, [modality, attempt, accompanimentId, professionalIds]);

  return result;
}
