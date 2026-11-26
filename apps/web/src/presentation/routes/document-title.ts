import { useEffect } from "react";

/** Nombre de la aplicación que cierra todos los títulos. */
const APP_NAME = "CERETI";

/**
 * Título de documento de una pantalla (TI2-185): «<Pantalla> · CERETI».
 *
 * El nombre de la pantalla va primero para que la pestaña, el historial y el
 * lector de pantalla distingan la vista antes que la marca.
 */
function formatScreenTitle(screen: string): string {
  return `${screen} · ${APP_NAME}`;
}

/**
 * Fija el título del documento al montar la pantalla y cuando cambia su
 * nombre. Se llama desde el componente de ruta: cada vista declara el suyo.
 */
export function useDocumentTitle(screen: string): void {
  useEffect(() => {
    document.title = formatScreenTitle(screen);
  }, [screen]);
}
