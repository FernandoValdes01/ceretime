/**
 * Caso de uso del cliente: inicio institucional (TI2-3).
 *
 * Puro y sin dependencias de React o Convex: describe los dos inicios
 * lógicos sobre el mismo OAuth Client de Google, uno por población. Los
 * botones orientan a elegir la cuenta correcta (`prompt: select_account` en
 * el servidor); la garantía real es el rechazo de dominios en el backend
 * (`databaseHooks` en `convex/auth.ts`), nunca un parámetro del cliente.
 *
 * No define roles ni autorizaciones: eso pertenece a TI2-4 / TI2-5.
 */

export type InstitutionalPopulation = "estudiante" | "personal";

type PopulationLogin = {
  id: InstitutionalPopulation;
  /** Sufijo mostrado para que la persona elija su cuenta correcta. */
  emailSuffix: "@alu.uct.cl" | "@uct.cl";
  buttonLabel: string;
};

export const POPULATION_LOGINS: readonly PopulationLogin[] = [
  {
    id: "estudiante",
    emailSuffix: "@alu.uct.cl",
    buttonLabel: "Continuar con cuenta @alu.uct.cl",
  },
  {
    id: "personal",
    emailSuffix: "@uct.cl",
    buttonLabel: "Continuar con cuenta @uct.cl",
  },
];

/**
 * Flujo de retorno del login social.
 *
 * `callbackURL` es navegación post-login dentro de la SPA (no el redirect
 * OAuth, que siempre es `/api/auth/callback/google` en el Site URL de
 * Convex). `errorCallbackURL` recibe los fallos con `?auth=error`, que la
 * pantalla traduce a un mensaje genérico sin detalles sensibles.
 *
 * Una ruta relativa la resuelve el plugin `crossDomain` contra `SITE_URL`
 * del deployment, así que el login siempre vuelve a ese origen. Con
 * `siteUrl` (el `VITE_SITE_URL` del entorno) el retorno es absoluto y vuelve
 * a la SPA de ese entorno, por ejemplo localhost, aunque `SITE_URL` apunte a
 * Vercel; Better Auth solo lo acepta si es un origen de confianza del
 * deployment. Sin `siteUrl` o con un valor inválido se conserva la ruta
 * relativa.
 */
export function getLoginRequest(siteUrl?: string) {
  const origin = parseOrigin(siteUrl);
  return {
    provider: "google" as const,
    callbackURL: `${origin}/`,
    errorCallbackURL: `${origin}/?auth=error`,
  };
}

function parseOrigin(siteUrl: string | undefined): string {
  if (siteUrl === undefined || siteUrl.trim().length === 0) return "";
  try {
    const url = new URL(siteUrl.trim());
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
  } catch {
    return "";
  }
}

/** Mensajes genéricos: nunca revelan motivo, unidad ni datos del apoyo. */
export const GENERIC_AUTH_MESSAGES = {
  loading: "Cargando…",
  signInError: "No pudimos iniciar sesión. Inténtalo de nuevo.",
  sessionExpired: "Tu sesión terminó. Vuelve a ingresar.",
  signOutError: "No pudimos cerrar la sesión. Inténtalo de nuevo.",
  misconfigured:
    "Falta la configuración del entorno local. Revisa las variables VITE_CONVEX_URL y VITE_CONVEX_SITE_URL.",
} as const;
