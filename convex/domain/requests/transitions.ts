/**
 * Transiciones de solicitud: las de Sprint 1 (TI2-7) y los cierres sin
 * acompañamiento (TI2-85).
 *
 * Declara qué transiciones existen. No las aplica ni las valida: el rechazo de
 * saltos y la exigencia de motivo son alcance de TI2-21.
 */

import type { ClosureRequestState, PersistableRequestState, Sprint1RequestState } from "./state";

/**
 * `from` y `to` se tipan como `PersistableRequestState`: una fila hacia
 * `referred` no compila, porque la derivación no tiene reglas acordadas.
 */
export type RequestStateTransition = {
  readonly from: PersistableRequestState;
  readonly to: PersistableRequestState;
  /**
   * Al pedir información o cerrar, el motivo le explica al estudiante qué falta
   * o por qué se cerró; al cancelar lo escribe el propio Estudiante y deja
   * trazado por qué terminó la solicitud.
   */
  readonly requiresReason: boolean;
};

/**
 * Cualquier par que no esté en esta tabla ni en la de cierres es inválido,
 * incluidos los saltos y los retrocesos.
 *
 * Las filas se tipan como `Sprint1RequestState`: agregar acá una transición
 * hacia un cierre o un estado de Cycle futuro no compila.
 */
export const SPRINT_1_REQUEST_TRANSITIONS = [
  { from: "received", to: "under_review", requiresReason: false },
  {
    from: "under_review",
    to: "awaiting_information_or_acceptance",
    requiresReason: true,
  },
  { from: "under_review", to: "accepted", requiresReason: false },
  {
    from: "awaiting_information_or_acceptance",
    to: "accepted",
    requiresReason: false,
  },
] as const satisfies readonly (RequestStateTransition & {
  readonly from: Sprint1RequestState;
  readonly to: Sprint1RequestState;
})[];

/**
 * Cierres sin acompañamiento (TI2-85). Salen solo de estados abiertos de
 * Sprint 1 y llegan a estados terminales: de un cierre no sale ninguna fila, y
 * `accepted` no se cancela ni se cierra porque ya abrió su acompañamiento.
 * Todas exigen motivo: al cerrar es la razón comprensible que pide la
 * especificación y al cancelar deja trazado por qué terminó la solicitud.
 *
 * La tabla no dice quién intenta cada fila: cancelar es del Estudiante dueño
 * y cerrar del Profesional con toma activa, y eso lo exige Aplicación. El
 * Profesional no cierra desde `received` porque tomar ya la pasa a
 * `under_review`. Orígenes provisionales mientras PV-04 siga pendiente.
 */
export const CLOSURE_REQUEST_TRANSITIONS = [
  { from: "received", to: "cancelled", requiresReason: true },
  { from: "under_review", to: "cancelled", requiresReason: true },
  { from: "awaiting_information_or_acceptance", to: "cancelled", requiresReason: true },
  { from: "under_review", to: "closed_without_accompaniment", requiresReason: true },
  {
    from: "awaiting_information_or_acceptance",
    to: "closed_without_accompaniment",
    requiresReason: true,
  },
] as const satisfies readonly (RequestStateTransition & {
  readonly from: Sprint1RequestState;
  readonly to: ClosureRequestState;
})[];

/** Toda transición válida de la solicitud; la política busca solo acá. */
export const REQUEST_TRANSITIONS = [
  ...SPRINT_1_REQUEST_TRANSITIONS,
  ...CLOSURE_REQUEST_TRANSITIONS,
] as const;

/**
 * Entrada del historial de cambios de estado de la solicitud: se agrega, no se
 * edita ni se borra. No es el evento de auditoría de RD-03, que registra solo
 * actor, fecha, acción, recurso y resultado: `reason` es texto libre y puede
 * traer datos sensibles, así que no se copia a la bitácora de auditoría.
 *
 * `actorId` sale de la sesión autenticada en la capa de aplicación, nunca de un
 * parámetro del cliente: es el Profesional o, al cancelar, el propio
 * Estudiante. `reason` lo escribe ese actor: el Profesional para el
 * estudiante o, al cancelar, el Estudiante para CERETI. Quien lo escribe no
 * debe incluir diagnósticos ni etiquetas clínicas, pero el tipo no puede
 * impedirlo. `occurredAt` es epoch en milisegundos, como maneja las fechas
 * Convex.
 */
export type RequestStateChange = {
  readonly from: PersistableRequestState;
  readonly to: PersistableRequestState;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/** Llegar acá habilita la apertura de exactamente un acompañamiento (TI2-24). */
export const ACCEPTANCE_STATE: Sprint1RequestState = "accepted";
