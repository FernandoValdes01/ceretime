import type { UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";
import { checkEnablement, validateBootstrapCandidate } from "../../domain/accounts/enablement";
import { normalizeEmail } from "../../domain/auth/institutional_domain";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import {
  findExistingAdmin,
  findProfileByTokenIdentifier,
  getUserById,
  insertBootstrapAdmin,
  patchEnablement,
} from "../../infrastructure/accounts/repository";

/**
 * Casos de uso de habilitación institucional y arranque administrativo
 * (TI2-11).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige llamante Administrador con cuenta
 * habilitada y vigente, valida el objetivo en Dominio y persiste con
 * Infraestructura. La habilitación de la cuenta y la asignación de un
 * acompañamiento son decisiones distintas: habilitar solo deja la cuenta en
 * condiciones de operar y jamás concede acceso a acompañamientos. Opera con
 * datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

/** Llamante Administrador con cuenta habilitada y vigente. */
async function requireAdminCaller(ctx: MutationCtx, identity: UserIdentity | null) {
  if (identity === null) deny();
  const caller = await findProfileByTokenIdentifier(ctx, identity?.tokenIdentifier ?? "");
  if (
    caller === null ||
    caller.role !== "admin" ||
    caller.institutionalStatus !== "enabled" ||
    caller.accountStatus !== "active"
  ) {
    deny();
  }
  return caller;
}

/**
 * Habilita la cuenta de un Practicante pendiente.
 *
 * Registra el actor administrador y la fecha de la operación en el propio
 * documento (`enabledBy`, `enabledAt`). Toda falta de permiso, ausencia de
 * identidad o de perfil responde el mismo error genérico, sin exponer el
 * motivo ni la existencia del recurso; tras superar esa puerta, el
 * Administrador recibe errores específicos de validación para operar.
 */
export async function enableInternAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<Id<"users">> {
  const caller = await requireAdminCaller(ctx, identity);

  const target = await getUserById(ctx, args.userId);
  if (target === null) deny();

  const check = checkEnablement({
    caller: {
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    },
    target: {
      role: target.role,
      email: target.email,
      institutionalStatus: target.institutionalStatus,
      accountStatus: target.accountStatus,
    },
  });
  if (!check.ok) {
    if (check.reason === "caller-not-admin" || check.reason === "caller-not-active") deny();
    if (check.reason === "target-not-intern") {
      throw new Error("Solo las cuentas de Practicante se habilitan por esta vía");
    }
    if (check.reason === "target-email-not-institutional") {
      throw new Error("El correo debe pertenecer a un dominio institucional");
    }
    if (check.reason === "target-account-not-active") {
      throw new Error("La cuenta debe estar vigente para habilitarla");
    }
    if (check.reason === "target-already-enabled") {
      throw new Error("La cuenta ya está habilitada");
    }
    throw new Error("Solo las cuentas pendientes se habilitan por esta vía");
  }

  await patchEnablement(ctx, {
    userId: target._id,
    enabledBy: caller._id,
    enabledAt: Date.now(),
  });
  return target._id;
}

export type BootstrapAdminInput = {
  readonly email: string;
  readonly fullName: string;
  readonly tokenIdentifier: string;
};

/**
 * Crea la cuenta administrativa inicial del entorno.
 *
 * Vía controlada y única: solo procede cuando no existe ninguna cuenta con
 * rol `admin`. No exige identidad previa porque aún no hay quien administre;
 * el control es la ausencia de administradores más el procedimiento por
 * entorno documentado en `domain/accounts/enablement.md`. El correo debe ser
 * institucional de personal (`@uct.cl`) y la cuenta nace habilitada y
 * vigente, con fecha de arranque y sin actor previo.
 */
export async function ensureBootstrapAdmin(
  ctx: MutationCtx,
  input: BootstrapAdminInput,
): Promise<Id<"users">> {
  const email = normalizeEmail(input.email);
  const fullName = input.fullName.trim();
  const tokenIdentifier = input.tokenIdentifier.trim();
  if (fullName.length === 0 || tokenIdentifier.length === 0) {
    throw new Error("El nombre y el identificador de identidad son obligatorios");
  }

  const bootstrapCheck = validateBootstrapCandidate({ email, role: "admin" });
  if (!bootstrapCheck.ok) {
    throw new Error("El arranque exige un correo institucional de personal");
  }

  const existing = await findExistingAdmin(ctx);
  if (existing !== null) {
    throw new Error("Ya existe una cuenta administrativa");
  }

  const duplicate = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
  if (duplicate !== null) {
    throw new Error("Ya existe un perfil para esta identidad");
  }

  return await insertBootstrapAdmin(ctx, {
    email,
    fullName,
    tokenIdentifier,
    enabledAt: Date.now(),
  });
}
