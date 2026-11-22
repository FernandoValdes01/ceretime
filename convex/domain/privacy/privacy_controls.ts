/**
 * Controles de privacidad: constancia de envío de respuestas, bloqueos
 * temporales con alcance y reglas de conservación configurable con
 * excepciones (TI2-151).
 *
 * Dominio puro: no importa Convex, React ni Expo. Complementa
 * `privacy_request.ts` y `privacy_deadlines.ts` (TI2-136) sin crear plazos de
 * conservación inventados ni una bitácora paralela a TI2-128.
 *
 * Los campos de control (`reference`, `legalBasisNote`, `liftReason`) guardan
 * únicamente identificadores opacos o referencias institucionales acotadas:
 * nunca copian necesidades de acceso, notas internas ni datos sensibles.
 */

import { isUsableInstant } from "../calendar/civil_days";

/** Límite de referencias opacas y notas de control sin contenido sensible. */
export const PRIVACY_CONTROL_REFERENCE_MAX_LENGTH = 200;

/**
 * Canales por los que se envía la constancia de respuesta al titular.
 *
 * `student_app` corresponde al aviso en la aplicación estudiantil, `email` al
 * correo institucional y `institutional_channel` al canal institucional para
 * los demás roles titulares.
 */
export const PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES = [
  "student_app",
  "email",
  "institutional_channel",
] as const;

export type PrivacyResponseDeliveryChannel =
  (typeof PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES)[number];

/** Verdadero cuando el valor es un canal de envío de respuesta conocido. */
export function isPrivacyResponseDeliveryChannel(
  value: string,
): value is PrivacyResponseDeliveryChannel {
  return (PRIVACY_RESPONSE_DELIVERY_CHANNEL_VALUES as readonly string[]).includes(value);
}

/**
 * Constancia inmutable del envío de la respuesta fundada al titular.
 *
 * `sentAt` es el instante `notifiedAt` desde el que corre el plazo de 30 días
 * hábiles para reclamar ante la Agencia (`calculatePrivacyAgencyClaimDeadline`).
 * `reference` es un folio o identificador opaco de despacho, nunca el cuerpo
 * completo ni contenido sensible.
 */
export interface PrivacyResponseDeliveryReceipt {
  readonly channel: PrivacyResponseDeliveryChannel;
  readonly sentAt: number;
  readonly recordedBy: string;
  readonly reference: string;
  readonly agencyClaimDueDate: string;
  readonly agencyClaimDueAt: number;
}

/**
 * Categorías de datos personales inventariadas en CERETI.
 *
 * Fuente única compartida entre el alcance de los bloqueos temporales y las
 * reglas de conservación (ADR-0003), para que ambos controles hablen de las
 * mismas categorías sin listas paralelas.
 */
export const PRIVACY_DATA_CATEGORY_VALUES = [
  "accompaniment_requests",
  "accompaniments",
  "appointments",
  "follow_up",
  "notifications",
  "calendar",
  "account_profile",
  "audit_records",
] as const;

export type PrivacyDataCategory = (typeof PRIVACY_DATA_CATEGORY_VALUES)[number];

/** Verdadero cuando el valor es una categoría de datos conocida. */
export function isPrivacyDataCategory(value: string): value is PrivacyDataCategory {
  return (PRIVACY_DATA_CATEGORY_VALUES as readonly string[]).includes(value);
}

/**
 * Alcance de un bloqueo temporal: puede cubrir todos los datos personales del
 * titular o acotarse a una categoría concreta.
 */
export const PRIVACY_BLOCK_SCOPE_VALUES = [
  "all_personal_data",
  ...PRIVACY_DATA_CATEGORY_VALUES,
] as const;

export type PrivacyBlockScope = (typeof PRIVACY_BLOCK_SCOPE_VALUES)[number];

/** Verdadero cuando el valor es un alcance de bloqueo conocido. */
export function isPrivacyBlockScope(value: string): value is PrivacyBlockScope {
  return (PRIVACY_BLOCK_SCOPE_VALUES as readonly string[]).includes(value);
}

/** Verdadero cuando el alcance del bloqueo cubre la categoría consultada. */
export function doesPrivacyBlockCoverCategory(
  scope: PrivacyBlockScope,
  category: PrivacyDataCategory,
): boolean {
  return scope === "all_personal_data" || scope === category;
}

/**
 * Estado derivado de un bloqueo temporal en un instante dado.
 *
 * No se persiste como columna aparte para evitar que un bloqueo vencido por el
 * paso del tiempo contradiga su propia marca: se calcula a partir de `endsAt`
 * y `liftedAt`.
 */
export const PRIVACY_BLOCK_STATE_VALUES = ["active", "expired", "lifted"] as const;

export type PrivacyBlockState = (typeof PRIVACY_BLOCK_STATE_VALUES)[number];

/** Forma mínima para derivar el estado de un bloqueo temporal. */
export interface PrivacyBlockWindow {
  readonly startsAt: number;
  readonly endsAt: number;
  readonly liftedAt?: number;
}

/**
 * Deriva si un bloqueo temporal está vigente, vencido o levantado en `now`.
 *
 * El vencimiento es exclusivo (`now >= endsAt` significa vencido), igual que
 * `isWithinPrivacyDeadline`. Un levantamiento explícito prevalece siempre.
 */
export function privacyBlockStateAt(block: PrivacyBlockWindow, now: number): PrivacyBlockState {
  if (!isUsableInstant(now)) {
    throw new Error("El instante de evaluación del bloqueo debe ser un epoch válido.");
  }
  if (block.liftedAt !== undefined) return "lifted";
  return now < block.endsAt ? "active" : "expired";
}

/**
 * Destino configurado al vencer el plazo de conservación (ADR-0003): eliminar
 * los datos personales o anonimizar los necesarios para estadísticas.
 */
export const PRIVACY_RETENTION_DISPOSITION_VALUES = ["delete", "anonymize"] as const;

export type PrivacyRetentionDisposition = (typeof PRIVACY_RETENTION_DISPOSITION_VALUES)[number];

/** Verdadero cuando el valor es una disposición de conservación conocida. */
export function isPrivacyRetentionDisposition(value: string): value is PrivacyRetentionDisposition {
  return (PRIVACY_RETENTION_DISPOSITION_VALUES as readonly string[]).includes(value);
}

/**
 * Valida un plazo de conservación en días configurado por la UCT.
 *
 * No existen plazos por defecto en código (ADR-0003): cuando la UCT aún no
 * aprueba la duración de una categoría, `retentionDays` queda ausente. Si se
 * informa un número, debe ser un entero positivo.
 */
export function isValidPrivacyRetentionDays(days: number): boolean {
  return Number.isInteger(days) && days >= 1;
}

/**
 * Motivos que suspenden temporalmente la eliminación o anonimización
 * (ADR-0003 y TI2-151): obligación legal o procedimiento abierto.
 */
export const PRIVACY_RETENTION_EXCEPTION_KIND_VALUES = [
  "legal_obligation",
  "open_procedure",
] as const;

export type PrivacyRetentionExceptionKind =
  (typeof PRIVACY_RETENTION_EXCEPTION_KIND_VALUES)[number];

/** Verdadero cuando el valor es una clase de excepción de conservación conocida. */
export function isPrivacyRetentionExceptionKind(
  value: string,
): value is PrivacyRetentionExceptionKind {
  return (PRIVACY_RETENTION_EXCEPTION_KIND_VALUES as readonly string[]).includes(value);
}

/** Forma mínima para evaluar si una excepción de conservación sigue vigente. */
export interface PrivacyRetentionExceptionWindow {
  readonly startsAt: number;
  readonly expiresAt?: number;
  readonly liftedAt?: number;
}

/**
 * Verdadero cuando la excepción sigue suspendiendo la conservación en `now`.
 *
 * Una excepción levantada (`liftedAt` definido) deja de regir. Sin fecha de
 * término (`expiresAt` ausente) rige mientras no se levante; con `expiresAt`,
 * vence de forma exclusiva al llegar a ese instante.
 */
export function isPrivacyRetentionExceptionActive(
  exception: PrivacyRetentionExceptionWindow,
  now: number,
): boolean {
  if (!isUsableInstant(now)) {
    throw new Error("El instante de evaluación de la excepción debe ser un epoch válido.");
  }
  if (exception.liftedAt !== undefined) return false;
  if (now < exception.startsAt) return false;
  return exception.expiresAt === undefined || now < exception.expiresAt;
}
