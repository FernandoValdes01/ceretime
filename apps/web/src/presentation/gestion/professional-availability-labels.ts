import {
  AVAILABILITY_EXCEPTION_KIND_VALUES,
  MODALITY_VALUES,
  type AvailabilityException,
} from "../../../../../convex/domain/index.ts";

/**
 * Etiquetas del editor de disponibilidad del Profesional (TI2-103).
 *
 * Derivan de los literales canónicos sin duplicarlos: modalidad o clase
 * desconocida muestra el valor. Días, horas y fechas siempre como texto,
 * nunca solo con color.
 */

const WEEKDAY_LABELS: Record<number, string> = {
  0: "Domingo",
  1: "Lunes",
  2: "Martes",
  3: "Miércoles",
  4: "Jueves",
  5: "Viernes",
  6: "Sábado",
};

const MODALITY_LABELS: Record<string, string> = {
  inPerson: "Presencial",
  online: "En línea",
};

const EXCEPTION_KIND_LABELS: Record<string, string> = {
  cancelled: "Cancelación",
  added: "Agregado",
};

/** Etiqueta en español de un día de semana 0–6. */
export function weekdayLabel(weekday: number): string {
  return WEEKDAY_LABELS[weekday] ?? String(weekday);
}

/** Etiqueta en español de una modalidad del contrato canónico. */
export function availabilityModalityLabel(modality: string): string {
  return MODALITY_LABELS[modality] ?? modality;
}

/** Etiqueta en español de una clase de excepción del contrato canónico. */
export function exceptionKindLabel(kind: string): string {
  return EXCEPTION_KIND_LABELS[kind] ?? kind;
}

/** Verdadero cuando el valor es una modalidad del contrato canónico. */
export function isKnownAvailabilityModality(value: string): boolean {
  return (MODALITY_VALUES as ReadonlyArray<string>).includes(value);
}

/** Verdadero cuando el valor es una clase de excepción del contrato canónico. */
export function isKnownExceptionKind(value: string): boolean {
  return (AVAILABILITY_EXCEPTION_KIND_VALUES as ReadonlyArray<string>).includes(value);
}

/** Minutos del día a texto `HH:MM` en formato de 24 horas. */
export function formatMinuteOfDay(minute: number): string {
  const hour = Math.floor(minute / 60);
  const rest = minute - hour * 60;
  return `${String(hour).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** Rango de ventana como texto legible `HH:MM – HH:MM`. */
export function formatWindowRange(startMinute: number, endMinute: number): string {
  return `${formatMinuteOfDay(startMinute)} – ${formatMinuteOfDay(endMinute)}`;
}

/** Duración del cupo como texto legible (`30 minutos`). */
export function formatSlotDuration(slotMinutes: number): string {
  return `${slotMinutes} minutos`;
}

/**
 * Alcance visible de una cancelación: día completo o bloque concreto.
 *
 * Sin `blockId` la recurrencia del día queda cancelada pero los agregados
 * se conservan; con `blockId` solo se descuentan los cupos de ese bloque.
 * Para `added` no hay alcance que resumir: la excepción trae sus ventanas.
 */
export function exceptionScopeLabel(
  exception: Pick<AvailabilityException, "kind" | "blockId">,
): string {
  if (exception.kind !== "cancelled") {
    return "Ventanas del día";
  }
  const blockId = exception.blockId?.trim() ?? "";
  return blockId === "" ? "Día completo" : `Bloque ${blockId}`;
}
