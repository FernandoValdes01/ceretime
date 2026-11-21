import type { Id } from "../../_generated/dataModel";
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
