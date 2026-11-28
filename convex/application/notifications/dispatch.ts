import type { NotificationDeliveryError } from "../../domain/notifications/delivery";
import { toExternalNotification } from "../../domain/notifications/notification";
import type {
  DeliverySendResult,
  EmailDeliveryStore,
  EmailSender,
  PrivacyDeliveryGate,
  PushDeliveryStore,
  PushSender,
  PushSendResult,
  PushSubscriptionTarget,
} from "./ports";

/**
 * Despacho de avisos por canal desde el evento persistido (TI2-159, TI2-160).
 *
 * Capa de Aplicación: reserva la entrega del canal (correo o push), compone el
 * mensaje solo con la variante externa genérica del aviso y registra el
 * resultado. El texto sale de `toExternalNotification`: no lleva CERETI,
 * profesional, tipo de acompañamiento, necesidades ni identificadores. La
 * reserva impide que el envío programado y el barrido de reintentos envíen la
 * misma entrega a la vez, y una entrega ya enviada no se repite.
 *
 * El despacho corre fuera de la mutation que originó el aviso: un fallo del
 * proveedor queda registrado en la entrega y nunca deshace ese cambio. En el
 * canal push, una suscripción vencida (`404`/`410`) se retira de inmediato.
 *
 * Antes de reservar, la compuerta del bloqueo (TI2-168) suspende el aviso
 * cuando el titular de su recurso —no necesariamente el destinatario— tiene
 * un bloqueo vigente que cubre `notifications`: la fila queda pendiente y
 * vuelve a programarse al terminar el bloqueo. No se envía, no se cuenta como
 * intento y no se marca como entregada: suspender el tratamiento no borra ni
 * modifica el aviso ni su entrega. Las respuestas a una solicitud de
 * privacidad se entregan siempre, aunque ese bloqueo recién se haya creado.
 */

export interface EmailDispatchDeps {
  readonly store: EmailDeliveryStore;
  readonly sender: EmailSender;
  readonly now: () => number;
  /** Compuerta de bloqueo de privacidad (TI2-168): opcional para pruebas previas. */
  readonly privacy?: PrivacyDeliveryGate;
}

/** Resultado del despacho de una entrega por canal. */
export type DeliveryDispatchOutcome = "sent" | "failed" | "skipped";

/** Un error inesperado del remitente se registra como proveedor no disponible. */
async function sendSafely(
  sender: EmailSender,
  message: Parameters<EmailSender["send"]>[0],
): Promise<DeliverySendResult> {
  try {
    return await sender.send(message);
  } catch {
    return { status: "failed", errorCode: "provider_unavailable" };
  }
}

/** Intenta una entrega por correo y registra su resultado. */
export async function dispatchEmailDelivery(
  deps: EmailDispatchDeps,
  deliveryId: string,
): Promise<DeliveryDispatchOutcome> {
  if (deps.privacy !== undefined) {
    const gate = await deps.privacy.check(deliveryId, deps.now());
    if (gate.status === "blocked") {
      await deps.privacy.defer(deliveryId, gate.retryAt);
      return "skipped";
    }
  }

  const claim = await deps.store.claim(deliveryId, deps.now());
  if (claim.status === "skipped") return "skipped";
  if (claim.status === "no_destination") {
    await deps.store.recordAttempt(
      claim.eventId,
      { status: "failed", errorCode: "invalid_destination" },
      deps.now(),
    );
    return "failed";
  }

  const notice = toExternalNotification(claim.event);
  const result = await sendSafely(deps.sender, {
    to: claim.recipientEmail,
    subject: notice.title,
    text: notice.body,
  });
  await deps.store.recordAttempt(claim.eventId, result, deps.now());
  return result.status;
}

export interface PushDispatchDeps {
  readonly store: PushDeliveryStore;
  readonly sender: PushSender;
  readonly now: () => number;
  /** Compuerta de bloqueo de privacidad (TI2-168): opcional para pruebas previas. */
  readonly privacy?: PrivacyDeliveryGate;
}

async function sendPushSafely(
  sender: PushSender,
  target: PushSubscriptionTarget,
  message: Parameters<PushSender["send"]>[1],
): Promise<PushSendResult> {
  try {
    return await sender.send(target, message);
  } catch {
    return { status: "failed", errorCode: "provider_unavailable" };
  }
}

/**
 * Intenta una entrega push sobre todas las suscripciones vigentes del
 * destinatario, retira las vencidas y registra el resultado (TI2-160).
 */
export async function dispatchPushDelivery(
  deps: PushDispatchDeps,
  deliveryId: string,
): Promise<DeliveryDispatchOutcome> {
  if (deps.privacy !== undefined) {
    const gate = await deps.privacy.check(deliveryId, deps.now());
    if (gate.status === "blocked") {
      await deps.privacy.defer(deliveryId, gate.retryAt);
      return "skipped";
    }
  }

  const claim = await deps.store.claim(deliveryId, deps.now());
  if (claim.status === "skipped") return "skipped";
  if (claim.status === "no_subscriptions" || claim.subscriptions.length === 0) {
    await deps.store.recordAttempt(
      claim.eventId,
      { status: "failed", errorCode: "invalid_destination" },
      deps.now(),
    );
    return "failed";
  }

  const notice = toExternalNotification(claim.event);
  let sentCount = 0;
  let finalError: NotificationDeliveryError | undefined;

  for (const subscription of claim.subscriptions) {
    const result = await sendPushSafely(deps.sender, subscription, notice);
    if (result.status === "sent") {
      sentCount += 1;
    } else if (result.status === "expired") {
      await deps.store.removeExpiredSubscription(subscription.endpoint);
    } else if (finalError !== "delivery_uncertain") {
      finalError = result.errorCode;
    }
  }

  const finalResult: DeliverySendResult =
    sentCount > 0
      ? { status: "sent" }
      : { status: "failed", errorCode: finalError ?? "invalid_destination" };
  await deps.store.recordAttempt(claim.eventId, finalResult, deps.now());
  return finalResult.status;
}
