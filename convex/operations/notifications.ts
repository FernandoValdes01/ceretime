/**
 * Despacho de avisos por correo y Web Push (TI2-159, TI2-160).
 *
 * Funciones internas: no forman parte de la API que consumen Web o Mobile.
 * La mutation que registra un aviso encola su entrega por correo (y por push
 * solo si la persona activó suscripciones) y programa `dispatchEmailDelivery`
 * / `dispatchPushDelivery`. El barrido periódico de `crons.ts` vuelve a
 * programar las entregas cuyo próximo intento venció. Cada acción reserva y
 * registra en transacciones separadas y envía entre ambas con el adaptador
 * configurado por entorno.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalAction, internalMutation } from "../_generated/server";
import {
  dispatchEmailDelivery as dispatchEmailDeliveryUseCase,
  dispatchPushDelivery as dispatchPushDeliveryUseCase,
  type DeliveryDispatchOutcome,
} from "../application/notifications/dispatch";
import type { EmailDeliveryClaim, PushDeliveryClaim } from "../application/notifications/ports";
import {
  isAppointmentNotificationEventKind,
  isRequestNotificationEventKind,
  toNotificationEvent,
  type NotificationEvent,
} from "../domain/notifications/notification";
import {
  gmailEmailSender,
  gmailSenderConfigFromEnv,
} from "../infrastructure/notifications/gmail_sender";
import {
  claimEmailDelivery as claimEmailDeliveryRow,
  claimPushDelivery as claimPushDeliveryRow,
  deleteExpiredPushSubscriptionByEndpoint,
  listDueDeliveries,
  recordDeliveryAttempt,
} from "../infrastructure/notifications/repository";
import {
  webPushConfigFromEnv,
  webPushSender,
} from "../infrastructure/notifications/web_push_sender";
import {
  notificationDeliveryErrorUnion,
  notificationEventKindUnion,
} from "../infrastructure/validators";

/** Campos serializados del aviso mínimo, compartidos entre correo y push. */
const serializedEventFields = {
  kind: notificationEventKindUnion,
  appointmentId: v.optional(v.string()),
  requestId: v.optional(v.string()),
  recipientId: v.string(),
  occurredAt: v.number(),
};

/** Reserva serializada para correo. */
const claimValidator = v.union(
  v.object({
    status: v.literal("claimed"),
    eventId: v.string(),
    recipientEmail: v.string(),
    ...serializedEventFields,
  }),
  v.object({ status: v.literal("no_destination"), eventId: v.string() }),
  v.object({ status: v.literal("skipped") }),
);

/** Reserva serializada para Web Push, con las suscripciones vigentes. */
const pushClaimValidator = v.union(
  v.object({
    status: v.literal("claimed"),
    eventId: v.string(),
    subscriptions: v.array(
      v.object({
        endpoint: v.string(),
        p256dh: v.string(),
        auth: v.string(),
      }),
    ),
    ...serializedEventFields,
  }),
  v.object({ status: v.literal("no_subscriptions"), eventId: v.string() }),
  v.object({ status: v.literal("skipped") }),
);

const sendResultValidator = v.union(
  v.object({ status: v.literal("sent") }),
  v.object({ status: v.literal("failed"), errorCode: notificationDeliveryErrorUnion }),
);

function serializeEvent(event: NotificationEvent) {
  return {
    kind: event.kind,
    ...("appointmentId" in event
      ? { appointmentId: event.appointmentId }
      : { requestId: event.requestId }),
    recipientId: event.recipientId,
    occurredAt: event.occurredAt,
  };
}

function deserializeEvent(raw: {
  readonly kind: typeof notificationEventKindUnion.type;
  readonly appointmentId?: string;
  readonly requestId?: string;
  readonly recipientId: string;
  readonly occurredAt: number;
}): NotificationEvent {
  if (raw.appointmentId !== undefined && isAppointmentNotificationEventKind(raw.kind)) {
    return toNotificationEvent({
      kind: raw.kind,
      appointmentId: raw.appointmentId,
      recipientId: raw.recipientId,
      occurredAt: raw.occurredAt,
    });
  }
  if (raw.requestId !== undefined && isRequestNotificationEventKind(raw.kind)) {
    return toNotificationEvent({
      kind: raw.kind,
      requestId: raw.requestId,
      recipientId: raw.recipientId,
      occurredAt: raw.occurredAt,
    });
  }
  throw new Error("El aviso reservado no corresponde a un recurso válido.");
}

/** Reserva la entrega de correo para un intento y devuelve el aviso y el destino. */
export const claimEmailDelivery = internalMutation({
  args: { deliveryId: v.string(), now: v.number() },
  returns: claimValidator,
  handler: async (ctx, args) => {
    const claim = await claimEmailDeliveryRow(ctx, args.deliveryId, args.now);
    if (claim.status !== "claimed") return claim;
    return {
      status: "claimed" as const,
      eventId: claim.eventId,
      recipientEmail: claim.recipientEmail,
      ...serializeEvent(claim.event),
    };
  },
});

/** Registra el resultado del intento de correo y el próximo según la política. */
export const recordEmailDeliveryAttempt = internalMutation({
  args: { eventId: v.string(), result: sendResultValidator, attemptedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordDeliveryAttempt(ctx, "email", args.eventId, args.result, args.attemptedAt);
    return null;
  },
});

function toEmailDeliveryClaim(claim: typeof claimValidator.type): EmailDeliveryClaim {
  if (claim.status !== "claimed") return claim;
  return {
    status: "claimed",
    eventId: claim.eventId,
    event: deserializeEvent(claim),
    recipientEmail: claim.recipientEmail,
  };
}

/** Intenta una entrega por correo con el remitente configurado por entorno. */
export const dispatchEmailDelivery = internalAction({
  args: { deliveryId: v.string() },
  returns: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  handler: async (ctx, args): Promise<DeliveryDispatchOutcome> => {
    return await dispatchEmailDeliveryUseCase(
      {
        store: {
          claim: async (deliveryId, now) => {
            const claim: typeof claimValidator.type = await ctx.runMutation(
              internal.operations.notifications.claimEmailDelivery,
              { deliveryId, now },
            );
            return toEmailDeliveryClaim(claim);
          },
          recordAttempt: async (eventId, result, attemptedAt) => {
            await ctx.runMutation(internal.operations.notifications.recordEmailDeliveryAttempt, {
              eventId,
              result,
              attemptedAt,
            });
          },
        },
        sender: gmailEmailSender(gmailSenderConfigFromEnv(env)),
        now: () => Date.now(),
      },
      args.deliveryId,
    );
  },
});

/** Reserva la entrega push para un intento y devuelve el aviso y las suscripciones vigentes. */
export const claimPushDelivery = internalMutation({
  args: { deliveryId: v.string(), now: v.number() },
  returns: pushClaimValidator,
  handler: async (ctx, args) => {
    const claim = await claimPushDeliveryRow(ctx, args.deliveryId, args.now);
    if (claim.status !== "claimed") return claim;
    return {
      status: "claimed" as const,
      eventId: claim.eventId,
      subscriptions: [...claim.subscriptions],
      ...serializeEvent(claim.event),
    };
  },
});

/** Retira una suscripción push vencida (`404`/`410`) reportada por el servicio push. */
export const removeExpiredPushSubscription = internalMutation({
  args: { endpoint: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    return await deleteExpiredPushSubscriptionByEndpoint(ctx, args.endpoint);
  },
});

/** Registra el resultado del intento push y el próximo según la política. */
export const recordPushDeliveryAttempt = internalMutation({
  args: { eventId: v.string(), result: sendResultValidator, attemptedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordDeliveryAttempt(ctx, "push", args.eventId, args.result, args.attemptedAt);
    return null;
  },
});

function toPushDeliveryClaim(claim: typeof pushClaimValidator.type): PushDeliveryClaim {
  if (claim.status !== "claimed") return claim;
  return {
    status: "claimed",
    eventId: claim.eventId,
    event: deserializeEvent(claim),
    subscriptions: claim.subscriptions,
  };
}

/** Intenta una entrega Web Push con las claves VAPID configuradas por entorno (TI2-160). */
export const dispatchPushDelivery = internalAction({
  args: { deliveryId: v.string() },
  returns: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  handler: async (ctx, args): Promise<DeliveryDispatchOutcome> => {
    return await dispatchPushDeliveryUseCase(
      {
        store: {
          claim: async (deliveryId, now) => {
            const claim: typeof pushClaimValidator.type = await ctx.runMutation(
              internal.operations.notifications.claimPushDelivery,
              { deliveryId, now },
            );
            return toPushDeliveryClaim(claim);
          },
          removeExpiredSubscription: async (endpoint) => {
            await ctx.runMutation(internal.operations.notifications.removeExpiredPushSubscription, {
              endpoint,
            });
          },
          recordAttempt: async (eventId, result, attemptedAt) => {
            await ctx.runMutation(internal.operations.notifications.recordPushDeliveryAttempt, {
              eventId,
              result,
              attemptedAt,
            });
          },
        },
        sender: webPushSender(webPushConfigFromEnv(env)),
        now: () => Date.now(),
      },
      args.deliveryId,
    );
  },
});

/**
 * Barrido de reintentos compartido por correo y push (TI2-159, TI2-160).
 * Una entrega programada dos veces no sale dos veces: la reserva deja pasar
 * solo al primer despacho.
 */
export const scheduleDueNotificationDeliveries = internalMutation({
  args: {},
  returns: v.object({ email: v.number(), push: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();
    const dueEmail = await listDueDeliveries(ctx, "email", now);
    for (const deliveryId of dueEmail) {
      await ctx.scheduler.runAfter(0, internal.operations.notifications.dispatchEmailDelivery, {
        deliveryId,
      });
    }
    const duePush = await listDueDeliveries(ctx, "push", now);
    for (const deliveryId of duePush) {
      await ctx.scheduler.runAfter(0, internal.operations.notifications.dispatchPushDelivery, {
        deliveryId,
      });
    }
    return { email: dueEmail.length, push: duePush.length };
  },
});
