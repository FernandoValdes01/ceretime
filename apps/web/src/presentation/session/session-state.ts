import { useQuery } from "convex/react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";

/**
 * Estado de sesión web (TI2-6): `undefined` mientras carga, union
 * autenticado/no-autenticado después. Es la única lectura de sesión que usan
 * el router y sus guards; la autorización efectiva siempre vive en Convex.
 */
export function useSessionState() {
  return useQuery(api.presentation.session.getSessionState);
}

/** Forma del estado de sesión para props y pruebas de guards. */
export type WebSessionState = ReturnType<typeof useSessionState>;

/**
 * Rol propio para navegación web (TI2-20): `undefined` mientras carga,
 * autenticado con rol o no autenticado (sin identidad o sin perfil) después.
 * Solo elige portal; no autoriza nada por sí mismo.
 */
export function useSessionRole() {
  return useQuery(api.presentation.session.getSessionRole);
}

/** Forma del rol de sesión para props y pruebas de guards. */
export type WebSessionRole = ReturnType<typeof useSessionRole>;

/** Roles institucionales que el Backend puede reportar. */
export type StaffRole = Extract<
  Exclude<WebSessionRole, undefined>,
  { status: "authenticated" }
>["role"];
