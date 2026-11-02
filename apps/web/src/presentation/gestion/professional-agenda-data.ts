import { useEffect, useState } from "react";
import {
  APPOINTMENT_TRANSITIONS,
  toSpaceLabel,
  type AppointmentStatus,
} from "../../../../../convex/domain/index.ts";
import type {
  AgendaAppointmentResult,
  ListAppointmentsResult,
} from "../../application/agenda/agenda-port.ts";
import { appointmentChangeLabel } from "./gestion-labels.ts";
import { getAgendaPort, setAgendaPortForTests } from "./professional-availability-data.ts";

/**
 * Lectura y cambios de estado de la agenda del Profesional (TI2-115).
 *
 * Un solo adaptador vigente: reutiliza el singleton del puerto común de
 * agenda (TI2-103) para que agenda, editor y detalle compartan la misma
 * representación de la atención; no se crea una segunda store de reservas.
 * La lectura responde `undefined` mientras carga; los fallos técnicos se
 * traducen al estado `error` tipado y la denegación al estado `denied`
 * genérico sin detalles sensibles.
 *
 * Acá no hay validadores de política: los destinos disponibles se derivan
 * de la tabla canónica `APPOINTMENT_TRANSITIONS` del dominio y cualquier
 * cambio pasa por el puerto, que aplica la misma política que el Backend.
 */
export { getAgendaPort, setAgendaPortForTests };

export function useProfessionalAgenda(attempt: number): ListAppointmentsResult | undefined {
  const [result, setResult] = useState<ListAppointmentsResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .listAppointments()
      .then(
        (next) => {
          if (!cancelled) {
            setResult(next);
          }
        },
        () => {
          if (!cancelled) {
            setResult({
              status: "error",
              message: "No pudimos cargar la agenda. Inténtalo de nuevo.",
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return result;
}

export function useAgendaAppointment(
  appointmentId: string,
  attempt: number,
): AgendaAppointmentResult | undefined {
  const [result, setResult] = useState<AgendaAppointmentResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .getAppointment(appointmentId)
      .then(
        (next) => {
          if (!cancelled) {
            setResult(next);
          }
        },
        () => {
          if (!cancelled) {
            setResult({
              status: "error",
              message: "No pudimos cargar la atención. Inténtalo de nuevo.",
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [appointmentId, attempt]);

  return result;
}

/**
 * Etiquetas legibles de los espacios del catálogo, por identificador.
 *
 * El catálogo es de lectura para cualquier cuenta vigente (`space:read`) y
 * la etiqueta sale de `toSpaceLabel` del dominio. Mientras carga, o si la
 * lectura falla, el mapa queda vacío y la vista omite el espacio en vez de
 * mostrar un identificador interno.
 */
export function useSpaceLabels(): ReadonlyMap<string, string> {
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .listSpaces()
      .then(
        (result) => {
          if (!cancelled && result.status === "ok") {
            setLabels(new Map(result.spaces.map((space) => [space.id, toSpaceLabel(space)])));
          }
        },
        () => {
          // Sin catálogo la agenda sigue siendo útil: el espacio se omite.
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}

/** Cambio de estado ofertado al Profesional, derivado de la tabla canónica. */
export type StatusChangeOption = {
  /** Estado destino del contrato canónico de dominio. */
  readonly to: AppointmentStatus;
  /** Etiqueta operativa de la vista. */
  readonly label: string;
  /** El destino de dominio exige motivo (cancelación por CERETI). */
  readonly requiresReason: boolean;
};

/**
 * Cambios de estado disponibles desde un estado vigente (TI2-115).
 *
 * Derivan de `APPOINTMENT_TRANSITIONS` del dominio, sin política local.
 * El modo simulado no pide nuevas fechas, así que no se ofrece el
 * reagendamiento (la causa canónica `reschedule_required` lo protege si un
 * intento llegara igual), y cancelar por el estudiante pertenece a la vista
 * del Estudiante, no a la coordinación del Profesional. La autorización
 * efectiva de cada cambio la decide el Backend.
 */
export function statusChangeOptions(from: AppointmentStatus): ReadonlyArray<StatusChangeOption> {
  return APPOINTMENT_TRANSITIONS.filter(
    (transition) =>
      transition.from === from &&
      !transition.requiresReschedule &&
      transition.to !== "cancelled_by_student",
  ).map((transition) => ({
    to: transition.to,
    label: appointmentChangeLabel(transition.to),
    requiresReason: transition.requiresReason,
  }));
}
