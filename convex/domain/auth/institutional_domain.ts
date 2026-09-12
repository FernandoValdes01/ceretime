/**
 * Dominio puro de identidad institucional (TI2-3).
 *
 * No importa Convex, React ni variables de entorno: se prueba sin backend.
 * La garantía real de dominio está aquí; el parámetro `hd` de Google es solo
 * una sugerencia de UX y nunca sustituye esta validación en el servidor.
 */

/** Sufijos institucionales aceptados por la UCT. */
export const INSTITUTIONAL_EMAIL_SUFFIXES = ["@alu.uct.cl", "@uct.cl"] as const;

export type InstitutionalEmailSuffix = (typeof INSTITUTIONAL_EMAIL_SUFFIXES)[number];

/** Población lógica para el inicio: no es un rol ni una autorización. */
export type InstitutionalPopulation = "estudiante" | "personal";

export function normalizeEmail(email: unknown): string {
  return typeof email === "string" ? email.trim().toLowerCase() : "";
}

/** Verdadero solo si el correo pertenece a un dominio institucional. */
export function isInstitutionalEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  return INSTITUTIONAL_EMAIL_SUFFIXES.some((suffix) => normalized.endsWith(suffix));
}

/**
 * Población sugerida por el sufijo. `@alu.uct.cl` anticipa estudiante y
 * `@uct.cl` anticipa personal. No otorga acceso: la habilitación y el rol se
 * resuelven en otra issue (TI2-4 / TI2-5).
 */
export function getInstitutionalPopulation(email: unknown): InstitutionalPopulation | null {
  const normalized = normalizeEmail(email);
  if (normalized.endsWith("@alu.uct.cl")) return "estudiante";
  if (normalized.endsWith("@uct.cl")) return "personal";
  return null;
}
