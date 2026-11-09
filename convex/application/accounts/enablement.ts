import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import {
  checkEnablement,
  checkStaffEnablement,
  checkStaffRevocation,
  validateBootstrapCandidate,
} from "../../domain/accounts/enablement";
import {
  canEnableAccount,
  canListAccounts,
  canReadAccount,
  canRevokeAccount,
} from "../../domain/authorization/permissions";
import { normalizeEmail } from "../../domain/auth/institutional_domain";
import { AUTHORIZATION_DENIED_MESSAGE } from "../authorization/authorize";
import {
  findExistingAdmin,
  findOtherEnabledAdmin,
  findProfileByTokenIdentifier,
  findUserByEmail,
  getUserById,
  insertBootstrapAdmin,
  paginateAccounts,
  patchEnablement,
  patchRevocation,
} from "../../infrastructure/accounts/repository";

/**
 * Casos de uso de habilitación institucional y arranque administrativo
 * (TI2-11, TI2-137).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige un Administrador con cuenta
 * habilitada y vigente, valida el objetivo en Dominio y persiste con
 * Infraestructura. La habilitación de la cuenta y la asignación de un
 * acompañamiento son decisiones distintas: habilitar solo deja la cuenta en
 * condiciones de operar y jamás concede acceso a acompañamientos. Opera con
 * datos ficticios.
 */

function deny(): never {
  throw new ConvexError(AUTHORIZATION_DENIED_MESSAGE);
}

type DbProfile = Doc<"users">;

/** Actor con rol Administrador y cuenta habilitada y vigente (TI2-137). */
async function requireAdminCaller(
  ctx: QueryCtx | MutationCtx,
  identity: UserIdentity | null,
): Promise<DbProfile> {
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
 * Lista paginada de cuentas para administración (TI2-137).
 *
 * Solo el Administrador vigente lista; cualquier otro rol, la ausencia de
 * identidad o de perfil responde el mismo error genérico. Devuelve el
 * detalle mínimo, sin `tokenIdentifier`, acompañamientos ni notas.
 */
export async function listAccountsUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
) {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    !canListAccounts({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    deny();
  }
  const result = await paginateAccounts(ctx, args.paginationOpts);
  return { ...result, page: result.page.map(toAccountSummary) };
}

/**
 * Detalle mínimo de una cuenta para administración (TI2-137).
 *
 * Solo el Administrador vigente lee; el recurso inexistente o ajeno
 * responde igual que la denegación, sin revelar existencia.
 */
export async function getAccountDetailUseCase(
  ctx: QueryCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<AccountSummary> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    !canReadAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    deny();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null) deny();
  return toAccountSummary(target);
}

/**
 * Habilita la cuenta profesional o administrativa pendiente o revocada
 * (TI2-137).
 *
 * Registra actor (`enabledBy`) y fecha (`enabledAt`). Toda denegación
 * responde el mismo error genérico, sin exponer el motivo ni la existencia
 * del recurso. El practicante no entra por esta vía (TI2-140).
 */
export async function enableStaffAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<Id<"users">> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    !canEnableAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    deny();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null) deny();
  const check = checkStaffEnablement({
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

/**
 * Revoca la cuenta profesional o administrativa habilitada (TI2-137).
 *
 * Fija `institutionalStatus` en `disabled` y registra actor (`revokedBy`)
 * y fecha (`revokedAt`); la cuenta revocada deja de operar en la petición
 * siguiente. No permite auto-revocarse ni revocar al último administrador
 * vigente, todo con el mismo error genérico.
 */
export async function revokeStaffAccount(
  ctx: MutationCtx,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<Id<"users">> {
  const caller = await requireAdminCaller(ctx, identity);
  if (
    !canRevokeAccount({
      role: caller.role,
      institutionalStatus: caller.institutionalStatus,
      accountStatus: caller.accountStatus,
    })
  ) {
    deny();
  }
  const target = await getUserById(ctx, args.userId);
  if (target === null) deny();
  if (target._id === caller._id) deny();
  const check = checkStaffRevocation({
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
  if (target.role === "admin") {
    const other = await findOtherEnabledAdmin(ctx, target._id);
    if (other === null) deny();
  }
  await patchRevocation(ctx, {
    userId: target._id,
    revokedBy: caller._id,
    revokedAt: Date.now(),
  });
  return target._id;
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
