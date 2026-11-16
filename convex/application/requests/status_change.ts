import type { OutgoingReferral } from "../../domain/requests/referral";
import type { RequestStateChange, RequestStatusChange } from "../../domain/requests/transitions";

/**
 * Cambio de estado vigente que deja la política (TI2-141), para las
 * operaciones de solicitudes. El destino sale de `change.to`, nunca escrito a
 * mano. El cierre lleva su razón y la derivación de salida (TI2-143) su
 * unidad de destino, que entrega el caso de uso. La política ya exigió la
 * razón del cierre, y solo `referRequest` deriva: si faltara cualquiera de
 * los dos datos, es un fallo interno, no una denegación, y responder «No
 * autorizado» lo escondería.
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
  if (change.to !== "closed_without_accompaniment") return { status: change.to };
  if (change.reason === undefined) {
    throw new Error("La política de solicitudes cerró sin dejar la razón del cierre.");
  }
  return { status: change.to, closureReason: change.reason };
}
