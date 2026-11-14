/**
 * Solicitud de acompañamiento: DTO de creación y entidad pública (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Se nombra
 * `AccompanimentRequest` y no `Request` porque `convex/tsconfig.json`
 * incluye `dom` en `lib`, y `Request` ya existe como tipo global de fetch
 * dentro de los archivos de Convex. Ver hilo de TI2-7 para el detalle.
 *
 * El contenido que entrega el estudiante (`AccompanimentRequestContent`) y
 * la entidad pública (`AccompanimentRequest`) son formas distintas y no se
 * mezclan: la tabla `requests` persiste `accessNeeds` como texto y nombra
 * el estado `status`, mientras el DTO de creación lleva el contenido
 * estructurado.
 *
 * Los campos de contenido siguen el mismo vocabulario que el flujo de Mobile
 * (`apps/mobile/src/application/student-area-models.ts`), de modo que un
 * payload de solicitud válido enviado por Mobile se tipa sin conversión
 * manual contra `AccompanimentRequestContent`.
 */

import { REQUEST_FIELDS_INVALID_ERROR_CODE, type ApiResult } from "../errors/api_error";
import { isPersistableRequestState, type PersistableRequestState } from "./state";

/**
 * Tope del texto de necesidades de acceso en caracteres (TI2-23).
 *
 * Valor definitivo del contrato compartido, acordado con TI2-10: el Backend
 * y los consumidores validan con esta constante para no duplicar el número.
 * Se rechaza el exceso en vez de truncarlo, porque recortar necesidades de
 * acceso (Ley 21.719) alteraría en silencio lo que el estudiante declaró.
 */
export const ACCESS_NEEDS_MAX_LENGTH = 2000;

/** Verdadero cuando el texto cabe en el tope del contrato. */
export function isAccessNeedsWithinLimit(text: string): boolean {
  return text.length <= ACCESS_NEEDS_MAX_LENGTH;
}

/** Modalidad de atención preferida por el estudiante en la solicitud. */
export type ModalityPreference = "inPerson" | "online";

/** Condición o apoyo que el estudiante indica para participar y comunicarse. */
export interface AccessNeed {
  readonly id: string;
  readonly label: string;
}

/** Rangos generales de disponibilidad del estudiante para el acompañamiento. */
export interface GeneralAvailability {
  readonly preferredWeekdays: readonly number[];
  readonly preferredTimeRange?: {
    readonly from: string;
    readonly to: string;
  };
}

/**
 * Contenido que el estudiante (o un canal institucional autorizado) entrega
 * al solicitar: necesidad, resultado esperado, condiciones de acceso,
 * modalidad, disponibilidad general y canal accesible para recibir
 * información.
 */
export interface AccompanimentRequestContent {
  needSummary: string;
  expectedOutcome: string;
  accessNeeds: readonly AccessNeed[];
  modalityPreference: ModalityPreference;
  generalAvailability: GeneralAvailability;
  preferredAccessibleInformationChannel: string;
  /** Texto libre para una condición adicional, sin pedir diagnóstico. */
  otherAccessNeed?: string;
}

/**
 * Canales por los que llega una solicitud (TI2-135): el propio Estudiante o
 * personal autorizado que la registra desde un canal oficial de CERETI.
 */
export const REQUEST_PROVENANCE_CHANNEL_VALUES = ["student", "official_channel"] as const;

export type RequestProvenanceChannel = (typeof REQUEST_PROVENANCE_CHANNEL_VALUES)[number];

/**
 * Canal que se asume en una solicitud sin `provenance` (TI2-135). Hasta
 * TI2-135 la única entrada era `createRequest` con la identidad del propio
 * Estudiante, así que las filas anteriores nacieron por ese canal: asumirlo al
 * leer y escribirlo en la migración no inventa un dato.
 */
export const LEGACY_REQUEST_PROVENANCE_CHANNEL = "student" satisfies RequestProvenanceChannel;

/** Canal efectivo de una fila: el declarado o, en las anteriores, el del Estudiante. */
export function requestProvenanceChannelOf(row: {
  readonly provenance?: { readonly channel: RequestProvenanceChannel };
}): RequestProvenanceChannel {
  return row.provenance?.channel ?? LEGACY_REQUEST_PROVENANCE_CHANNEL;
}

/**
 * Texto de necesidades de acceso para registrar una solicitud (TI2-26).
 *
 * Dominio puro: recorta el texto del estudiante y rechaza el vacío, sin persistir nada. Devuelve el texto recortado o `null` cuando no hay contenido válido; el tope de longitud lo aplica la capa de aplicación junto a este recorte, para que el mensaje de rechazo indique el máximo vigente.
 */
export function toAccessNeedsText(raw: string): string | null {
  const accessNeeds = raw.trim();
  return accessNeeds === "" ? null : accessNeeds;
}

/**
 * Entidad de solicitud (TI2-8): espejo exacto de la fila de la tabla
 * `requests` tal como la lee el Backend (`_id`, `studentId`, `status`,
 * `accessNeeds` como texto y `createdAt`). Un documento real de la tabla se
 * asigna directo a este tipo, incluidas las cerradas o canceladas (TI2-85).
 * Los identificadores son `string` plano para no importar
 * `convex/_generated`; los `Id` de Convex son asignables a `string` y pasan
 * directo al adaptador.
 */
export interface AccompanimentRequest {
  readonly _id: string;
  readonly studentId: string;
  readonly status: PersistableRequestState;
  readonly accessNeeds: string;
  readonly createdAt: number;
}

/**
 * Valida una fila persistida de `requests` y devuelve la entidad.
 * Rechaza un `status` que no sea persistible en vez de propagar un literal
 * desconocido: una fila con estado inválido es corrupción, no una
 * solicitud. El identificador es genérico para no importar
 * `convex/_generated`: con `string` devuelve la entidad canónica y con un
 * `Id` de Convex preserva el tipo para los validadores de la API.
 * No transforma `AccompanimentRequestContent`: convertir el DTO de creación
 * a la forma persistida es alcance de TI2-23.
 */
export function toAccompanimentRequest<RowId extends string, StudentId extends string>(row: {
  readonly _id: RowId;
  readonly studentId: StudentId;
  readonly status: string;
  readonly accessNeeds: string;
  readonly createdAt: number;
}): AccompanimentRequest & { readonly _id: RowId; readonly studentId: StudentId } {
  const status = row.status;
  if (!isPersistableRequestState(status)) {
    throw new Error(`Estado de solicitud desconocido en la fila ${row._id}: ${status}`);
  }
  return {
    _id: row._id,
    studentId: row.studentId,
    status,
    accessNeeds: row.accessNeeds,
    createdAt: row.createdAt,
  };
}

/**
 * Topes del envío completo (TI2-141). Los textos largos comparten el tope de
 * las necesidades de acceso; el canal accesible es una indicación breve. Se
 * rechaza el exceso, nunca se trunca, por la misma razón que en
 * `ACCESS_NEEDS_MAX_LENGTH`.
 */
export const REQUEST_TEXT_MAX_LENGTH = ACCESS_NEEDS_MAX_LENGTH;
export const INFORMATION_CHANNEL_MAX_LENGTH = 200;
export const ACCESS_NEED_SELECTIONS_MAX = 20;
export const ACCESS_NEED_LABEL_MAX_LENGTH = 200;
/** El identificador se guarda tal cual en `accessNeedSelections`: lleva el mismo tope que el nombre. */
export const ACCESS_NEED_ID_MAX_LENGTH = ACCESS_NEED_LABEL_MAX_LENGTH;
export const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

/**
 * Envío completo (TI2-141): el contenido canónico `AccompanimentRequestContent`
 * más la clave de idempotencia que genera el cliente. La lista `accessNeeds`
 * se persiste como `accessNeedSelections`; esa conversión es del caso de uso.
 */
export type RequestSubmission = Readonly<AccompanimentRequestContent> & {
  readonly idempotencyKey: string;
};

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

/*
 * Mensajes de los campos del envío completo. Los usan `toCompleteSubmission`,
 * cuando el campo no llega, y `toRequestSubmission`, cuando llega vacío: el
 * Estudiante lee lo mismo en los dos casos.
 */
const NEED_SUMMARY_REQUIRED = "Describe la barrera o necesidad.";
const EXPECTED_OUTCOME_REQUIRED = "Indica qué esperas de CERETI.";
const ACCESS_NEEDS_LIST_REQUIRED =
  "Envía las necesidades de acceso como lista junto con los demás datos de la solicitud.";
const MODALITY_PREFERENCE_REQUIRED = "Indica si prefieres la modalidad presencial o en línea.";
const PREFERRED_WEEKDAYS_REQUIRED = "Selecciona al menos un día disponible.";
const INFORMATION_CHANNEL_REQUIRED = "Indica cómo prefieres recibir información.";
const IDEMPOTENCY_KEY_INVALID = `La clave del envío debe tener entre 1 y ${IDEMPOTENCY_KEY_MAX_LENGTH} caracteres.`;

function invalidRequestFields<T>(message: string): ApiResult<T> {
  return { status: "error", error: { code: REQUEST_FIELDS_INVALID_ERROR_CODE, message } };
}

/**
 * Envío tal como llega al borde: en la forma completa, `accessNeeds` es la
 * lista de necesidades; en la forma anterior, el texto unido sin ningún otro
 * campo. Convex exige un objeto, así que los campos de la forma completa
 * llegan opcionales.
 */
export type RequestSubmissionDraft = {
  readonly accessNeeds?: string | readonly AccessNeed[];
} & Partial<Omit<RequestSubmission, "accessNeeds">>;

/**
 * Exige los campos obligatorios de la forma completa (TI2-141), en el orden
 * del formulario. Si falta uno, el mensaje lo nombra con el mismo texto que
 * usa `toRequestSubmission` cuando llega vacío; `accessNeeds` como texto
 * pide la lista. No valida contenido: eso es de `toRequestSubmission`.
 */
export function toCompleteSubmission(draft: RequestSubmissionDraft): ApiResult<RequestSubmission> {
  const {
    needSummary,
    expectedOutcome,
    accessNeeds,
    otherAccessNeed,
    modalityPreference,
    generalAvailability,
    preferredAccessibleInformationChannel,
    idempotencyKey,
  } = draft;
  if (needSummary === undefined) return invalidRequestFields(NEED_SUMMARY_REQUIRED);
  if (expectedOutcome === undefined) return invalidRequestFields(EXPECTED_OUTCOME_REQUIRED);
  if (accessNeeds === undefined || typeof accessNeeds === "string") {
    return invalidRequestFields(ACCESS_NEEDS_LIST_REQUIRED);
  }
  if (modalityPreference === undefined) return invalidRequestFields(MODALITY_PREFERENCE_REQUIRED);
  if (generalAvailability === undefined) return invalidRequestFields(PREFERRED_WEEKDAYS_REQUIRED);
  if (preferredAccessibleInformationChannel === undefined) {
    return invalidRequestFields(INFORMATION_CHANNEL_REQUIRED);
  }
  if (idempotencyKey === undefined) return invalidRequestFields(IDEMPOTENCY_KEY_INVALID);
  return {
    status: "ok",
    data: {
      needSummary,
      expectedOutcome,
      accessNeeds,
      ...(otherAccessNeed === undefined ? {} : { otherAccessNeed }),
      modalityPreference,
      generalAvailability,
      preferredAccessibleInformationChannel,
      idempotencyKey,
    },
  };
}

/** Texto recortado dentro del tope, o el mensaje que indica qué corregir. */
function boundedText(
  raw: string,
  max: number,
  empty: string,
  tooLong: string,
): { readonly error: string } | { readonly text: string } {
  const text = raw.trim();
  if (text === "") return { error: empty };
  if (text.length > max) return { error: tooLong };
  return { text };
}

/**
 * Valida el envío completo de una solicitud (TI2-141).
 *
 * Dominio puro: recorta los textos, aplica los topes y revisa la forma de la
 * disponibilidad general, sin persistir nada. Devuelve el envío normalizado o
 * el primer error con un mensaje en español que indica qué corregir, con
 * `request_fields_invalid`; el texto unido de las necesidades de acceso
 * conserva los códigos `access_needs_*` de `toStoredAccessNeeds`. No pide
 * ni acepta RUT, diagnóstico, certificados ni área interna: esos campos no
 * existen en el contrato.
 */
export function toRequestSubmission(input: RequestSubmission): ApiResult<RequestSubmission> {
  const fail = (message: string): ApiResult<RequestSubmission> => invalidRequestFields(message);

  const needSummary = boundedText(
    input.needSummary,
    REQUEST_TEXT_MAX_LENGTH,
    NEED_SUMMARY_REQUIRED,
    `La descripción de la necesidad supera el máximo permitido (${REQUEST_TEXT_MAX_LENGTH} caracteres).`,
  );
  if ("error" in needSummary) return fail(needSummary.error);

  const expectedOutcome = boundedText(
    input.expectedOutcome,
    REQUEST_TEXT_MAX_LENGTH,
    EXPECTED_OUTCOME_REQUIRED,
    `El resultado esperado supera el máximo permitido (${REQUEST_TEXT_MAX_LENGTH} caracteres).`,
  );
  if ("error" in expectedOutcome) return fail(expectedOutcome.error);

  if (input.accessNeeds.length > ACCESS_NEED_SELECTIONS_MAX) {
    return fail(`Selecciona como máximo ${ACCESS_NEED_SELECTIONS_MAX} necesidades de acceso.`);
  }
  const accessNeeds: AccessNeed[] = [];
  const seenNeeds = new Set<string>();
  for (const need of input.accessNeeds) {
    const id = need.id.trim();
    const label = need.label.trim();
    if (id === "" || label === "") return fail("Cada necesidad de acceso necesita su nombre.");
    if (label.length > ACCESS_NEED_LABEL_MAX_LENGTH) {
      return fail(
        `El nombre de una necesidad de acceso supera el máximo permitido (${ACCESS_NEED_LABEL_MAX_LENGTH} caracteres).`,
      );
    }
    if (id.length > ACCESS_NEED_ID_MAX_LENGTH) {
      return fail(
        `El identificador de una necesidad de acceso supera el máximo permitido (${ACCESS_NEED_ID_MAX_LENGTH} caracteres).`,
      );
    }
    if (seenNeeds.has(id)) return fail("Una necesidad de acceso está repetida.");
    seenNeeds.add(id);
    accessNeeds.push({ id, label });
  }
  const otherAccessNeed = input.otherAccessNeed?.trim();
  const stored = toStoredAccessNeeds(accessNeeds, otherAccessNeed);
  if (stored.status === "error") {
    // Conserva el código estable de Sprint 1 (`access_needs_*`), que los
    // clientes ya traducen. El tope es del texto unido: con la lista, se pasa
    // la suma de los nombres y el texto adicional, no un texto suelto.
    if (stored.error.code !== "access_needs_too_long") return stored;
    return {
      status: "error",
      error: {
        code: stored.error.code,
        message: `Las necesidades de acceso y el texto adicional superan juntos el máximo permitido (${ACCESS_NEEDS_MAX_LENGTH} caracteres).`,
      },
    };
  }

  const { preferredWeekdays, preferredTimeRange } = input.generalAvailability;
  if (preferredWeekdays.length === 0) return fail(PREFERRED_WEEKDAYS_REQUIRED);
  const days = new Set<number>();
  for (const day of preferredWeekdays) {
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return fail("Los días disponibles van de 0 (domingo) a 6 (sábado).");
    }
    if (days.has(day)) return fail("Un día disponible está repetido.");
    days.add(day);
  }
  if (preferredTimeRange !== undefined) {
    const { from, to } = preferredTimeRange;
    if (!TIME_OF_DAY.test(from) || !TIME_OF_DAY.test(to)) {
      return fail("El horario disponible se indica en formato HH:mm.");
    }
    if (from >= to) return fail("El horario disponible debe empezar antes de terminar.");
  }

  const channel = boundedText(
    input.preferredAccessibleInformationChannel,
    INFORMATION_CHANNEL_MAX_LENGTH,
    INFORMATION_CHANNEL_REQUIRED,
    `El medio para recibir información supera el máximo permitido (${INFORMATION_CHANNEL_MAX_LENGTH} caracteres).`,
  );
  if ("error" in channel) return fail(channel.error);

  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey.trim() === "" || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return fail(IDEMPOTENCY_KEY_INVALID);
  }

  return {
    status: "ok",
    data: {
      needSummary: needSummary.text,
      expectedOutcome: expectedOutcome.text,
      accessNeeds,
      ...(otherAccessNeed ? { otherAccessNeed } : {}),
      modalityPreference: input.modalityPreference,
      generalAvailability: {
        preferredWeekdays: [...preferredWeekdays],
        ...(preferredTimeRange === undefined
          ? {}
          : { preferredTimeRange: { ...preferredTimeRange } }),
      },
      preferredAccessibleInformationChannel: channel.text,
      idempotencyKey,
    },
  };
}

/** Tope de la respuesta del Estudiante a la información pedida (TI2-141). */
export const REQUEST_RESPONSE_MAX_LENGTH = 2000;

/**
 * Respuesta del Estudiante a la información pedida (TI2-141), recortada.
 * Es obligatoria y se rechaza sobre `REQUEST_RESPONSE_MAX_LENGTH` sin
 * cortarla, igual que los demás textos de la solicitud.
 */
export function toInformationResponse(raw: string): ApiResult<string> {
  const response = boundedText(
    raw,
    REQUEST_RESPONSE_MAX_LENGTH,
    "Se requiere la respuesta a la información pedida.",
    `La respuesta supera el máximo permitido (${REQUEST_RESPONSE_MAX_LENGTH} caracteres).`,
  );
  if ("error" in response) return invalidRequestFields(response.error);
  return { status: "ok", data: response.text };
}

/**
 * Textos del intercambio que acompañan al detalle de una solicitud (TI2-141),
 * leídos de su historial de cambios, del último al primero.
 *
 * `informationRequest` es lo que el Profesional pidió y solo existe mientras
 * la solicitud espera respuesta: después deja de ser lo pendiente.
 * `informationResponse` es la respuesta al último pedido: si el Profesional
 * vuelve a pedir, la respuesta anterior deja de entregarse hasta que llegue la
 * nueva, así una pregunta pendiente no parece respondida. Son texto libre:
 * solo se entregan en el detalle, a quien ya puede leer la solicitud.
 */
export function toRequestExchange(
  status: PersistableRequestState,
  recentChanges: readonly {
    readonly from: PersistableRequestState;
    readonly to: PersistableRequestState;
    readonly reason?: string;
  }[],
): { readonly informationRequest?: string; readonly informationResponse?: string } {
  const requestAt = recentChanges.findIndex(
    (change) => change.to === "awaiting_information_or_acceptance",
  );
  const responseAt = recentChanges.findIndex(
    (change) =>
      change.from === "awaiting_information_or_acceptance" && change.to === "under_review",
  );
  const lastRequest = recentChanges[requestAt];
  // La lista va del último cambio al primero. Un pedido fuera de lo leído es
  // anterior a cualquier respuesta leída, porque toda respuesta sigue a un pedido.
  const lastResponse =
    responseAt !== -1 && (requestAt === -1 || responseAt < requestAt)
      ? recentChanges[responseAt]
      : undefined;
  return {
    ...(status === "awaiting_information_or_acceptance" && lastRequest?.reason !== undefined
      ? { informationRequest: lastRequest.reason }
      : {}),
    ...(lastResponse?.reason === undefined ? {} : { informationResponse: lastResponse.reason }),
  };
}

/** Campos de la tabla `requests` que salen del contenido estructurado. */
export interface StoredRequestFields {
  readonly accessNeeds: string;
}

/**
 * Serializa las condiciones de acceso a la forma persistida (TI2-23).
 *
 * Une las etiquetas de `accessNeeds` más `otherAccessNeed` (si trae texto)
 * separadas por salto de línea. Es la única regla para armar el texto unido:
 * la usan los clientes y también el repositorio cuando recibe la lista
 * estructurada, para que `accessNeeds` y `accessNeedSelections` no puedan
 * contradecirse (TI2-135).
 *
 * Exige texto no vacío como el registro: un arreglo vacío sin texto libre es
 * error, no fila vacía.
 *
 * Nunca trunca: si el texto supera `ACCESS_NEEDS_MAX_LENGTH` devuelve error
 * con código estable para que el llamante lo informe sin filtrar detalles
 * internos.
 */
export function toStoredAccessNeeds(
  accessNeeds: readonly AccessNeed[],
  otherAccessNeed?: string,
): ApiResult<StoredRequestFields> {
  const parts = accessNeeds.map((need) => need.label);
  const other = otherAccessNeed?.trim();
  if (other) {
    parts.push(other);
  }
  const text = parts.join("\n");
  if (text.trim().length === 0) {
    return {
      status: "error",
      error: {
        code: "access_needs_empty",
        message: "Se requiere describir la necesidad de acceso.",
      },
    };
  }
  if (!isAccessNeedsWithinLimit(text)) {
    return {
      status: "error",
      error: {
        code: "access_needs_too_long",
        message: "El texto de necesidades de acceso supera el máximo permitido.",
      },
    };
  }
  return { status: "ok", data: { accessNeeds: text } };
}

/**
 * Serializa el contenido estructurado a la forma persistida (TI2-23).
 *
 * Solo cubre las condiciones de acceso: el resto del contenido (`needSummary`,
 * `expectedOutcome`, modalidad, disponibilidad) tiene sus propias columnas
 * desde TI2-135. Es solo dominio para que los clientes armen el texto antes de
 * llamar: Aplicación y Presentación no lo invocan y la API rechaza con sus
 * propios mensajes (ver tabla de rechazos en `docs/contratos-sprint-1.md`).
 */
export function toStoredRequestFields(
  content: AccompanimentRequestContent,
): ApiResult<StoredRequestFields> {
  return toStoredAccessNeeds(content.accessNeeds, content.otherAccessNeed);
}
