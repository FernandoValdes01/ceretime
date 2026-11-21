import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import type { ProfessionalReviewPort } from "../application/professional-review-port";
import { UserFacingError } from "../application/user-facing-error";
import type { ProfessionalRequest } from "../domain/professional-review-models";
import {
  mapBackendProfessionalRequest,
  mapBackendProfessionalRequests,
  mapBackendStudentAccompaniment,
  mapProfessionalActionToContract,
} from "./backend-contract-mappers";
import type { MobileConvexClient } from "./convex-client";
import { readAllPages } from "./read-all-pages";

const missingDetailMessages = {
  reason_required: "Se requiere el motivo para pedir información adicional",
  objective_required: "Se requiere el objetivo para abrir el acompañamiento",
} as const;

// La aceptación ya quedó guardada: si la relectura falla se informa el éxito con lo que se sabe,
// en vez de un error que invitaría a repetir una aceptación que el servidor rechazaría.
async function readAcceptedRequest(
  client: Pick<MobileConvexClient, "query">,
  requestId: Id<"requests">,
): Promise<Pick<ProfessionalRequest, "id" | "createdAt"> & Partial<ProfessionalRequest>> {
  try {
    return mapBackendProfessionalRequest(
      await client.query(api.presentation.requests.getRequest, { requestId }),
    );
  } catch {
    return { id: requestId, createdAt: new Date().toISOString() };
  }
}

/** Bandeja y acciones del Profesional sobre las operaciones públicas de Convex (TI2-141, TI2-181). */
export function createConvexProfessionalReviewAdapter(
  client: Pick<MobileConvexClient, "query" | "mutation">,
): ProfessionalReviewPort {
  return {
    async readProfessionalRequests() {
      const [open, authorized] = await Promise.all([
        readAllPages((paginationOpts) =>
          client.query(api.presentation.requests.listOpenRequests, { paginationOpts }),
        ),
        readAllPages((paginationOpts) =>
          client.query(api.presentation.requests.listAuthorizedRequests, { paginationOpts }),
        ),
      ]);
      return mapBackendProfessionalRequests({ open, authorized });
    },

    async performProfessionalRequestAction(requestId, action, details) {
      const operation = mapProfessionalActionToContract(requestId, action, details);
      switch (operation.kind) {
        case "unsupported":
          throw new UserFacingError(missingDetailMessages[operation.reason]);
        case "takeRequest": {
          const taken = await client.mutation(
            api.presentation.requests.takeRequest,
            operation.args,
          );
          return {
            action,
            request: mapBackendProfessionalRequest(taken),
            message: "La solicitud quedó en revisión.",
          };
        }
        case "requestAdditionalInformation": {
          const updated = await client.mutation(
            api.presentation.requests.requestAdditionalInformation,
            operation.args,
          );
          return {
            action,
            request: mapBackendProfessionalRequest(updated),
            message: "La solicitud quedó esperando información.",
          };
        }
        case "acceptRequest": {
          const opened = await client.mutation(
            api.presentation.requests.acceptRequest,
            operation.args,
          );
          const accompaniment = { ...mapBackendStudentAccompaniment(opened), requestId };
          const accepted: ProfessionalRequest = {
            ...(await readAcceptedRequest(client, operation.args.requestId)),
            status: "accepted",
            availableActions: [],
            accompaniment,
          };
          return {
            action,
            request: accepted,
            message: "La solicitud fue aceptada y abrió un acompañamiento.",
          };
        }
      }
    },
  };
}
