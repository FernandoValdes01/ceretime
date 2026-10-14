import { useEffect, useState } from "react";
import type { AgendaSlot } from "../../application/agenda/agenda-port.ts";
import { getAgendaPort } from "./schedule-search-data.ts";

/**
 * Lectura del cupo a confirmar (TI2-102).
 *
 * Reutiliza la búsqueda del puerto y elige por id: sin segundo almacén ni
 * nueva capacidad. `undefined` carga, `null` ausente (sin slotId o ya no
 * publicado). Los fallos de lectura caen al caso ausente con vuelta.
 */
export function useReservationSlot(slotId: string | undefined) {
  const [slots, setSlots] = useState<ReadonlyArray<AgendaSlot> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .searchSlots({ modality: "all" })
      .then(
        (result) => {
          if (!cancelled) {
            setSlots(result.status === "ok" ? result.slots : []);
          }
        },
        () => {
          if (!cancelled) {
            setSlots([]);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  if (slotId === undefined) {
    return null;
  }
  if (slots === undefined) {
    return undefined;
  }
  return slots.find((slot) => slot.id === slotId) ?? null;
}
