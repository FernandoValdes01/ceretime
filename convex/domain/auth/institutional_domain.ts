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

/**
 * Verdadero solo si el correo pertenece a un dominio institucional.
 *
 * Además del sufijo, exige una estructura mínima (parte local no vacía y un
 * solo `@`): un `endsWith` aislado aceptaría valores inválidos como
 * `@uct.cl` o `usuario@@uct.cl`.
 */
export function isInstitutionalEmail(email: unknown): boolean {
  const normalized = normalizeEmail(email);
  const at = normalized.indexOf("@");
  if (at <= 0 || normalized.indexOf("@", at + 1) !== -1) return false;
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

/**
 * Dominio de Google Workspace de cada población (TI2-131): el valor que se
 * pide como `hd` al abrir el selector y el que Google declara en el claim `hd`
 * del ID token de sus cuentas.
 */
export const HOSTED_DOMAIN_BY_POPULATION = {
  estudiante: "alu.uct.cl",
  personal: "uct.cl",
} as const satisfies Record<InstitutionalPopulation, string>;

/**
 * Proveedor de inicio de cada población (TI2-131): contrato entre la Web, que
 * elige el proveedor según el botón, y `convex/auth.ts`, que lo registra.
 */
export const GOOGLE_PROVIDER_ID_BY_POPULATION = {
  estudiante: "google-alu",
  personal: "google-uct",
} as const satisfies Record<InstitutionalPopulation, string>;

export type GoogleProviderId = (typeof GOOGLE_PROVIDER_ID_BY_POPULATION)[InstitutionalPopulation];

/** Claims del ID token de Google que decide el ingreso, sin validar. */
export interface GoogleIdentityClaims {
  readonly email: unknown;
  readonly emailVerified: unknown;
  readonly hostedDomain: unknown;
}

/**
 * Verdadero solo si la cuenta de Google corresponde a la población del inicio.
 *
 * Exige correo verificado por Google y sufijo institucional de esa población.
 * El claim `hd`, cuando viene, debe ser el dominio de la población: una cuenta
 * `@alu.uct.cl` declara `hd: "alu.uct.cl"` (verificado en TI2-131). La
 * ausencia de `hd` no basta para aceptar ni para rechazar, porque todavía no
 * se confirma que las cuentas `@uct.cl` lo traigan; el sufijo sigue siendo la
 * garantía y una cuenta personal (`@gmail.com`) no lo cumple.
 */
export function isAcceptedGoogleIdentity(
  claims: GoogleIdentityClaims,
  population: InstitutionalPopulation,
): boolean {
  if (claims.emailVerified !== true) return false;
  const email = normalizeEmail(claims.email);
  if (!isInstitutionalEmail(email) || getInstitutionalPopulation(email) !== population) {
    return false;
  }
  return (
    claims.hostedDomain === undefined ||
    claims.hostedDomain === HOSTED_DOMAIN_BY_POPULATION[population]
  );
}
