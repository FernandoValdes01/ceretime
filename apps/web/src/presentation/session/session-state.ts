import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
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
 *
 * Una sesión sin rol puede ser una cuenta que aún no tiene perfil (TI2-182):
 * se pide `ensureMyProfile` una vez por correo y el par sigue `undefined`
 * hasta que responde, para que ningún guard decida ni ninguna pantalla
 * consulte antes de que exista el perfil. Cuando la mutation termina, Convex
 * ya entregó el par actualizado.
 */
export function useSessionAndRole() {
  const pair = useQuery(api.presentation.session.getSessionWithRole);
  const provisioning = useOwnProfileProvisioning(pair);
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

// Compartido entre las rutas montadas: cada guard y el índice usan el mismo
// par, así la creación del perfil se pide una sola vez por correo y pestaña.
const provisioningByEmail = new Map<string, Promise<void>>();
const provisionedEmails = new Set<string>();

/**
 * Pide el perfil propio y devuelve `true` mientras la petición sigue abierta.
 *
 * Solo una respuesta del Backend cierra el correo para la pestaña: el perfil
 * creado o existente, o la denegación genérica (por ejemplo, un correo ya
 * registrado con otra identidad), que no cambia al repetirla. Un fallo de red
 * libera la navegación de este montaje sin cerrar el correo, así la siguiente
 * ruta montada vuelve a intentarlo en vez de dejar sin perfil a la cuenta
 * hasta recargar.
 */
function useOwnProfileProvisioning(
  pair: FunctionReturnType<typeof api.presentation.session.getSessionWithRole> | undefined,
): boolean {
  const ensureMyProfile = useMutation(api.presentation.session.ensureMyProfile);
  const [settledEmail, setSettledEmail] = useState<string | null>(null);
  const email =
    pair?.session.status === "authenticated" && pair.role.status === "unauthenticated"
      ? pair.session.email
      : null;

  useEffect(() => {
    if (email === null || provisionedEmails.has(email)) return;
    let pending = provisioningByEmail.get(email);
    if (pending === undefined) {
      pending = ensureMyProfile()
        .then(
          () => {
            provisionedEmails.add(email);
          },
          (error: unknown) => {
            if (error instanceof ConvexError) provisionedEmails.add(email);
          },
        )
        .finally(() => {
          provisioningByEmail.delete(email);
        });
      provisioningByEmail.set(email, pending);
    }
    let active = true;
    void pending.then(() => {
      if (active) setSettledEmail(email);
    });
    return () => {
      active = false;
    };
  }, [email, ensureMyProfile]);

  return email !== null && !provisionedEmails.has(email) && settledEmail !== email;
}
