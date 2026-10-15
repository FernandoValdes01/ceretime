import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Lecturas y escrituras de solicitudes del Profesional (TI2-91/92).
 *
 * Cableado delgado, un hook por recurso: consume solo queries/mutations públicas
 * ya existentes. Cada query responde `undefined` mientras carga y la
 * autorización vive en Convex. Separarlas permite que la bandeja y las
 * tomadas carguen y fallen por su cuenta.
 */
/** Tamaño de página de las bandejas; el Backend pagina con cursor. */
export const PAGE_SIZE = 10;

export function useOpenRequests(cursor: string | null) {
  return useQuery(api.presentation.requests.listOpenRequests, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
}

export function useAuthorizedRequests(cursor: string | null) {
  return useQuery(api.presentation.requests.listAuthorizedRequests, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
}

export function useRequestDetail(requestId: string) {
  return useQuery(api.presentation.requests.getRequest, {
    // El formato y la existencia los valida el Backend; un id inválido o
    // ajeno responde denegación genérica sin filtrar existencia.
    requestId: requestId as Id<"requests">,
  });
}

/** Mutación para tomar una solicitud (TI2-92). */
export function useTakeRequest() {
  return useMutation(api.presentation.requests.takeRequest);
}

/** Mutación para pedir información adicional (TI2-92). */
export function useRequestAdditionalInformation() {
  return useMutation(api.presentation.requests.requestAdditionalInformation);
}

/** Página de bandeja o tomadas, derivada del contrato generado (sin duplicar formas). */
export type OpenRequestsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.requests.listOpenRequests>
>;

/** Fila minimizada de la bandeja: sin `accessNeeds` por diseño. */
export type OpenRequestItem = OpenRequestsPage["page"][number];

/** Página de tomadas, derivada del contrato generado (sin duplicar formas). */
export type AuthorizedRequestsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.requests.listAuthorizedRequests>
>;

/** Solicitud tomada con su texto de necesidades de acceso. */
export type AuthorizedRequestItem = AuthorizedRequestsPage["page"][number];

/** Detalle completo de una solicitud, derivado del contrato generado. */
export type RequestDetail = NonNullable<
  FunctionReturnType<typeof api.presentation.requests.getRequest>
>;
