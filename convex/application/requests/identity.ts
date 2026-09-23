import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import { findProfileByTokenIdentifier } from "../../infrastructure/accompaniments/repository";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";

/**
 * Identidad de quien llama para solicitudes (TI2-9).
 *
 * Resuelve el perfil en el servidor desde `ctx.auth.getUserIdentity()` y
 * exige el rol con cuenta habilitada y vigente. Toda denegación usa el
 * error genérico, sin motivo ni existencia de recursos.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

type DbContext = QueryCtx | MutationCtx;

/** Estudiante con cuenta habilitada y vigente. */
export async function requireActiveStudent(
  ctx: DbContext,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "student" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }
  return caller;
}

/** Profesional con cuenta habilitada y vigente. */
export async function requireActiveProfessional(
  ctx: DbContext,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "professional" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }
  return caller;
}
