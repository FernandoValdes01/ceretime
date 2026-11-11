import { useEffect, useState } from "react";
import { toSpaceLabel } from "../../../../../convex/domain/index.ts";
import type {
  AgendaAppointment,
  AgendaAppointmentResult,
  ListAppointmentsResult,
} from "../../application/agenda/agenda-port.ts";
import { getAgendaPort } from "./schedule-search-data.ts";

/** Ventana de la lista según el adaptador, para declararla en pantalla. */
export {
  AGENDA_DAYS_AFTER,
  AGENDA_DAYS_BEFORE,
} from "../../infrastructure/agenda/convex-agenda-adapter.ts";

/**
 * Lectura de las atenciones propias del Estudiante (TI2-114).
 *
 * La lista y el detalle reutilizan el mismo puerto común de agenda
 * (`listAppointments`/`getAppointment`) que la agenda del Profesional,
 * conectado a la API por TI2-123. El rol no se decide acá ni en el Cliente:
 * el Backend entrega solo las atenciones propias del Estudiante, dentro de
 * la ventana de lectura del adaptador.
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
  // El resultado recuerda a qué intento pertenece: al reintentar se deriva la
  // carga en el render, sin conservar el error anterior mientras llega la
  // respuesta nueva.
  const [entry, setEntry] = useState<{
    attempt: number;
    result?: ListAppointmentsResult;
  }>({ attempt });

  useEffect(() => {
    let cancelled = false;
    const apply = (next: ListAppointmentsResult) => {
      if (!cancelled) {
        setEntry({
          attempt,
          result:
            next.status === "ok"
              ? { status: "ok", appointments: next.appointments.map(sharedViewOf) }
              : next,
        });
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

  return entry.attempt === attempt ? entry.result : undefined;
}

/** Detalle de una atención propia, con la vista `shared` aplicada. */
export function useStudentAppointment(
  appointmentId: string,
  attempt: number,
): AgendaAppointmentResult | undefined {
  // Igual que la lista, el resultado recuerda a qué lectura pertenece.
  const [entry, setEntry] = useState<{
    appointmentId: string;
    attempt: number;
    result?: AgendaAppointmentResult;
  }>({ appointmentId, attempt });

  useEffect(() => {
    let cancelled = false;
    const apply = (next: AgendaAppointmentResult) => {
      if (!cancelled) {
        setEntry({
          appointmentId,
          attempt,
          result:
            next.status === "ok"
              ? { status: "ok", appointment: sharedViewOf(next.appointment) }
              : next,
        });
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

  return entry.appointmentId === appointmentId && entry.attempt === attempt
    ? entry.result
    : undefined;
}

/** Catálogo de salas por identificador, con su estado de lectura y reintento. */
export type SpaceLabels = {
  readonly labels: ReadonlyMap<string, string>;
  /** Verdadero cuando la lectura terminó; una sala sin etiqueta queda sin resolver. */
  readonly settled: boolean;
  readonly retry: () => void;
};

const NO_SPACE_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * Etiquetas legibles de los espacios del catálogo, por identificador.
 *
 * La misma lectura compartida (`space:read`) resuelve la etiqueta con
 * `toSpaceLabel` del dominio. Mientras carga, o si la lectura falla, el mapa
 * queda vacío y la fila omite el espacio en vez de mostrar el identificador
 * interno; `settled` permite avisar de la sala sin resolver y `retry` vuelve a
 * leer el catálogo sin afectar a las atenciones ya cargadas.
 */
export function useSpaceLabels(): SpaceLabels {
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<{
    attempt: number;
    labels: ReadonlyMap<string, string>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (labels: ReadonlyMap<string, string>) => {
      if (!cancelled) {
        setEntry({ attempt, labels });
      }
    };
    getAgendaPort()
      .listSpaces()
      .then(
        (result) => {
          settle(
            result.status === "ok"
              ? new Map(result.spaces.map((space) => [space.id, toSpaceLabel(space)]))
              : NO_SPACE_LABELS,
          );
        },
        () => {
          // Sin catálogo la lista sigue siendo útil: el espacio se omite con aviso.
          settle(NO_SPACE_LABELS);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const settled = entry !== null && entry.attempt === attempt;
  return {
    labels: settled ? entry.labels : NO_SPACE_LABELS,
    settled,
    retry: () => setAttempt((value) => value + 1),
  };
}
