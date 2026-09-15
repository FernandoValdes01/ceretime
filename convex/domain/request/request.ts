/**
 * Entidad de solicitud de acompañamiento (TI2-8).
 *
 * Se nombra `AccompanimentRequest` y no `Request` porque `convex/tsconfig.json`
 * incluye `dom` en `lib`, y `Request` ya existe como tipo global de fetch
 * dentro de los archivos de Convex. Ver hilo de TI2-7 para el detalle.
 *
 * No incluye `id` todavía: no existe una tabla `accompanimentRequests` propia
 * en el schema (TI2-23 la definirá). Agregar el campo cuando esa tabla exista.
 */
import type { Id } from "../../_generated/dataModel";
import type { RequestState } from "./state";

/**
 * Solicitud de acompañamiento mínima de Sprint 1. No incluye agenda,
 * disponibilidad, reservas ni seguimiento (fuera de alcance).
 */
export interface AccompanimentRequest {
  studentId: Id<"users">;
  state: RequestState;
  createdAt: number;
}
