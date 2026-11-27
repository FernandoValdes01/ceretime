import {
  ACCESS_NEED_OPTIONS,
  type ModalityPreference,
} from "../../../../../convex/domain/index.ts";
import type { OwnRequestSubmission } from "./student-request-form-data.ts";

/**
 * Borrador del formulario de solicitud del Estudiante (TI2-149). El registro
 * por canal oficial del Profesional (TI2-158) usa la misma forma, sin guardarla
 * en el navegador.
 *
 * Guarda lo que el Estudiante escribe mientras arma su solicitud: sobrevive a
 * recargar la página, a salir y volver al formulario y a un envío fallido.
 *
 * Vive en `sessionStorage`, separado por cuenta: las necesidades de acceso
 * son datos personales y en un equipo compartido no deben quedar guardadas.
 * El borrador se borra al enviar con éxito, al cerrar sesión
 * (`clearAllRequestDrafts`) o al cerrar la pestaña, lo que ocurra primero. Las comprobaciones de este módulo solo
 * ayudan a completar el formulario; el Backend valida el envío.
 */

/** Días en el orden de la semana chilena; el valor es el del contrato (0 = domingo). */
export const WEEKDAY_OPTIONS = [
  { value: 1, label: "Lunes" },
  { value: 2, label: "Martes" },
  { value: 3, label: "Miércoles" },
  { value: 4, label: "Jueves" },
  { value: 5, label: "Viernes" },
  { value: 6, label: "Sábado" },
  { value: 0, label: "Domingo" },
] as const;

export const MODALITY_OPTIONS: ReadonlyArray<{ value: ModalityPreference; label: string }> = [
  { value: "inPerson", label: "Presencial" },
  { value: "online", label: "En línea" },
];

export interface RequestDraft {
  readonly needSummary: string;
  readonly expectedOutcome: string;
  readonly accessNeedIds: readonly string[];
  readonly otherAccessNeed: string;
  /** Vacío mientras el Estudiante no elige. */
  readonly modalityPreference: ModalityPreference | "";
  readonly preferredWeekdays: readonly number[];
  /** `HH:mm` o vacío: el horario es opcional. */
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly preferredAccessibleInformationChannel: string;
}

export type RequestDraftField =
  | "needSummary"
  | "expectedOutcome"
  | "accessNeeds"
  | "modalityPreference"
  | "preferredWeekdays"
  | "availableTime"
  | "preferredAccessibleInformationChannel";

export type RequestDraftErrors = Partial<Record<RequestDraftField, string>>;

/**
 * Quién completa el contenido (TI2-158): el propio Estudiante o el personal
 * que registra una solicitud recibida por canal oficial. Cambia solo la voz de
 * los textos; los campos y las comprobaciones son los mismos.
 */
export type RequestFormVoice = "student" | "staff";

/** Orden en que el formulario muestra los campos: el resumen de errores lo respeta. */
export const REQUEST_DRAFT_FIELD_ORDER: readonly RequestDraftField[] = [
  "needSummary",
  "expectedOutcome",
  "accessNeeds",
  "modalityPreference",
  "preferredWeekdays",
  "availableTime",
  "preferredAccessibleInformationChannel",
];

export function emptyRequestDraft(): RequestDraft {
  return {
    needSummary: "",
    expectedOutcome: "",
    accessNeedIds: [],
    otherAccessNeed: "",
    modalityPreference: "",
    preferredWeekdays: [],
    availableFrom: "",
    availableTo: "",
    preferredAccessibleInformationChannel: "",
  };
}

/**
 * Señala lo que falta para poder enviar. Solo revisa presencia y que el
 * horario venga completo: los topes, el formato y las demás reglas los
 * decide el Backend y su mensaje se muestra tal cual.
 */
export function findMissingFields(
  draft: RequestDraft,
  voice: RequestFormVoice,
): RequestDraftErrors {
  const errors: RequestDraftErrors = {};
  if (draft.needSummary.trim() === "") {
    errors.needSummary = "Describe la barrera o necesidad.";
  }
  if (draft.expectedOutcome.trim() === "") {
    errors.expectedOutcome =
      voice === "student"
        ? "Indica qué esperas de CERETI."
        : "Indica qué espera el estudiante de CERETI.";
  }
  if (draft.accessNeedIds.length === 0 && draft.otherAccessNeed.trim() === "") {
    errors.accessNeeds =
      "Selecciona al menos una necesidad de acceso o escribe cuál en «Otra necesidad de acceso».";
  }
  if (draft.modalityPreference === "") {
    errors.modalityPreference =
      voice === "student"
        ? "Indica si prefieres la modalidad presencial o en línea."
        : "Indica si el estudiante prefiere la modalidad presencial o en línea.";
  }
  if (draft.preferredWeekdays.length === 0) {
    errors.preferredWeekdays = "Selecciona al menos un día disponible.";
  }
  if ((draft.availableFrom === "") !== (draft.availableTo === "")) {
    errors.availableTime = "Indica la hora de inicio y la de término, o deja ambas vacías.";
  }
  if (draft.preferredAccessibleInformationChannel.trim() === "") {
    errors.preferredAccessibleInformationChannel =
      voice === "student"
        ? "Indica cómo prefieres recibir información."
        : "Indica cómo prefiere recibir información el estudiante.";
  }
  return errors;
}

/** Arma el envío de la forma completa de `createRequest` desde un borrador sin campos faltantes. */
export function toRequestContentSubmission(draft: RequestDraft): OwnRequestSubmission {
  if (draft.modalityPreference === "") {
    throw new Error("toRequestContentSubmission requiere la modalidad elegida.");
  }
  const otherAccessNeed = draft.otherAccessNeed.trim();
  const hasTimeRange = draft.availableFrom !== "" && draft.availableTo !== "";
  return {
    needSummary: draft.needSummary,
    expectedOutcome: draft.expectedOutcome,
    accessNeeds: ACCESS_NEED_OPTIONS.filter((option) =>
      draft.accessNeedIds.includes(option.id),
    ).map(({ id, label }) => ({ id, label })),
    ...(otherAccessNeed === "" ? {} : { otherAccessNeed }),
    modalityPreference: draft.modalityPreference,
    generalAvailability: {
      preferredWeekdays: WEEKDAY_OPTIONS.map((day) => day.value).filter((value) =>
        draft.preferredWeekdays.includes(value),
      ),
      ...(hasTimeRange
        ? { preferredTimeRange: { from: draft.availableFrom, to: draft.availableTo } }
        : {}),
    },
    preferredAccessibleInformationChannel: draft.preferredAccessibleInformationChannel,
  };
}

const STORAGE_PREFIX = "cereti:solicitud-borrador:";

function storageKey(ownerEmail: string): string {
  return `${STORAGE_PREFIX}${ownerEmail}`;
}

/** Devuelve el borrador guardado de la cuenta o uno nuevo si no hay o no se puede leer. */
export function loadRequestDraft(ownerEmail: string): RequestDraft {
  try {
    const raw = window.sessionStorage.getItem(storageKey(ownerEmail));
    if (raw !== null) {
      const parsed = parseRequestDraft(JSON.parse(raw));
      if (parsed !== null) {
        return parsed;
      }
    }
  } catch {
    // Almacenamiento bloqueado o contenido dañado: se empieza un borrador nuevo.
  }
  return emptyRequestDraft();
}

export function saveRequestDraft(ownerEmail: string, draft: RequestDraft): void {
  try {
    window.sessionStorage.setItem(storageKey(ownerEmail), JSON.stringify(draft));
  } catch {
    // Sin almacenamiento el formulario sigue funcionando; solo no sobrevive a recargar.
  }
}

export function clearRequestDraft(ownerEmail: string): void {
  try {
    window.sessionStorage.removeItem(storageKey(ownerEmail));
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
}

/**
 * Borra los borradores de todas las cuentas de esta pestaña. Se llama al
 * cerrar sesión: quien use después el mismo navegador no debe poder leer lo
 * que otra persona escribió y no envió.
 */
export function clearAllRequestDrafts(): void {
  try {
    const storage = window.sessionStorage;
    const draftKeys = Array.from({ length: storage.length }, (_, index) =>
      storage.key(index),
    ).filter((key): key is string => key !== null && key.startsWith(STORAGE_PREFIX));
    for (const key of draftKeys) {
      storage.removeItem(key);
    }
  } catch {
    // Nada que borrar si el almacenamiento no está disponible.
  }
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Acepta solo un borrador con la forma completa; cualquier otra cosa se descarta. */
function parseRequestDraft(value: unknown): RequestDraft | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const {
    needSummary,
    expectedOutcome,
    accessNeedIds,
    otherAccessNeed,
    modalityPreference,
    preferredWeekdays,
    availableFrom,
    availableTo,
    preferredAccessibleInformationChannel,
  } = record;
  if (
    !isString(needSummary) ||
    !isString(expectedOutcome) ||
    !Array.isArray(accessNeedIds) ||
    !accessNeedIds.every(isString) ||
    !isString(otherAccessNeed) ||
    (modalityPreference !== "" &&
      modalityPreference !== "inPerson" &&
      modalityPreference !== "online") ||
    !Array.isArray(preferredWeekdays) ||
    !preferredWeekdays.every((day) => typeof day === "number") ||
    !isString(availableFrom) ||
    !isString(availableTo) ||
    !isString(preferredAccessibleInformationChannel)
  ) {
    return null;
  }
  return {
    needSummary,
    expectedOutcome,
    accessNeedIds,
    otherAccessNeed,
    modalityPreference,
    preferredWeekdays,
    availableFrom,
    availableTo,
    preferredAccessibleInformationChannel,
  };
}
