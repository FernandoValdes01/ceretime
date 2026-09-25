/**
 * Ruta de retorno post-login (TI2-6).
 *
 * Puro salvo el acceso acotado a `sessionStorage`: valida, guarda y consume
 * la ruta a la que el Estudiante quería entrar antes del login. El retorno
 * sobrevive al round-trip OAuth (el `callbackURL` fijo de TI2-3 siempre
 * vuelve a `/`, donde el índice lo consume). Nunca acepta URLs absolutas ni
 * las rutas de acceso/denegado, para no crear bucles ni redirecciones
 * abiertas fuera del portal.
 */

const RETURN_TARGET_KEY = "ceretime:post-login-redirect";

/**
 * Normaliza un candidato a ruta de retorno. Devuelve `pathname + search` o
 * `null` si no es una ruta interna válida del portal.
 */
export function resolveReturnTarget(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw, "https://ceretime.invalid");
  } catch {
    return null;
  }
  if (
    url.pathname === "/" ||
    url.pathname === "/login" ||
    url.pathname.startsWith("/login/") ||
    url.pathname === "/denegado" ||
    url.pathname.startsWith("/denegado/")
  ) {
    return null;
  }
  return url.pathname + url.search;
}

function readStoredTarget(): string | null {
  try {
    return resolveReturnTarget(sessionStorage.getItem(RETURN_TARGET_KEY));
  } catch {
    return null;
  }
}

/**
 * Guarda la ruta de retorno; un valor inválido o ausente limpia el retorno
 * anterior para no arrastrar destinos de otra visita.
 */
export function persistReturnTarget(raw: unknown): void {
  try {
    const target = resolveReturnTarget(raw);
    if (target === null) {
      sessionStorage.removeItem(RETURN_TARGET_KEY);
    } else {
      sessionStorage.setItem(RETURN_TARGET_KEY, target);
    }
  } catch {
    // Almacenamiento no disponible: se pierde el retorno, no la sesión.
  }
}

/** Lee la ruta de retorno sin consumirla (para decidir a dónde navegar). */
export function peekReturnTarget(): string | null {
  return readStoredTarget();
}

/** Lee la ruta de retorno y la elimina: cada retorno se usa una sola vez. */
export function consumeReturnTarget(): string | null {
  const target = readStoredTarget();
  try {
    sessionStorage.removeItem(RETURN_TARGET_KEY);
  } catch {
    // Almacenamiento no disponible: nada que limpiar.
  }
  return target;
}
