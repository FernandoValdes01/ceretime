import type { Id } from "../../_generated/dataModel";
import type { Role } from "../../domain/identity/roles";

/**
 * Puerto de la corrección de Estudiante a Practicante (TI2-182).
 *
 * Capa de Aplicación: fija lo que el caso de uso lee y escribe, sin Convex.
 * Infraestructura lo cumple con `internReclassificationStore(ctx)`, creado
 * en el borde interno con el mismo `ctx` de la mutation, así la lectura y la
 * escritura ocurren en una sola transacción.
 */
export interface InternReclassificationStore {
  /** Rol y correo del perfil, o `null` si no existe. */
  findAccount(userId: Id<"users">): Promise<{ readonly role: Role; readonly email: string } | null>;
  /** Verdadero si el perfil tiene alguna solicitud o acompañamiento como Estudiante. */
  hasStudentActivity(userId: Id<"users">): Promise<boolean>;
  /** Deja el perfil como Practicante pendiente, sin la habilitación automática. */
  markPendingIntern(userId: Id<"users">): Promise<void>;
}
