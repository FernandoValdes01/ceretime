import { isProfileActive } from "../../domain/authorization/permissions";
import {
  conflictError,
  errResult,
  okResult,
  unauthorizedError,
  type ApiResult,
} from "../../domain/errors/api_error";
import type { AuthorizationReader } from "../authorization/authorize";
import type {
  PushSubscriptionActivationInput,
  PushSubscriptionReader,
  PushSubscriptionStore,
} from "./ports";

/**
 * Gestión de suscripciones Web Push propias (TI2-160).
 *
 * Capa de Aplicación: solo el perfil vigente de la sesión puede consultar si
 * tiene push activo, activar una suscripción propia o desactivarla por
 * endpoint. Nunca acepta un identificador de usuario del cliente y nunca
 * devuelve endpoints ni claves de suscripción.
 */

export interface PushStatusDeps {
  readonly auth: AuthorizationReader;
  readonly subscriptions: PushSubscriptionReader;
  readonly vapidPublicKey: string | null;
}

export interface PushMutationDeps {
  readonly auth: AuthorizationReader;
  readonly subscriptions: PushSubscriptionStore;
  readonly now: () => number;
}

export interface OwnPushStatus {
  readonly enabled: boolean;
  readonly subscriptionCount: number;
  readonly vapidPublicKey: string | null;
}

async function resolveActiveUserId(
  auth: AuthorizationReader,
  tokenIdentifier: string | null,
): Promise<string | null> {
  if (tokenIdentifier === null) return null;
  const profile = await auth.findProfileByTokenIdentifier(tokenIdentifier);
  return profile === null || !isProfileActive(profile) ? null : profile._id;
}

/** Estado push propio y clave pública VAPID para que el navegador pueda suscribirse. */
export async function getOwnPushStatus(
  deps: PushStatusDeps,
  tokenIdentifier: string | null,
): Promise<ApiResult<OwnPushStatus>> {
  const userId = await resolveActiveUserId(deps.auth, tokenIdentifier);
  if (userId === null) return errResult(unauthorizedError());
  const subscriptionCount = await deps.subscriptions.countForUser(userId);
  return okResult({
    enabled: subscriptionCount > 0,
    subscriptionCount,
    vapidPublicKey: deps.vapidPublicKey,
  });
}

/** Guarda o actualiza una suscripción Web Push propia del navegador actual. */
export async function activateOwnPushSubscription(
  deps: PushMutationDeps,
  input: {
    readonly tokenIdentifier: string | null;
    readonly subscription: PushSubscriptionActivationInput;
  },
): Promise<ApiResult<{ readonly created: boolean }>> {
  const userId = await resolveActiveUserId(deps.auth, input.tokenIdentifier);
  if (userId === null) return errResult(unauthorizedError());
  const saved = await deps.subscriptions.saveForUser(userId, input.subscription, deps.now());
  if (saved.status !== "saved") {
    return errResult(conflictError());
  }
  return okResult({ created: saved.created });
}

/** Retira una suscripción Web Push propia por su endpoint. */
export async function deactivateOwnPushSubscription(
  deps: PushMutationDeps,
  input: {
    readonly tokenIdentifier: string | null;
    readonly endpoint: string;
  },
): Promise<ApiResult<{ readonly deleted: boolean }>> {
  const userId = await resolveActiveUserId(deps.auth, input.tokenIdentifier);
  if (userId === null) return errResult(unauthorizedError());
  const deleted = await deps.subscriptions.deleteForUser(userId, input.endpoint);
  return okResult({ deleted });
}
