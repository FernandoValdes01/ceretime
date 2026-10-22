import { useEffect, useState } from "react";
import type {
  AgendaPort,
  ListAvailabilityResult,
  SaveBlockInput,
  SaveExceptionInput,
} from "../../application/agenda/agenda-port.ts";
import { createFictitiousAgendaAdapter } from "../../infrastructure/agenda/fictitious-agenda-adapter.ts";

/**
 * Lectura y validación de formato del editor de disponibilidad (TI2-103).
 *
 * Un solo adaptador vigente: el ficticio hasta TI2-125, que lo sustituye por
 * la API real sin tocar presentación. La lectura responde `undefined`
 * mientras carga; los fallos técnicos se traducen al estado `error` tipado
 * y la denegación al estado `denied` genérico sin detalles sensibles.
 *
 * Los validadores de formato solo revisan horas, rangos y presencia de
 * campos para dar errores legibles y accesibles. No sustituyen los
 * invariantes de Dominio (TI2-81): la autorización efectiva y las reglas de
 * duración, recurrencia y cruces viven en el Backend.
 */

let agendaPort: AgendaPort | null = null;

/** Adaptador vigente (ficticio hasta TI2-125). Exportado para pruebas. */
export function getAgendaPort(): AgendaPort {
  if (agendaPort === null) {
    agendaPort = createFictitiousAgendaAdapter();
  }
  return agendaPort;
}

/** Fija el adaptador en pruebas para simular lectura y guardado. */
export function setAgendaPortForTests(next: AgendaPort | null): void {
  agendaPort = next;
}

export function useProfessionalAvailability(attempt: number) {
  const [result, setResult] = useState<ListAvailabilityResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    getAgendaPort()
      .listAvailability()
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
              message: "No pudimos cargar la disponibilidad. Inténtalo de nuevo.",
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

/** Campos del formulario de bloque tal como los edita el Profesional. */
export type BlockFormState = {
  weekday: string;
  startTime: string;
  endTime: string;
  slotMinutes: string;
  modality: string;
  spaceId: string;
};

/** Campos del formulario de excepción tal como los edita el Profesional. */
export type ExceptionFormState = {
  date: string;
  kind: string;
  blockId: string;
  startTime: string;
  endTime: string;
  slotMinutes: string;
  modality: string;
  spaceId: string;
};

export const EMPTY_BLOCK_FORM: BlockFormState = {
  weekday: "",
  startTime: "",
  endTime: "",
  slotMinutes: "",
  modality: "",
  spaceId: "",
};

export const EMPTY_EXCEPTION_FORM: ExceptionFormState = {
  date: "",
  kind: "",
  blockId: "",
  startTime: "",
  endTime: "",
  slotMinutes: "",
  modality: "",
  spaceId: "",
};

/** Texto `HH:MM` a minutos del día; `null` ante formato inválido. */
export function parseTimeToMinutes(value: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value.trim());
  if (match === null) {
    if (value.trim() === "24:00") {
      return 1440;
    }
    return null;
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Verdadero ante fecha civil `YYYY-MM-DD` real del calendario. */
export function isValidDateText(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const roundTrip = new Date(Date.UTC(year, month - 1, day));
  return (
    roundTrip.getUTCFullYear() === year &&
    roundTrip.getUTCMonth() === month - 1 &&
    roundTrip.getUTCDate() === day
  );
}

function validateWindowFields(
  startTime: string,
  endTime: string,
  slotMinutesText: string,
  modality: string,
  spaceId: string,
  prefix: string,
): { errors: Record<string, string>; startMinute: number | null; endMinute: number | null } {
  const errors: Record<string, string> = {};
  const startMinute = parseTimeToMinutes(startTime);
  const endMinute = parseTimeToMinutes(endTime);
  if (startMinute === null) {
    errors[`${prefix}startTime`] = "Usa el formato HH:MM de 24 horas.";
  }
  if (endMinute === null) {
    errors[`${prefix}endTime`] = "Usa el formato HH:MM de 24 horas.";
  }
  if (startMinute !== null && endMinute !== null && !(startMinute < endMinute)) {
    errors[`${prefix}endTime`] = "La hora de término debe ser posterior al inicio.";
  }
  const slotMinutes = Number(slotMinutesText.trim());
  if (!Number.isInteger(slotMinutes) || slotMinutes <= 0) {
    errors[`${prefix}slotMinutes`] = "La duración debe ser un número entero mayor que cero.";
  } else if (startMinute !== null && endMinute !== null && slotMinutes > endMinute - startMinute) {
    errors[`${prefix}slotMinutes`] = "La duración no cabe en el rango indicado.";
  }
  if (modality !== "inPerson" && modality !== "online") {
    errors[`${prefix}modality`] = "Elige presencial o en línea.";
  }
  if (modality === "inPerson" && spaceId.trim() === "") {
    errors[`${prefix}spaceId`] = "La atención presencial requiere referencia al espacio.";
  }
  if (modality === "online" && spaceId.trim() !== "") {
    errors[`${prefix}spaceId`] = "La atención en línea no lleva referencia a espacio.";
  }
  return { errors, startMinute, endMinute };
}

/** Errores de formato del formulario de bloque, vacíos cuando es válido. */
export function validateBlockForm(form: BlockFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  const weekdayText = form.weekday.trim();
  const weekday = weekdayText === "" ? Number.NaN : Number(weekdayText);
  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    errors.weekday = "Elige un día de la semana entre domingo y sábado.";
  }
  const window = validateWindowFields(
    form.startTime,
    form.endTime,
    form.slotMinutes,
    form.modality,
    form.spaceId,
    "",
  );
  Object.assign(errors, {
    ...(window.errors.startTime !== undefined ? { startTime: window.errors.startTime } : {}),
    ...(window.errors.endTime !== undefined ? { endTime: window.errors.endTime } : {}),
    ...(window.errors.slotMinutes !== undefined ? { slotMinutes: window.errors.slotMinutes } : {}),
    ...(window.errors.modality !== undefined ? { modality: window.errors.modality } : {}),
    ...(window.errors.spaceId !== undefined ? { spaceId: window.errors.spaceId } : {}),
  });
  return errors;
}

/** Convierte el formulario válido a la entrada tipada del puerto. */
export function toSaveBlockInput(form: BlockFormState): SaveBlockInput {
  const startMinute = parseTimeToMinutes(form.startTime) ?? 0;
  const endMinute = parseTimeToMinutes(form.endTime) ?? 0;
  return {
    weekday: Number(form.weekday),
    startMinute,
    endMinute,
    slotMinutes: Number(form.slotMinutes.trim()),
    modality: form.modality as SaveBlockInput["modality"],
    ...(form.modality === "inPerson" && form.spaceId.trim() !== ""
      ? { spaceId: form.spaceId.trim() }
      : {}),
  };
}

/** Errores de formato del formulario de excepción, vacíos cuando es válido. */
export function validateExceptionForm(form: ExceptionFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!isValidDateText(form.date)) {
    errors.date = "Usa una fecha válida con formato AAAA-MM-DD.";
  }
  if (form.kind !== "cancelled" && form.kind !== "added") {
    errors.kind = "Elige cancelación o agregado.";
  }
  if (form.kind === "added" && form.blockId.trim() !== "") {
    errors.blockId = "El agregado trae su propia ventana, no un bloque.";
  }
  if (form.kind === "added") {
    const window = validateWindowFields(
      form.startTime,
      form.endTime,
      form.slotMinutes,
      form.modality,
      form.spaceId,
      "",
    );
    Object.assign(errors, {
      ...(window.errors.startTime !== undefined ? { startTime: window.errors.startTime } : {}),
      ...(window.errors.endTime !== undefined ? { endTime: window.errors.endTime } : {}),
      ...(window.errors.slotMinutes !== undefined
        ? { slotMinutes: window.errors.slotMinutes }
        : {}),
      ...(window.errors.modality !== undefined ? { modality: window.errors.modality } : {}),
      ...(window.errors.spaceId !== undefined ? { spaceId: window.errors.spaceId } : {}),
    });
  }
  if (
    form.kind === "cancelled" &&
    form.modality !== "" &&
    form.modality !== "inPerson" &&
    form.modality !== "online"
  ) {
    errors.modality = "Elige presencial o en línea.";
  }
  return errors;
}

/** Convierte el formulario válido a la entrada tipada del puerto. */
export function toSaveExceptionInput(form: ExceptionFormState): SaveExceptionInput {
  if (form.kind === "added") {
    const startMinute = parseTimeToMinutes(form.startTime) ?? 0;
    const endMinute = parseTimeToMinutes(form.endTime) ?? 0;
    const modality = form.modality as SaveBlockInput["modality"];
    return {
      date: form.date.trim(),
      kind: "added",
      windows: [
        {
          startMinute,
          endMinute,
          slotMinutes: Number(form.slotMinutes.trim()),
          modality,
          ...(modality === "inPerson" && form.spaceId.trim() !== ""
            ? { spaceId: form.spaceId.trim() }
            : {}),
        },
      ],
    };
  }
  return {
    date: form.date.trim(),
    kind: "cancelled",
    ...(form.blockId.trim() === "" ? {} : { blockId: form.blockId.trim() }),
  };
}
