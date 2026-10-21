import { MODALITY_VALUES } from "../../../../../convex/domain/index.ts";
import {
  SLOT_MODALITY_FILTER_VALUES,
  type SlotModalityFilter,
} from "../../application/agenda/agenda-port.ts";

/**
 * Etiquetas de agenda del Estudiante (TI2-101).
 *
 * Derivan de los literales canónicos sin duplicarlos: modalidad desconocida
 * muestra el valor. Fecha y hora siempre como texto, nunca solo con color.
 */

const MODALITY_LABELS: Record<string, string> = {
  inPerson: "Presencial",
  online: "En línea",
};

/** Etiqueta en español de una modalidad del contrato canónico. */
export function modalityLabel(modality: string): string {
  return MODALITY_LABELS[modality] ?? modality;
}

/** Opciones del filtro de modalidad en orden de la vista. */
export function modalityFilterOptions(): ReadonlyArray<{
  value: SlotModalityFilter;
  label: string;
}> {
  return SLOT_MODALITY_FILTER_VALUES.map((value) => ({
    value,
    label: value === "all" ? "Todas" : modalityLabel(value),
  }));
}

/** Verifica que un valor sea una modalidad del contrato canónico. */
export function isKnownModality(value: string): boolean {
  return (MODALITY_VALUES as ReadonlyArray<string>).includes(value);
}

const SLOT_DATE_FORMAT = new Intl.DateTimeFormat("es-CL", {
  weekday: "long",
  day: "numeric",
  month: "long",
});

const SLOT_TIME_FORMAT = new Intl.DateTimeFormat("es-CL", {
  hour: "numeric",
  minute: "2-digit",
});

/** Fecha y hora legibles de un cupo (epoch en milisegundos). */
export function formatSlotDateTime(startAt: number, endAt: number): string {
  return `${SLOT_DATE_FORMAT.format(startAt)}, ${SLOT_TIME_FORMAT.format(startAt)} – ${SLOT_TIME_FORMAT.format(endAt)}`;
}
