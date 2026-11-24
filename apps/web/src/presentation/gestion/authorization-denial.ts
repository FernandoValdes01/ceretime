import { UNAUTHORIZED_ERROR_CODE } from "../../../../../convex/domain/index.ts";
import { publicErrorOf } from "../../infrastructure/convex/public-error.ts";

/**
 * Denegación genérica del Backend (TI2-88), compartida por las vistas de
 * acompañamientos y seguimiento. Lee el código con `publicErrorOf`, que
 * también reconoce la forma anterior con el texto en `error.data`: el SDK
 * decora `error.message`, así que comparar el mensaje falla contra el
 * Backend real. Vive fuera de los componentes para que el recargado rápido
 * de Vite siga funcionando.
 */
export function isAuthorizationDenial(error: unknown): boolean {
  return publicErrorOf(error)?.code === UNAUTHORIZED_ERROR_CODE;
}
