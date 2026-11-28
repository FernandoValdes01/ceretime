import { useState } from "react";
import type { CalendarCallbackStatus } from "../../application/calendar/calendar-link.ts";
import { formatAgendaShortDate } from "../shared/date-format.ts";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import {
  CALENDAR_LINK_FAILED,
  startCalendarLink,
  useConfirmCalendarLinkOnReturn,
  type CalendarLinkNotice,
} from "./calendar-link-actions.ts";
import { useCalendarLinkStatus, useDisconnectCalendarLink } from "./notifications-data.ts";

/**
 * Vínculo propio con Google Calendar (TI2-172) sobre la API de TI2-161.
 *
 * Vincular pide solo el permiso de eventos con `linkSocial`; al volver de
 * Google, la Web confirma el vínculo en el Backend, que valida el permiso y
 * programa la sincronización de las atenciones futuras. Desconectar revoca el
 * permiso en Google y avisa que los eventos creados antes pueden quedar sin
 * actualizar. Rechazar o perder el vínculo nunca impide reservar ni usar la
 * agenda: el `.ics` de cada atención sigue disponible.
 */

export function CalendarLinkPanel({
  callbackStatus,
}: {
  callbackStatus: CalendarCallbackStatus | undefined;
}) {
  const status = useCalendarLinkStatus();
  const disconnect = useDisconnectCalendarLink();
  const returnNotice = useConfirmCalendarLinkOnReturn(callbackStatus);
  const [pending, setPending] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [notice, setNotice] = useState<CalendarLinkNotice | null>(null);
  const shown = notice ?? returnNotice;

  async function onConnect() {
    setPending(true);
    setNotice(null);
    if (!(await startCalendarLink())) setNotice(CALENDAR_LINK_FAILED);
    setPending(false);
  }

  async function onDisconnect() {
    setPending(true);
    setNotice(null);
    try {
      const result = await disconnect();
      setConfirmingDisconnect(false);
      setNotice({
        tone: "status",
        text: result.staleEventsMayRemain
          ? "Desconectamos Google Calendar. Los eventos que ya estaban en tu calendario pueden quedar sin actualizar; puedes borrarlos desde Google."
          : "Desconectamos Google Calendar.",
      });
    } catch {
      setNotice({
        tone: "alert",
        text: "No pudimos desconectar Google Calendar. El vínculo sigue igual; inténtalo de nuevo.",
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="calendar-link-title"
      className="flex flex-col gap-3 rounded-lg border border-border-low bg-surface-container-lowest p-6"
    >
      <h2 id="calendar-link-title" className={SECTION_TITLE_CLASS}>
        Google Calendar
      </h2>
      {shown === null ? null : (
        <p role={shown.tone} className="m-0 font-semibold text-on-surface">
          {shown.text}
        </p>
      )}
      {status === undefined ? (
        <p role="status" className="m-0 text-base text-on-surface-variant">
          Revisando la conexión con Google Calendar…
        </p>
      ) : status.connected ? (
        <>
          <p className="m-0 text-base text-on-surface">
            Conectado
            {status.linkedAt === undefined
              ? "."
              : ` desde el ${formatAgendaShortDate(status.linkedAt)}.`}{" "}
            Tus atenciones se agregan, cambian y cancelan solas en tu calendario.
          </p>
          {confirmingDisconnect ? (
            <div className="flex flex-col gap-3">
              <p className="m-0 text-base text-on-surface">
                Al desconectar, los eventos que ya creamos pueden quedar en tu calendario sin
                actualizar. Tus atenciones en CERETI no cambian.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  className={PRIMARY_BUTTON_CLASS}
                  disabled={pending}
                  aria-busy={pending}
                  onClick={() => void onDisconnect()}
                >
                  Confirmar la desconexión
                </button>
                <button
                  type="button"
                  className={SECONDARY_BUTTON_CLASS}
                  disabled={pending}
                  onClick={() => setConfirmingDisconnect(false)}
                >
                  Mantener conectado
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${SECONDARY_BUTTON_CLASS} w-fit`}
              onClick={() => {
                setNotice(null);
                setConfirmingDisconnect(true);
              }}
            >
              Desconectar Google Calendar
            </button>
          )}
        </>
      ) : (
        <>
          <p className="m-0 text-base text-on-surface">
            No está conectado. Es opcional: si lo conectas, tus atenciones se agregan solas a tu
            calendario. Google pedirá permiso solo sobre los eventos; no leemos el resto de tu
            calendario. Sin conectarlo puedes descargar el archivo .ics de cada atención.
          </p>
          {status.staleEventsMayRemain ? (
            <p className="m-0 text-base text-on-surface-variant">
              Los eventos creados antes de desconectar pueden seguir en tu calendario sin
              actualizar.
            </p>
          ) : null}
          <button
            type="button"
            className={`${PRIMARY_BUTTON_CLASS} w-fit`}
            disabled={pending}
            aria-busy={pending}
            onClick={() => void onConnect()}
          >
            {pending ? "Conectando…" : "Conectar Google Calendar"}
          </button>
        </>
      )}
    </section>
  );
}
