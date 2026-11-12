import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  checkEnablement,
  validateBootstrapCandidate,
  validateStaffEnablementTarget,
  validateStaffRevocationTarget,
} from "../../domain/accounts/enablement";
import {
  canEnableAccount,
  canListAccounts,
  canReadAccount,
  canRevokeAccount,
} from "../../domain/authorization/permissions";
import { normalizeEmail } from "../../domain/auth/institutional_domain";
import {
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  type ApiResult,
} from "../../domain/errors/api_error";
import { AUTHORIZATION_DENIED_MESSAGE, deniedPublicError } from "../authorization/authorize";
import {
  findExistingAdmin,
  findProfileByTokenIdentifier,
  findUserByEmail,
  getUserById,
  insertBootstrapAdmin,
  paginateStaffAccounts,
  patchEnablement,
  patchRevocation,
} from "../../infrastructure/accounts/repository";

/**
 * Casos de uso de habilitación institucional y arranque administrativo
 * (TI2-11, TI2-137).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige un Administrador con cuenta
 * habilitada y vigente (regla única de `canManageAccounts`, sin duplicarla),
 * valida el objetivo en Dominio y persiste con Infraestructura. Devuelve el
 * `ApiResult` común de TI2-88 para que Presentación traduzca con
 * `unwrapApiResult`. La habilitación de la cuenta y la asignación de un
 * acompañamiento son decisiones distintas: habilitar solo deja la cuenta en
 * condiciones de operar y jamás concede acceso a acompañamientos. Opera con
 * datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

function unauthorized<T>(): ApiResult<T> {
  return errResult(deniedPublicError());
}

function conflict<T>(message: string): ApiResult<T> {
  return errResult({ code: CONFLICT_ERROR_CODE, message });
}

type DbProfile = Doc<"users">;

/**
 * Perfil de quien llama, vinculado a la identidad (TI2-137).
 *
 * Solo carga el perfil; cada caso de uso exige su permiso específico de la
 * matriz (`canListAccounts`, `canReadAccount`, `canEnableAccount`,
 * `canRevokeAccount`) para que la matriz y el código hablen igual.
 */
async function requireAdminCaller(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity | null,
): Promise<DbProfile | null> {
  if (identity === null) return null;
  return await findProfileByTokenIdentifier(ctx, identity.tokenIdentifier ?? "");
}

/** Verdadero cuando la cuenta es de personal: profesional o administrador. */
function isStaffAccount(target: DbProfile): boolean {
  return target.role === "professional" || target.role === "admin";
}

/** Detalle mínimo de cuenta para administración (TI2-137). */
export type AccountSummary = {
  readonly _id: Id<"users">;
  readonly email: string;
  readonly fullName: string;
  readonly role: DbProfile["role"];
  readonly institutionalStatus: DbProfile["institutionalStatus"];
  readonly accountStatus: DbProfile["accountStatus"];
  readonly enabledBy?: Id<"users">;
  readonly enabledAt?: number;
  readonly revokedBy?: Id<"users">;
  readonly revokedAt?: number;
};

function toAccountSummary(profile: DbProfile): AccountSummary {
  return {
    _id: profile._id,
    email: profile.email,
    fullName: profile.fullName,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
    ...(profile.enabledBy === undefined ? {} : { enabledBy: profile.enabledBy }),
    ...(profile.enabledAt === undefined ? {} : { enabledAt: profile.enabledAt }),
    ...(profile.revokedBy === undefined ? {} : { revokedBy: profile.revokedBy }),
    ...(profile.revokedAt === undefined ? {} : { revokedAt: profile.revokedAt }),
  };
}

/**
 * Lista paginada de cuentas de personal para administración (TI2-137).
 *
 * Solo el Administrador vigente lista, filtrado por rol con el índice
 * `by_role`: estudiantes y practicantes nunca aparecen. El `numItems` debe
 * ser un entero entre 1 y 100 y se rechaza con error de regla, igual que
 * `listSpaces`: nunca se trunca en silencio. Devuelve el detalle mínimo,
 * sin `tokenIdentifier`, acompañamientos ni notas.
 */
export async function listAccountsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly role: "professional" | "admin"; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<{ page: AccountSummary[]; isDone: boolean; continueCursor: string }>> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    caller === null ||
    !canListAccounts({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }
  if (
    !Number.isInteger(args.paginationOpts.numItems) ||
    args.paginationOpts.numItems < 1 ||
    args.paginationOpts.numItems > 100
  ) {
    throw new Error("El límite del listado debe ser un entero entre 1 y 100.");
  }
  const result = await paginateStaffAccounts(ctx, args.role, args.paginationOpts);
  return okResult({ ...result, page: result.page.map(toAccountSummary) });
}

/**
 * Detalle mínimo de una cuenta de personal para administración (TI2-137).
 *
 * Solo el Administrador vigente lee; el recurso inexistente o fuera de
 * esta vía (estudiante o practicante) responde `unauthorized`, sin
 * revelar existencia.
 */
export async function getAccountDetailUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<AccountSummary>> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    caller === null ||
    !canReadAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null || !isStaffAccount(target)) return unauthorized();
  return okResult(toAccountSummary(target));
}

/**
 * Habilita la cuenta profesional o administrativa pendiente o revocada
 * (TI2-137).
 *
 * Registra actor (`enabledBy`) y fecha (`enabledAt`); la rehabilitación
 * registra el nuevo evento, sin conservar la auditoría anterior. La falta
 * de permiso responde `unauthorized`; un objetivo inexistente o fuera de
 * esta vía también, sin revelar existencia; un tránsito
 * inválido (cuenta ya habilitada, correo sin personal o cuenta no vigente)
 * responde `conflict` sin escribir. Cortar el acceso no exige correo de
 * personal, pero rehabilitar sí: por eso revocar no revisa el dominio. El
 * practicante no entra por esta vía (TI2-140).
 */
export async function enableStaffAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    caller === null ||
    !canEnableAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null) return unauthorized();
  const check = validateStaffEnablementTarget({
    role: target.role,
    email: target.email,
    institutionalStatus: target.institutionalStatus,
    accountStatus: target.accountStatus,
  });
  if (!check.ok) {
    switch (check.reason) {
      case "target-not-staff":
        return unauthorized();
      case "target-already-enabled":
        return conflict("La cuenta ya está habilitada.");
      case "target-email-not-institutional":
        return conflict("El objetivo debe tener correo institucional de personal.");
      case "target-account-not-active":
        return conflict("La cuenta objetivo no está vigente.");
      default:
        return conflict("La cuenta no admite la habilitación en su estado actual.");
    }
  }
  await patchEnablement(ctx, {
    userId: target._id,
    enabledBy: caller._id,
    enabledAt: Date.now(),
  });
  return okResult({ userId: target._id });
}

/**
 * Revoca la cuenta profesional o administrativa habilitada (TI2-137).
 *
 * Fija `institutionalStatus` en `disabled` y registra actor (`revokedBy`)
 * y fecha (`revokedAt`); la cuenta revocada deja de operar en la petición
 * siguiente. Revocar no revisa el dominio del correo: cortar el acceso
 * siempre está permitido, aunque rehabilitar exija personal. La falta de
 * permiso responde `unauthorized`; un objetivo inexistente o fuera de esta
 * vía también, sin revelar existencia; un tránsito inválido (cuenta no
 * habilitada, cuenta no vigente o auto-revocación) responde `conflict` sin
 * escribir. La auto-revocación se deniega como conflicto porque quien llama
 * ya es un administrador autorizado que puede leer el estado.
 */
export async function revokeStaffAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    caller === null ||
    !canRevokeAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    return unauthorized();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null) return unauthorized();
  if (target._id === caller._id) return conflict("No puedes revocar tu propia cuenta.");
  const check = validateStaffRevocationTarget({
    role: target.role,
    email: target.email,
    institutionalStatus: target.institutionalStatus,
    accountStatus: target.accountStatus,
  });
  if (!check.ok) {
    switch (check.reason) {
      case "target-not-staff":
        return unauthorized();
      case "target-not-enabled":
        return conflict("La cuenta no está habilitada.");
      case "target-account-not-active":
        return conflict("La cuenta objetivo no está vigente.");
      default:
        return conflict("La cuenta no admite la revocación en su estado actual.");
    }
  }
  await patchRevocation(ctx, {
    userId: target._id,
    revokedBy: caller._id,
    revokedAt: Date.now(),
  });
  return okResult({ userId: target._id });
}

/**
 * Habilita la cuenta de un Practicante pendiente.
 *
 * Registra el actor administrador y la fecha de la operación en el propio
 * documento (`enabledBy`, `enabledAt`). Toda denegación (sin identidad, sin
 * perfil, actor no administrador o no vigente, objetivo inexistente, rol
 * no practicante, correo no institucional, cuenta no vigente o estado no
 * pendiente) responde el mismo error genérico, sin exponer el motivo ni la
 * existencia del recurso.
 */
export async function enableInternAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<Id<"users">> {
  const caller = await requireAdminCaller(ctx, identity);
  if (caller === null) deny();

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
  if (!check.ok) deny();

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

  // Unicidad de correo (TI2-17): el arranque tampoco puede duplicar el
  // correo de un perfil existente.
  const emailTaken = await findUserByEmail(ctx, email);
  if (emailTaken !== null) {
    throw new Error("Ya existe un perfil con este correo");
  }

  return await insertBootstrapAdmin(ctx, {
    email,
    fullName,
    tokenIdentifier,
    enabledAt: Date.now(),
  });
}
