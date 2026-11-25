/**
 * Despacho de avisos por correo (TI2-159).
 *
 * Funciones internas: no forman parte de la API que consumen Web o Mobile.
 * La mutation que registra un aviso encola su entrega y programa
 * `dispatchEmailDelivery`; el barrido periódico de `crons.ts` vuelve a
 * programar las entregas cuyo próximo intento venció. La acción no tiene base
 * de datos: reserva y registra con mutations internas, cada una en su propia
 * transacción, y envía entre ambas con el remitente configurado por entorno.
 */

import { v } from "convex/values";
import { internal } from "../_generated/api";
import { env, internalAction, internalMutation } from "../_generated/server";
import {
  dispatchEmailDelivery as dispatchEmailDeliveryUseCase,
  type EmailDispatchOutcome,
} from "../application/notifications/dispatch";
import type { EmailDeliveryClaim } from "../application/notifications/ports";
import {
  isAppointmentNotificationEventKind,
  isRequestNotificationEventKind,
  toNotificationEvent,
} from "../domain/notifications/notification";
import {
  gmailEmailSender,
  gmailSenderConfigFromEnv,
} from "../infrastructure/notifications/gmail_sender";
import {
  claimEmailDelivery as claimEmailDeliveryRow,
  listDueEmailDeliveries,
  recordEmailDeliveryAttempt as recordEmailDeliveryAttemptRow,
} from "../infrastructure/notifications/repository";
import {
  notificationDeliveryErrorUnion,
  notificationEventKindUnion,
} from "../infrastructure/validators";

/** Reserva serializada: el aviso viaja con su forma mínima, sin textos. */
const claimValidator = v.union(
  v.object({
    status: v.literal("claimed"),
    eventId: v.string(),
    recipientEmail: v.string(),
    kind: notificationEventKindUnion,
    appointmentId: v.optional(v.string()),
    requestId: v.optional(v.string()),
    recipientId: v.string(),
    occurredAt: v.number(),
  }),
  v.object({ status: v.literal("no_destination"), eventId: v.string() }),
  v.object({ status: v.literal("skipped") }),
);

const sendResultValidator = v.union(
  v.object({ status: v.literal("sent") }),
  v.object({ status: v.literal("failed"), errorCode: notificationDeliveryErrorUnion }),
);

/** Reserva la entrega para un intento y devuelve el aviso y el destino. */
export const claimEmailDelivery = internalMutation({
  args: { deliveryId: v.string(), now: v.number() },
  returns: claimValidator,
  handler: async (ctx, args) => {
    const claim = await claimEmailDeliveryRow(ctx, args.deliveryId, args.now);
    if (claim.status !== "claimed") return claim;
    const { event } = claim;
    return {
      status: "claimed" as const,
      eventId: claim.eventId,
      recipientEmail: claim.recipientEmail,
      kind: event.kind,
      ...("appointmentId" in event
        ? { appointmentId: event.appointmentId }
        : { requestId: event.requestId }),
      recipientId: event.recipientId,
      occurredAt: event.occurredAt,
    };
  },
});

/** Registra el resultado del intento y el próximo según la política de reintento. */
export const recordEmailDeliveryAttempt = internalMutation({
  args: { eventId: v.string(), result: sendResultValidator, attemptedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await recordEmailDeliveryAttemptRow(ctx, args.eventId, args.result, args.attemptedAt);
    return null;
  },
});

/** Reconstruye el aviso validado por el dominio a partir de la reserva serializada. */
function toEmailDeliveryClaim(claim: typeof claimValidator.type): EmailDeliveryClaim {
  if (claim.status !== "claimed") return claim;
  if (claim.appointmentId !== undefined && isAppointmentNotificationEventKind(claim.kind)) {
    return {
      status: "claimed",
      eventId: claim.eventId,
      event: toNotificationEvent({
        kind: claim.kind,
        appointmentId: claim.appointmentId,
        recipientId: claim.recipientId,
        occurredAt: claim.occurredAt,
      }),
      recipientEmail: claim.recipientEmail,
    };
  }
  if (claim.requestId !== undefined && isRequestNotificationEventKind(claim.kind)) {
    return {
      status: "claimed",
      eventId: claim.eventId,
      event: toNotificationEvent({
        kind: claim.kind,
        requestId: claim.requestId,
        recipientId: claim.recipientId,
        occurredAt: claim.occurredAt,
      }),
      recipientEmail: claim.recipientEmail,
    };
  }
  throw new Error("El aviso reservado no corresponde a un recurso válido.");
}

/** Intenta una entrega por correo con el remitente configurado por entorno. */
export const dispatchEmailDelivery = internalAction({
  args: { deliveryId: v.string() },
  returns: v.union(v.literal("sent"), v.literal("failed"), v.literal("skipped")),
  handler: async (ctx, args): Promise<EmailDispatchOutcome> => {
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

/**
 * Barrido de reintentos: programa el despacho de las entregas cuyo próximo
 * intento venció. Una entrega programada dos veces no sale dos veces: la
 * reserva deja pasar solo al primer despacho.
 */
export const scheduleDueEmailDeliveries = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const due = await listDueEmailDeliveries(ctx, Date.now());
    for (const deliveryId of due) {
      await ctx.scheduler.runAfter(0, internal.operations.notifications.dispatchEmailDelivery, {
        deliveryId,
      });
    }
    return due.length;
  },
});
