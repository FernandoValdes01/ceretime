import { useEffect, useState } from "react";

/** Cada cuánto se renueva el instante: basta para plazos e inicios por minuto. */
const NOW_REFRESH_MS = 60_000;

/**
 * Instante actual del navegador para decidir qué se muestra (TI2-163), como
 * ocultar una acción cuando la atención ya empezó o un plazo venció.
 *
 * Se lee fuera del render y se renueva cada minuto para que la vista no quede
 * detenida en el instante de carga. Nunca decide reglas: el Backend vuelve a
 * comprobar todo con su propio reloj.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), NOW_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return now;
}
