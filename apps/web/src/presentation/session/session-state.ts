import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useEffect } from "react";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import { requestOwnProfile, useOwnProfileProvisioning } from "./own-profile-provisioning.ts";

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
 *
 * Una sesión sin rol puede ser una cuenta que aún no tiene perfil (TI2-182):
 * se pide `ensureMyProfile` una vez por correo y el par sigue `undefined`
 * hasta que responde, para que ningún guard decida ni ninguna pantalla
 * consulte antes de que exista el perfil. Cuando la mutation termina, Convex
 * ya entregó el par actualizado.
 */
export function useSessionAndRole() {
  const pair = useQuery(api.presentation.session.getSessionWithRole);
  const provisioning = useOwnProfilePending(pair);
  return provisioning ? undefined : pair;
}

/** Forma del par sesión y rol para props y pruebas de guards. */
export type WebSessionAndRole = ReturnType<typeof useSessionAndRole>;

/** Forma del rol de sesión para props y pruebas de guards. */
export type WebSessionRole = NonNullable<WebSessionAndRole>["role"];

/** Roles institucionales que el Backend puede reportar. */
export type StaffRole = Extract<
  Exclude<WebSessionRole, undefined>,
  { status: "authenticated" }
>["role"];

/**
 * Pide el perfil propio cuando la sesión no trae rol y devuelve `true`
 * mientras la petición sigue abierta. Un fallo pasajero libera la navegación;
 * el portal del Estudiante lo distingue de una cuenta no habilitada con
 * `useOwnProfileProvisioning` y ofrece el reintento.
 */
function useOwnProfilePending(
  pair: FunctionReturnType<typeof api.presentation.session.getSessionWithRole> | undefined,
): boolean {
  const ensureMyProfile = useMutation(api.presentation.session.ensureMyProfile);
  const email =
    pair?.session.status === "authenticated" && pair.role.status === "unauthenticated"
      ? pair.session.email
      : null;
  const status = useOwnProfileProvisioning(email);

  useEffect(() => {
    if (email !== null) requestOwnProfile(email, ensureMyProfile);
  }, [email, ensureMyProfile]);

  // Sin estado todavía, el efecto está por pedirlo: se espera igual.
  return email !== null && (status === null || status === "pending");
}
