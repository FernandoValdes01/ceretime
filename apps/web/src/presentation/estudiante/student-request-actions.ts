import { useConvexConnectionState, useMutation } from "convex/react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";
import {
  CONFLICT_ERROR_CODE,
  UNAUTHORIZED_ERROR_CODE,
  type ApiErrorCode,
} from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";

/**
 * Acciones del Estudiante sobre su solicitud (TI2-153): responder a la
 * información pedida y cancelar.
 *
 * El Backend decide si la acción procede: la Web no replica transiciones. El
 * desenlace distingue por código estable, igual que el envío
 * (`student-request-form-data.ts`): un rechazo por el estado actual o por los
 * datos muestra el mensaje público del Backend, que explica por qué; la
 * denegación usa el aviso genérico y cualquier otro fallo (un error del
 * servidor o un código que la Web no espera) es recuperable con mensaje
 * propio. Nunca se muestra `error.message` del SDK.
 *
 * Una red caída no llega como fallo: Convex guarda la mutación y la reenvía
 * cuando vuelve la conexión, así que la promesa queda pendiente. Por eso la
 * pantalla consulta `useBackendConnected` para avisar la espera en vez de
 * esperar un rechazo.
 */

export type OwnRequestActionOutcome =
  | { status: "done" }
  | { status: "rejected"; message: string }
  | { status: "denied" }
  | { status: "failed" };

/**
 * Códigos cuyo mensaje público explica por qué la acción no procede: el estado
 * cambió (`conflict`) o falta o sobra texto (`request_fields_invalid`).
 */
const EXPLAINED_CODES: ReadonlySet<string> = new Set<ApiErrorCode>([
  CONFLICT_ERROR_CODE,
  "request_fields_invalid",
]);

/** Traduce el error de una acción sobre la solicitud propia al desenlace que se muestra. */
export function toOwnRequestActionFailure(
  error: unknown,
): Exclude<OwnRequestActionOutcome, { status: "done" }> {
  const publicError = publicErrorOf(error);
  if (publicError === null) {
    return { status: "failed" };
  }
  if (publicError.code === UNAUTHORIZED_ERROR_CODE) {
    return { status: "denied" };
  }
  if (EXPLAINED_CODES.has(publicError.code)) {
    return { status: "rejected", message: publicError.message };
  }
  return { status: "failed" };
}

/** Desenlace de una mutación: `done` solo si se resolvió; cualquier rechazo se traduce. */
export async function toOutcome(operation: Promise<unknown>): Promise<OwnRequestActionOutcome> {
  try {
    await operation;
    return { status: "done" };
  } catch (error) {
    return toOwnRequestActionFailure(error);
  }
}

// Reciben el `_id` que entregó `getRequest`, con su tipo de origen: la acción
// solo se ofrece sobre un detalle ya cargado y no hace falta convertir el
// parámetro de la ruta.

export function useCancelOwnRequest(): (
  requestId: Id<"requests">,
  reason: string,
) => Promise<OwnRequestActionOutcome> {
  const cancelRequest = useMutation(api.presentation.requests.cancelRequest);
  return (requestId, reason) => toOutcome(cancelRequest({ requestId, reason }));
}

export function useRespondToInformationRequest(): (
  requestId: Id<"requests">,
  response: string,
) => Promise<OwnRequestActionOutcome> {
  const respond = useMutation(api.presentation.requests.respondToInformationRequest);
  return (requestId, response) => toOutcome(respond({ requestId, response }));
}

/** Verdadero mientras el cliente de Convex tiene conexión con el Backend. */
export function useBackendConnected(): boolean {
  return useConvexConnectionState().isWebSocketConnected;
}
