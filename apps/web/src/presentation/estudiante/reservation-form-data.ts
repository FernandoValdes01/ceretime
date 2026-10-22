import { useEffect, useState } from "react";
import type { AgendaSlot } from "../../application/agenda/agenda-port.ts";
import { getAgendaPort } from "./schedule-search-data.ts";

/**
 * Lectura del cupo a confirmar (TI2-102).
 *
 * Reutiliza la búsqueda del puerto y elige por id: sin segundo almacén ni
 * nueva capacidad. Distingue carga, listo, ausente y fallo de lectura: un
 * fallo técnico no se presenta como cupo inexistente y permite reintentar
 * conservando el slotId de la URL.
 */
export type ReservationSlotState =
  | { status: "loading" }
  | { status: "ready"; slot: AgendaSlot }
  | { status: "missing" }
  | { status: "read-error" };

export function useReservationSlot(slotId: string | undefined): {
  state: ReservationSlotState;
  retry: () => void;
} {
  const [slots, setSlots] = useState<ReadonlyArray<AgendaSlot> | undefined>(undefined);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .searchSlots({ modality: "all" })
      .then(
        (result) => {
          if (cancelled) {
            return;
          }
          if (result.status === "error") {
            setFailed(true);
            setSlots([]);
          } else {
            setSlots(result.status === "ok" ? result.slots : []);
          }
        },
        () => {
          if (!cancelled) {
            setFailed(true);
            setSlots([]);
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setFailed(false);
    // Vuelve a carga: sin esto la lista vacía del fallo anterior se leería
    // como cupo ausente mientras la nueva búsqueda está pendiente.
    setSlots(undefined);
    setAttempt((count) => count + 1);
  }

  if (slotId === undefined) {
    return { state: { status: "missing" }, retry };
  }
  if (failed) {
    return { state: { status: "read-error" }, retry };
  }
  if (slots === undefined) {
    return { state: { status: "loading" }, retry };
  }
  const slot = slots.find((item) => item.id === slotId) ?? null;
  if (slot === null) {
    return { state: { status: "missing" }, retry };
  }
  return { state: { status: "ready", slot }, retry };
}
