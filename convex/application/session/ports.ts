import type { InitialProfile } from "../../domain/accounts/own_profile";
import type { AuthenticatedProfile } from "../../domain/identity/roles";

/**
 * Puertos del perfil propio (TI2-10, TI2-182).
 *
 * Capa de Aplicación: fija lo que el caso de uso lee y escribe, sin Convex.
 * Infraestructura los cumple con `ownProfileReader(ctx)` y
 * `ownProfileStore(ctx)`, creados en Presentación con el mismo `ctx` de la
 * función, así la búsqueda y la creación ocurren en una sola transacción. Las
 * pruebas pasan un doble en memoria.
 */
export type NewOwnProfile = InitialProfile & {
  readonly email: string;
  readonly fullName: string;
  readonly tokenIdentifier: string;
  readonly enabledAt?: number;
};

/** Lectura del perfil propio, para la consulta y para el primer ingreso. */
export interface OwnProfileReader {
  /** Perfil vinculado a la identidad autenticada, o `null` si no existe. */
  findByTokenIdentifier(tokenIdentifier: string): Promise<AuthenticatedProfile | null>;
}

export interface OwnProfileStore extends OwnProfileReader {
  /** Verdadero si algún perfil, de cualquier identidad, ya usa ese correo. */
  isEmailRegistered(email: string): Promise<boolean>;
  create(profile: NewOwnProfile): Promise<AuthenticatedProfile>;
}
