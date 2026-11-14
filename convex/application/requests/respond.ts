import { okResult, type ApiResult } from "../../domain/errors/api_error";
import {
  toAccompanimentRequest,
  toInformationResponse,
  type AccompanimentRequest,
} from "../../domain/requests/request";
import { transitionRequest } from "../../domain/requests/transition_policy";
import type {
  ActiveStudentReader,
  RequestReader,
  RequestStatusWriter,
  RequestTransitionRecorder,
} from "./ports";
import { denied, stateConflict } from "./results";
import { toStatusChange } from "./status_change";

/** Capacidades que necesita la respuesta del Estudiante; la composición entrega los adaptadores. */
export interface RespondToInformationRequestDeps<RequestId extends string, UserId extends string> {
  readonly students: ActiveStudentReader<UserId>;
  readonly requests: RequestReader<RequestId, UserId> &
    RequestStatusWriter<RequestId> &
    RequestTransitionRecorder<RequestId, UserId>;
  /** Reloj del servidor para el registro del cambio; las pruebas lo fijan. */
  readonly now: () => number;
}

const NOT_AWAITING = "La solicitud no admite una respuesta en su estado actual.";

/**
 * Responde a la información que pidió el Profesional (TI2-141): devuelve la
 * solicitud de `awaiting_information_or_acceptance` a `under_review` para que
 * quien la tomó la retome. Solo el Estudiante dueño con cuenta vigente; una
 * solicitud ajena o inexistente recibe la misma denegación genérica. La
 * respuesta la normaliza Dominio con `toInformationResponse` y queda, recortada,
 * como motivo del cambio en el historial, junto al actor y la fecha. Fuera de
 * la espera se rechaza sin escribir y nunca abre acompañamiento.
 *
 * Recibe sus dependencias como puertos: no conoce Convex ni repositorios
 * concretos. Los adaptadores comparten el `ctx` de la mutation, así la lectura,
 * la validación y las dos escrituras siguen siendo atómicas.
 */
export async function respondToInformationRequest<RequestId extends string, UserId extends string>(
  deps: RespondToInformationRequestDeps<RequestId, UserId>,
  input: {
    readonly tokenIdentifier: string | null;
    readonly requestId: RequestId;
    readonly response: string;
  },
): Promise<
  ApiResult<AccompanimentRequest & { readonly _id: RequestId; readonly studentId: UserId }>
> {
  const student = await deps.students.findActiveStudent(input.tokenIdentifier);
  if (student === null) return denied();
  const row = await deps.requests.getRequest(input.requestId);
  if (row === null || row.studentId !== student._id) return denied();
  // Solo la espera admite respuesta: `received -> under_review` existe en la
  // tabla, pero es la toma del Profesional, no un paso del Estudiante.
  if (row.status !== "awaiting_information_or_acceptance") return stateConflict(NOT_AWAITING);
  const response = toInformationResponse(input.response);
  if (response.status === "error") return response;
  const result = transitionRequest({
    from: row.status,
    to: "under_review",
    actorId: student._id,
    occurredAt: deps.now(),
    reason: response.data,
  });
  if (result.status === "rejected") return stateConflict(NOT_AWAITING);
  await deps.requests.setRequestStatus(row._id, toStatusChange(result.change));
  await deps.requests.logRequestTransition({
    requestId: row._id,
    from: result.change.from,
    to: result.change.to,
    actorId: student._id,
    reason: response.data,
    occurredAt: result.change.occurredAt,
  });
  return okResult(
    toAccompanimentRequest({
      _id: row._id,
      studentId: row.studentId,
      status: result.change.to,
      accessNeeds: row.accessNeeds,
      createdAt: row.createdAt,
    }),
  );
}
