import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { API_ERROR_MESSAGES, isApiErrorCode } from "../../../../convex/domain/errors/api_error";
import {
  StudentRequestActionError,
  type StudentRequestActionCommand,
  type StudentRequestActions,
  type StudentRequestSubmitter,
} from "../application/student-area-port";
import type { SubmitStudentRequestCommand } from "../domain/student-area-models";
import { mapBackendStudentRequest, mapCreatedRequestToReceipt } from "./backend-contract-mappers";
import type { MobileConvexClient } from "./convex-client";
import { notifyStudentAreaChanged } from "./convex-student-area-reader";
import { toStudentOperationError } from "./student-contract-mappers";

type WriteClient = Pick<MobileConvexClient, "mutation">;

export interface ConvexStudentRequestSubmitter extends StudentRequestSubmitter {
  readonly requestActions: StudentRequestActions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function defaultIdempotencyKey(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  // Sin crypto el valor solo debe distinguir intentos distintos de esta instalación.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

/** Traduce el rechazo público de una acción; un error desconocido no deja pasar el mensaje del SDK. */
function toActionError(error: unknown): StudentRequestActionError {
  const data = isRecord(error) && isRecord(error.data) ? error.data : undefined;
  const code = typeof data?.code === "string" ? data.code : undefined;
  if (code === "unauthorized" || (isRecord(error) && error.data === "No autorizado")) {
    return new StudentRequestActionError("unauthorized", API_ERROR_MESSAGES.unauthorized);
  }
  if (code === "conflict") {
    return new StudentRequestActionError(
      "conflict",
      "La solicitud cambió y ya no admite esta acción. Actualiza el detalle.",
    );
  }
  if (code === "request_fields_invalid") {
    // El código solo dice que un campo falló; el texto en español viene redactado para mostrarse.
    const detail = typeof data?.message === "string" ? data.message : undefined;
    return new StudentRequestActionError(
      "invalid",
      detail ?? API_ERROR_MESSAGES.request_fields_invalid,
    );
  }
  if (code !== undefined && isApiErrorCode(code)) {
    return new StudentRequestActionError("invalid", API_ERROR_MESSAGES[code]);
  }
  return new StudentRequestActionError(
    "invalid",
    "No pudimos completar la acción. Revisa tu conexión e intenta nuevamente.",
  );
}

/**
 * Envía solicitudes y ejecuta sus acciones contra Convex. El servidor decide autorización, estado
 * vigente y duplicados; este adaptador solo traduce y nunca confirma una escritura que no ocurrió.
 */
export function createConvexStudentRequestSubmitter({
  client,
  createIdempotencyKey = defaultIdempotencyKey,
}: {
  readonly client: WriteClient;
  readonly createIdempotencyKey?: () => string;
}): ConvexStudentRequestSubmitter {
  // Un reintento del mismo contenido reutiliza la clave: si el primer intento sí llegó al servidor
  // (la red falló al responder), el servidor devuelve esa solicitud en vez de duplicarla.
  let pending: { readonly fingerprint: string; readonly key: string } | null = null;

  function keyFor(command: SubmitStudentRequestCommand): string {
    const fingerprint = JSON.stringify(command);
    if (pending?.fingerprint !== fingerprint)
      pending = { fingerprint, key: createIdempotencyKey() };
    return pending.key;
  }

  const requestActions: StudentRequestActions = {
    persistsToServer: true,
    async execute(command: StudentRequestActionCommand) {
      // La app no construye IDs de Convex: reenvía el recibido y el servidor valida que sea suyo.
      const requestId = command.requestId as Id<"requests">;
      try {
        if (command.kind === "cancelRequest") {
          const cancelled = await client.mutation(api.presentation.requests.cancelRequest, {
            requestId,
            reason: command.reason,
          });
          notifyStudentAreaChanged();
          return { ...mapBackendStudentRequest(cancelled), closureReason: command.reason };
        }
        const responded = await client.mutation(
          api.presentation.requests.respondToInformationRequest,
          { requestId, response: command.response },
        );
        notifyStudentAreaChanged();
        // La respuesta cierra la pregunta pendiente; el estado y la fecha son los que fijó el servidor.
        return { ...mapBackendStudentRequest(responded), informationResponse: command.response };
      } catch (error) {
        throw toActionError(error);
      }
    },
  };

  return {
    persistsToServer: true,
    requestActions,
    async submitStudentRequest(command) {
      const { accessNeeds, generalAvailability, ...rest } = command;
      try {
        const created = await client.mutation(api.presentation.requests.createRequest, {
          ...rest,
          accessNeeds: accessNeeds.map(({ id, label }) => ({ id, label })),
          // El validador de Convex pide arreglos mutables; el modelo local los declara de solo lectura.
          generalAvailability: {
            preferredWeekdays: [...generalAvailability.preferredWeekdays],
            ...(generalAvailability.preferredTimeRange
              ? { preferredTimeRange: { ...generalAvailability.preferredTimeRange } }
              : {}),
          },
          idempotencyKey: keyFor(command),
        });
        pending = null;
        notifyStudentAreaChanged();
        return mapCreatedRequestToReceipt(created);
      } catch (error) {
        throw toStudentOperationError(error, "createRequest");
      }
    },
  };
}
