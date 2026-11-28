import { useEffect, useState } from "react";
import { toSpaceLabel } from "../../../../../convex/domain/index.ts";
import type { Space } from "../../../../../convex/domain/index.ts";
import type {
  AgendaAppointment,
  AgendaAppointmentResult,
  ListAppointmentsResult,
  OnlineAccessResult,
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
 * Estudiante no lo recibe ni lo muestra. La vista sí trae el acompañamiento,
 * para reagendar con la misma búsqueda, y la recepción y revisión de la
 * justificación (TI2-163); el plazo sale del dominio compartido (TI2-147).
 */

/**
 * Proyección con la vista visible del Estudiante: todo lo de la atención salvo
 * el motivo de cancelación, que es de la vista del Profesional.
 */
function sharedViewOf(appointment: AgendaAppointment): AgendaAppointment {
  return appointment.cancelReason === undefined
    ? appointment
    : { ...appointment, cancelReason: undefined };
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

/**
 * Detalle de una atención propia, con la vista `shared` aplicada.
 *
 * `attempt` reintenta tras un error y vuelve a la carga; `revision` relee
 * después de un cambio propio conservando lo mostrado hasta que llega la
 * respuesta nueva, para no perder el foco ni la atención anterior. Sin
 * identificador no consulta nada: la confirmación de reserva solo lee la
 * atención cuando cambia su horario (TI2-163).
 */
export function useStudentAppointment(
  appointmentId: string | undefined,
  attempt: number,
  revision = 0,
): AgendaAppointmentResult | undefined {
  // Igual que la lista, el resultado recuerda a qué lectura pertenece.
  const [entry, setEntry] = useState<{
    appointmentId: string | undefined;
    attempt: number;
    result?: AgendaAppointmentResult;
  }>({ appointmentId, attempt });

  useEffect(() => {
    if (appointmentId === undefined) {
      return;
    }
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
  }, [appointmentId, attempt, revision]);

  return entry.appointmentId === appointmentId && entry.attempt === attempt
    ? entry.result
    : undefined;
}

/**
 * Acceso a la atención en línea (TI2-142). Lo consulta solo la sección de una
 * atención en línea; el enlace privado nunca viaja en la agenda.
 */
export function useOnlineAccess(
  appointmentId: string,
  attempt: number,
): OnlineAccessResult | undefined {
  const [entry, setEntry] = useState<{
    key: string;
    result: OnlineAccessResult;
  } | null>(null);
  const key = `${appointmentId}:${attempt}`;

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .getOnlineAccess(appointmentId)
      .then(
        (result) => {
          if (!cancelled) {
            setEntry({ key, result });
          }
        },
        () => {
          if (!cancelled) {
            setEntry({
              key,
              result: {
                status: "error",
                message: "No pudimos cargar el acceso en línea. Inténtalo de nuevo.",
              },
            });
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [appointmentId, key]);

  return entry?.key === key ? entry.result : undefined;
}

/** Catálogo de salas por identificador, con su estado de lectura y reintento. */
export type SpaceLabels = {
  readonly labels: ReadonlyMap<string, string>;
  /** Salas completas, con condiciones de acceso e instrucciones de llegada (TI2-163). */
  readonly spaces: ReadonlyMap<string, Space>;
  /** Verdadero cuando la lectura terminó; una sala sin etiqueta queda sin resolver. */
  readonly settled: boolean;
  readonly retry: () => void;
};

const NO_SPACES: ReadonlyMap<string, Space> = new Map();

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
    spaces: ReadonlyMap<string, Space>;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const settle = (spaces: ReadonlyMap<string, Space>) => {
      if (!cancelled) {
        setEntry({ attempt, spaces });
      }
    };
    getAgendaPort()
      .listSpaces()
      .then(
        (result) => {
          settle(
            result.status === "ok"
              ? new Map(result.spaces.map((space) => [space.id, space]))
              : NO_SPACES,
          );
        },
        () => {
          // Sin catálogo la lista sigue siendo útil: el espacio se omite con aviso.
          settle(NO_SPACES);
        },
      );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const settled = entry !== null && entry.attempt === attempt;
  const spaces = settled ? entry.spaces : NO_SPACES;
  return {
    labels: new Map([...spaces].map(([id, space]) => [id, toSpaceLabel(space)])),
    spaces,
    settled,
    retry: () => setAttempt((value) => value + 1),
  };
}
