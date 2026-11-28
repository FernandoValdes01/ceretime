import type { PaginationOptions, PaginationResult } from "convex/server";
import type { Doc, Id } from "../../_generated/dataModel";
import type { ReclassifiedRole } from "../../domain/accounts/enablement";
import type { Role } from "../../domain/identity/roles";

/**
 * Puerto de la corrección del Estudiante creado en el primer ingreso (TI2-182).
 *
 * Capa de Aplicación: fija lo que el caso de uso lee y escribe, sin Convex.
 * Infraestructura lo cumple con `studentReclassificationStore(ctx)`, creado
 * en el borde interno con el mismo `ctx` de la mutation, así la lectura y la
 * escritura ocurren en una sola transacción.
 */
export interface StudentReclassificationStore {
  /** Rol y correo del perfil, o `null` si no existe. */
  findAccount(userId: Id<"users">): Promise<{ readonly role: Role; readonly email: string } | null>;
  /** Verdadero si el perfil tiene alguna solicitud o acompañamiento como Estudiante. */
  hasStudentActivity(userId: Id<"users">): Promise<boolean>;
  /** Deja el perfil pendiente con el rol nuevo, sin la habilitación automática. */
  markPending(userId: Id<"users">, role: ReclassifiedRole): Promise<void>;
}

/**
 * Lecturas de cuentas para la administración y la habilitación (TI2-11,
 * TI2-137, TI2-140, TI2-170).
 *
 * Capa de Aplicación: Infraestructura lo cumple con `accountReader(ctx)` en
 * las consultas y con `accountStore(ctx)` en las mutations, creados en el
 * borde con el `ctx` de la función.
 */
export interface AccountReader {
  /** Perfil vinculado a la identidad, o `null`. */
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<Doc<"users"> | null>;
  getUserById(userId: Id<"users">): Promise<Doc<"users"> | null>;
  /** Primer perfil con ese correo, o `null`. */
  findUserByEmail(email: string): Promise<Doc<"users"> | null>;
  /** Primera cuenta administrativa, o `null` cuando no hay ninguna. */
  findExistingAdmin(): Promise<Doc<"users"> | null>;
  paginateStaffAccounts(
    role: "professional" | "admin",
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"users">>>;
  paginateInternAccounts(
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"users">>>;
}

/**
 * Escrituras de la habilitación y del arranque administrativo. Se crea con el
 * `ctx` de la mutation, así la lectura, la decisión y la escritura ocurren en
 * una sola transacción.
 */
export interface AccountStore extends AccountReader {
  /** Deja la cuenta habilitada con su actor y su fecha, sin cambiar el rol. */
  patchEnablement(input: {
    readonly userId: Id<"users">;
    readonly enabledBy: Id<"users">;
    readonly enabledAt: number;
  }): Promise<void>;
  /** Deja la cuenta revocada con su actor y su fecha, sin cambiar el rol. */
  patchRevocation(input: {
    readonly userId: Id<"users">;
    readonly revokedBy: Id<"users">;
    readonly revokedAt: number;
  }): Promise<void>;
  /** Crea la cuenta administrativa inicial, ya habilitada. */
  insertBootstrapAdmin(input: {
    readonly email: string;
    readonly fullName: string;
    readonly tokenIdentifier: string;
    readonly enabledAt: number;
  }): Promise<Id<"users">>;
}
