/**
 * Entidad de solicitud de acompañamiento (TI2-8).
 *
 * Dominio puro: no importa Convex ni `convex/_generated`. Se nombra
 * `AccompanimentRequest` y no `Request` porque `convex/tsconfig.json` incluye
 * `dom` en `lib`, y `Request` ya existe como tipo global de fetch dentro de
 * los archivos de Convex. Ver hilo de TI2-7 para el detalle.
 *
 * No incluye `id` todavía: no existe una tabla `accompanimentRequests` propia
 * en el schema (TI2-23 la definirá). Agregar el campo cuando esa tabla exista.
 *
 * Los campos de contenido siguen el mismo vocabulario que el flujo de Mobile
 * (`apps/mobile/src/application/student-area-models.ts`), de modo que un
 * payload de solicitud válido enviado por Mobile se tipa sin conversión
 * manual contra `AccompanimentRequestContent`.
 */

import type { Sprint1RequestState } from "./state";

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
 * Solicitud de acompañamiento de Sprint 1. No incluye agenda, reservas ni
 * seguimiento (fuera de alcance).
 */
export interface AccompanimentRequest extends AccompanimentRequestContent {
  studentId: string;
  state: Sprint1RequestState;
  createdAt: number;
}
