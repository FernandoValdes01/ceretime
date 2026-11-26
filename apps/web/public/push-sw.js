/*
 * Service worker de notificaciones Web Push (TI2-160).
 *
 * Muestra únicamente el texto genérico que llega desde el servidor (o el
 * respaldo genérico si el mensaje no trae cuerpo). Nunca incluye nombres de
 * unidad, profesionales, necesidades ni datos del acompañamiento.
 */

const FALLBACK_TITLE = "Tienes una actualización pendiente";
const FALLBACK_BODY = "Revisa las novedades en la aplicación.";

function parseGenericPayload(event) {
  if (!event.data) return { title: FALLBACK_TITLE, body: FALLBACK_BODY };
  try {
    const parsed = event.data.json();
    const title =
      typeof parsed?.title === "string" && parsed.title.trim() !== ""
        ? parsed.title.trim()
        : FALLBACK_TITLE;
    const body =
      typeof parsed?.body === "string" && parsed.body.trim() !== ""
        ? parsed.body.trim()
        : FALLBACK_BODY;
    return { title, body };
  } catch {
    return { title: FALLBACK_TITLE, body: FALLBACK_BODY };
  }
}

self.addEventListener("push", (event) => {
  const { title, body } = parseGenericPayload(event);
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "aviso-pendiente",
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow("/");
      return undefined;
    }),
  );
});
