import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Lecturas de solicitudes propias del Estudiante (TI2-89).
 *
 * Cableado delgado, un hook por recurso: consume solo queries públicas ya
 * existentes (`listOwnRequests` y `getRequest`). Cada query responde
 * `undefined` mientras carga y la autorización vive en Convex. La paginación
 * avanza por cursor sin perder ni repetir filas.
 */
/** Tamaño de página del listado; el Backend pagina con cursor. */
export const PAGE_SIZE = 10;

export function useOwnRequests(cursor: string | null) {
  return useQuery(api.presentation.requests.listOwnRequests, {
    paginationOpts: { numItems: PAGE_SIZE, cursor },
  });
}

export function useOwnRequestDetail(requestId: string) {
  return useQuery(api.presentation.requests.getRequest, {
    // El formato y la existencia los valida el Backend; un id inválido o
    // ajeno responde denegación genérica sin filtrar existencia.
    requestId: requestId as Id<"requests">,
  });
}

/** Página de solicitudes propias, derivada del contrato generado (sin duplicar formas). */
export type OwnRequestsPage = NonNullable<
  FunctionReturnType<typeof api.presentation.requests.listOwnRequests>
>;

/** Fila de solicitud propia con su texto de necesidades de acceso. */
export type OwnRequestItem = OwnRequestsPage["page"][number];

/** Detalle completo de una solicitud propia, derivado del contrato generado. */
export type OwnRequestDetail = NonNullable<
  FunctionReturnType<typeof api.presentation.requests.getRequest>
>;
