import { useAction, useConvex, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { NotificationReadStatus } from "../../../../../convex/domain/index.ts";
// Provisorio (TI2-3): importa los tipos generados por ruta relativa hasta que
// el monorepo defina el alias o paquete interno compartido.
import { api } from "../../../../../convex/_generated/api";
import type { Id } from "../../../../../convex/_generated/dataModel";

/**
 * Bandeja de avisos, push y vínculo de Calendar en la Web (TI2-172).
 *
 * Cableado delgado sobre `api.presentation.notifications` (TI2-154, TI2-160)
 * y `api.presentation.calendar` (TI2-161). La autorización, el permiso
 * vigente sobre el recurso de cada aviso y el estado del vínculo los decide
 * el Backend; la Web no vuelve a comprobarlos.
 */

/** Tamaño de página; el Backend admite hasta 50. */
export const NOTIFICATIONS_PAGE_SIZE = 20;

/** Avisos propios del más reciente al más antiguo, con filtro opcional de lectura. */
export function useOwnNotifications(readStatus: NotificationReadStatus | undefined) {
  return usePaginatedQuery(
    api.presentation.notifications.listOwnNotifications,
    readStatus === undefined ? {} : { readStatus },
    { initialNumItems: NOTIFICATIONS_PAGE_SIZE },
  );
}

/**
 * Abre un aviso al elegirlo: el Backend lo entrega solo si quien llama todavía
 * puede leer su recurso. Es una consulta puntual, no una suscripción.
 */
export function useOpenNotification() {
  const convex = useConvex();
  return (notificationId: Id<"notificationEvents">) =>
    convex.query(api.presentation.notifications.openNotification, { notificationId });
}

export function useMarkNotificationRead() {
  const mark = useMutation(api.presentation.notifications.markNotificationRead);
  return (notificationId: Id<"notificationEvents">) => mark({ notificationId });
}

/** Estado push propio y clave pública VAPID; nunca trae endpoints ni claves. */
export function useOwnPushStatus() {
  return useQuery(api.presentation.notifications.getOwnPushStatus, {});
}

export function useActivatePushSubscription() {
  return useMutation(api.presentation.notifications.activatePushSubscription);
}

export function useDeactivatePushSubscription() {
  return useMutation(api.presentation.notifications.deactivatePushSubscription);
}

/** Estado del vínculo propio con Google Calendar. */
export function useCalendarLinkStatus() {
  return useQuery(api.presentation.calendar.getCalendarLinkStatus, {});
}

/** Registra el vínculo al volver de la autorización de Google. */
export function useConfirmCalendarLink() {
  return useMutation(api.presentation.calendar.confirmCalendarLink);
}

/** Revoca el permiso en Google y elimina el vínculo propio. */
export function useDisconnectCalendarLink() {
  return useAction(api.presentation.calendar.disconnectCalendarLink);
}

/** Aviso tal como lo entrega el Backend, derivado del contrato generado. */
export type OwnNotification = FunctionReturnType<
  typeof api.presentation.notifications.openNotification
>;
