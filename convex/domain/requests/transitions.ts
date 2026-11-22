/**
 * Transiciones de solicitud: las de Sprint 1 (TI2-7), los cierres sin
 * acompañamiento (TI2-85), la respuesta del Estudiante (TI2-141), la
 * derivación de salida (TI2-143) y la liberación de la toma (revisión TI4-84).
 *
 * Declara qué transiciones existen. No las aplica ni las valida: el rechazo de
 * saltos y la exigencia de motivo son alcance de TI2-21.
 */

import type { OutgoingReferral } from "./referral";
import type {
  ClosureRequestState,
  RequestState,
  ReferralRequestState,
  Sprint1RequestState,
} from "./state";

/** `from` y `to` son estados que una fila puede traer. */
export type RequestStateTransition = {
  readonly from: RequestState;
  readonly to: RequestState;
  /**
   * Al pedir información, cerrar o derivar, el motivo le explica al estudiante
   * qué falta, por qué se cerró o por qué se derivó; al cancelar lo escribe el
   * propio Estudiante y deja trazado por qué terminó la solicitud.
   */
  readonly requiresReason: boolean;
};

/**
 * Cualquier par que no esté en esta tabla, en la de respuesta, en la de
 * derivación ni en la de cierres es inválido, incluidos los saltos y los
 * demás retrocesos.
 *
 * Las filas se tipan como `Sprint1RequestState`: agregar acá una transición
 * hacia un cierre o hacia la derivación no compila.
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

/**
 * Respuesta del Estudiante a la información pedida (TI2-141): la solicitud
 * vuelve a revisión para que el Profesional la retome. Exige motivo porque el
 * motivo es la respuesta misma. Junto con la liberación de la toma es uno de
 * los dos retrocesos del modelo; quién lo intenta (el Estudiante dueño) lo
 * exige Aplicación.
 */
export const RESPONSE_REQUEST_TRANSITIONS = [
  { from: "awaiting_information_or_acceptance", to: "under_review", requiresReason: true },
] as const satisfies readonly (RequestStateTransition & {
  readonly from: Sprint1RequestState;
  readonly to: Sprint1RequestState;
})[];

/**
 * Derivación de salida (TI2-143): CERETI deriva al estudiante a otra unidad
 * mientras revisa la solicitud. Sale solo de los estados que ya tienen toma y
 * llega a `referred`, que es terminal: de ahí no sale ninguna fila y nunca se
 * abre acompañamiento. Exige motivo porque es la razón comprensible que lee el
 * estudiante. No sale de `received` por la misma razón que el cierre: tomar
 * la solicitud ya la pasa a `under_review`.
 *
 * La tabla no pide destinatarios ni antecedentes: la comunicación con la
 * unidad de destino ocurre fuera de la aplicación. Quién la intenta (el
 * Profesional con toma activa) lo exige Aplicación.
 */
export const REFERRAL_REQUEST_TRANSITIONS = [
  { from: "under_review", to: "referred", requiresReason: true },
  { from: "awaiting_information_or_acceptance", to: "referred", requiresReason: true },
] as const satisfies readonly (RequestStateTransition & {
  readonly from: Sprint1RequestState;
  readonly to: ReferralRequestState;
})[];

/**
 * Liberación de la toma (revisión TI4-84): la solicitud vuelve a `received`
 * para que otro Profesional la tome desde la bandeja. Sale solo de los
 * estados que ya tienen toma; un estado terminal no se libera. La libera el
 * propio Profesional con toma activa o, al revocar su cuenta, la revocación
 * misma, y eso lo exige Aplicación. No exige motivo: el registro del cambio
 * deja actor y fecha, y la toma liberada (`TOMAS_SOLICITUD.liberadaEn` del MER)
 * queda revocada. Volver a `received` desde la espera de información deja sin
 * efecto la pregunta pendiente; quien la tome puede volver a pedirla.
 */
export const RELEASE_REQUEST_TRANSITIONS = [
  { from: "under_review", to: "received", requiresReason: false },
  { from: "awaiting_information_or_acceptance", to: "received", requiresReason: false },
] as const satisfies readonly (RequestStateTransition & {
  readonly from: Sprint1RequestState;
  readonly to: Sprint1RequestState;
})[];

/** Toda transición válida de la solicitud; la política busca solo acá. */
export const REQUEST_TRANSITIONS = [
  ...SPRINT_1_REQUEST_TRANSITIONS,
  ...RESPONSE_REQUEST_TRANSITIONS,
  ...RELEASE_REQUEST_TRANSITIONS,
  ...REFERRAL_REQUEST_TRANSITIONS,
  ...CLOSURE_REQUEST_TRANSITIONS,
] as const;

/**
 * Verdadero mientras la solicitud admite algún paso más (TI2-149): sale de la
 * tabla de transiciones, así que una aceptada, derivada, cerrada o cancelada
 * ya terminó. Recibe `string` para clasificar lo que muestra un cliente.
 */
export function isOpenRequestState(state: string): boolean {
  return REQUEST_TRANSITIONS.some((transition) => transition.from === state);
}

/**
 * Entrada del historial de cambios de estado de la solicitud: se agrega, no se
 * edita ni se borra. No es el evento de auditoría de RD-03, que registra solo
 * actor, fecha, acción, recurso y resultado: `reason` es texto libre y puede
 * traer datos sensibles, así que no se copia a la bitácora de auditoría.
 *
 * `actorId` sale de la sesión autenticada en la capa de aplicación, nunca de un
 * parámetro del cliente: es el Profesional o, al cancelar, el propio
 * Estudiante, o el Administrador que revoca la cuenta del Profesional que la
 * tenía tomada (revisión TI4-84). `reason` lo escribe ese actor: el Profesional para el
 * estudiante o, al cancelar o responder, el Estudiante para CERETI. Quien lo escribe no
 * debe incluir diagnósticos ni etiquetas clínicas, pero el tipo no puede
 * impedirlo. `occurredAt` es epoch en milisegundos, como maneja las fechas
 * Convex.
 */
export type RequestStateChange = {
  readonly from: RequestState;
  readonly to: RequestState;
  readonly actorId: string;
  readonly occurredAt: number;
  readonly reason?: string;
};

/**
 * Escritura del estado vigente de la solicitud (TI2-141). El cierre sin
 * acompañamiento lleva su razón, que lee el Estudiante, y ningún otro estado
 * la lleva: así no compila una razón de cierre en una solicitud aceptada ni un
 * cierre sin razón.
 *
 * `referred` lleva su derivación de salida de la misma forma (TI2-143): no
 * compila una solicitud derivada que no diga a dónde, ni una derivación en
 * otro estado. El identificador es genérico para no importar
 * `convex/_generated`.
 */
export type RequestStatusChange<UserId extends string = string> =
  | {
      readonly status: "closed_without_accompaniment";
      readonly closureReason: string;
      readonly outgoingReferral?: never;
    }
  | {
      readonly status: ReferralRequestState;
      readonly outgoingReferral: OutgoingReferral<UserId>;
      readonly closureReason?: never;
    }
  | {
      readonly status: Exclude<RequestState, "closed_without_accompaniment" | ReferralRequestState>;
      readonly closureReason?: never;
      readonly outgoingReferral?: never;
    };

/** Llegar acá habilita la apertura de exactamente un acompañamiento (TI2-24). */
export const ACCEPTANCE_STATE: Sprint1RequestState = "accepted";
