/**
 * Entidad de acompañamiento (TI2-8).
 *
 * Alineada con la tabla `accompaniments` del schema actual. `accessNeeds`
 * es información sensible (Ley 21.719) y se minimiza para Practicante —
 * ese control de acceso vive en la capa de autorización, no en este tipo.
 */
import type { Id } from "../../_generated/dataModel";
import type { Infer } from "convex/values";
import type { accompanimentStatusUnion } from "../../validators";

/** Estados del acompañamiento (activo, pausado, cerrado). */
export type AccompanimentStatus = Infer<typeof accompanimentStatusUnion>;

/**
 * Información mínima del acompañamiento para Sprint 1. No incluye agenda,
 * disponibilidad ni reservas (fuera de alcance).
 */
export interface Accompaniment {
  id: Id<"accompaniments">;
  studentId: Id<"users">;
  status: AccompanimentStatus;
  objective: string;
  accessNeeds: string;
}
