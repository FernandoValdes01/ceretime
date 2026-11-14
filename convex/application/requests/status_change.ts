import type { RequestStateChange, RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Cambio de estado vigente que deja la política (TI2-141), para las
 * operaciones de solicitudes. El destino sale de `change.to`, nunca escrito a
 * mano. La política ya exigió la razón del cierre: si faltara, es un fallo
 * interno, no una denegación, y responder «No autorizado» lo escondería.
 */
export function toStatusChange(change: RequestStateChange): RequestStatusChange {
  if (change.to !== "closed_without_accompaniment") return { status: change.to };
  if (change.reason === undefined) {
    throw new Error("La política de solicitudes cerró sin dejar la razón del cierre.");
  }
  return { status: change.to, closureReason: change.reason };
}
