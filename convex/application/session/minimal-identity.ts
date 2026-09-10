import {
  getInstitutionalPopulation,
  isInstitutionalEmail,
  normalizeEmail,
  type InstitutionalPopulation,
} from "../../domain/auth/institutional-domain";

/**
 * Caso de uso: recuperar el estado de sesión (TI2-3).
 *
 * Entrada plana, sin `ctx` ni dependencias de Convex: la función pública
 * resuelve la identidad y delega aquí. Solo conserva los datos mínimos
 * necesarios para continuar (correo y nombre de la cuenta Google).
 */

export type MinimalIdentityInput = {
  email: unknown;
  name: unknown;
};

export type MinimalIdentity = {
  email: string;
  name: string;
  population: InstitutionalPopulation;
};

/**
 * Devuelve la identidad mínima si el correo es institucional; de lo contrario
 * devuelve `null` para que Presentación responda como no autenticado, sin
 * exponer el motivo exacto al cliente.
 */
export function toMinimalIdentity(
  input: MinimalIdentityInput,
): MinimalIdentity | null {
  const email = normalizeEmail(input.email);
  if (!isInstitutionalEmail(email)) return null;

  const population = getInstitutionalPopulation(email);
  if (population === null) return null;

  const name = typeof input.name === "string" ? input.name.trim() : "";
  return { email, name, population };
}
