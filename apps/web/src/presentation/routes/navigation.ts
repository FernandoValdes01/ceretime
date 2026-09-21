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
      void router.navigate({ to: target as "/", replace: true });
    },
    [router],
  );
}
