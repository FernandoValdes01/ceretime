import { useEffect, useState } from "react";
import {
  isWebPushSupported,
  readBrowserPushEndpoint,
  subscribeBrowserPush,
  unsubscribeBrowserPush,
} from "../../infrastructure/notifications/web-push.ts";
import {
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import {
  useActivatePushSubscription,
  useDeactivatePushSubscription,
  useOwnPushStatus,
} from "./notifications-data.ts";

/**
 * Activación opcional de avisos push en este navegador (TI2-172), sobre la API
 * de TI2-160.
 *
 * Es opcional y no cambia nada más: sin push, los avisos siguen en la bandeja
 * y la agenda funciona igual. El navegador pide su propio permiso; si lo
 * niega, se explica cómo cambiarlo sin insistir. Los avisos push solo llevan
 * un texto genérico, sin datos del acompañamiento.
 */

type Notice = { readonly tone: "status" | "alert"; readonly text: string };

export function PushPreference() {
  const status = useOwnPushStatus();
  const activate = useActivatePushSubscription();
  const deactivate = useDeactivatePushSubscription();
  const [browserEndpoint, setBrowserEndpoint] = useState<string | null | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const supported = isWebPushSupported();

  useEffect(() => {
    let active = true;
    readBrowserPushEndpoint()
      .then((endpoint) => {
        if (active) setBrowserEndpoint(endpoint);
      })
      .catch(() => {
        if (active) setBrowserEndpoint(null);
      });
    return () => {
      active = false;
    };
  }, []);

  async function onActivate(vapidPublicKey: string) {
    setPending(true);
    setNotice(null);
    try {
      const result = await subscribeBrowserPush(vapidPublicKey);
      if (result.status === "subscribed") {
        await activate(result.subscription);
        setBrowserEndpoint(result.subscription.endpoint);
        setNotice({ tone: "status", text: "Activamos los avisos en este navegador." });
      } else if (result.status === "permission_denied") {
        setNotice({
          tone: "alert",
          text: "El navegador no permitió las notificaciones. Puedes permitirlas en la configuración del sitio y volver a intentarlo.",
        });
      } else {
        setNotice({
          tone: "alert",
          text: "Este navegador no pudo activar los avisos. Los seguirás viendo aquí.",
        });
      }
    } catch {
      setNotice({
        tone: "alert",
        text: "No pudimos activar los avisos. Inténtalo de nuevo; los seguirás viendo aquí.",
      });
    } finally {
      setPending(false);
    }
  }

  async function onDeactivate() {
    setPending(true);
    setNotice(null);
    try {
      const endpoint = await unsubscribeBrowserPush();
      if (endpoint !== null) await deactivate({ endpoint });
      setBrowserEndpoint(null);
      setNotice({ tone: "status", text: "Desactivamos los avisos en este navegador." });
    } catch {
      setNotice({
        tone: "alert",
        text: "No pudimos desactivar los avisos. Inténtalo de nuevo.",
      });
    } finally {
      setPending(false);
    }
  }

  const activeHere = typeof browserEndpoint === "string";

  return (
    <section
      aria-labelledby="push-preference-title"
      className="flex flex-col gap-3 rounded-lg border border-border-low bg-surface-container-lowest p-6"
    >
      <h2 id="push-preference-title" className={SECTION_TITLE_CLASS}>
        Avisos en este navegador
      </h2>
      <p className="m-0 text-base text-on-surface-variant">
        Es opcional. Te avisamos con un mensaje genérico, sin datos de tus atenciones, aunque no
        tengas la aplicación abierta.
      </p>
      {notice === null ? null : (
        <p role={notice.tone} className="m-0 font-semibold text-on-surface">
          {notice.text}
        </p>
      )}
      {!supported ? (
        <p className="m-0 text-base text-on-surface">
          Este navegador no admite avisos push. Los seguirás viendo en esta bandeja.
        </p>
      ) : status === undefined || browserEndpoint === undefined ? (
        <p role="status" className="m-0 text-base text-on-surface-variant">
          Revisando los avisos de este navegador…
        </p>
      ) : status.vapidPublicKey === null ? (
        <p className="m-0 text-base text-on-surface">
          Los avisos push no están disponibles por ahora. Los seguirás viendo en esta bandeja.
        </p>
      ) : activeHere ? (
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} w-fit`}
          disabled={pending}
          aria-busy={pending}
          onClick={() => void onDeactivate()}
        >
          Desactivar avisos en este navegador
        </button>
      ) : (
        <button
          type="button"
          className={`${PRIMARY_BUTTON_CLASS} w-fit`}
          disabled={pending}
          aria-busy={pending}
          onClick={() => void onActivate(status.vapidPublicKey ?? "")}
        >
          Activar avisos en este navegador
        </button>
      )}
    </section>
  );
}
