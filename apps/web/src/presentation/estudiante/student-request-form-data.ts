import { useMutation } from "convex/react";
import type { FunctionArgs } from "convex/server";
import { ConvexError } from "convex/values";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import {
  isApiErrorCode,
  UNAUTHORIZED_ERROR_MESSAGE,
  type ApiErrorCode,
} from "../../../../../convex/domain/index.ts";

/**
 * Envío de la solicitud propia del Estudiante (TI2-149).
 *
 * Usa la forma completa de `createRequest` (TI2-141), con la clave de
 * idempotencia que conserva el borrador. El desenlace distingue por código
 * estable: los rechazos de los datos muestran el mensaje público del
 * Backend, la denegación usa el aviso genérico y cualquier otro fallo
 * (incluida una red caída) se trata como recuperable con mensaje propio.
 * Nunca se muestra `error.message` del SDK.
 */

type CreateRequestArgs = FunctionArgs<typeof api.presentation.requests.createRequest>;

/** Forma completa del envío: la forma anterior (`accessNeeds` como texto) queda fuera. */
export type OwnRequestSubmission = Required<
  Omit<CreateRequestArgs, "accessNeeds" | "otherAccessNeed">
> & {
  accessNeeds: Extract<CreateRequestArgs["accessNeeds"], readonly unknown[]>;
  otherAccessNeed?: string;
};

export type SubmitOwnRequestOutcome =
  | { status: "sent"; requestId: string }
  | { status: "rejected"; message: string }
  | { status: "denied" }
  | { status: "failed" };

/** Códigos cuyo mensaje público explica qué corregir en el formulario. */
const CORRECTABLE_CODES: ReadonlySet<ApiErrorCode> = new Set<ApiErrorCode>([
  "request_fields_invalid",
  "access_needs_empty",
  "access_needs_too_long",
  "conflict",
]);

/** Traduce el error de `createRequest` al desenlace que muestra el formulario. */
export function toSubmitFailure(
  error: unknown,
): Exclude<SubmitOwnRequestOutcome, { status: "sent" }> {
  if (!(error instanceof ConvexError)) {
    return { status: "failed" };
  }
  const data: unknown = error.data;
  // La forma anterior todavía deniega con texto (TI2-181).
  if (data === UNAUTHORIZED_ERROR_MESSAGE) {
    return { status: "denied" };
  }
  if (typeof data !== "object" || data === null || !("code" in data)) {
    return { status: "failed" };
  }
  const { code } = data;
  if (typeof code !== "string" || !isApiErrorCode(code)) {
    return { status: "failed" };
  }
  if (code === "unauthorized") {
    return { status: "denied" };
  }
  const message = "message" in data && typeof data.message === "string" ? data.message : null;
  if (CORRECTABLE_CODES.has(code) && message !== null) {
    return { status: "rejected", message };
  }
  return { status: "failed" };
}

export function useSubmitOwnRequest(): (
  submission: OwnRequestSubmission,
) => Promise<SubmitOwnRequestOutcome> {
  const createRequest = useMutation(api.presentation.requests.createRequest);
  return async (submission) => {
    try {
      const request = await createRequest(submission);
      return { status: "sent", requestId: request._id };
    } catch (error) {
      return toSubmitFailure(error);
    }
  };
}
