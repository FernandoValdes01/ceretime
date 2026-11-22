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
 * Evento del historial de habilitaciones de una cuenta (HABILITACIONES_CUENTA
 * del MER, revisión TI4-84): una habilitación y, si ya terminó, su revocación.
 */
export type AccountEnablementEvent = {
  readonly _id: Id<"accountEnablements">;
  readonly enabledRole: Role;
  readonly enabledBy?: Id<"users">;
  readonly enabledAt: number;
  readonly revokedBy?: Id<"users">;
  readonly revokedAt?: number;
  readonly revocationReason?: string;
};

/**
 * Puerto de la habilitación institucional y del arranque administrativo
 * (TI2-11, TI2-137, TI2-140; puertos desde la revisión TI4-84).
 *
 * Capa de Aplicación: fija lo que los casos de uso de `enablement.ts` leen y
 * escriben, sin Convex. Infraestructura los cumple con
 * `accountEnablementReader(ctx)` en las queries y `accountEnablementStore(ctx)`
 * en las mutations, creados en Presentación o en el borde interno con el mismo
 * `ctx`, así la lectura del objetivo, la escritura de su estado y la del
 * historial ocurren en una sola transacción.
 */
export interface AccountEnablementReader {
  /** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
  findProfileByTokenIdentifier(tokenIdentifier: string): Promise<Doc<"users"> | null>;
  /** Usuario por id, o `null` si no existe. */
  getUser(userId: Id<"users">): Promise<Doc<"users"> | null>;
  /** Primer perfil con ese correo, o `null`. */
  findUserByEmail(email: string): Promise<Doc<"users"> | null>;
  /** Primera cuenta administrativa existente, o `null`. */
  findExistingAdmin(): Promise<Doc<"users"> | null>;
  /** Página de cuentas de personal con ese rol. */
  paginateStaffAccounts(
    role: "professional" | "admin",
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<Doc<"users">>>;
  /** Historial de la cuenta, del evento más reciente al más antiguo. */
  paginateEnablementHistory(
    userId: Id<"users">,
    paginationOpts: PaginationOptions,
  ): Promise<PaginationResult<AccountEnablementEvent>>;
}

/** Lecturas más las escrituras de la habilitación, para las mutations. */
export interface AccountEnablementStore extends AccountEnablementReader {
  /**
   * Deja la cuenta habilitada con su actor y fecha, y agrega la habilitación
   * al historial con el rol vigente.
   */
  recordEnablement(input: {
    readonly userId: Id<"users">;
    readonly role: Role;
    readonly enabledBy: Id<"users">;
    readonly enabledAt: number;
  }): Promise<void>;
  /**
   * Deja la cuenta revocada con su actor y fecha, y cierra en el historial la
   * habilitación abierta con el mismo actor, fecha y motivo.
   */
  recordRevocation(input: {
    readonly userId: Id<"users">;
    readonly revokedBy: Id<"users">;
    readonly revokedAt: number;
    readonly reason?: string;
  }): Promise<void>;
  /** Crea la cuenta administrativa inicial ya habilitada y abre su historial. */
  insertBootstrapAdmin(input: {
    readonly email: string;
    readonly fullName: string;
    readonly tokenIdentifier: string;
    readonly enabledAt: number;
  }): Promise<Id<"users">>;
}

/**
 * Libera las tomas de solicitudes de un Profesional cuya cuenta se revoca
 * (revisión TI4-84). Presentación lo compone con el caso de uso de
 * solicitudes en la misma mutation que la revocación: si la cuenta se revoca,
 * sus solicitudes en revisión vuelven a la bandeja en la misma transacción.
 */
export interface RevokedProfessionalTakeReleaser {
  releaseTakesOf(input: {
    readonly professionalId: Id<"users">;
    readonly releasedBy: Id<"users">;
  }): Promise<void>;
}
