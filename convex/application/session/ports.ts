import type { InitialProfile } from "../../domain/accounts/own_profile";
import type { AuthenticatedProfile } from "../../domain/identity/roles";

/**
 * Puerto del perfil propio en el primer ingreso (TI2-182).
 *
 * Capa de Aplicación: fija lo que el caso de uso lee y escribe, sin Convex.
 * Infraestructura lo cumple con `ownProfileStore(ctx)`, creado en Presentación
 * con el mismo `ctx` de la mutation, así la búsqueda y la creación ocurren en
 * una sola transacción. Las pruebas pasan un doble en memoria.
 */
export type NewOwnProfile = InitialProfile & {
  readonly email: string;
  readonly fullName: string;
  readonly tokenIdentifier: string;
  readonly enabledAt?: number;
};

export interface OwnProfileStore {
  /** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
  findByTokenIdentifier(tokenIdentifier: string): Promise<AuthenticatedProfile | null>;
  /** Verdadero si algún perfil, de cualquier identidad, ya usa ese correo. */
  isEmailRegistered(email: string): Promise<boolean>;
  create(profile: NewOwnProfile): Promise<AuthenticatedProfile>;
}
