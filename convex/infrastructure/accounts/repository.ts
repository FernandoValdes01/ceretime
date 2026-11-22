import type { PaginationOptions } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../../_generated/server";
import type {
  AccountEnablementEvent,
  AccountEnablementReader,
  AccountEnablementStore,
  StudentReclassificationStore,
} from "../../application/accounts/ports";
import type { OwnProfileReader, OwnProfileStore } from "../../application/session/ports";
import type { AuthenticatedProfile, Role } from "../../domain/identity/roles";

/**
 * Repositorio de cuentas (TI2-11).
 *
 * Capa de Infraestructura: único lugar que toca `ctx.db` en el flujo de
 * habilitación institucional y arranque administrativo. No decide
 * autorización ni resuelve identidad; solo persiste y recupera con los
 * índices declarados en `convex/schema.ts`, consultando los campos en el
 * orden del índice. Opera con datos ficticios.
 */

type DbReader = QueryCtx | MutationCtx;

/** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
export async function findProfileByTokenIdentifier(
  ctx: DbReader,
  tokenIdentifier: string,
): Promise<Doc<"users"> | null> {
  return await ctx.db
    .query("users")
    .withIndex("by_token_identifier", (q) => q.eq("tokenIdentifier", tokenIdentifier))
    .unique();
}

/** Usuario por id, o `null` si no existe. */
export async function getUserById(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"users"> | null> {
  return await ctx.db.get(userId);
}

/** Primer perfil con ese correo, o `null` si no existe. */
export async function findUserByEmail(ctx: DbReader, email: string): Promise<Doc<"users"> | null> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_email", (q) => q.eq("email", email))
    .take(1);
  return rows[0] ?? null;
}

/** Primera cuenta administrativa existente, o `null` cuando no hay ninguna. */
export async function findExistingAdmin(ctx: DbReader): Promise<Doc<"users"> | null> {
  const rows = await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", "admin"))
    .take(1);
  return rows[0] ?? null;
}

/**
 * Abre una habilitación en el historial (HABILITACIONES_CUENTA, revisión
 * TI4-84). Sin `enabledBy` queda la habilitación sin actor: el arranque y el
 * Estudiante habilitado en su primer ingreso.
 */
async function insertEnablementEvent(
  ctx: MutationCtx,
  input: {
    readonly userId: Id<"users">;
    readonly role: Role;
    readonly enabledBy?: Id<"users">;
    readonly enabledAt: number;
  },
): Promise<void> {
  await ctx.db.insert("accountEnablements", {
    userId: input.userId,
    enabledRole: input.role,
    ...(input.enabledBy === undefined ? {} : { enabledBy: input.enabledBy }),
    enabledAt: input.enabledAt,
  });
}

/** Evento más reciente del historial de la cuenta, o `null` si no tiene. */
async function findLatestEnablementEvent(
  ctx: DbReader,
  userId: Id<"users">,
): Promise<Doc<"accountEnablements"> | null> {
  return await ctx.db
    .query("accountEnablements")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .first();
}

/**
 * Cierra la habilitación abierta de la cuenta con su revocación. Una cuenta
 * habilitada antes de que existiera el historial no tiene fila abierta: se
 * agrega una con la habilitación que conserva `users` para que la revocación
 * no quede sin su habilitación. Si `users` tampoco guarda la fecha (filas
 * insertadas sin la vía guardada), no se agrega nada: inventar la fecha de
 * habilitación violaría la trazabilidad de `integrity.md`, y la revocación
 * igual queda en `users.revokedBy`/`revokedAt`.
 */
async function closeEnablementEvent(
  ctx: MutationCtx,
  user: Doc<"users">,
  revocation: {
    readonly revokedBy?: Id<"users">;
    readonly revokedAt: number;
    readonly reason?: string;
  },
): Promise<void> {
  const closing = {
    ...(revocation.revokedBy === undefined ? {} : { revokedBy: revocation.revokedBy }),
    revokedAt: revocation.revokedAt,
    ...(revocation.reason === undefined ? {} : { revocationReason: revocation.reason }),
  };
  const latest = await findLatestEnablementEvent(ctx, user._id);
  if (latest !== null && latest.revokedAt === undefined) {
    await ctx.db.patch(latest._id, closing);
    return;
  }
  if (user.enabledAt === undefined) return;
  await ctx.db.insert("accountEnablements", {
    userId: user._id,
    enabledRole: user.role,
    ...(user.enabledBy === undefined ? {} : { enabledBy: user.enabledBy }),
    enabledAt: user.enabledAt,
    ...closing,
  });
}

/**
 * Marca la cuenta como habilitada con su auditoría y abre la habilitación en
 * el historial.
 *
 * Fija `institutionalStatus` en `enabled` junto al actor y la fecha de la
 * operación. No cambia el rol: la habilitación jamás convierte una cuenta en
 * Administradora. `users` guarda el último evento y `accountEnablements`
 * todos (revisión TI4-84).
 */
async function recordEnablement(
  ctx: MutationCtx,
  input: {
    readonly userId: Id<"users">;
    readonly role: Role;
    readonly enabledBy: Id<"users">;
    readonly enabledAt: number;
  },
): Promise<void> {
  await ctx.db.patch(input.userId, {
    institutionalStatus: "enabled",
    enabledBy: input.enabledBy,
    enabledAt: input.enabledAt,
  });
  await insertEnablementEvent(ctx, input);
}

/**
 * Marca la cuenta profesional o administrativa como revocada (TI2-137) y
 * cierra su habilitación en el historial (revisión TI4-84).
 *
 * Fija `institutionalStatus` en `disabled` junto al actor administrador y la
 * fecha de la operación, sin cambiar el rol. La cuenta revocada deja de operar
 * en la petición siguiente porque ya no cumple `institutionalStatus ===
 * "enabled"`. El motivo solo va al historial.
 */
async function recordRevocation(
  ctx: MutationCtx,
  input: {
    readonly userId: Id<"users">;
    readonly revokedBy: Id<"users">;
    readonly revokedAt: number;
    readonly reason?: string;
  },
): Promise<void> {
  const user = await ctx.db.get(input.userId);
  if (user === null) throw new Error("La cuenta a revocar no existe.");
  await ctx.db.patch(input.userId, {
    institutionalStatus: "disabled",
    revokedBy: input.revokedBy,
    revokedAt: input.revokedAt,
  });
  await closeEnablementEvent(ctx, user, input);
}

/** Evento público del historial: sin `userId`, que ya conoce quien consulta. */
function toEnablementEvent(row: Doc<"accountEnablements">): AccountEnablementEvent {
  return {
    _id: row._id,
    enabledRole: row.enabledRole,
    ...(row.enabledBy === undefined ? {} : { enabledBy: row.enabledBy }),
    enabledAt: row.enabledAt,
    ...(row.revokedBy === undefined ? {} : { revokedBy: row.revokedBy }),
    ...(row.revokedAt === undefined ? {} : { revokedAt: row.revokedAt }),
    ...(row.revocationReason === undefined ? {} : { revocationReason: row.revocationReason }),
  };
}

/** Página de cuentas de personal para el listado administrativo (TI2-137). */
export async function paginateStaffAccounts(
  ctx: QueryCtx,
  role: "professional" | "admin",
  paginationOpts: PaginationOptions,
) {
  return await ctx.db
    .query("users")
    .withIndex("by_role", (q) => q.eq("role", role))
    .paginate(paginationOpts);
}

/** Perfil propio mínimo que ven la interfaz y los casos de uso de sesión. */
function toAuthenticatedProfile(profile: Doc<"users">): AuthenticatedProfile {
  return {
    fullName: profile.fullName,
    email: profile.email,
    role: profile.role,
    institutionalStatus: profile.institutionalStatus,
    accountStatus: profile.accountStatus,
  };
}

/** Adaptador del puerto `OwnProfileReader` (TI2-10, TI2-182). */
export function ownProfileReader(ctx: DbReader): OwnProfileReader {
  return {
    findByTokenIdentifier: async (tokenIdentifier) => {
      const profile = await findProfileByTokenIdentifier(ctx, tokenIdentifier);
      return profile === null ? null : toAuthenticatedProfile(profile);
    },
  };
}

/**
 * Adaptador del puerto `OwnProfileStore` (TI2-182). La habilitación
 * automática del Estudiante deja `enabledAt` sin `enabledBy`, igual que el
 * arranque: no hubo un administrador que actuara.
 */
export function ownProfileStore(ctx: MutationCtx): OwnProfileStore {
  return {
    ...ownProfileReader(ctx),
    isEmailRegistered: async (email) => (await findUserByEmail(ctx, email)) !== null,
    create: async (profile) => {
      const userId = await ctx.db.insert("users", {
        email: profile.email,
        fullName: profile.fullName,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
        tokenIdentifier: profile.tokenIdentifier,
        ...(profile.enabledAt === undefined ? {} : { enabledAt: profile.enabledAt }),
      });
      // El Estudiante nace habilitado: su habilitación sin actor abre el historial.
      if (profile.enabledAt !== undefined) {
        await insertEnablementEvent(ctx, {
          userId,
          role: profile.role,
          enabledAt: profile.enabledAt,
        });
      }
      return {
        fullName: profile.fullName,
        email: profile.email,
        role: profile.role,
        institutionalStatus: profile.institutionalStatus,
        accountStatus: profile.accountStatus,
      };
    },
  };
}

/**
 * Crea la cuenta administrativa inicial del entorno, ya habilitada, y abre su
 * habilitación en el historial sin actor: aún no había quien administrara.
 */
async function insertBootstrapAdmin(
  ctx: MutationCtx,
  input: {
    readonly email: string;
    readonly fullName: string;
    readonly tokenIdentifier: string;
    readonly enabledAt: number;
  },
): Promise<Id<"users">> {
  const userId = await ctx.db.insert("users", {
    email: input.email,
    fullName: input.fullName,
    role: "admin",
    institutionalStatus: "enabled",
    accountStatus: "active",
    tokenIdentifier: input.tokenIdentifier,
    enabledAt: input.enabledAt,
  });
  await insertEnablementEvent(ctx, { userId, role: "admin", enabledAt: input.enabledAt });
  return userId;
}

/**
 * Adaptador del puerto `AccountEnablementStore` (revisión TI4-84). Presentación
 * y el borde interno lo crean con el `ctx` de la función, así el objetivo, su
 * estado y su historial se leen y escriben en la misma transacción.
 */
export function accountEnablementStore(ctx: MutationCtx): AccountEnablementStore {
  return {
    ...accountEnablementReader(ctx),
    recordEnablement: (input) => recordEnablement(ctx, input),
    recordRevocation: (input) => recordRevocation(ctx, input),
    insertBootstrapAdmin: (input) => insertBootstrapAdmin(ctx, input),
  };
}

/** Adaptador del puerto `AccountEnablementReader` para las queries de administración. */
export function accountEnablementReader(ctx: DbReader): AccountEnablementReader {
  return {
    findProfileByTokenIdentifier: (tokenIdentifier: string) =>
      findProfileByTokenIdentifier(ctx, tokenIdentifier),
    getUser: (userId: Id<"users">) => getUserById(ctx, userId),
    findUserByEmail: (email: string) => findUserByEmail(ctx, email),
    findExistingAdmin: () => findExistingAdmin(ctx),
    paginateStaffAccounts: (role: "professional" | "admin", paginationOpts: PaginationOptions) =>
      paginateStaffAccounts(ctx, role, paginationOpts),
    paginateEnablementHistory: async (userId: Id<"users">, paginationOpts: PaginationOptions) => {
      const result = await ctx.db
        .query("accountEnablements")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .order("desc")
        .paginate(paginationOpts);
      return { ...result, page: result.page.map(toEnablementEvent) };
    },
  };
}

/**
 * Adaptador del puerto `StudentReclassificationStore` (TI2-182). Quita
 * `enabledAt` porque la habilitación automática del Estudiante no vale para
 * el rol nuevo, que espera la suya con actor y fecha.
 */
export function studentReclassificationStore(ctx: MutationCtx): StudentReclassificationStore {
  return {
    findAccount: async (userId) => {
      const profile = await ctx.db.get(userId);
      return profile === null ? null : { role: profile.role, email: profile.email };
    },
    hasStudentActivity: async (userId) => {
      const request = await ctx.db
        .query("requests")
        .withIndex("by_student", (q) => q.eq("studentId", userId))
        .first();
      if (request !== null) return true;
      const accompaniment = await ctx.db
        .query("accompaniments")
        .withIndex("by_student", (q) => q.eq("studentId", userId))
        .first();
      return accompaniment !== null;
    },
    markPending: async (userId, role) => {
      const user = await ctx.db.get(userId);
      await ctx.db.patch(userId, {
        role,
        institutionalStatus: "pending",
        enabledAt: undefined,
      });
      // La habilitación automática como Estudiante termina sin actor: la cerró
      // el operador al corregir el rol, no un Administrador de la aplicación.
      if (user !== null && user.institutionalStatus === "enabled") {
        await closeEnablementEvent(ctx, user, { revokedAt: Date.now() });
      }
    },
  };
}
