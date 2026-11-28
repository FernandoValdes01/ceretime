import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import {
  PRIVACY_REQUEST_CONTRACT_VERSION,
  type PrivacyRequestStatus,
} from "../../../../../convex/domain/index.ts";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Solicitudes de derechos de privacidad en la Web (TI2-171).
 *
 * Cableado delgado sobre `api.presentation.privacy` (contrato v1 de
 * `docs/contratos-sprint-3/privacidad.md`). Cada query responde `undefined`
 * mientras carga; la autorización, los plazos y las transiciones los decide
 * el Backend. La Web no calcula vencimientos ni prórrogas: muestra los que
 * llegan en la solicitud.
 */

const version = PRIVACY_REQUEST_CONTRACT_VERSION;

/** Tamaño de página; el Backend admite hasta 50. */
export const PRIVACY_PAGE_SIZE = 10;

/** Solicitudes propias del Estudiante, de la más reciente a la más antigua. */
export function useOwnPrivacyRequests() {
  return usePaginatedQuery(
    api.presentation.privacy.listOwnPrivacyRequests,
    { version },
    { initialNumItems: PRIVACY_PAGE_SIZE },
  );
}

/** Cola del Administrador por vencimiento, con filtro opcional de estado. */
export function usePrivacyRequestQueue(status: PrivacyRequestStatus | undefined) {
  return usePaginatedQuery(
    api.presentation.privacy.listPrivacyRequests,
    status === undefined ? { version } : { version, status },
    { initialNumItems: PRIVACY_PAGE_SIZE },
  );
}

/** Una solicitud propia, o cualquiera para el Administrador responsable. */
export function usePrivacyRequest(requestId: string) {
  return useQuery(api.presentation.privacy.getPrivacyRequest, {
    // El formato y la titularidad los valida el Backend; un id ajeno o
    // inexistente responde la denegación genérica sin revelar si existe.
    requestId: requestId as Id<"privacyRequests">,
    version,
  });
}

export function useSubmitPrivacyRequest() {
  const submit = useMutation(api.presentation.privacy.submitPrivacyRequest);
  return (kind: SubmitPrivacyRequestArgs["kind"]) => submit({ kind, version });
}

export function useStartPrivacyRequestReview() {
  const start = useMutation(api.presentation.privacy.startPrivacyRequestReview);
  return (requestId: Id<"privacyRequests">) => start({ requestId, version });
}

export function useResolvePrivacyRequest() {
  const resolve = useMutation(api.presentation.privacy.resolvePrivacyRequest);
  return (input: Omit<ResolvePrivacyRequestArgs, "version">) => resolve({ ...input, version });
}

export function useExtendPrivacyRequestDeadline() {
  const extend = useMutation(api.presentation.privacy.extendPrivacyRequestDeadline);
  return (input: Omit<ExtendPrivacyRequestArgs, "version">) => extend({ ...input, version });
}

export function useRecordPrivacyResponseDelivery() {
  const record = useMutation(api.presentation.privacy.recordPrivacyResponseDelivery);
  return (input: Omit<RecordPrivacyDeliveryArgs, "version">) => record({ ...input, version });
}

type SubmitPrivacyRequestArgs = FunctionArgs<typeof api.presentation.privacy.submitPrivacyRequest>;
type ResolvePrivacyRequestArgs = FunctionArgs<
  typeof api.presentation.privacy.resolvePrivacyRequest
>;
type ExtendPrivacyRequestArgs = FunctionArgs<
  typeof api.presentation.privacy.extendPrivacyRequestDeadline
>;
type RecordPrivacyDeliveryArgs = FunctionArgs<
  typeof api.presentation.privacy.recordPrivacyResponseDelivery
>;

/** Solicitud tal como la entrega el Backend, en la vista del titular o del responsable. */
export type PrivacyRequestView = FunctionReturnType<
  typeof api.presentation.privacy.getPrivacyRequest
>;

/** Solicitud de la cola del responsable. */
export type ReviewPrivacyRequest = Extract<PrivacyRequestView, { view: "review" }>;
