import { useEffect, useRef, useState } from "react";
import {
  getCalendarLinkRequest,
  type CalendarCallbackStatus,
} from "../../application/calendar/calendar-link.ts";
import { authClient } from "../../infrastructure/auth/auth-client.ts";
import { useConfirmCalendarLink } from "./notifications-data.ts";

/**
 * Pasos del vínculo con Google Calendar que comparten la bandeja y el detalle
 * del acompañamiento (TI2-172): iniciar la autorización y confirmarla en el
 * Backend al volver.
 */

export type CalendarLinkNotice = { readonly tone: "status" | "alert"; readonly text: string };

export const CALENDAR_LINK_FAILED: CalendarLinkNotice = {
  tone: "alert",
  text: "No pudimos conectar Google Calendar. Puedes intentarlo de nuevo; tu agenda sigue funcionando igual.",
};

/**
 * Confirma el vínculo una sola vez al volver de Google con `?calendar=`. Sin
 * el permiso de eventos, el Backend responde `not_connected` y no es un error.
 * Un retorno con error no llama al Backend.
 */
export function useConfirmCalendarLinkOnReturn(
  callbackStatus: CalendarCallbackStatus | undefined,
): CalendarLinkNotice | null {
  const confirm = useConfirmCalendarLink();
  const done = useRef(false);
  const [notice, setNotice] = useState<CalendarLinkNotice | null>(null);

  useEffect(() => {
    if (callbackStatus !== "connected" || done.current) return;
    done.current = true;
    confirm()
      .then((result) =>
        setNotice(
          result.connected
            ? {
                tone: "status",
                text: "Google Calendar quedó conectado. Tus próximas atenciones se agregarán solas.",
              }
            : {
                tone: "alert",
                text: "Google no concedió el permiso de eventos. Puedes volver a conectar o seguir con el archivo .ics.",
              },
        ),
      )
      .catch(() => setNotice(CALENDAR_LINK_FAILED));
  }, [callbackStatus, confirm]);

  return callbackStatus === "error" ? CALENDAR_LINK_FAILED : notice;
}

/** Inicia la autorización de Google para volver a la misma pantalla. */
export async function startCalendarLink(): Promise<boolean> {
  try {
    const result = await authClient.linkSocial(
      getCalendarLinkRequest(`${window.location.pathname}${window.location.search}`),
    );
    return !result.error;
  } catch {
    return false;
  }
}
