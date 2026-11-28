import type { PaginationOptions, UserIdentity } from "convex/server";
import { ConvexError } from "convex/values";
import type { Doc, Id } from "../../_generated/dataModel";
import {
  ACCOUNT_REVOCATION_REASON_MAX_LENGTH,
  checkEnablement,
  checkInternEnablement,
  checkTestProfessionalEnablement,
  isPersonalProfessionalActive,
  toRevocationReason,
  validateBootstrapCandidate,
  validateStaffEnablementTarget,
  validateStaffRevocationTarget,
  type AccountEnabler,
  type EnablementCheck,
  type EnablementRejectionReason,
  type EnablementTarget,
} from "../../domain/accounts/enablement";
import {
  canEnableAccount,
  canListAccounts,
  canReadAccount,
  canRevokeAccount,
} from "../../domain/authorization/permissions";
import { normalizeEmail } from "../../domain/auth/institutional_domain";
import {
  ACCOUNT_FIELDS_INVALID_ERROR_CODE,
  CONFLICT_ERROR_CODE,
  errResult,
  okResult,
  type ApiResult,
} from "../../domain/errors/api_error";
import { AUTHORIZATION_DENIED_MESSAGE, deniedPublicError } from "../authorization/authorize";
import { releaseOpenTakesOf, type ReleaseOpenTakesDeps } from "../requests/takes";
import type { AccountReader, AccountStore } from "./ports";

/**
 * Casos de uso de habilitación institucional y arranque administrativo
 * (TI2-11, TI2-137, TI2-140).
 *
 * Capa de Aplicación: recibe la identidad ya resuelta en el borde con
 * `ctx.auth.getUserIdentity()`, exige un Administrador con cuenta
 * habilitada y vigente (regla única de `canManageAccounts`, sin duplicarla),
 * valida el objetivo en Dominio y persiste por los puertos `AccountReader` y
 * `AccountStore`, que el borde crea con su `ctx`. Devuelve el
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
 * Perfil de quien llama, vinculado a la identidad.
 *
 * Solo carga el perfil; cada caso de uso exige su permiso específico de la
 * matriz (`canListAccounts`, `canReadAccount`, `canEnableAccount`,
 * `canRevokeAccount`) o la regla de habilitación de Dominio, para que la
 * matriz, el dominio y el código hablen igual.
 */
async function findCallerProfile(
  accounts: AccountReader,
  identity: UserIdentity | null,
): Promise<DbProfile | null> {
  if (identity === null) return null;
  return await accounts.findProfileByTokenIdentifier(identity.tokenIdentifier ?? "");
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
  accounts: AccountReader,
  identity: UserIdentity | null,
  args: { readonly role: "professional" | "admin"; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<{ page: AccountSummary[]; isDone: boolean; continueCursor: string }>> {
  const caller = await findCallerProfile(accounts, identity);
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
  const result = await accounts.paginateStaffAccounts(args.role, args.paginationOpts);
  return okResult({ ...result, page: result.page.map(toAccountSummary) });
}

/**
 * Lista paginada de cuentas practicantes para la gestión del Profesional
 * (TI2-170).
 *
 * La llama el profesional de personal con cuenta habilitada y vigente o el
 * administrador vigente. Devuelve el detalle mínimo, sin `tokenIdentifier`,
 * acompañamientos ni notas. La habilitación y la asignación siguen siendo
 * decisiones distintas: listar no concede accesos. Toda denegación responde
 * `unauthorized` genérico, sin revelar existencia.
 */
export async function listInternAccountsUseCase(
  accounts: AccountReader,
  identity: UserIdentity | null,
  args: { readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<{ page: AccountSummary[]; isDone: boolean; continueCursor: string }>> {
  const caller = await findCallerProfile(accounts, identity);
  if (caller === null) return unauthorized();
  const isAdminActive =
    caller.role === "admin" &&
    caller.institutionalStatus === "enabled" &&
    caller.accountStatus === "active";
  const canList = isAdminActive || isPersonalProfessionalActive(caller);
  if (!canList) return unauthorized();
  if (
    !Number.isInteger(args.paginationOpts.numItems) ||
    args.paginationOpts.numItems < 1 ||
    args.paginationOpts.numItems > 100
  ) {
    throw new Error("El límite del listado debe ser un entero entre 1 y 100.");
  }
  const result = await accounts.paginateInternAccounts(args.paginationOpts);
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
  accounts: AccountReader,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<AccountSummary>> {
  const caller = await findCallerProfile(accounts, identity);
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
  const target = await accounts.getUserById(args.userId);
  if (target === null || !isStaffAccount(target)) return unauthorized();
  return okResult(toAccountSummary(target));
}

/** Evento del historial de habilitaciones con el nombre de cada actor (TI4-84). */
export type AccountEnablementEvent = {
  readonly _id: Id<"accountEnablements">;
  readonly role: DbProfile["role"];
  readonly enabledAt: number;
  readonly enabledBy?: Id<"users">;
  readonly enabledByName?: string;
  readonly revokedAt?: number;
  readonly revokedBy?: Id<"users">;
  readonly revokedByName?: string;
  readonly revocationReason?: string;
};

/**
 * Historial paginado de habilitaciones y revocaciones de una cuenta de
 * personal (TI4-84), del evento más reciente al más antiguo.
 *
 * Solo el Administrador vigente, con el mismo permiso que lee la cuenta
 * (`canReadAccount`); una cuenta inexistente o fuera de esta vía responde
 * `unauthorized`, sin revelar existencia. Cada evento trae el nombre de quien
 * habilitó y de quien revocó, para que la Web no tenga que buscarlo; la
 * habilitación automática y el arranque no tienen actor. El `numItems` debe
 * ser un entero entre 1 y 100, igual que `listAccounts`.
 */
export async function listAccountEnablementsUseCase(
  accounts: AccountReader,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users">; readonly paginationOpts: PaginationOptions },
): Promise<ApiResult<{ page: AccountEnablementEvent[]; isDone: boolean; continueCursor: string }>> {
  const caller = await findCallerProfile(accounts, identity);
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
  const target = await accounts.getUserById(args.userId);
  if (target === null || !isStaffAccount(target)) return unauthorized();
  if (
    !Number.isInteger(args.paginationOpts.numItems) ||
    args.paginationOpts.numItems < 1 ||
    args.paginationOpts.numItems > 100
  ) {
    throw new Error("El límite del listado debe ser un entero entre 1 y 100.");
  }
  const result = await accounts.paginateAccountEnablements(target._id, args.paginationOpts);
  const names = new Map<Id<"users">, string | undefined>();
  const nameOf = async (userId: Id<"users"> | undefined) => {
    if (userId === undefined) return undefined;
    if (!names.has(userId)) names.set(userId, (await accounts.getUserById(userId))?.fullName);
    return names.get(userId);
  };
  const page: AccountEnablementEvent[] = [];
  for (const event of result.page) {
    const enabledByName = await nameOf(event.enabledBy);
    const revokedByName = await nameOf(event.revokedBy);
    page.push({
      _id: event._id,
      role: event.role,
      enabledAt: event.enabledAt,
      ...(event.enabledBy === undefined ? {} : { enabledBy: event.enabledBy }),
      ...(enabledByName === undefined ? {} : { enabledByName }),
      ...(event.revokedAt === undefined ? {} : { revokedAt: event.revokedAt }),
      ...(event.revokedBy === undefined ? {} : { revokedBy: event.revokedBy }),
      ...(revokedByName === undefined ? {} : { revokedByName }),
      ...(event.revocationReason === undefined ? {} : { revocationReason: event.revocationReason }),
    });
  }
  return okResult({ page, isDone: result.isDone, continueCursor: result.continueCursor });
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
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  const caller = await findCallerProfile(accounts, identity);
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
  const target = await accounts.getUserById(args.userId);
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
  await accounts.patchEnablement({
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
 *
 * El motivo es opcional y se guarda en el historial de la cuenta (TI4-84); uno
 * de más de `ACCOUNT_REVOCATION_REASON_MAX_LENGTH` caracteres responde
 * `account_fields_invalid` sin escribir.
 *
 * Revocar a un Profesional libera en la misma transacción sus tomas abiertas,
 * con el Administrador como actor (TI4-84): las solicitudes vuelven a
 * `received` y a la bandeja en vez de quedar bloqueadas. El Administrador no
 * las reasigna ni las lee: administrar cuentas no da acceso a solicitudes.
 */
export async function revokeStaffAccount(
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users">; readonly reason?: string },
  takes: ReleaseOpenTakesDeps<Id<"requests">, Id<"users">>,
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  const caller = await findCallerProfile(accounts, identity);
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
  const reason = toRevocationReason(args.reason);
  if (!reason.ok) {
    return errResult({
      code: ACCOUNT_FIELDS_INVALID_ERROR_CODE,
      message: `El motivo de la revocación no puede superar ${ACCOUNT_REVOCATION_REASON_MAX_LENGTH} caracteres.`,
    });
  }
  const target = await accounts.getUserById(args.userId);
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
  const revokedAt = Date.now();
  await accounts.patchRevocation({
    userId: target._id,
    revokedBy: caller._id,
    revokedAt,
    ...(reason.reason === undefined ? {} : { reason: reason.reason }),
  });
  if (target.role === "professional") {
    await releaseOpenTakesOf(takes, {
      professionalId: target._id,
      actorId: caller._id,
      occurredAt: revokedAt,
    });
  }
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
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<Id<"users">> {
  const caller = await findCallerProfile(accounts, identity);
  if (caller === null) deny();

  const target = await accounts.getUserById(args.userId);
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

  await accounts.patchEnablement({
    userId: target._id,
    enabledBy: caller._id,
    enabledAt: Date.now(),
  });
  return target._id;
}

/**
 * Traduce un rechazo de habilitación de Dominio al `ApiResult` común de
 * TI2-88 (TI2-140). Única fuente para las dos vías nuevas: la falta de
 * permiso o el objetivo fuera de la vía responde `unauthorized` sin revelar
 * existencia, y el tránsito inválido responde `conflict` con el motivo en
 * español, sin escribir. Sin `default`: cada motivo de la unión cerrada debe
 * mapearse acá para que el compilador avise del faltante.
 */
function enablementRejection<T>(reason: EnablementRejectionReason): ApiResult<T> {
  switch (reason) {
    case "caller-not-admin":
    case "caller-not-professional":
    case "caller-not-authorized":
    case "caller-not-active":
    case "target-not-intern":
    case "target-not-staff":
    case "target-not-professional":
      return unauthorized();
    case "target-email-not-test":
      return conflict("La cuenta de prueba debe tener correo @alu.uct.cl.");
    case "target-email-not-institutional":
      return conflict("El objetivo debe tener correo institucional.");
    case "target-account-not-active":
      return conflict("La cuenta objetivo no está vigente.");
    case "target-not-pending":
      return conflict("La cuenta no está pendiente de habilitación.");
    case "target-not-enabled":
      return conflict("La cuenta no está habilitada.");
    case "target-already-enabled":
      return conflict("La cuenta ya está habilitada.");
  }
}

/**
 * Habilita una cuenta cargando llamante y objetivo una sola vez (TI2-140).
 * Recibe la decisión de Dominio (`checkInternEnablement` o
 * `checkTestProfessionalEnablement`) y traduce su rechazo con
 * `enablementRejection`.
 */
async function enableWithDecision(
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
  check: (input: {
    readonly caller: AccountEnabler;
    readonly target: EnablementTarget;
  }) => EnablementCheck,
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  const caller = await findCallerProfile(accounts, identity);
  if (caller === null) return unauthorized();
  const target = await accounts.getUserById(args.userId);
  if (target === null) return unauthorized();
  const decision = check({
    caller: {
      role: caller.role,
      email: caller.email,
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
  if (!decision.ok) return enablementRejection(decision.reason);
  await accounts.patchEnablement({
    userId: target._id,
    enabledBy: caller._id,
    enabledAt: Date.now(),
  });
  return okResult({ userId: target._id });
}

/**
 * Habilita la cuenta de un Practicante pendiente (TI2-140, RF-39).
 *
 * Vía pública: el administrador vigente o el profesional de personal con
 * cuenta habilitada y vigente habilita al practicante pendiente y registra
 * actor (`enabledBy`) y fecha (`enabledAt`); la cuenta de prueba jamás
 * habilita. Habilitar no concede acompañamientos: la asignación posterior la
 * realiza el profesional autorizado sobre cada acompañamiento.
 */
export async function enableInternByProfessional(
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  return await enableWithDecision(accounts, identity, args, checkInternEnablement);
}

/**
 * Habilita la cuenta de prueba profesional `@alu.uct.cl` (TI2-140, RF-38/RN-25).
 *
 * Vía pública: el administrador vigente o el profesional de personal con
 * cuenta habilitada y vigente habilita al profesional de prueba pendiente o
 * deshabilitado y registra actor y fecha; la cuenta de prueba jamás habilita.
 * Habilitar no concede acompañamientos: el alcance se asigna después por
 * acompañamiento explícito y auditado, y la lectura exige ambas condiciones
 * (cuenta habilitada y asignación activa).
 */
export async function enableTestProfessionalAccount(
  accounts: AccountStore,
  identity: UserIdentity | null,
  args: { readonly userId: Id<"users"> },
): Promise<ApiResult<{ userId: Id<"users"> }>> {
  return await enableWithDecision(accounts, identity, args, checkTestProfessionalEnablement);
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
  accounts: AccountStore,
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

  const existing = await accounts.findExistingAdmin();
  if (existing !== null) {
    throw new Error("Ya existe una cuenta administrativa");
  }

  const duplicate = await accounts.findProfileByTokenIdentifier(tokenIdentifier);
  if (duplicate !== null) {
    throw new Error("Ya existe un perfil para esta identidad");
  }

  // Unicidad de correo (TI2-17): el arranque tampoco puede duplicar el
  // correo de un perfil existente.
  const emailTaken = await accounts.findUserByEmail(email);
  if (emailTaken !== null) {
    throw new Error("Ya existe un perfil con este correo");
  }

  return await accounts.insertBootstrapAdmin({
    email,
    fullName,
    tokenIdentifier,
    enabledAt: Date.now(),
  });
}
