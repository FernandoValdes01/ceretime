import { useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  NOTIFICATION_EVENT_KIND_LABELS,
  type NotificationReadStatus,
} from "../../../../../convex/domain/index.ts";
import type { CalendarCallbackStatus } from "../../application/calendar/calendar-link.ts";
import { StudentPanelErrorBoundary } from "../routes/student-portal.tsx";
import { isAuthorizationDenial } from "../shared/authorization-denial.ts";
import { formatAgendaInstant } from "../shared/date-format.ts";
import { EmptyState, LoadingState } from "../shared/view-states.tsx";
import {
  FOCUS_CLASS,
  PAGE_CLASS,
  PAGE_TITLE_CLASS,
  SECONDARY_BUTTON_CLASS,
  SECTION_TITLE_CLASS,
} from "../estudiante/student-page-classes.ts";
import { CalendarLinkPanel } from "./calendar-link-panel.tsx";
import {
  NOTIFICATIONS_PAGE_SIZE,
  useMarkNotificationRead,
  useOpenNotification,
  useOwnNotifications,
  type OwnNotification,
} from "./notifications-data.ts";
import { PushPreference } from "./push-preference.tsx";

/**
 * Bandeja de avisos del Estudiante y del Profesional (TI2-172).
 *
 * Lista los avisos propios con leídos y pendientes (TI2-154). Al abrir uno,
 * el Backend vuelve a evaluar el permiso sobre su recurso: si sigue vigente,
 * se marca como leído y se navega al detalle; si no, se avisa sin revelar el
 * motivo y el aviso sigue en la bandeja. El texto sale de la clase del aviso,
 * sin datos del recurso. Debajo están las preferencias opcionales: avisos
 * push en este navegador y el vínculo con Google Calendar.
 */

export type NotificationsAudience = "student" | "professional";

const FILTERS: ReadonlyArray<{ value: NotificationReadStatus | undefined; label: string }> = [
  { value: undefined, label: "Todos" },
  { value: "pending", label: "Pendientes" },
  { value: "read", label: "Leídos" },
];

export function NotificationsPage({
  audience,
  calendarStatus,
}: {
  audience: NotificationsAudience;
  calendarStatus?: CalendarCallbackStatus;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [filter, setFilter] = useState<NotificationReadStatus | undefined>(undefined);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <section aria-labelledby="notifications-title" className={PAGE_CLASS}>
      <div className="flex flex-col gap-2">
        <h1
          id="notifications-title"
          ref={headingRef}
          tabIndex={-1}
          className={`${PAGE_TITLE_CLASS} ${FOCUS_CLASS}`}
        >
          Avisos
        </h1>
        <p className="m-0 text-base text-on-surface-variant">
          Novedades de tus solicitudes y atenciones. Abre un aviso para ver el detalle.
        </p>
      </div>
      <fieldset className="m-0 flex flex-wrap gap-2 border-0 p-0">
        <legend className="mb-2 p-0 text-base font-semibold text-on-surface">Mostrar</legend>
        {FILTERS.map((option) => {
          const selected = filter === option.value;
          return (
            <button
              key={option.label}
              type="button"
              aria-pressed={selected}
              onClick={() => setFilter(option.value)}
              className={`min-h-[44px] rounded-full border-2 px-4 font-semibold ${
                selected
                  ? "border-primary bg-primary text-on-primary"
                  : "border-outline bg-surface-container-lowest text-on-surface"
              } ${FOCUS_CLASS}`}
            >
              {option.label}
            </button>
          );
        })}
      </fieldset>
      <StudentPanelErrorBoundary subject="tus avisos" level="section">
        {/* La clave vuelve a la primera página al cambiar el filtro. */}
        <NotificationList key={filter ?? "all"} filter={filter} audience={audience} />
      </StudentPanelErrorBoundary>
      <PushPreference />
      <CalendarLinkPanel callbackStatus={calendarStatus} />
    </section>
  );
}

function NotificationList({
  filter,
  audience,
}: {
  filter: NotificationReadStatus | undefined;
  audience: NotificationsAudience;
}) {
  const { results, status, loadMore } = useOwnNotifications(filter);
  const open = useOpenNotification();
  const markRead = useMarkNotificationRead();
  const goTo = useNotificationTarget(audience);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const loadingMore = status === "LoadingMore";
  const canLoadMore = status === "CanLoadMore" || loadingMore;

  async function onOpen(notification: OwnNotification) {
    if (openingId !== null) return;
    setOpeningId(notification.id);
    setNotice(null);
    try {
      const opened = await open(notification.id);
      if (opened.readStatus === "pending") await markRead(opened.id);
      goTo(opened);
    } catch (error) {
      setNotice(
        isAuthorizationDenial(error)
          ? "Ya no tienes acceso al detalle de este aviso. Si crees que es un error, comunícate con CERETI."
          : "No pudimos abrir el aviso. Inténtalo de nuevo.",
      );
    } finally {
      setOpeningId(null);
    }
  }

  async function onMarkRead(notification: OwnNotification) {
    setNotice(null);
    try {
      await markRead(notification.id);
    } catch {
      setNotice("No pudimos marcar el aviso como leído. Inténtalo de nuevo.");
    }
  }

  if (status === "LoadingFirstPage") return <LoadingState label="Cargando tus avisos…" />;

  return (
    <section aria-labelledby="notifications-list-title" className="flex flex-col gap-3">
      <h2 id="notifications-list-title" className={SECTION_TITLE_CLASS}>
        {filter === "pending" ? "Pendientes" : filter === "read" ? "Leídos" : "Todos los avisos"}
      </h2>
      {notice === null ? null : (
        <p role="alert" className="m-0 font-semibold text-error">
          {notice}
        </p>
      )}
      {results.length === 0 && !canLoadMore ? (
        <EmptyState
          title={
            filter === "pending"
              ? "No tienes avisos pendientes."
              : filter === "read"
                ? "Todavía no marcas avisos como leídos."
                : "Todavía no tienes avisos."
          }
        >
          <p>Aquí aparecerán las novedades de tus solicitudes y atenciones.</p>
        </EmptyState>
      ) : (
        <ul role="list" className="m-0 grid list-none gap-3 p-0">
          {results.map((notification) => {
            const pending = notification.readStatus === "pending";
            const label = NOTIFICATION_EVENT_KIND_LABELS[notification.kind];
            return (
              <li
                key={notification.id}
                className={`flex flex-col gap-2 rounded-lg border bg-surface-container-lowest p-4 ${
                  pending ? "border-l-4 border-border-low border-l-primary" : "border-border-low"
                }`}
              >
                <p className="m-0 flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-on-surface">{label}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-sm font-bold ${
                      pending
                        ? "bg-primary-fixed text-on-primary-fixed"
                        : "bg-surface-container-high text-on-surface-variant"
                    }`}
                  >
                    {pending ? "Pendiente" : "Leído"}
                  </span>
                </p>
                <p className="m-0 text-sm text-on-surface-variant">
                  {formatAgendaInstant(notification.occurredAt)}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    className={SECONDARY_BUTTON_CLASS}
                    disabled={openingId !== null}
                    aria-busy={openingId === notification.id}
                    aria-label={`Ver el detalle: ${label}`}
                    onClick={() => void onOpen(notification)}
                  >
                    {openingId === notification.id ? "Abriendo…" : "Ver detalle"}
                  </button>
                  {pending ? (
                    <button
                      type="button"
                      className={`min-h-[44px] rounded-[0.5rem] px-2 font-semibold text-primary underline ${FOCUS_CLASS}`}
                      aria-label={`Marcar como leído: ${label}`}
                      onClick={() => void onMarkRead(notification)}
                    >
                      Marcar como leído
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canLoadMore ? (
        <button
          type="button"
          className={`${SECONDARY_BUTTON_CLASS} w-fit`}
          disabled={loadingMore}
          aria-busy={loadingMore}
          onClick={() => loadMore(NOTIFICATIONS_PAGE_SIZE)}
        >
          {loadingMore ? "Cargando…" : "Cargar más"}
        </button>
      ) : null}
    </section>
  );
}

/** Navega al detalle del recurso del aviso, en el área de quien lo recibió. */
function useNotificationTarget(audience: NotificationsAudience) {
  const navigate = useNavigate();
  return (notification: OwnNotification) => {
    if ("appointmentId" in notification) {
      const params = { appointmentId: notification.appointmentId };
      void (audience === "student"
        ? navigate({ to: "/estudiante/atenciones/$appointmentId", params })
        : navigate({ to: "/profesional/agenda/$appointmentId", params }));
      return;
    }
    const params = { requestId: notification.requestId };
    void (audience === "student"
      ? navigate({ to: "/estudiante/solicitudes/$requestId", params })
      : navigate({ to: "/profesional/solicitudes/$requestId", params }));
  };
}
