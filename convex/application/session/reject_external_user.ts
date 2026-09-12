import { isInstitutionalEmail } from "../../domain/auth/institutional_domain";

/**
 * Guardia de alta de usuarios (TI2-3).
 *
 * Función exacta que `convex/auth.ts` cablea en
 * `databaseHooks.user.create.before`: retorna `false` para impedir la
 * creación de usuario y sesión ante correos no institucionales. Vive en
 * Aplicación (y no anónima en el hook) para poder probarse directamente.
 */
export async function rejectExternalUser(email: unknown): Promise<false | undefined> {
  if (!isInstitutionalEmail(email)) return false;
  return undefined;
}
