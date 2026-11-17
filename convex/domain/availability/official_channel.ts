/**
 * Coordinación por canal oficial (TI2-144).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile muestren el mismo resultado sin levantar el backend. Cuando la búsqueda de cupos no encuentra una hora compatible y libre, explica por qué, entrega los canales oficiales accesibles de CERETI y un código de referencia para que el Estudiante coordine sin volver a explicar su situación. Nunca rebaja las necesidades de acceso: la compatibilidad sigue siendo la de TI2-82.
 *
 * Los canales son un catálogo fijo con datos ficticios: la especificación deja los canales reales como pendiente de validación con CERETI. Se reemplazan aquí, en un solo lugar, cuando CERETI los confirme.
 */

import { fnv1a64 } from "../hashing/fnv1a";
import type { SpaceFields } from "../spaces/space";

/**
 * Motivos de la ausencia de horario compatible, en orden de prioridad:
 *
 * - `slots_occupied`: hay horarios que cubren las necesidades de acceso, pero todos están ocupados.
 * - `needs_not_met`: ningún horario del rango cubre las necesidades de acceso, esté ocupado o libre (sala sin las condiciones requeridas, o modalidad en línea sin apoyos).
 * - `no_published_slots`: no hay horarios que se puedan ofrecer en el rango: no se publicaron o su sala ya no está en el catálogo. Un profesional no reservable responde igual, para no revelar si existe o tiene agenda.
 */
export const NO_COMPATIBLE_SLOT_REASON_VALUES = [
  "slots_occupied",
  "needs_not_met",
  "no_published_slots",
] as const;

export type NoCompatibleSlotReason = (typeof NO_COMPATIBLE_SLOT_REASON_VALUES)[number];

/** Explicación pública de cada motivo, en español y sin datos de otras personas. */
export const NO_COMPATIBLE_SLOT_EXPLANATIONS: Readonly<Record<NoCompatibleSlotReason, string>> = {
  slots_occupied:
    "Los horarios compatibles con tus necesidades de acceso de este período ya están ocupados. Coordina tu atención por un canal oficial.",
  needs_not_met:
    "Los horarios de este período no cubren tus necesidades de acceso. No las reducimos para encontrar un cupo: coordina tu atención por un canal oficial.",
  no_published_slots:
    "No hay horarios publicados en este período. Coordina tu atención por un canal oficial.",
};

/**
 * Elige el motivo a partir de lo que descartó la búsqueda: `occupied` cuenta solo horarios que cubrían las necesidades y `incompatible`, los que no las cubren, ocupados o libres. Si existe un horario compatible ocupado, el motivo es la ocupación aunque otros sean incompatibles: hay un horario que sirve, solo que tomado.
 */
export function decideNoCompatibleSlotReason(discarded: {
  readonly occupied: number;
  readonly incompatible: number;
}): NoCompatibleSlotReason {
  if (discarded.occupied > 0) return "slots_occupied";
  if (discarded.incompatible > 0) return "needs_not_met";
  return "no_published_slots";
}

/**
 * Motivo de varias búsquedas sin horario compatible, como las de cada profesional de un acompañamiento: el de mayor prioridad según `NO_COMPATIBLE_SLOT_REASON_VALUES`. Sin motivos responde `no_published_slots`.
 */
export function combineNoCompatibleSlotReasons(
  reasons: readonly NoCompatibleSlotReason[],
): NoCompatibleSlotReason {
  return (
    NO_COMPATIBLE_SLOT_REASON_VALUES.find((reason) => reasons.includes(reason)) ??
    "no_published_slots"
  );
}

/** Canal oficial presencial: la ubicación usa los mismos campos que un espacio del catálogo. */
export interface InPersonOfficialChannel {
  readonly id: string;
  readonly kind: "inPerson";
  readonly name: string;
  readonly hours: string;
  readonly location: SpaceFields;
}

export interface EmailOfficialChannel {
  readonly id: string;
  readonly kind: "email";
  readonly name: string;
  readonly hours: string;
  readonly address: string;
}

export interface PhoneOfficialChannel {
  readonly id: string;
  readonly kind: "phone";
  readonly name: string;
  readonly hours: string;
  readonly phoneNumber: string;
}

/** Canal oficial accesible de CERETI, discriminado por `kind`. */
export type OfficialChannel = InPersonOfficialChannel | EmailOfficialChannel | PhoneOfficialChannel;

/** Canales oficiales con datos ficticios, provisionales hasta que CERETI confirme los reales. */
export const OFFICIAL_CHANNELS: readonly OfficialChannel[] = [
  {
    id: "cereti-office",
    kind: "inPerson",
    name: "Oficina de CERETI",
    hours: "Lunes a viernes, de 9:00 a 17:00.",
    location: {
      campus: "Campus ficticio",
      building: "Edificio ficticio de CERETI",
      floor: "Piso 1",
      room: "Oficina 101",
      accessConditions:
        "Acceso a nivel desde la calle, sin escalones, con puerta de apertura amplia y baño accesible en el mismo piso.",
      arrivalInstructions:
        "Desde la entrada principal, avanza 20 metros por el pasillo central con franja guía en el piso. La oficina es la primera puerta a la derecha.",
    },
  },
  {
    id: "cereti-email",
    kind: "email",
    name: "Correo de CERETI",
    hours: "Respuesta en días hábiles.",
    address: "cereti.ficticio@example.com",
  },
  {
    id: "cereti-phone",
    kind: "phone",
    name: "Teléfono de CERETI",
    hours: "Lunes a viernes, de 9:00 a 17:00.",
    phoneNumber: "+56 45 000 0000",
  },
];

/** Prefijo visible del código de referencia. */
const COORDINATION_REFERENCE_PREFIX = "CER";

/** Base32 de Crockford: sin I, L, O ni U, para dictarlo o copiarlo sin confundir letras. */
// cspell:ignore ABCDEFGHJKMNPQRSTVWXYZ
const CROCKFORD_BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const REFERENCE_CODE_LENGTH = 8;

/**
 * Código de referencia del acompañamiento, como `CER-7KQ2-M9XD`.
 *
 * Se deriva con FNV-1a del identificador opaco del acompañamiento: no contiene nombre, correo, RUT, necesidades ni fechas, y no se puede revertir al identificador. Es determinista, así el mismo acompañamiento entrega siempre el mismo código, aunque busque otra semana u otro profesional, y el personal puede reconocer un acompañamiento que llega varias veces. Son 40 bits: no es un secreto ni prueba identidad, solo orienta la coordinación.
 */
export function deriveCoordinationReferenceCode(accompanimentId: string): string {
  const id = accompanimentId.trim();
  if (id === "") throw new Error("El código de referencia requiere un acompañamiento.");
  let remaining = fnv1a64(`ceretime:coordination:${id}`);
  let encoded = "";
  for (let index = 0; index < REFERENCE_CODE_LENGTH; index += 1) {
    encoded = CROCKFORD_BASE32_ALPHABET[Number(remaining & 31n)] + encoded;
    remaining >>= 5n;
  }
  return `${COORDINATION_REFERENCE_PREFIX}-${encoded.slice(0, 4)}-${encoded.slice(4)}`;
}

/** Resultado que acompaña la ausencia de horario compatible. */
export interface OfficialChannelCoordination {
  readonly reason: NoCompatibleSlotReason;
  readonly explanation: string;
  readonly referenceCode: string;
  readonly channels: readonly OfficialChannel[];
}

/** Arma la coordinación por canal oficial de un acompañamiento sin horario compatible. */
export function toOfficialChannelCoordination(
  accompanimentId: string,
  reason: NoCompatibleSlotReason,
): OfficialChannelCoordination {
  return {
    reason,
    explanation: NO_COMPATIBLE_SLOT_EXPLANATIONS[reason],
    referenceCode: deriveCoordinationReferenceCode(accompanimentId),
    channels: OFFICIAL_CHANNELS,
  };
}
