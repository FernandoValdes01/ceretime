import { useCallback } from "react";
import { useRouter } from "@tanstack/react-router";

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
        // NotFoundRedirect. El target ya viene sanitizado por
        // `resolveReturnTarget`.
        to: url.pathname as "/",
        search: search as never,
        replace: true,
      });
    },
    [router],
  );
}
