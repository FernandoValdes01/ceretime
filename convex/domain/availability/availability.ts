/**
 * Disponibilidad: contratos públicos compartidos v1 (TI2-87).
 *
 * Dominio puro: no importa Convex, React ni Expo, para que Web y Mobile
 * consuman la misma forma sin levantar el backend. Fija las entradas y
 * salidas mínimas con identificadores genéricos (`string` plano, sin
 * `Id`/`Doc` de Convex): bloques con profesionales y días, excepciones
 * puntuales, rango civil explícito y paginación.
 *
 * Reutiliza `ModalityPreference` de la solicitud y las clases de excepción
 * de TI2-81 (`cancelled`/`added`) para no duplicar su representación; la
 * duración, la recurrencia efectiva, la expansión a cupos y los cruces
 * pertenecen a TI2-81/TI2-84 y la compatibilidad de modalidad y espacio a
 * TI2-82. Acá solo hay forma versionada, sin políticas propias.
 */

import type { ModalityPreference } from "../request/request";

/** Versión del contrato público de disponibilidad. */
export const AVAILABILITY_CONTRACT_VERSION = "v1" as const;

export type AvailabilityContractVersion = typeof AVAILABILITY_CONTRACT_VERSION;

/** Clases de excepción sobre la recurrencia, como en TI2-81. */
export const AVAILABILITY_EXCEPTION_KIND_VALUES = ["cancelled", "added"] as const;

export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KIND_VALUES)[number];

/** Ventana dentro de un día civil, en minutos desde las 00:00. */
export interface AvailabilityWindow {
  readonly startMinute: number;
  readonly endMinute: number;
  readonly slotMinutes: number;
  readonly modality: ModalityPreference;
  /** Referencia opaca al espacio; su resolución contra el catálogo es de aplicación (TI2-82). */
  readonly spaceId?: string;
}

/** Bloque semanal de disponibilidad con identificadores genéricos. */
export interface AvailabilityBlock extends AvailabilityWindow {
  readonly id: string;
  readonly professionalId: string;
  /** Día de la semana, 0 (domingo) a 6 (sábado). */
  readonly weekday: number;
  readonly version: AvailabilityContractVersion;
}

/** Excepción puntual sobre la recurrencia en una fecha civil concreta. */
export interface AvailabilityException {
  /** Fecha civil en formato `YYYY-MM-DD`. */
  readonly date: string;
  readonly kind: AvailabilityExceptionKind;
  /** Ventanas del día cuando `kind` es `added`; ausente en `cancelled`. */
  readonly windows?: readonly AvailabilityWindow[];
  readonly version: AvailabilityContractVersion;
}

/** Entrada mínima para listar disponibilidad: rango civil explícito y paginación. */
export interface ListAvailabilityInput {
  readonly professionalId: string;
  /** Primera fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly from: string;
  /** Última fecha civil incluida, en formato `YYYY-MM-DD`. */
  readonly to: string;
  /** Zona horaria IANA del profesional (p. ej. `America/Santiago`). */
  readonly timeZone: string;
  readonly limit: number;
  readonly cursor?: string;
  readonly version: AvailabilityContractVersion;
}

/** Cupo disponible ya resuelto: candidato a reserva, sin estado de ocupación. */
export interface AvailabilitySlot {
  readonly id: string;
  readonly professionalId: string;
  /** Fecha civil del cupo en formato `YYYY-MM-DD`, en la zona horaria pedida. */
  readonly date: string;
  /** Inicio del cupo como milisegundos epoch. */
  readonly startAt: number;
  /** Fin del cupo como milisegundos epoch. */
  readonly endAt: number;
  readonly modality: ModalityPreference;
  readonly spaceId?: string;
  readonly version: AvailabilityContractVersion;
}

/** Página de cupos con paginación keyset sobre el identificador. */
export interface AvailabilitySlotPage {
  readonly items: readonly AvailabilitySlot[];
  readonly hasMore: boolean;
  readonly nextCursor: string | null;
  readonly version: AvailabilityContractVersion;
}
