import { toExternalNotification } from "../../domain/notifications/notification";
import type { EmailDeliveryStore, EmailSender, EmailSendResult } from "./ports";

/**
 * Despacho de avisos por correo desde el evento persistido (TI2-159).
 *
 * Capa de Aplicación: reserva la entrega, compone el correo solo con la
 * variante externa genérica del aviso y registra el resultado. El texto sale
 * de `toExternalNotification`: no lleva CERETI, profesional, tipo de
 * acompañamiento, necesidades ni identificadores. La reserva impide que el
 * envío programado y el barrido de reintentos envíen la misma entrega a la
 * vez, y una entrega ya enviada no se repite.
 *
 * El despacho corre fuera de la mutation que originó el aviso: un fallo del
 * proveedor queda registrado en la entrega y nunca deshace ese cambio.
 */

export interface EmailDispatchDeps {
  readonly store: EmailDeliveryStore;
  readonly sender: EmailSender;
  readonly now: () => number;
}

/** Resultado del despacho de una entrega. */
export type EmailDispatchOutcome = "sent" | "failed" | "skipped";

/** Un error inesperado del remitente se registra como proveedor no disponible. */
async function sendSafely(
  sender: EmailSender,
  message: Parameters<EmailSender["send"]>[0],
): Promise<EmailSendResult> {
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
): Promise<EmailDispatchOutcome> {
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
