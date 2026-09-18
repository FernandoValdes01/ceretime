import { GENERIC_AUTH_MESSAGES } from "../../application/session/institutional-login";

/**
 * Presentación: avisos seguros para retornos de autenticación con error (TI2-14).
 *
 * Funciones puras sin dependencias del DOM ni de React: reciben el `search` de la URL y nunca devuelven valores de parámetros, solo el mensaje genérico. La lectura y limpieza de parámetros de URL vive aquí (y no en Aplicación) porque es lógica de interfaz y del router, no un caso de uso.
 */

/**
 * Devuelve el mensaje genérico solo ante el marcador controlado `auth=error`.
 *
 * Los fallos genuinos del proveedor llegan como `/?auth=error&error=...&error_description=...` (Better Auth agrega `&error=` sobre nuestro `errorCallbackURL` y el `errorURL` controlado de `onAPIError`), por lo que el marcador siempre está presente y un `?error` ajeno de otra funcionalidad se ignora en vez de mostrar un aviso incorrecto.
 */
export function readAuthErrorNotice(search: string): string | null {
  if (!search) return null;
  const params = new URLSearchParams(search);
  if (params.get("auth") === "error") return GENERIC_AUTH_MESSAGES.signInError;
  return null;
}

/**
 * Limpieza quirúrgica de la URL tras un retorno con error.
 *
 * Recibe el `search` y devuelve el resto de parámetros (con `?` inicial o cadena vacía). Solo retira `auth`, `error` y `error_description`: `error_description` puede traer detalles del proveedor que no deben persistir en la URL; el resto del estado de navegación se conserva intacto.
 */
export function removeAuthErrorParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete("auth");
  params.delete("error");
  params.delete("error_description");
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
