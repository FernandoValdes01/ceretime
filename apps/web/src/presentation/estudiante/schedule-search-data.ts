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

/** Aplica el filtro de modalidad a una búsqueda ya cargada. */
function filterByModality(
  result: SlotSearchResult | undefined,
  modality: SlotModalityFilter,
): SlotSearchResult | undefined {
  if (result?.status !== "ok" || modality === "all") {
    return result;
  }
  const slots = result.slots.filter((slot) => slot.modality === modality);
  return slots.length === 0 ? { status: "empty" } : { status: "ok", slots };
}

export function useSlotSearch(
  modality: SlotModalityFilter,
  attempt: number,
  context?: SlotSearchContext,
) {
  // Se carga una sola vez por intento: cambiar la modalidad filtra lo ya leído
  // sin repetir la búsqueda. El resultado guardado recuerda su intento: al
  // reintentar se deriva `loading` en el render, sin conservar los cupos previos.
  const [entry, setEntry] = useState<{ attempt: number; result?: SlotSearchResult }>({ attempt });
  const result = entry.attempt === attempt ? entry.result : undefined;

  const accompanimentId = context?.accompanimentId;
  const professionalIds = context?.professionalIds;

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .searchSlots({
        modality: "all",
        ...(accompanimentId === undefined || professionalIds === undefined
          ? {}
          : { context: { accompanimentId, professionalIds } }),
      })
      .then(
        (next) => {
          if (!cancelled) {
            setEntry({ attempt, result: next });
          }
        },
        () => {
          if (!cancelled) {
            setEntry({
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
  }, [attempt, accompanimentId, professionalIds]);

  return filterByModality(result, modality);
}
