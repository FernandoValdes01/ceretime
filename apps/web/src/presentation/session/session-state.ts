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
 * Sesión y rol propio para navegación Web (TI2-20): `undefined` mientras
 * carga, par autenticado/no-autenticado después. Ambas mitades salen de la
 * misma identidad en una única respuesta, así la Web nunca observa la
 * sesión de una cuenta con el rol de otra. Solo elige portal; no autoriza
 * nada por sí mismo.
 */
export function useSessionAndRole() {
  return useQuery(api.presentation.session.getSessionWithRole);
}

/** Forma del par sesión y rol para props y pruebas de guards. */
export type WebSessionAndRole = ReturnType<typeof useSessionAndRole>;

/** Par resuelto, sin el `undefined` de carga. */
type ResolvedSessionAndRole = NonNullable<WebSessionAndRole>;

/** Forma del rol de sesión para props y pruebas de guards. */
export type WebSessionRole = ResolvedSessionAndRole["role"] | undefined;

/** Roles institucionales que el Backend puede reportar. */
export type StaffRole = Extract<
  Exclude<WebSessionRole, undefined>,
  { status: "authenticated" }
>["role"];
