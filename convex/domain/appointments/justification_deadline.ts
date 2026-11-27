import { AGENDA_TIME_ZONE } from "../availability/availability";
import { CHILE_HOLIDAYS } from "../calendar/chile_holidays";
import {
  calculateJustificationDeadline,
  decideJustificationTimeliness,
  type JustificationDeadline,
  type JustificationTimeliness,
} from "./appointment";

/**
 * Calendario único del plazo de justificación (TI2-147).
 *
 * Entregar, revisar y vencer usan estas dos funciones: la misma zona de la
 * agenda y el mismo catálogo de feriados de Chile. Antes cada caso de uso
 * armaba los argumentos por su cuenta y el barrido usaba feriados que la
 * entrega ignoraba, así un feriado podía cambiar solo el cierre automático.
 *
 * Dominio puro: no lee el reloj ni toca Convex. El instante siempre lo pasa
 * quien llama (servidor o prueba).
 */

/** Plazo de cinco días hábiles para una inasistencia en la zona de la agenda. */
export function justificationDeadlineFor(missedAt: number): JustificationDeadline {
  return calculateJustificationDeadline({
    missedAt,
    timeZone: AGENDA_TIME_ZONE,
    holidays: CHILE_HOLIDAYS,
  });
}

/** Puntualidad de una entrega con el mismo plazo que usan revisar y vencer. */
export function justificationTimelinessFor(
  missedAt: number,
  submittedAt: number,
): JustificationTimeliness {
  return decideJustificationTimeliness({
    missedAt,
    submittedAt,
    timeZone: AGENDA_TIME_ZONE,
    holidays: CHILE_HOLIDAYS,
  });
}
