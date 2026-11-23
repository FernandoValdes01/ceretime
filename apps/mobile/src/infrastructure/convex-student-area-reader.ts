import { api } from "../../../../convex/_generated/api";
import type { StudentAreaReader, StudentPageOptions } from "../application/student-area-port";
import type { Accompaniment } from "../domain/request-models";
import type {
  StudentAreaSnapshot,
  StudentIdentity,
  StudentRequest,
} from "../domain/student-area-models";
import type { MobileConvexClient } from "./convex-client";
import {
  mapStudentAccompanimentDetail,
  mapStudentRequestDetail,
  toStudentOperationError,
} from "./student-contract-mappers";

const PAGE_SIZE = 50;
// Tope de seguridad: un cursor que nunca termina no debe dejar la pantalla cargando para siempre.
const MAX_PAGES = 50;

type ReadClient = Pick<MobileConvexClient, "query">;

// Los envíos y las acciones viven en otro adaptador y otra ruta: avisan por aquí para que la lista
// se recargue aunque su pantalla ya esté montada.
const changeListeners = new Set<() => void>();

/** Avisa a todos los lectores estudiantiles que las solicitudes de la cuenta cambiaron. */
export function notifyStudentAreaChanged(): void {
  for (const listener of changeListeners) listener();
}

export interface ConvexStudentAreaReader extends StudentAreaReader {
  subscribe(onChange: () => void): () => void;
  /** Provoca la recarga de quienes escuchan; lo usan los adaptadores que escriben. */
  notifyChanged(): void;
}

interface ServerPage<T> {
  readonly page: readonly T[];
  readonly isDone: boolean;
  readonly continueCursor: string;
}

/** Recorre todas las páginas: una página vacía puede tener continuación, solo `isDone` es el final. */
async function readAllPages<T>(
  readPage: (options: StudentPageOptions) => Promise<ServerPage<T>>,
): Promise<T[]> {
  const items: T[] = [];
  let cursor: string | null = null;
  for (let pageNumber = 0; pageNumber < MAX_PAGES; pageNumber += 1) {
    const page: ServerPage<T> = await readPage({ numItems: PAGE_SIZE, cursor });
    items.push(...page.page);
    if (page.isDone) return items;
    cursor = page.continueCursor;
  }
  throw new Error("El recorrido de páginas no terminó.");
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
      return await Promise.all(
        listed.map(async (row): Promise<StudentRequest> => {
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
        }),
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
      return listed.map(mapStudentAccompanimentDetail);
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
    notifyChanged: notifyStudentAreaChanged,
  };
}
