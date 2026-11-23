import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Aviso flotante que desaparece solo (TI2-169).
 *
 * Guarda el mensaje para que la vista lo anuncie con `role="status"` y lo
 * retira a los 5 segundos. Limpia el temporizador al desmontar.
 */
export function useToast(timeoutMs = 5000) {
  const [toast, setToast] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    };
  }, []);

  const showToast = useCallback(
    (message: string) => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      setToast(message);
      timer.current = window.setTimeout(() => {
        setToast(null);
        timer.current = null;
      }, timeoutMs);
    },
    [timeoutMs],
  );

  return { toast, showToast };
}
