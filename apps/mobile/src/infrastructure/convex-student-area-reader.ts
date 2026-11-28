import { api } from "../../../../convex/_generated/api";
import type { StudentAreaReader } from "../application/student-area-port";
import type { Accompaniment } from "../domain/request-models";
import type {
  StudentAreaSnapshot,
  StudentIdentity,
  StudentRequest,
} from "../domain/student-area-models";
import type { MobileConvexClient } from "./convex-client";
import {
  mapListedStudentAccompaniment,
  mapStudentRequestDetail,
  toStudentOperationError,
} from "./student-contract-mappers";
import { readAllPages } from "./read-all-pages";

type ReadClient = Pick<MobileConvexClient, "query">;

// Cada solicitud pide su detalle aparte: en tandas, la ráfaga no crece con el historial de la cuenta.
const MAX_CONCURRENT_DETAIL_READS = 5;

async function mapInBatches<Item, Result>(
  items: readonly Item[],
  size: number,
  map: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(map))));
  }
  return results;
}

// Los envíos y las acciones viven en otro adaptador y otra ruta: avisan por aquí para que la lista
// se recargue aunque su pantalla ya esté montada.
const changeListeners = new Set<() => void>();

/** Avisa a todos los lectores estudiantiles que las solicitudes de la cuenta cambiaron. */
export function notifyStudentAreaChanged(): void {
  for (const listener of changeListeners) listener();
}

export interface ConvexStudentAreaReader extends StudentAreaReader {
  subscribe(onChange: () => void): () => void;
}

/**
 * Lee el área estudiantil desde Convex. La identidad la resuelve el servidor con la sesión del
 * cliente; `student` solo rotula la pantalla con la cuenta que ya ingresó.
 */
export function createConvexStudentAreaReader({
  client,
  student,
}: {
  readonly client: ReadClient;
  readonly student: StudentIdentity;
}): ConvexStudentAreaReader {
  async function readRequests(): Promise<StudentRequest[]> {
    try {
      const listed = await readAllPages((paginationOpts) =>
        client.query(api.presentation.requests.listOwnRequests, { paginationOpts }),
      );
      // El listado no trae el intercambio con el profesional ni la razón de cierre: solo el detalle.
      return await mapInBatches(
        listed,
        MAX_CONCURRENT_DETAIL_READS,
        async (row): Promise<StudentRequest> => {
          const detail = await client.query(api.presentation.requests.getRequest, {
            requestId: row._id,
          });
          return {
            ...mapStudentRequestDetail(detail),
            ...(detail.informationRequest === undefined
              ? {}
              : { informationRequest: detail.informationRequest }),
            ...(detail.informationResponse === undefined
              ? {}
              : { informationResponse: detail.informationResponse }),
            ...(detail.closureReason === undefined ? {} : { closureReason: detail.closureReason }),
          };
        },
      );
    } catch (error) {
      throw toStudentOperationError(error, "listOwnRequests");
    }
  }

  async function readAccompaniments(): Promise<Accompaniment[]> {
    try {
      const listed = await readAllPages((paginationOpts) =>
        client.query(api.presentation.accompaniments.listOwnedAccompaniments, { paginationOpts }),
      );
      return listed.map(mapListedStudentAccompaniment);
    } catch (error) {
      throw toStudentOperationError(error, "listOwnedAccompaniments");
    }
  }

  return {
    async readStudentArea(): Promise<StudentAreaSnapshot> {
      // Sin éxito parcial: si una de las dos lecturas falla, falla la carga completa.
      const [requests, accompaniments] = await Promise.all([readRequests(), readAccompaniments()]);
      return { student, requests, accompaniments };
    },
    subscribe(onChange) {
      changeListeners.add(onChange);
      return () => {
        changeListeners.delete(onChange);
      };
    },
  };
}
