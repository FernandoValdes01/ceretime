import { api } from "../../../../convex/_generated/api";
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
          // La aceptación responde el acompañamiento; la solicitud se relee para no suponer su estado.
          const request = await client.query(api.presentation.requests.getRequest, {
            requestId: operation.args.requestId,
          });
          const accepted: ProfessionalRequest = {
            ...mapBackendProfessionalRequest(request),
            accompaniment: { ...mapBackendStudentAccompaniment(opened), requestId },
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
