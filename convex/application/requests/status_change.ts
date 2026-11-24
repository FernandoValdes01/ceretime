import type { OutgoingReferral } from "../../domain/requests/referral";
import type { RequestStateChange, RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Cambio de estado vigente que deja la política (TI2-141), para las
 * operaciones de solicitudes. El destino sale de `change.to`, nunca escrito a
 * mano. La derivación de salida (TI2-143) lleva su unidad de destino, que
 * entrega el caso de uso. La razón del cierre queda solo en el registro del
 * cambio (TI2-165), pero la política ya debió exigirla. Si faltara la razón
 * o la derivación, o llegara una derivación con otro destino, es un fallo
 * interno, no una denegación, y responder «No autorizado» lo escondería.
 */
export function toStatusChange<UserId extends string = string>(
  change: RequestStateChange,
  outgoingReferral?: OutgoingReferral<UserId>,
): RequestStatusChange<UserId> {
  if (change.to === "referred") {
    if (outgoingReferral === undefined) {
      throw new Error("La solicitud se derivó sin dejar la derivación de salida.");
    }
    return { status: change.to, outgoingReferral };
  }
  // Caso inverso: perderla en silencio dejaría la solicitud en otro estado sin su derivación.
  if (outgoingReferral !== undefined) {
    throw new Error("La derivación de salida solo acompaña al estado de derivación.");
  }
  if (change.to === "closed_without_accompaniment" && change.reason === undefined) {
    throw new Error("La política de solicitudes cerró sin dejar la razón del cierre.");
  }
  return { status: change.to };
}
