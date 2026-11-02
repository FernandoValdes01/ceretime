import {
  isAcceptedGoogleIdentity,
  isInstitutionalEmail,
  type InstitutionalPopulation,
} from "../../domain/auth/institutional_domain";

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

/**
 * Guardia de sesión (TI2-131), cableada en `databaseHooks.session.create.before`.
 *
 * Un usuario que ya existe con un correo no institucional (creado antes de la
 * guardia de alta o con el correo cambiado después) no obtiene sesión nueva.
 * Si el usuario de la sesión no se puede leer, también se rechaza.
 */
export async function rejectExternalSession(
  user: { readonly email?: unknown } | null,
): Promise<false | undefined> {
  if (user === null || !isInstitutionalEmail(user.email)) return false;
  return undefined;
}

/** Payload de un JWT sin verificar firma, o `null` si no tiene la forma esperada. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Datos de la cuenta que el inicio entrega a Better Auth. */
export interface InstitutionalGoogleUserInfo {
  readonly id: string;
  readonly email: string;
  readonly emailVerified: true;
  readonly name: string;
  readonly image?: string;
}

/**
 * Datos de la cuenta de Google para el inicio de una población (TI2-131), o
 * `null` para rechazarla.
 *
 * Lee el ID token que Better Auth recibe directo del endpoint de tokens de
 * Google en el canje del código; no verifica la firma porque ese canal ya
 * autentica a Google. Devolver `null` hace que el proveedor cancele el ingreso
 * sin crear usuario ni sesión, y la Web muestra el error genérico. La regla de
 * qué cuenta se acepta vive en el dominio (`isAcceptedGoogleIdentity`).
 */
export function toInstitutionalGoogleUserInfo(
  idToken: string | undefined,
  population: InstitutionalPopulation,
): InstitutionalGoogleUserInfo | null {
  const claims = idToken === undefined ? null : decodeJwtPayload(idToken);
  if (claims === null || typeof claims.sub !== "string" || claims.sub === "") return null;
  const accepted = isAcceptedGoogleIdentity(
    { email: claims.email, emailVerified: claims.email_verified, hostedDomain: claims.hd },
    population,
  );
  if (!accepted || typeof claims.email !== "string") return null;
  const email = claims.email.trim().toLowerCase();
  // Better Auth cancela el ingreso sin nombre; el correo lo reemplaza.
  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  return {
    id: claims.sub,
    email,
    emailVerified: true,
    name: name === "" ? email : name,
    ...(typeof claims.picture === "string" ? { image: claims.picture } : {}),
  };
}
