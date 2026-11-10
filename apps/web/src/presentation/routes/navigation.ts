import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Navegación visible de cada portal (TI2-133).
 *
 * Solo enlaces a pantallas reales: la portada y las vistas funcionales ya
 * entregadas. El cierre de sesión no vive aquí porque es un botón, no una
 * ruta. Al agregar una ruta a un área, agrega su entrada en la lista de ese
 * portal y deja intactas las demás.
 *
 * `exact` evita que la portada quede marcada en todas sus rutas hijas;
 * `includeSearch: false` (aplicado en `AppShell`) mantiene marcada la sección
 * aunque la URL cambie de filtros.
 */
export const PORTAL_NAVIGATION = {
  student: {
    title: "Portal del Estudiante",
    brandHome: "/estudiante",
    items: [
      { to: "/estudiante", label: "Inicio", exact: true },
      { to: "/estudiante/solicitudes", label: "Solicitudes", exact: false },
      { to: "/estudiante/horarios", label: "Horarios", exact: false },
      // «Reservar» no se enlaza aquí: la confirmación necesita el `slotId`
      // que devuelve la búsqueda de horarios. Sin ese parámetro la vista
      // muestra «Cupo no disponible», así que se llega desde Horarios.
      { to: "/estudiante/atenciones", label: "Atenciones", exact: false },
    ],
  },
  professional: {
    title: "Portal del Profesional",
    brandHome: "/profesional",
    items: [
      { to: "/profesional", label: "Inicio", exact: true },
      { to: "/profesional/solicitudes", label: "Solicitudes", exact: false },
      { to: "/profesional/agenda", label: "Agenda", exact: false },
      { to: "/profesional/disponibilidad", label: "Disponibilidad", exact: false },
    ],
  },
  practitioner: {
    title: "Portal del Practicante",
    brandHome: "/practicante",
    items: [
      { to: "/practicante", label: "Inicio", exact: true },
      { to: "/practicante/acompanamientos", label: "Acompañamientos", exact: false },
    ],
  },
  admin: {
    title: "Portal de Administración",
    brandHome: "/administrador",
    items: [
      { to: "/administrador", label: "Inicio", exact: true },
      { to: "/administrador/espacios", label: "Espacios", exact: false },
    ],
  },
} as const;

/** Área de la Web con portal propio y navegación común. */
export type PortalArea = keyof typeof PORTAL_NAVIGATION;

/**
 * Navegación a una ruta calculada en ejecución (TI2-6).
 *
 * El router registrado solo acepta rutas conocidas en tipos; la ruta de
 * retorno se valida en `return-target.ts` antes de navegar, así que el
 * `to` dinámico queda acotado a este helper con reemplazo de historial.
 */
export function useNavigateToPath() {
  const router = useRouter();
  return useCallback(
    (target: string) => {
      const url = new URL(target, "https://ceretime.invalid");
      const search = url.search
        ? Object.fromEntries(new URLSearchParams(url.search).entries())
        : undefined;
      void router.navigate({
        // `to` solo lleva el pathname; la query va en `search` para que
        // TanStack no la trate como parte de la ruta y no caiga en
        // NotFoundRedirect. El target ya viene validado por
        // `resolveReturnTarget`.
        to: url.pathname as "/",
        search: search as never,
        replace: true,
      });
    },
    [router],
  );
}
