import { useEffect, useState } from "react";
import { toSpaceLabel } from "../../../../../convex/domain/index.ts";
import type {
  AgendaAppointment,
  AgendaAppointmentResult,
  ListAppointmentsResult,
} from "../../application/agenda/agenda-port.ts";
import { getAgendaPort } from "./schedule-search-data.ts";

/**
 * Lectura de las atenciones propias del Estudiante (TI2-114).
 *
 * La lista y el detalle reutilizan el mismo puerto común de agenda
 * (`listAppointments`/`getAppointment`) que la agenda del Profesional:
 * mientras la conexión real sigue pendiente (TI2-123), la lectura cae en el
 * adaptador ficticio vigente del flujo estudiantil y la vista lo declara
 * como demostración. El rol no se decide acá ni en el Cliente: cuando el
 * adaptador real responda, el Backend entrega solo las atenciones propias
 * del Estudiante y esta presentación no cambia.
 *
 * La proyección visible corresponde a la vista `shared` de TI2-112: el
 * motivo de cancelación es texto libre de la vista del Profesional y el
 * Estudiante no lo recibe ni lo muestra. El cálculo del plazo de
 * justificación pertenece al Backend (TI2-94) y la presentación y revisión
 * de justificaciones a TI2-119; nada de eso se calcula o inventa acá.
 */

/** Proyección con la vista visible del Estudiante: sin datos de terceros. */
function sharedViewOf(appointment: AgendaAppointment): AgendaAppointment {
  return {
    id: appointment.id,
    status: appointment.status,
    modality: appointment.modality,
    startAt: appointment.startAt,
    endAt: appointment.endAt,
    ...(appointment.spaceId === undefined ? {} : { spaceId: appointment.spaceId }),
    ...(appointment.originalStartAt === undefined
      ? {}
      : { originalStartAt: appointment.originalStartAt }),
  };
}

/** Lista de las atenciones propias, con la vista `shared` aplicada. */
export function useStudentAppointments(attempt: number): ListAppointmentsResult | undefined {
  const [result, setResult] = useState<ListAppointmentsResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: ListAppointmentsResult) => {
      if (!cancelled) {
        setResult(
          next.status === "ok"
            ? { status: "ok", appointments: next.appointments.map(sharedViewOf) }
            : next,
        );
      }
    };
    const port = getAgendaPort();
    if (port.watchAppointments !== undefined) {
      const unsubscribe = port.watchAppointments(apply);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    port.listAppointments().then(apply, () => {
      if (!cancelled) {
        apply({
          status: "error",
          message: "No pudimos cargar tus atenciones. Inténtalo de nuevo.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return result;
}

/** Detalle de una atención propia, con la vista `shared` aplicada. */
export function useStudentAppointment(
  appointmentId: string,
  attempt: number,
): AgendaAppointmentResult | undefined {
  const [result, setResult] = useState<AgendaAppointmentResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: AgendaAppointmentResult) => {
      if (!cancelled) {
        setResult(
          next.status === "ok"
            ? { status: "ok", appointment: sharedViewOf(next.appointment) }
            : next,
        );
      }
    };
    const port = getAgendaPort();
    if (port.watchAppointment !== undefined) {
      const unsubscribe = port.watchAppointment(appointmentId, apply);
      return () => {
        cancelled = true;
        unsubscribe();
      };
    }
    port.getAppointment(appointmentId).then(apply, () => {
      if (!cancelled) {
        apply({
          status: "error",
          message: "No pudimos cargar la atención. Inténtalo de nuevo.",
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [appointmentId, attempt]);

  return result;
}

/**
 * Etiquetas legibles de los espacios del catálogo, por identificador.
 *
 * La misma lectura compartida (`space:read`) resuelve la etiqueta con
 * `toSpaceLabel` del dominio. Mientras carga, o si la lectura falla, el mapa
 * queda vacío y la fila omite el espacio en vez de mostrar el identificador
 * interno.
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
          // Sin catálogo la lista sigue siendo útil: el espacio se omite.
        },
      );
    return () => {
      cancelled = true;
    };
  }, []);

  return labels;
}
