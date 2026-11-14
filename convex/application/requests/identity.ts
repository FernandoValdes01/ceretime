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
 * exige el rol con cuenta habilitada y vigente. La regla de vigencia vive en
 * `findActiveProfile`: las variantes `find*` devuelven `null` para que las
 * operaciones de TI2-141 respondan `unauthorized` como valor, y las
 * `require*` de Sprint 1 lanzan el texto «No autorizado» de siempre. Ninguna
 * dice el motivo ni si el recurso existe.
 */

type DbContext = QueryCtx | MutationCtx;

async function findActiveProfile(
  ctx: DbContext,
  tokenIdentifier: string | null,
  role: Doc<"users">["role"],
): Promise<Doc<"users"> | null> {
  if (tokenIdentifier === null) return null;
  const caller = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
  if (
    caller === null ||
    caller.role !== role ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    return null;
  }
  return caller;
}

/** Estudiante con cuenta habilitada y vigente, o `null`. */
export async function findActiveStudent(
  ctx: DbContext,
  tokenIdentifier: string | null,
): Promise<Doc<"users"> | null> {
  return await findActiveProfile(ctx, tokenIdentifier, "student");
}

/** Cumple `ActiveStudentReader` sobre el `ctx` de la mutation que lo compone. */
export function activeStudentReader(ctx: DbContext) {
  return {
    findActiveStudent: (tokenIdentifier: string | null) => findActiveStudent(ctx, tokenIdentifier),
  };
}

/** Profesional con cuenta habilitada y vigente, o `null`. */
export async function findActiveProfessional(
  ctx: DbContext,
  tokenIdentifier: string | null,
): Promise<Doc<"users"> | null> {
  return await findActiveProfile(ctx, tokenIdentifier, "professional");
}

function orDeny(caller: Doc<"users"> | null): Doc<"users"> {
  if (caller === null) throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
  return caller;
}

/** Estudiante con cuenta habilitada y vigente; si no, la denegación de Sprint 1. */
export async function requireActiveStudent(
  ctx: DbContext,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  return orDeny(await findActiveStudent(ctx, identity?.tokenIdentifier ?? null));
}

/** Profesional con cuenta habilitada y vigente; si no, la denegación de Sprint 1. */
export async function requireActiveProfessional(
  ctx: DbContext,
  identity: UserIdentity | null,
): Promise<Doc<"users">> {
  return orDeny(await findActiveProfessional(ctx, identity?.tokenIdentifier ?? null));
}
