import { paginationOptsValidator, paginationResultValidator } from "convex/server";
import { v, type Infer } from "convex/values";
import {
  listOwnNotifications as listOwnNotificationsUseCase,
  markNotificationRead as markNotificationReadUseCase,
  openNotification as openNotificationUseCase,
} from "../application/notifications/inbox";
import {
  activateOwnPushSubscription as activateOwnPushSubscriptionUseCase,
  deactivateOwnPushSubscription as deactivateOwnPushSubscriptionUseCase,
  getOwnPushStatus as getOwnPushStatusUseCase,
} from "../application/notifications/push";
import { env, mutation, query } from "../_generated/server";
import { authorizationReader } from "../infrastructure/accompaniments/repository";
import { appointmentAgendaReader } from "../infrastructure/appointments/repository";
import {
  notificationInboxReader,
  notificationReadMarker,
  pushSubscriptionReader,
  pushSubscriptionStore,
} from "../infrastructure/notifications/repository";
import { activeRequestViewerReader, requestReader } from "../infrastructure/requests/repository";
import {
  appointmentNotificationEventKindUnion,
  notificationContractVersionLiteral,
  notificationReadStatusUnion,
  requestNotificationEventKindUnion,
} from "../infrastructure/validators";
import { unwrapApiResult } from "./session";

/**
 * Borde de Presentación: bandeja de avisos (TI2-154).
 *
 * Adaptador delgado: resuelve la identidad en el servidor con
 * `ctx.auth.getUserIdentity()`, compone los adaptadores con el mismo `ctx` y
 * delega en `convex/application/notifications/inbox.ts`. Nunca recibe un
 * destinatario del cliente. Toda denegación llega como `{ code:
 * "unauthorized" }`, sin distinguir un aviso ajeno de uno inexistente ni de
 * uno cuyo recurso ya no se puede leer. Sin correo, push ni pantallas.
 */

const notificationBaseFields = {
  id: v.id("notificationEvents"),
  recipientId: v.id("users"),
  occurredAt: v.number(),
  readStatus: notificationReadStatusUnion,
  readAt: v.optional(v.number()),
  version: notificationContractVersionLiteral,
};

/**
 * Aviso propio: clase, referencia a exactamente un recurso, instante y
 * lectura. No lleva títulos, motivos, notas ni datos del recurso: el
 * contenido se lee en el recurso, con su propio permiso. La referencia usa
 * el tipo de cada contrato: `appointmentId` como texto, como en la agenda, y
 * `requestId` como `Id<"requests">`, como en las solicitudes.
 */
const notificationValidator = v.union(
  v.object({
    ...notificationBaseFields,
    kind: appointmentNotificationEventKindUnion,
    appointmentId: v.string(),
  }),
  v.object({
    ...notificationBaseFields,
    kind: requestNotificationEventKindUnion,
    requestId: v.id("requests"),
  }),
);

const notificationPageValidator = paginationResultValidator(notificationValidator);

// Aplicación lleva los identificadores de Convex con genéricos desde el
// repositorio, así que el handler declara el tipo del validador sin convertir.
type PublicNotification = Infer<typeof notificationValidator>;
type PublicNotificationPage = Infer<typeof notificationPageValidator>;

/**
 * Avisos propios, del más reciente al más antiguo. Sin `readStatus` trae
 * leídos y pendientes; con él, solo esos. A lo sumo 50 por página.
 */
export const listOwnNotifications = query({
  args: {
    paginationOpts: paginationOptsValidator,
    readStatus: v.optional(notificationReadStatusUnion),
  },
  returns: notificationPageValidator,
  handler: async (ctx, args): Promise<PublicNotificationPage> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await listOwnNotificationsUseCase(
        { auth: authorizationReader(ctx), notifications: notificationInboxReader(ctx) },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          paginationOpts: args.paginationOpts,
          ...(args.readStatus === undefined ? {} : { readStatus: args.readStatus }),
        },
      ),
    );
  },
});

/**
 * Abre un aviso propio y lo entrega solo si quien llama todavía puede leer su
 * recurso: con la respuesta, el cliente navega al detalle de la atención o de
 * la solicitud. No lo marca como leído.
 */
export const openNotification = query({
  args: { notificationId: v.id("notificationEvents") },
  returns: notificationValidator,
  handler: async (ctx, args): Promise<PublicNotification> => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await openNotificationUseCase(
        {
          auth: authorizationReader(ctx),
          notifications: notificationInboxReader(ctx),
          appointments: appointmentAgendaReader(ctx),
          requests: { viewers: activeRequestViewerReader(ctx), requests: requestReader(ctx) },
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, notificationId: args.notificationId },
      ),
    );
  },
});

/** Marca como leído un aviso propio; repetirlo conserva el instante original. */
export const markNotificationRead = mutation({
  args: { notificationId: v.id("notificationEvents") },
  returns: v.object({
    id: v.id("notificationEvents"),
    readStatus: v.literal("read"),
    readAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    const marked = unwrapApiResult(
      await markNotificationReadUseCase(
        {
          auth: authorizationReader(ctx),
          notifications: notificationReadMarker(ctx),
          now: Date.now,
        },
        { tokenIdentifier: identity?.tokenIdentifier ?? null, notificationId: args.notificationId },
      ),
    );
    return { ...marked, id: args.notificationId };
  },
});

/**
 * Estado push propio y clave pública VAPID para activar notificaciones en el
 * navegador (TI2-160). Nunca devuelve endpoints ni claves de suscripción.
 */
export const getOwnPushStatus = query({
  args: {},
  returns: v.object({
    enabled: v.boolean(),
    subscriptionCount: v.number(),
    vapidPublicKey: v.union(v.string(), v.null()),
  }),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    const publicKey = env.VAPID_PUBLIC_KEY?.trim() ?? "";
    return unwrapApiResult(
      await getOwnPushStatusUseCase(
        {
          auth: authorizationReader(ctx),
          subscriptions: pushSubscriptionReader(ctx),
          vapidPublicKey: publicKey === "" ? null : publicKey,
        },
        identity?.tokenIdentifier ?? null,
      ),
    );
  },
});

/** Activa o actualiza la suscripción Web Push propia del navegador actual (TI2-160). */
export const activatePushSubscription = mutation({
  args: {
    endpoint: v.string(),
    p256dh: v.string(),
    auth: v.string(),
    expirationTime: v.optional(v.number()),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await activateOwnPushSubscriptionUseCase(
        {
          auth: authorizationReader(ctx),
          subscriptions: pushSubscriptionStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          subscription: {
            endpoint: args.endpoint,
            p256dh: args.p256dh,
            auth: args.auth,
            ...(args.expirationTime === undefined ? {} : { expirationTime: args.expirationTime }),
          },
        },
      ),
    );
  },
});

/** Desactiva la suscripción Web Push propia correspondiente al endpoint (TI2-160). */
export const deactivatePushSubscription = mutation({
  args: { endpoint: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    return unwrapApiResult(
      await deactivateOwnPushSubscriptionUseCase(
        {
          auth: authorizationReader(ctx),
          subscriptions: pushSubscriptionStore(ctx),
          now: Date.now,
        },
        {
          tokenIdentifier: identity?.tokenIdentifier ?? null,
          endpoint: args.endpoint,
        },
      ),
    );
  },
});
